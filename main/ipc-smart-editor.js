/**
 * Smart Editor v2 — AI-powered automatic video editing.
 * Three-phase approach:
 *   1. Transcribe audio → word-level timestamps
 *   2. AI plans editorial (which scenes match which narration)
 *   3. FFmpeg extracts clips + still frames → assembles final video
 *
 * Key improvements:
 *   - Episode summaries give AI context about what happens in each episode
 *   - Character-first matching ensures the right characters appear
 *   - Strict anti-repetition prevents reusing scenes
 *   - Gap filling ensures video covers full audio duration
 *   - Fallback between OpenAI and Elevate Labs APIs
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { CHAT_BASE } = require('./elevate-api');
const { findBinary, runFfmpeg, probeDuration, transcribe } = require('./whisper-utils');

const SMART_DIR = path.join(DATA_DIR, 'smart-editor');
const PARALLEL = Math.min(6, Math.max(2, Math.floor(os.cpus().length / 2)));

let cancelled = false;
let currentProcess = null;

function ensureSmartDir() {
  ensureDataDir();
  if (!fs.existsSync(SMART_DIR)) fs.mkdirSync(SMART_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// PHASE 1: TRANSCRIPTION → SEGMENTS
// ═══════════════════════════════════════════════════════════

function groupWordsIntoSegments(words) {
  if (!words || words.length === 0) return [];
  const segments = [];
  let cur = { words: [], startTime: words[0].start, endTime: words[0].end };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.words.push(w.word);
    cur.endTime = w.end;

    const isEnd = /[.!?]$/.test(w.word.trim());
    const nextGap = i < words.length - 1 ? words[i + 1].start - w.end : 999;
    const tooLong = cur.endTime - cur.startTime > 10;

    if (isEnd || nextGap > 0.5 || tooLong) {
      segments.push({
        text: cur.words.join(' ').trim(),
        startTime: cur.startTime,
        endTime: cur.endTime,
      });
      if (i < words.length - 1) {
        cur = { words: [], startTime: words[i + 1].start, endTime: words[i + 1].end };
      }
    }
  }
  if (cur.words.length > 0) {
    segments.push({ text: cur.words.join(' ').trim(), startTime: cur.startTime, endTime: cur.endTime });
  }
  return segments;
}

// ═══════════════════════════════════════════════════════════
// PHASE 2: SCENE DATABASE + AI PLANNING
// ═══════════════════════════════════════════════════════════

// Build complete scene database with episode context
function buildSceneDB(seriesList) {
  const scenes = [];
  const episodeSummaries = {};

  for (const series of seriesList) {
    for (const ep of (series.episodes || [])) {
      if (!ep.scenes || ep.scenes.length === 0) continue;

      const epScenes = [];
      for (const scene of ep.scenes) {
        if (!scene.description) continue;
        const entry = {
          id: `${ep.code}@${scene.time}`,
          episode: ep.code,
          time: scene.time,
          desc: scene.description,
          chars: (scene.characters || []).map(c => c.toLowerCase()),
          mood: scene.mood || 'unknown',
          filePath: ep.filePath,
        };
        scenes.push(entry);
        epScenes.push(entry);
      }

      // Auto-generate episode summary from its scenes
      if (epScenes.length > 0) {
        const allChars = [...new Set(epScenes.flatMap(s => s.chars))];
        const moods = {};
        epScenes.forEach(s => { moods[s.mood] = (moods[s.mood] || 0) + 1; });
        const topMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

        // Pick 3 representative descriptions (start, middle, end)
        const picks = [
          epScenes[0],
          epScenes[Math.floor(epScenes.length / 2)],
          epScenes[epScenes.length - 1],
        ];
        const summary = picks.map(p => p.desc.slice(0, 80)).join('. ');

        episodeSummaries[ep.code] = {
          chars: allChars.slice(0, 8),
          mood: topMood,
          sceneCount: epScenes.length,
          summary: summary.slice(0, 250),
        };
      }
    }
  }

  console.log(`[SmartEditor] Scene DB: ${scenes.length} scenes, ${Object.keys(episodeSummaries).length} episodes`);
  return { scenes, episodeSummaries };
}

// Character alias system for matching
function buildCharAliases(characters) {
  const map = {};
  for (const name of (characters || [])) {
    const low = name.toLowerCase();
    const parts = low.split(/\s+/);
    map[low] = low;
    if (parts[0].length > 2) map[parts[0]] = low;
    if (parts.length > 1 && parts[parts.length - 1].length > 2) map[parts[parts.length - 1]] = low;
    // Gravity Falls specific aliases
    if (parts[0] === 'stan') { map['stanley'] = low; map['grunkle stan'] = low; map['grunkle'] = low; map['mr. pines'] = low; }
    if (parts[0] === 'stanford') { map['ford'] = low; map['great uncle ford'] = low; map['author'] = low; }
    if (parts[0] === 'dipper') { map['mason'] = low; map['pine tree'] = low; }
    if (parts[0] === 'mabel') { map['shooting star'] = low; }
    if (parts[0] === 'soos') { map['jesus'] = low; map['handyman'] = low; }
    if (parts[0] === 'bill') { map['cipher'] = low; map['bill cipher'] = low; map['triangle'] = low; map['dream demon'] = low; }
    if (parts[0] === 'wendy') { map['corduroy'] = low; map['wendy corduroy'] = low; }
    if (parts[0] === 'gideon') { map['gleeful'] = low; map['lil gideon'] = low; }
    if (parts[0] === 'pacifica') { map['northwest'] = low; }
  }
  return map;
}

// Find characters mentioned in text
function findMentionedChars(text, aliases) {
  const low = text.toLowerCase();
  const found = new Set();
  // Sort by length descending so "grunkle stan" matches before "stan"
  const sortedAliases = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, fullName] of sortedAliases) {
    if (low.includes(alias)) found.add(fullName);
  }
  return [...found];
}

// Score a scene against voiceover text — CHARACTER MATCHING IS KING
function scoreScene(scene, voText, mentionedChars, contextKeywords) {
  let score = 0;
  const descLow = scene.desc.toLowerCase();

  // ── CHARACTER MATCHING (highest weight) ──
  for (const char of mentionedChars) {
    const charParts = char.split(/\s+/);
    // Scene has this character tagged
    if (scene.chars.some(c => c === char || charParts.some(p => p.length > 2 && c.includes(p)))) {
      score += 25;
    }
    // Character name appears in description
    for (const part of charParts) {
      if (part.length > 2 && descLow.includes(part)) score += 10;
    }
  }

  // Penalty: scene shows characters NOT mentioned (less relevant)
  if (mentionedChars.length > 0 && scene.chars.length > 0) {
    const anyMatch = scene.chars.some(c =>
      mentionedChars.some(m => m.includes(c) || c.includes(m.split(' ')[0]))
    );
    if (!anyMatch) score -= 15; // strong penalty for wrong characters
  }

  // Extra penalty: if voiceover talks about kids/fun/solving mysteries and scene shows villains
  if (/kid|child|fun|play|mystery|solving|bond|heart|together/i.test(voLow)) {
    if (scene.chars.some(c => /bill|cipher|gideon|ghost|monster|demon/i.test(c))) {
      score -= 20; // don't show villains when talking about fun/kids
    }
  }

  // ── KEYWORD MATCHING ──
  for (const kw of contextKeywords) {
    if (descLow.includes(kw)) score += 3;
  }

  // ── CONTEXTUAL PATTERNS ──
  const voLow = voText.toLowerCase();
  // Objects & places
  if (/journal|diário|diary|book|livro/i.test(voLow) && /journal|book|diary|red book|gold|hand symbol/i.test(descLow)) score += 12;
  if (/portal|máquina|machine/i.test(voLow) && /portal|machine|glow|basement|device/i.test(descLow)) score += 12;
  if (/mystery shack|cabana|shack/i.test(voLow) && /shack|mystery|gift shop|tourist/i.test(descLow)) score += 8;
  if (/forest|floresta|woods/i.test(voLow) && /forest|tree|wood|outdoor|pine/i.test(descLow)) score += 6;
  if (/cipher wheel|zodiac|wheel/i.test(voLow) && /wheel|zodiac|symbol|cipher/i.test(descLow)) score += 10;

  // Actions & emotions
  if (/fight|luta|batalha|battle/i.test(voLow) && /fight|battle|attack|punch|combat/i.test(descLow)) score += 8;
  if (/secret|segredo|escond|hid/i.test(voLow) && /secret|hidden|door|basement|behind/i.test(descLow)) score += 8;
  if (/young|pequen|criança|kid|child|boy|menino/i.test(voLow) && /young|child|kid|boy|small|beach/i.test(descLow)) score += 8;
  if (/sad|triste|cry|chorar|emotional/i.test(voLow) && /sad|cry|tear|emotional|hug/i.test(descLow)) score += 6;
  if (/scary|medo|assust|creepy/i.test(voLow) && /scary|dark|shadow|creature|monster/i.test(descLow)) score += 6;

  // Mood matching
  if (scene.mood === 'action' && /luta|atac|corr|fug|explo|fight|run|chase|battle/i.test(voLow)) score += 4;
  if (scene.mood === 'dramatic' && /segredo|mistér|escur|perigo|secret|dark|danger|reveal/i.test(voLow)) score += 4;
  if (scene.mood === 'quiet' && /calm|paz|tranquil|quiet|peace|think|reflect/i.test(voLow)) score += 3;

  return score;
}

// Extract meaningful keywords from voiceover text
function extractKeywords(text) {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'about', 'between', 'under', 'above', 'but', 'and',
    'or', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all',
    'any', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just',
    'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
    'why', 'its', 'his', 'her', 'their', 'our', 'your', 'my', 'it', 'he', 'she', 'they', 'we',
    'you', 'me', 'him', 'them', 'us', 'que', 'de', 'da', 'do', 'em', 'um', 'uma', 'para',
    'com', 'por', 'mas', 'como', 'mais', 'também', 'não', 'se', 'ou', 'já', 'são', 'foi',
    'era', 'ser', 'ter', 'está', 'este', 'essa', 'isso', 'ele', 'ela', 'eles', 'nos']);

  return text.toLowerCase()
    .replace(/[^a-záàâãéèêíìîóòôõúùûç\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

// Find best scenes for a voiceover batch — character-first, diversity-enforced
function findBestScenes(allScenes, episodeSummaries, voText, charAliases, usedSceneIds, maxScenes = 120) {
  const mentionedChars = findMentionedChars(voText, charAliases);
  const keywords = extractKeywords(voText);

  console.log(`[SmartEditor] Matching: chars=[${mentionedChars.join(',')}], keywords=${keywords.length}`);

  // Score all unused scenes (skip empty descriptions)
  const scored = [];
  for (const scene of allScenes) {
    if (usedSceneIds.has(scene.id)) continue;
    if (!scene.desc || scene.desc.length < 10) continue; // skip empty/broken scenes
    const score = scoreScene(scene, voText, mentionedChars, keywords);
    if (score >= 10) scored.push({ ...scene, score }); // minimum threshold
  }

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Diversify: don't take more than 15 scenes from the same episode
  const perEp = {};
  const result = [];
  for (const scene of scored) {
    if (result.length >= maxScenes) break;
    const epCount = perEp[scene.episode] || 0;
    if (epCount >= 15) continue;
    perEp[scene.episode] = epCount + 1;
    result.push(scene);
  }

  console.log(`[SmartEditor] Found ${result.length} relevant scenes (top score: ${result[0]?.score || 0})`);
  return result;
}

// Format scenes for AI prompt — compact but informative
function formatScenesForPrompt(scenes) {
  return scenes.map(s => {
    const chars = s.chars.length > 0 ? ` [${s.chars.join(', ')}]` : '';
    return `${s.episode}@${s.time}s${chars} (${s.mood}): ${s.desc.slice(0, 200)}`;
  }).join('\n');
}

// Build episode context — tell AI what happens in each episode
function buildEpisodeContext(episodeSummaries, relevantEpisodes) {
  const lines = [];
  for (const epCode of relevantEpisodes) {
    const info = episodeSummaries[epCode];
    if (!info) continue;
    const chars = info.chars.slice(0, 5).join(', ');
    lines.push(`${epCode}: ${chars} | ${info.mood} | ${info.summary.slice(0, 120)}`);
  }
  return lines.join('\n');
}

// ── Direct Scene Assignment — no AI needed for scene selection ──
// The scoring system already picks the right scenes. The AI was the bottleneck.

function generateEditorialPlan(segments, sceneDB, seriesName, characters, settings, onProgress) {
  const charAliases = buildCharAliases(characters);
  const usedSceneIds = new Set();
  const allItems = [];
  const effects = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];

  console.log(`[SmartEditor] Direct planning for ${segments.length} segments`);

  for (let i = 0; i < segments.length; i++) {
    if (cancelled) throw new Error('Cancelado');

    const seg = segments[i];
    const segDuration = seg.endTime - seg.startTime;
    if (segDuration < 0.5) continue;

    onProgress({
      phase: 'planning',
      percent: Math.round((i / segments.length) * 100),
      detail: `A planear segmento ${i + 1}/${segments.length}...`,
    });

    // Find best scenes for THIS specific segment
    const bestScenes = findBestScenes(
      sceneDB.scenes, sceneDB.episodeSummaries,
      seg.text, charAliases, usedSceneIds, 30
    );

    if (bestScenes.length === 0) continue;

    // Decide how many sub-segments to create for this voiceover segment
    // Short segments (< 4s): 1 clip. Medium (4-8s): 2 clips. Long (> 8s): 3+ clips.
    let subCount;
    if (segDuration < 4) subCount = 1;
    else if (segDuration < 8) subCount = 2;
    else subCount = Math.ceil(segDuration / 4);

    const subDuration = segDuration / subCount;
    let t = seg.startTime;

    for (let j = 0; j < subCount && j < bestScenes.length; j++) {
      const scene = bestScenes[j];
      const subEnd = Math.min(t + subDuration, seg.endTime);
      const dur = subEnd - t;
      if (dur < 1) break;

      // Alternate video_clip and still_frame
      // First sub-segment: video (shows the action)
      // Subsequent: alternate still/video
      const isVideo = j === 0 || j % 3 === 0;

      allItems.push({
        startTime: t,
        endTime: subEnd,
        type: isVideo ? 'video_clip' : 'still_frame',
        episode: scene.episode,
        sceneTime: scene.time,
        effect: effects[(allItems.length) % 4],
        clipDuration: isVideo ? Math.min(5, dur) : 0,
        _score: scene.score,
        _desc: scene.desc.slice(0, 80),
      });

      usedSceneIds.add(scene.id);
      t = subEnd;
    }
  }

  console.log(`[SmartEditor] Direct plan: ${allItems.length} items from ${segments.length} segments`);
  return allItems;
}

// ═══════════════════════════════════════════════════════════
// PHASE 2.5: VALIDATE AND FIX PLAN
// ═══════════════════════════════════════════════════════════

function validatePlan(plan, seriesData, audioDuration) {
  const episodes = {};
  for (const ep of (seriesData.episodes || [])) {
    episodes[ep.code] = ep;
  }

  const effects = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];
  const usedScenes = new Set();

  // First pass: clean and validate each item
  const cleaned = [];
  for (const item of plan) {
    // Verify episode exists
    if (!episodes[item.episode]) {
      // Find any valid episode
      const validEp = Object.keys(episodes)[0];
      if (!validEp) continue;
      item.episode = validEp;
    }

    // Prevent exact duplicates
    const key = `${item.episode}@${item.sceneTime}`;
    if (usedScenes.has(key)) {
      // Shift to nearby scene
      const ep = episodes[item.episode];
      if (ep?.scenes) {
        const available = ep.scenes.filter(s => !usedScenes.has(`${item.episode}@${s.time}`));
        if (available.length > 0) {
          item.sceneTime = available[Math.floor(Math.random() * available.length)].time;
        } else {
          item.sceneTime += 20 + Math.floor(Math.random() * 40);
        }
      } else {
        item.sceneTime += 20 + Math.floor(Math.random() * 40);
      }
    }
    usedScenes.add(`${item.episode}@${item.sceneTime}`);

    // Sanitize values
    item.startTime = parseFloat(item.startTime) || 0;
    item.endTime = parseFloat(item.endTime) || item.startTime + 5;
    item.sceneTime = Math.max(0, parseInt(item.sceneTime) || 0);
    item.type = item.type === 'still_frame' ? 'still_frame' : 'video_clip';
    item.effect = effects.includes(item.effect) ? item.effect : effects[cleaned.length % 4];
    item.clipDuration = item.type === 'video_clip' ? Math.min(5, item.endTime - item.startTime) : 0;

    // Enforce duration bounds
    let dur = item.endTime - item.startTime;
    if (dur < 2) { item.endTime = item.startTime + 2; dur = 2; }
    if (dur > 10) { item.endTime = item.startTime + 10; dur = 10; }

    cleaned.push(item);
  }

  // Sort by startTime
  cleaned.sort((a, b) => a.startTime - b.startTime);

  // Second pass: fill gaps and ensure continuity
  const final = [];
  let lastEnd = 0;

  for (const item of cleaned) {
    // Fill gap before this item
    const gap = item.startTime - lastEnd;
    if (gap > 0.5) {
      // Insert gap-filler segments
      let t = lastEnd;
      while (t < item.startTime - 0.3) {
        const gapDur = Math.min(6, item.startTime - t);
        if (gapDur < 1) break;
        // Use previous item's episode with shifted time
        const prevItem = final.length > 0 ? final[final.length - 1] : item;
        final.push({
          startTime: t,
          endTime: t + gapDur,
          type: 'still_frame',
          episode: prevItem.episode,
          sceneTime: (prevItem.sceneTime || 0) + 30 + Math.floor(Math.random() * 60),
          effect: effects[final.length % 4],
          clipDuration: 5,
        });
        t += gapDur;
      }
    }

    // Adjust item to start where last ended (prevent overlap)
    if (item.startTime < lastEnd) {
      const dur = item.endTime - item.startTime;
      item.startTime = lastEnd;
      item.endTime = lastEnd + dur;
    }

    final.push(item);
    lastEnd = item.endTime;
  }

  // Fill tail — extend to full audio duration using previous segments' episodes
  if (audioDuration && lastEnd < audioDuration - 1) {
    let t = lastEnd;
    // Cycle through previous items to get varied episodes/scenes
    let cycleIdx = 0;
    while (t < audioDuration - 0.5) {
      const dur = Math.min(6, audioDuration - t);
      if (dur < 1) break;
      // Pick from existing items, shifting the sceneTime
      const sourceItem = final.length > 0 ? final[cycleIdx % final.length] : { episode: 'S01E01', sceneTime: 60 };
      final.push({
        startTime: t,
        endTime: t + dur,
        type: 'still_frame',
        episode: sourceItem.episode,
        sceneTime: (sourceItem.sceneTime || 0) + 40 + Math.floor(Math.random() * 80),
        effect: effects[final.length % 4],
        clipDuration: 5,
      });
      t += dur;
      cycleIdx++;
    }
  }

  console.log(`[SmartEditor] Validated: ${plan.length} → ${final.length} segments, covers 0 → ${final[final.length - 1]?.endTime?.toFixed(1) || 0}s (audio: ${audioDuration?.toFixed(1) || '?'}s)`);
  return final;
}

// ═══════════════════════════════════════════════════════════
// PHASE 3: EXTRACTION + ASSEMBLY
// ═══════════════════════════════════════════════════════════

function extractVideoClip(episodePath, sceneTime, duration, outputPath) {
  const ffmpegPath = findBinary('ffmpeg');
  return runFfmpeg(ffmpegPath, [
    '-y', '-ss', String(sceneTime), '-i', episodePath,
    '-t', String(duration),
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
    outputPath,
  ], null, 60000);
}

async function extractStillFrame(episodePath, sceneTime, duration, effect, outputPath) {
  const ffmpegPath = findBinary('ffmpeg');
  const tmpFrame = outputPath.replace('.mp4', '_frame.jpg');

  // Extract frame
  await runFfmpeg(ffmpegPath, [
    '-y', '-ss', String(sceneTime), '-i', episodePath,
    '-vframes', '1',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    '-q:v', '2', tmpFrame,
  ], null, 30000);

  if (!fs.existsSync(tmpFrame)) throw new Error(`Frame extraction failed at ${sceneTime}s`);

  // Ken Burns effect
  const frames = Math.round(duration * 30);
  const vfMap = {
    zoom_in: `scale=2880:1620,zoompan=z='min(zoom+0.001,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`,
    zoom_out: `scale=2880:1620,zoompan=z='if(eq(on\\,0)\\,1.5\\,max(zoom-0.001\\,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`,
    pan_left: `scale=2400:1350,crop=1920:1080:'(iw-ow)*(1-t/${duration})':0`,
    pan_right: `scale=2400:1350,crop=1920:1080:'(iw-ow)*t/${duration}':0`,
  };

  await runFfmpeg(ffmpegPath, [
    '-y', '-loop', '1', '-i', tmpFrame, '-t', String(duration),
    '-vf', vfMap[effect] || vfMap.zoom_in,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
    outputPath,
  ], null, 120000);

  try { fs.unlinkSync(tmpFrame); } catch (_) {}
}

async function extractAssets(plan, seriesData, tmpDir, onProgress) {
  const episodes = {};
  for (const ep of (seriesData.episodes || [])) {
    episodes[ep.code] = ep.filePath;
  }

  const total = plan.length;
  let completed = 0;

  for (let i = 0; i < plan.length; i += PARALLEL) {
    if (cancelled) throw new Error('Cancelado');

    const batch = plan.slice(i, i + PARALLEL);
    await Promise.all(batch.map(async (item, batchIdx) => {
      const idx = i + batchIdx;
      const outputPath = path.join(tmpDir, `seg_${String(idx).padStart(5, '0')}.mp4`);
      item._outputPath = outputPath;

      const episodePath = episodes[item.episode];
      const duration = Math.max(1, item.endTime - item.startTime);
      const ffmpegPath = findBinary('ffmpeg');

      if (!episodePath || !fs.existsSync(episodePath)) {
        // Fallback: use any available episode
        const fallback = Object.values(episodes).find(p => p && fs.existsSync(p));
        if (fallback) {
          const rndTime = 30 + Math.floor(Math.random() * 300);
          try {
            await extractStillFrame(fallback, rndTime, duration, item.effect || 'zoom_in', outputPath);
            return;
          } catch (_) {}
        }
        // Last resort: black frame
        await runFfmpeg(ffmpegPath, [
          '-y', '-f', 'lavfi', '-i', `color=c=0x1a1a2e:s=1920x1080:d=${duration}:r=30`,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', outputPath,
        ], null, 15000);
        return;
      }

      // Try extraction with retries (shift timestamp on failure)
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const t = item.sceneTime + (attempt * 20);
          if (item.type === 'video_clip') {
            const clipDur = Math.min(item.clipDuration || 5, duration);
            await extractVideoClip(episodePath, t, clipDur, outputPath);

            // Extend clip if shorter than segment
            if (clipDur < duration - 0.5) {
              const lastFrame = path.join(tmpDir, `lf_${idx}.jpg`);
              const extPath = path.join(tmpDir, `ext_${idx}.mp4`);
              try {
                await runFfmpeg(ffmpegPath, ['-y', '-sseof', '-0.1', '-i', outputPath, '-vframes', '1', '-q:v', '2', lastFrame], null, 15000);
                if (fs.existsSync(lastFrame)) {
                  const remaining = duration - clipDur;
                  const holdFrames = Math.round(remaining * 30);
                  await runFfmpeg(ffmpegPath, [
                    '-y', '-loop', '1', '-i', lastFrame, '-t', String(remaining),
                    '-vf', `scale=1920:1080,zoompan=z='min(zoom+0.001,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${holdFrames}:s=1920x1080:fps=30`,
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an', extPath,
                  ], null, 60000);

                  const concatTxt = path.join(tmpDir, `cat_${idx}.txt`);
                  fs.writeFileSync(concatTxt, `file '${outputPath.replace(/\\/g, '/')}'\nfile '${extPath.replace(/\\/g, '/')}'\n`);
                  const merged = path.join(tmpDir, `mrg_${idx}.mp4`);
                  await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c', 'copy', merged], null, 30000);
                  fs.unlinkSync(outputPath);
                  fs.renameSync(merged, outputPath);
                  try { fs.unlinkSync(extPath); fs.unlinkSync(lastFrame); fs.unlinkSync(concatTxt); } catch (_) {}
                }
              } catch (_) {} // Extension failed, just use the short clip
            }
          } else {
            await extractStillFrame(episodePath, t, duration, item.effect || 'zoom_in', outputPath);
          }
          ok = true;
        } catch (err) {
          console.warn(`[SmartEditor] Extract attempt ${attempt + 1} failed: ${err.message}`);
        }
      }

      // Final fallback
      if (!ok || !fs.existsSync(outputPath)) {
        try {
          await extractStillFrame(episodePath, 60, duration, 'zoom_in', outputPath);
        } catch (_) {
          await runFfmpeg(ffmpegPath, [
            '-y', '-f', 'lavfi', '-i', `color=c=0x1a1a2e:s=1920x1080:d=${duration}:r=30`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', outputPath,
          ], null, 15000);
        }
      }
    }));

    completed += batch.length;
    onProgress({ phase: 'extracting', percent: Math.round((completed / total) * 100), detail: `A extrair ${completed}/${total}...`, current: completed, total });
  }
}

async function assembleVideo(plan, audioPath, outputPath, tmpDir, onProgress) {
  const ffmpegPath = findBinary('ffmpeg');
  onProgress({ phase: 'assembling', percent: 0, detail: 'A montar vídeo...' });

  const concatFile = path.join(tmpDir, 'concat_final.txt');
  const lines = [];

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    if (item._outputPath && fs.existsSync(item._outputPath)) {
      lines.push(`file '${item._outputPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    }
  }

  if (lines.length === 0) throw new Error('Nenhum segmento extraído com sucesso.');
  console.log(`[SmartEditor] Assembly: ${lines.length} segments`);

  fs.writeFileSync(concatFile, lines.join('\n') + '\n');

  // Concat video
  const concatOut = path.join(tmpDir, 'concat_video.mp4');
  await runFfmpeg(ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
    '-c', 'copy', '-movflags', '+faststart', concatOut,
  ], null, 300000);

  onProgress({ phase: 'assembling', percent: 50, detail: 'A juntar áudio...' });

  // Merge with audio — use shortest to avoid desync
  await runFfmpeg(ffmpegPath, [
    '-y', '-i', concatOut, '-i', audioPath,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-map', '0:v:0', '-map', '1:a:0', '-shortest',
    '-movflags', '+faststart', outputPath,
  ], null, 300000);

  onProgress({ phase: 'done', percent: 100, detail: 'Concluído!' });
}

// ═══════════════════════════════════════════════════════════
// IPC REGISTRATION
// ═══════════════════════════════════════════════════════════

function register(mainWindow) {
  const send = (data) => {
    try { mainWindow.webContents.send('smart-editor-progress', data); } catch (_) {}
  };

  ipcMain.handle('smart-editor-generate', async (_event, opts) => {
    const { scriptId, scriptText: rawScript, audioPath: directAudio, voiceoverPath, seriesIds, outputFolder, outputFilename } = opts;
    const audioPath = directAudio || voiceoverPath;
    const settings = getSettings();

    if (!settings.elevateLabsApiKey && !settings.openaiApiKey) {
      return { success: false, error: 'API key não configurada. Vai a Definições.' };
    }
    if (!audioPath || !fs.existsSync(audioPath)) {
      return { success: false, error: `Ficheiro de áudio não encontrado: ${audioPath || '(vazio)'}` };
    }

    let scriptText = rawScript || '';
    if (scriptId && !scriptText) {
      const sd = readJson(path.join(DATA_DIR, 'scripts', `${scriptId}.json`));
      if (sd?.content) scriptText = sd.content;
    }

    cancelled = false;
    ensureSmartDir();
    const tmpDir = path.join(os.tmpdir(), `pinehat-smart-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Step 1: Transcribe
      send({ phase: 'transcribing', percent: 0, detail: 'A transcrever áudio...' });
      const transcription = await transcribe(audioPath, 0, settings, (p) => {
        send({ phase: 'transcribing', percent: Math.round(p.percent * 0.15), detail: p.detail || 'A transcrever...' });
      });

      if (!transcription.words || transcription.words.length === 0) {
        return { success: false, error: 'Transcrição falhou — sem palavras detectadas.' };
      }
      console.log(`[SmartEditor] Transcription: ${transcription.words.length} words`);

      let audioDuration = 0;
      try { audioDuration = await probeDuration(audioPath); } catch (_) {}
      console.log(`[SmartEditor] Audio: ${audioDuration}s`);

      // Step 2: Segment
      send({ phase: 'segmenting', percent: 15, detail: 'A agrupar segmentos...' });
      const segments = groupWordsIntoSegments(transcription.words);
      console.log(`[SmartEditor] ${segments.length} segments`);

      // Step 3: Build scene database
      send({ phase: 'planning', percent: 20, detail: 'A preparar cenas...' });
      const seriesData = readJson(path.join(DATA_DIR, 'series.json'));
      const allSeries = seriesData?.series || [];
      const selectedIds = Array.isArray(seriesIds) ? seriesIds : [seriesIds];

      let combined = { episodes: [], characters: [] };
      let seriesName = '';
      const seriesToSearch = [];

      for (const sid of selectedIds) {
        const s = allSeries.find(x => x.id === sid);
        if (!s) continue;
        seriesName += (seriesName ? ' + ' : '') + s.name;
        combined.episodes.push(...(s.episodes || []));
        combined.characters.push(...(s.characters || []));
        seriesToSearch.push(s);
      }

      const analyzed = combined.episodes.filter(e => e.scenes?.length > 0);
      if (analyzed.length === 0) {
        return { success: false, error: 'Nenhum episódio analisado. Corre a Análise Profunda primeiro.' };
      }

      const sceneDB = buildSceneDB(seriesToSearch);

      // Step 4: Direct Plan (no AI needed — scoring assigns scenes directly)
      const plan = generateEditorialPlan(
        segments, sceneDB, seriesName, combined.characters, settings,
        (p) => send({ phase: 'planning', percent: 20 + Math.round(p.percent * 0.30), detail: p.detail }),
      );
      console.log(`[SmartEditor] Raw plan: ${plan.length} items`);

      // Step 5: Validate
      send({ phase: 'validating', percent: 50, detail: 'A validar...' });
      const validPlan = validatePlan(plan, combined, audioDuration);
      console.log(`[SmartEditor] Valid: ${validPlan.length} items`);

      if (validPlan.length === 0) {
        return { success: false, error: 'Plano editorial vazio após validação.' };
      }

      // Save plan + debug log
      const planId = uuid();
      const debugLog = path.join(SMART_DIR, `${planId}_debug.txt`);
      const debugLines = validPlan.map((item, i) => {
        const seg = segments.find(s => s.startTime <= item.startTime && s.endTime >= item.startTime);
        const voText = seg ? seg.text.slice(0, 50) : '(gap filler)';
        const desc = item._desc || '';
        const score = item._score || 0;
        return `${i}: [${item.startTime.toFixed(1)}-${item.endTime.toFixed(1)}s] ${item.type} ${item.episode}@${item.sceneTime}s (${score}pts) | VO: "${voText}" | Scene: "${desc}"`;
      });
      fs.writeFileSync(debugLog, debugLines.join('\n'), 'utf8');
      console.log(`[SmartEditor] Debug log saved: ${debugLog}`);

      writeJson(path.join(SMART_DIR, `${planId}.json`), {
        id: planId, seriesName, segments, plan: validPlan, audioPath,
        scriptText: scriptText?.slice(0, 500), createdAt: new Date().toISOString(),
      });

      // Step 6: Extract
      await extractAssets(validPlan, combined, tmpDir, (p) => {
        send({ phase: 'extracting', percent: 50 + Math.round(p.percent * 0.35), detail: p.detail, current: p.current, total: p.total });
      });

      // Step 7: Assemble
      const finalOut = path.join(outputFolder || tmpDir, outputFilename || 'smart_edit.mp4');
      await assembleVideo(validPlan, audioPath, finalOut, tmpDir, (p) => {
        send({ phase: p.phase, percent: 85 + Math.round(p.percent * 0.15), detail: p.detail });
      });

      return {
        success: true, outputPath: finalOut, planId,
        segmentCount: validPlan.length,
        clipCount: validPlan.filter(i => i.type === 'video_clip').length,
        frameCount: validPlan.filter(i => i.type === 'still_frame').length,
      };
    } catch (err) {
      if (err.message === 'Cancelado') return { success: false, error: 'Cancelado pelo utilizador.' };
      console.error('[SmartEditor] Error:', err);
      return { success: false, error: err.message };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  ipcMain.handle('smart-editor-cancel', () => {
    cancelled = true;
    if (currentProcess) try { currentProcess.kill('SIGTERM'); } catch (_) {}
    return { success: true };
  });
}

module.exports = { register };
