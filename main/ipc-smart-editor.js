/**
 * Smart Editor — AI-powered automatic video editing.
 * Syncs B-Roll clips and still frames with voiceover narration.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { CHAT_BASE } = require('./elevate-api');
const { findBinary, runFfmpeg, probeDuration, transcribe } = require('./whisper-utils');

const SMART_DIR = path.join(DATA_DIR, 'smart-editor');
const PARALLEL = Math.min(8, Math.max(2, Math.floor(os.cpus().length / 2)));

let cancelled = false;
let currentProcess = null;

function ensureSmartDir() {
  ensureDataDir();
  if (!fs.existsSync(SMART_DIR)) fs.mkdirSync(SMART_DIR, { recursive: true });
}

// ── Segment grouping: words → sentences ──

function groupWordsIntoSegments(words) {
  if (!words || words.length === 0) return [];

  const segments = [];
  let current = { words: [], startTime: words[0].start, endTime: words[0].end };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    current.words.push(w.word);
    current.endTime = w.end;

    const isEnd = /[.!?]$/.test(w.word.trim());
    const nextGap = (i < words.length - 1) ? words[i + 1].start - w.end : 999;
    const tooLong = current.endTime - current.startTime > 8; // max 8 seconds per segment

    if (isEnd || nextGap > 0.5 || tooLong) {
      segments.push({
        text: current.words.join(' ').trim(),
        startTime: current.startTime,
        endTime: current.endTime,
      });
      if (i < words.length - 1) {
        current = { words: [], startTime: words[i + 1].start, endTime: words[i + 1].end };
      }
    }
  }

  // Push remaining
  if (current.words.length > 0) {
    segments.push({
      text: current.words.join(' ').trim(),
      startTime: current.startTime,
      endTime: current.endTime,
    });
  }

  return segments;
}

// ── Build scene database for AI ──
// Two-phase: full DB for search, compact per-batch for prompt

function buildFullSceneDatabase(seriesList) {
  const allScenes = [];
  for (const series of seriesList) {
    for (const ep of (series.episodes || [])) {
      if (!ep.scenes || ep.scenes.length === 0) continue;
      for (const scene of ep.scenes) {
        if (!scene.description) continue;
        allScenes.push({
          episode: ep.code,
          time: scene.time,
          description: scene.description,
          characters: scene.characters || [],
          mood: scene.mood || 'unknown',
        });
      }
    }
  }
  console.log(`[SmartEditor] Full scene DB: ${allScenes.length} scenes`);
  return allScenes;
}

// Build character aliases for better matching
function buildCharacterAliases(characters) {
  const aliases = {};
  for (const name of (characters || [])) {
    const lower = name.toLowerCase();
    const parts = lower.split(/\s+/);
    // Full name
    aliases[lower] = lower;
    // First name only
    if (parts[0].length > 2) aliases[parts[0]] = lower;
    // Last name only
    if (parts.length > 1 && parts[parts.length - 1].length > 2) aliases[parts[parts.length - 1]] = lower;
    // Common variations
    if (parts[0] === 'stan') { aliases['stanley'] = lower; aliases['grunkle stan'] = lower; aliases['grunkle'] = lower; }
    if (parts[0] === 'stanford') { aliases['ford'] = lower; aliases['great uncle ford'] = lower; }
    if (parts[0] === 'dipper') { aliases['mason'] = lower; }
    if (parts[0] === 'soos') { aliases['jesus'] = lower; aliases['soos ramirez'] = lower; }
    if (parts[0] === 'bill') { aliases['bill cipher'] = lower; aliases['cipher'] = lower; }
    if (parts[0] === 'mabel') { aliases['mabel pines'] = lower; }
    if (parts[0] === 'wendy') { aliases['wendy corduroy'] = lower; }
    if (parts[0] === 'gideon') { aliases['gideon gleeful'] = lower; aliases['gleeful'] = lower; }
    if (parts[0] === 'pacifica') { aliases['pacifica northwest'] = lower; aliases['northwest'] = lower; }
  }
  return aliases;
}

// For each batch, find the most relevant scenes based on voiceover text
function findRelevantScenes(allScenes, batchText, maxScenes = 80, characterAliases = {}) {
  const textLower = batchText.toLowerCase();
  const words = textLower.split(/\s+/).filter(w => w.length > 3);

  // Find which characters are mentioned in this batch text
  const mentionedChars = new Set();
  for (const [alias, fullName] of Object.entries(characterAliases)) {
    if (textLower.includes(alias)) mentionedChars.add(fullName);
  }

  // Score each scene by relevance to batch text
  const scored = allScenes.map(scene => {
    let score = 0;
    const descLower = scene.description.toLowerCase();
    const charNames = (scene.characters || []).map(c => c.toLowerCase());

    // Character name matches (highest priority)
    for (const charName of charNames) {
      const firstName = charName.split(' ')[0];
      // Direct character match in voiceover text
      if (mentionedChars.has(charName) || mentionedChars.has(firstName)) score += 15;
      if (textLower.includes(charName)) score += 10;
      if (firstName.length > 2 && textLower.includes(firstName)) score += 8;
    }

    // Check if scene description mentions characters from voiceover
    for (const mentioned of mentionedChars) {
      const mParts = mentioned.split(' ');
      for (const part of mParts) {
        if (part.length > 2 && descLower.includes(part)) score += 6;
      }
    }

    // Word overlap (keywords from voiceover found in scene description)
    for (const word of words) {
      if (descLower.includes(word)) score += 2;
    }

    // Context words (young, old, kids, children, etc.)
    if (/young|pequen|criança|kid|child|boy|menino/i.test(textLower) && /young|child|kid|boy|small/i.test(descLower)) score += 5;
    if (/secret|segredo|escond/i.test(textLower) && /secret|hid|door|basement|portal/i.test(descLower)) score += 5;
    if (/fight|luta|batalha|combat/i.test(textLower) && /fight|battle|attack|punch|hit/i.test(descLower)) score += 4;
    if (/mystery|mistério|journal|diário/i.test(textLower) && /journal|book|mystery|clue|code/i.test(descLower)) score += 4;

    // Mood matching
    if (scene.mood === 'action' && /luta|atac|corr|fug|explo|fight|run|chase/i.test(textLower)) score += 3;
    if (scene.mood === 'dramatic' && /segredo|mistér|escur|perigo|mort|secret|dark|danger/i.test(textLower)) score += 3;
    if (scene.mood === 'dialogue' && /disse|fal|convers|explic|said|talk|explain/i.test(textLower)) score += 2;

    return { ...scene, score };
  });

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.slice(0, maxScenes);

  // Format for prompt
  return relevant.map(s => {
    const chars = s.characters?.length ? ` [${s.characters.join(',')}]` : '';
    return `${s.episode}@${s.time}s${chars}: ${s.description.slice(0, 150)}`;
  }).join('\n');
}

// Legacy compact format for small scene databases
function buildSceneDatabase(series, maxPerEp = 3) {
  const lines = [];
  let totalScenes = 0;
  const MAX_TOTAL = 40;

  for (const ep of (series.episodes || [])) {
    if (!ep.scenes || ep.scenes.length === 0) continue;
    if (totalScenes >= MAX_TOTAL) break;

    const validScenes = ep.scenes.filter(s => s.description);
    const step = Math.max(1, Math.floor(validScenes.length / maxPerEp));
    const picked = [];
    for (let i = 0; i < validScenes.length && picked.length < maxPerEp; i += step) {
      picked.push(validScenes[i]);
    }

    if (picked.length === 0) continue;
    lines.push(`${ep.code}: ${picked.map(s => `[${s.time}s]${s.description.slice(0, 100)}`).join(' | ')}`);
    totalScenes += picked.length;
  }
  const result = lines.join('\n');
  console.log(`[SmartEditor] Scene DB: ${totalScenes} scenes, ${result.length} chars`);
  return result;
}

// ── AI Editorial Plan ──

async function generateEditorialPlan(segments, allScenes, seriesName, characters, settings, onProgress) {
  const apiKey = settings.elevateLabsApiKey;

  // Batch segments for long videos (max ~2 min of content per batch)
  const batches = [];
  let batch = [];
  let batchDuration = 0;
  const MAX_BATCH_DURATION = 120;

  for (const seg of segments) {
    const dur = seg.endTime - seg.startTime;
    if (batchDuration + dur > MAX_BATCH_DURATION && batch.length > 0) {
      batches.push(batch);
      batch = [];
      batchDuration = 0;
    }
    batch.push(seg);
    batchDuration += dur;
  }
  if (batch.length > 0) batches.push(batch);

  const allItems = [];
  const charactersList = (characters || []).join(', ') || 'unknown';
  const charAliases = buildCharacterAliases(characters);

  for (let b = 0; b < batches.length; b++) {
    if (cancelled) throw new Error('Cancelado');

    onProgress({
      phase: 'planning',
      percent: Math.round((b / batches.length) * 100),
      detail: `A planear batch ${b + 1}/${batches.length}...`,
    });

    const batchSegs = batches[b];
    const batchText = batchSegs.map(s => s.text).join(' ');
    const segList = batchSegs.map((s, i) => `${i}: [${s.startTime.toFixed(1)}s-${s.endTime.toFixed(1)}s] "${s.text}"`).join('\n');

    // Two-phase scene selection:
    // 1. Score ALL scenes and get top 150
    // 2. Group by episode and include FULL scene lists for top episodes
    const usedSceneKeys = new Set(allItems.map(it => `${it.episode}@${it.sceneTime}`));
    const unusedScenes = allScenes.filter(s => !usedSceneKeys.has(`${s.episode}@${s.time}`));

    // Score all scenes
    const textLower = batchText.toLowerCase();
    const mentionedChars = new Set();
    for (const [alias, fullName] of Object.entries(charAliases)) {
      if (textLower.includes(alias)) mentionedChars.add(fullName);
    }

    // Find top episodes by counting how many of their scenes match
    const episodeScores = {};
    for (const scene of unusedScenes) {
      if (!episodeScores[scene.episode]) episodeScores[scene.episode] = { score: 0, scenes: [] };
      episodeScores[scene.episode].scenes.push(scene);

      const descLower = scene.description.toLowerCase();
      const charNames = (scene.characters || []).map(c => c.toLowerCase());

      let score = 0;
      for (const charName of charNames) {
        if (mentionedChars.has(charName) || mentionedChars.has(charName.split(' ')[0])) score += 5;
      }
      for (const word of textLower.split(/\s+/).filter(w => w.length > 3)) {
        if (descLower.includes(word)) score += 1;
      }
      episodeScores[scene.episode].score += score;
    }

    // Pick top 5 episodes, include ALL their scenes (up to 30 each)
    const topEpisodes = Object.entries(episodeScores)
      .sort(([,a], [,b]) => b.score - a.score)
      .slice(0, 5);

    let relevantScenes = '';
    let sceneCount = 0;
    for (const [epCode, data] of topEpisodes) {
      const epScenes = data.scenes.slice(0, 30);
      relevantScenes += `\n--- ${epCode} ---\n`;
      for (const s of epScenes) {
        const chars = s.characters?.length ? ` [${s.characters.join(',')}]` : '';
        relevantScenes += `${epCode}@${s.time}s${chars}: ${s.description.slice(0, 180)}\n`;
        sceneCount++;
      }
    }

    // Also add top 20 scenes from other episodes (variety)
    const topEpCodes = new Set(topEpisodes.map(([code]) => code));
    const otherScenes = findRelevantScenes(
      unusedScenes.filter(s => !topEpCodes.has(s.episode)),
      batchText, 20, charAliases
    );
    if (otherScenes) {
      relevantScenes += `\n--- OTHER EPISODES ---\n${otherScenes}\n`;
    }

    console.log(`[SmartEditor] Batch ${b + 1}: ${sceneCount} scenes from ${topEpisodes.length} episodes + extras`);

    const usedList = allItems.length > 0
      ? `\nALREADY USED (do NOT reuse):\n${[...usedSceneKeys].slice(-15).join(', ')}\n`
      : '';

    const prompt = `You are an expert YouTube video editor. Create B-Roll for "${seriesName}".
Characters: ${charactersList}

VOICEOVER:
${segList}

SCENES (ranked by relevance — pick from these):
${relevantScenes}
${usedList}
Return ONLY a JSON array. Each object:
{"startTime":N,"endTime":N,"type":"video_clip"|"still_frame","episode":"S01E01","sceneTime":N,"clipDuration":N,"effect":"zoom_in"|"zoom_out"|"pan_left"|"pan_right"}

STRICT RULES:
1. MATCH what is being SAID. "Stan hid a secret" → show STAN, not Dipper.
2. episode@time from scenes list → use as episode + sceneTime in JSON.
3. NEVER reuse a scene already used above. Every scene must be UNIQUE.
4. video_clip: 3-5 seconds of actual video. still_frame: frozen frame with zoom/pan.
5. Cover ${batchSegs[0].startTime.toFixed(1)}s to ${batchSegs[batchSegs.length - 1].endTime.toFixed(1)}s fully, no gaps.
6. Segments: 3-8 seconds each. Mix video_clip and still_frame.
7. Vary effects: zoom_in, zoom_out, pan_left, pan_right.

JSON:`;

    console.log(`[SmartEditor] Prompt length: ${prompt.length} chars`);

    // Use OpenAI API for planning (more reliable, no daily token limit)
    const openaiKey = settings.openaiApiKey;
    const planApiBase = openaiKey ? 'https://api.openai.com/v1' : CHAT_BASE;
    const planApiKey = openaiKey || apiKey;
    const planModel = openaiKey ? 'gpt-4o' : 'gemini-2.5-pro';

    console.log(`[SmartEditor] Using ${openaiKey ? 'OpenAI (gpt-4o)' : 'Elevate Labs'} for planning`);

    const response = await fetch(`${planApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${planApiKey}`,
      },
      body: JSON.stringify({
        model: planModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    console.log(`[SmartEditor] Batch ${b + 1} raw response:`, JSON.stringify(data).slice(0, 500));
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    console.log(`[SmartEditor] Batch ${b + 1} content (${content.length} chars):`, content.slice(0, 300));

    // Check for empty response — might be rate limit or content filter
    if (!content) {
      const reason = data.choices?.[0]?.finish_reason || 'unknown';
      const errMsg = data.error?.message || '';
      const rawStr = JSON.stringify(data).slice(0, 400);
      console.error(`[SmartEditor] Empty response. Full:`, JSON.stringify(data));
      throw new Error(`Resposta vazia (${reason}). Raw: ${rawStr}`);
    }

    // Parse JSON from response — handle markdown code blocks, raw JSON, etc.
    let jsonStr = null;

    // Try 1: extract from ```json ... ``` block
    const codeBlockMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];

    // Try 2: find raw JSON array
    if (!jsonStr) {
      const rawMatch = content.match(/\[[\s\S]*\]/);
      if (rawMatch) jsonStr = rawMatch[0];
    }

    // Try 3: maybe it's just the array without brackets context
    if (!jsonStr) {
      // Try wrapping in brackets
      const objMatch = content.match(/\{[\s\S]*"type"[\s\S]*\}/g);
      if (objMatch) jsonStr = `[${objMatch.join(',')}]`;
    }

    if (!jsonStr) {
      console.error(`[SmartEditor] No JSON found in batch ${b + 1}. Full response:`, content);
      throw new Error(`AI não devolveu JSON válido no batch ${b + 1}. Resposta: "${content.slice(0, 200)}"`);
    }

    try {
      const items = JSON.parse(jsonStr);
      console.log(`[SmartEditor] Batch ${b + 1}: ${items.length} items parsed`);
      allItems.push(...items);
    } catch (e) {
      console.error(`[SmartEditor] JSON parse error in batch ${b + 1}:`, e.message, jsonStr.slice(0, 200));
      throw new Error(`Erro ao parsear JSON do batch ${b + 1}: ${e.message}`);
    }
  }

  return allItems;
}

// ── Validate and fix the editorial plan ──

function validatePlan(plan, series, audioDuration) {
  const episodes = {};
  for (const ep of (series.episodes || [])) {
    episodes[ep.code] = ep;
  }

  const MIN_DURATION = 2;   // minimum 2 seconds per segment
  const MAX_DURATION = 12;  // maximum 12 seconds per segment
  const effects = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];
  const usedScenes = new Set(); // track used scenes to prevent duplicates

  const valid = [];
  for (const item of plan) {
    // Check episode exists
    if (!episodes[item.episode]) {
      console.warn(`[SmartEditor] Episode ${item.episode} not found, skipping`);
      continue;
    }

    // Prevent duplicate scenes
    const sceneKey = `${item.episode}@${item.sceneTime}`;
    if (usedScenes.has(sceneKey)) {
      // Shift sceneTime by 10-30s to get a nearby but different scene
      item.sceneTime = (item.sceneTime || 0) + 10 + Math.floor(Math.random() * 20);
    }
    usedScenes.add(`${item.episode}@${item.sceneTime}`);
    // Ensure required fields
    item.startTime = parseFloat(item.startTime) || 0;
    item.endTime = parseFloat(item.endTime) || item.startTime + 5;
    item.sceneTime = parseInt(item.sceneTime) || 0;
    item.type = item.type === 'still_frame' ? 'still_frame' : 'video_clip';
    if (item.type === 'video_clip') {
      item.clipDuration = Math.min(parseFloat(item.clipDuration) || 5, 5);
    }
    if (item.type === 'still_frame') {
      item.effect = effects.includes(item.effect) ? item.effect : 'zoom_in';
    }

    // Enforce minimum duration
    let duration = item.endTime - item.startTime;
    if (duration < MIN_DURATION) {
      item.endTime = item.startTime + MIN_DURATION;
      duration = MIN_DURATION;
    }

    // Enforce maximum duration — split into multiple segments
    if (duration > MAX_DURATION) {
      let t = item.startTime;
      while (t < item.endTime) {
        const segEnd = Math.min(t + MAX_DURATION, item.endTime);
        const remaining = segEnd - t;
        if (remaining < MIN_DURATION && valid.length > 0) break; // skip tiny leftover
        valid.push({
          ...item,
          startTime: t,
          endTime: segEnd,
          type: valid.length % 3 === 0 ? 'video_clip' : 'still_frame',
          effect: effects[valid.length % effects.length],
          clipDuration: Math.min(5, segEnd - t),
        });
        t = segEnd;
      }
      continue; // already pushed split segments
    }

    valid.push(item);
  }

  // Sort by startTime
  valid.sort((a, b) => a.startTime - b.startTime);

  // Fill gaps — if there's a gap > 0.5s between segments, add a still frame
  const filled = [];
  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];

    if (filled.length > 0) {
      const prev = filled[filled.length - 1];
      const gap = item.startTime - prev.endTime;
      if (gap > 0.5) {
        // Fill gap with still frame from same or previous episode
        filled.push({
          startTime: prev.endTime,
          endTime: item.startTime,
          type: 'still_frame',
          episode: prev.episode,
          sceneTime: (prev.sceneTime || 0) + 10,
          effect: effects[filled.length % effects.length],
          clipDuration: 5,
        });
      }
    }

    filled.push(item);
  }

  // Fill end — if last segment ends before audio duration
  if (audioDuration && filled.length > 0) {
    const last = filled[filled.length - 1];
    const remaining = audioDuration - last.endTime;
    if (remaining > 1) {
      // Split remaining into MAX_DURATION chunks
      let t = last.endTime;
      while (t < audioDuration) {
        const segEnd = Math.min(t + MAX_DURATION, audioDuration);
        if (segEnd - t < 1) break;
        filled.push({
          startTime: t,
          endTime: segEnd,
          type: 'still_frame',
          episode: last.episode,
          sceneTime: (last.sceneTime || 0) + Math.floor(Math.random() * 60),
          effect: effects[filled.length % effects.length],
          clipDuration: 5,
        });
        t = segEnd;
      }
    }
  }

  console.log(`[SmartEditor] Validated: ${plan.length} → ${filled.length} segments (min ${MIN_DURATION}s, max ${MAX_DURATION}s)`);
  return filled;
}

// ── FFmpeg: Extract video clip ──

function extractVideoClip(episodePath, sceneTime, duration, outputPath) {
  const ffmpegPath = findBinary('ffmpeg');
  const args = [
    '-y', '-ss', String(sceneTime), '-i', episodePath,
    '-t', String(duration),
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
    outputPath,
  ];
  return runFfmpeg(ffmpegPath, args, null, 60000);
}

// ── FFmpeg: Extract still frame + Ken Burns ──

async function extractStillFrame(episodePath, sceneTime, duration, effect, outputPath) {
  const ffmpegPath = findBinary('ffmpeg');
  const tmpFrame = outputPath.replace('.mp4', '_frame.jpg');

  // Step 1: Extract frame at correct aspect ratio (scale to fit 1920x1080 area)
  await runFfmpeg(ffmpegPath, [
    '-y', '-ss', String(sceneTime), '-i', episodePath,
    '-vframes', '1',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    '-q:v', '2', tmpFrame,
  ], null, 30000);

  if (!fs.existsSync(tmpFrame)) {
    throw new Error(`Frame extraction failed at ${sceneTime}s`);
  }

  // Step 2: Ken Burns effect on the 1920x1080 frame
  const frames = Math.round(duration * 30); // 30fps
  let vf;

  // Scale up first for zoom headroom, then zoompan outputs 1920x1080
  switch (effect) {
    case 'zoom_in':
      vf = `scale=2880:1620,zoompan=z='min(zoom+0.001,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
      break;
    case 'zoom_out':
      vf = `scale=2880:1620,zoompan=z='if(eq(on\\,0)\\,1.5\\,max(zoom-0.001\\,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
      break;
    case 'pan_left':
      vf = `scale=2400:1350,crop=1920:1080:'(iw-ow)*(1-t/${duration})':0`;
      break;
    case 'pan_right':
      vf = `scale=2400:1350,crop=1920:1080:'(iw-ow)*t/${duration}':0`;
      break;
    default:
      vf = `scale=2160:1620,zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
  }

  await runFfmpeg(ffmpegPath, [
    '-y', '-loop', '1', '-i', tmpFrame, '-t', String(duration),
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
    outputPath,
  ], null, 120000);

  // Cleanup frame
  try { fs.unlinkSync(tmpFrame); } catch (_) {}
}

// ── Parallel asset extraction ──

async function extractAssets(plan, series, tmpDir, onProgress) {
  const episodes = {};
  for (const ep of (series.episodes || [])) {
    episodes[ep.code] = ep.filePath;
  }

  const total = plan.length;
  let completed = 0;

  // Process in parallel batches
  for (let i = 0; i < plan.length; i += PARALLEL) {
    if (cancelled) throw new Error('Cancelado');

    const batch = plan.slice(i, i + PARALLEL);
    await Promise.all(batch.map(async (item, batchIdx) => {
      const idx = i + batchIdx;
      const outputPath = path.join(tmpDir, `segment_${String(idx).padStart(5, '0')}.mp4`);
      item._outputPath = outputPath;

      const episodePath = episodes[item.episode];
      const duration = item.endTime - item.startTime;
      const ffmpegPath = findBinary('ffmpeg');

      if (!episodePath || !fs.existsSync(episodePath)) {
        console.warn(`[SmartEditor] Episode file not found: ${item.episode}`);
        // Try any available episode as fallback
        const fallbackEp = Object.values(episodes).find(p => p && fs.existsSync(p));
        if (fallbackEp) {
          const randomTime = Math.floor(Math.random() * 300) + 30;
          await extractStillFrame(fallbackEp, randomTime, duration, item.effect || 'zoom_in', outputPath).catch(() => {});
        }
        if (!fs.existsSync(outputPath)) {
          await runFfmpeg(ffmpegPath, [
            '-y', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:d=${duration}:r=30`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an',
            outputPath,
          ], null, 15000);
        }
        return;
      }

      // Try extraction with retry on different sceneTime
      let extracted = false;
      for (let attempt = 0; attempt < 3 && !extracted; attempt++) {
        try {
          const sceneTime = item.sceneTime + (attempt * 15); // shift 15s each retry

          if (item.type === 'video_clip') {
            const clipDur = Math.min(item.clipDuration || 5, duration);
            await extractVideoClip(episodePath, sceneTime, clipDur, outputPath);

            // If clip is shorter than segment, extend with freeze frame
            if (clipDur < duration - 0.1) {
              const extendPath = path.join(tmpDir, `extend_${String(idx).padStart(5, '0')}.mp4`);
              const lastFramePath = path.join(tmpDir, `lastframe_${idx}.jpg`);

              await runFfmpeg(ffmpegPath, ['-y', '-sseof', '-0.1', '-i', outputPath, '-vframes', '1', '-q:v', '2', lastFramePath], null, 15000);

              if (fs.existsSync(lastFramePath)) {
                const remaining = duration - clipDur;
                const holdFrames = Math.round(remaining * 30);
                await runFfmpeg(ffmpegPath, [
                  '-y', '-loop', '1', '-i', lastFramePath, '-t', String(remaining),
                  '-vf', `scale=1920:1080,zoompan=z='min(zoom+0.001,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${holdFrames}:s=1920x1080:fps=30`,
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
                  extendPath,
                ], null, 60000);

                const concatFile = path.join(tmpDir, `concat_${idx}.txt`);
                fs.writeFileSync(concatFile, `file '${outputPath.replace(/\\/g, '/')}'\nfile '${extendPath.replace(/\\/g, '/')}'\n`);
                const mergedPath = path.join(tmpDir, `merged_${String(idx).padStart(5, '0')}.mp4`);
                await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', mergedPath], null, 30000);

                fs.unlinkSync(outputPath);
                fs.renameSync(mergedPath, outputPath);
                try { fs.unlinkSync(extendPath); fs.unlinkSync(lastFramePath); fs.unlinkSync(concatFile); } catch (_) {}
              }
            }
          } else {
            await extractStillFrame(episodePath, sceneTime, duration, item.effect || 'zoom_in', outputPath);
          }
          extracted = true;
        } catch (err) {
          console.warn(`[SmartEditor] Extract attempt ${attempt + 1} failed for ${item.episode}@${item.sceneTime}s: ${err.message}`);
        }
      }

      // Final fallback: still frame from beginning of episode
      if (!extracted || !fs.existsSync(outputPath)) {
        console.warn(`[SmartEditor] All attempts failed, using fallback frame for segment ${idx}`);
        try {
          await extractStillFrame(episodePath, 60, duration, 'zoom_in', outputPath);
        } catch (_) {
          await runFfmpeg(ffmpegPath, [
            '-y', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:d=${duration}:r=30`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an',
            outputPath,
          ], null, 15000);
        }
      }
    }));

    completed += batch.length;
    onProgress({
      phase: 'extracting',
      percent: Math.round((completed / total) * 100),
      detail: `A extrair ${completed}/${total} segmentos...`,
      current: completed,
      total,
    });
  }
}

// ── Final assembly ──

async function assembleVideo(plan, audioPath, outputPath, tmpDir, onProgress) {
  const ffmpegPath = findBinary('ffmpeg');

  onProgress({ phase: 'assembling', percent: 0, detail: 'A juntar segmentos...' });

  // Write concat file — fill gaps with black frames for missing segments
  const concatFile = path.join(tmpDir, 'concat_final.txt');
  const lines = [];
  let missingCount = 0;

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    if (item._outputPath && fs.existsSync(item._outputPath)) {
      lines.push(`file '${item._outputPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    } else {
      // Create black frame for missing segment
      missingCount++;
      const dur = item.endTime - item.startTime;
      const blackPath = path.join(tmpDir, `black_${String(i).padStart(5, '0')}.mp4`);
      try {
        await runFfmpeg(ffmpegPath, [
          '-y', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:d=${dur}:r=30`,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an',
          blackPath,
        ], null, 15000);
        lines.push(`file '${blackPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      } catch (_) {
        console.warn(`[SmartEditor] Failed to create black frame for segment ${i}`);
      }
    }
  }

  console.log(`[SmartEditor] Assembly: ${lines.length} segments (${missingCount} missing → black frames)`);
  if (lines.length === 0) throw new Error('Nenhum segmento extraído com sucesso');

  fs.writeFileSync(concatFile, lines.join('\n'));

  // Concat video segments
  const concatOutput = path.join(tmpDir, 'concat_video.mp4');
  await runFfmpeg(ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
    '-c', 'copy', '-movflags', '+faststart',
    concatOutput,
  ], null, 300000);

  onProgress({ phase: 'assembling', percent: 50, detail: 'A juntar áudio...' });

  // Merge with voiceover audio
  await runFfmpeg(ffmpegPath, [
    '-y', '-i', concatOutput, '-i', audioPath,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-map', '0:v:0', '-map', '1:a:0',
    '-movflags', '+faststart',
    outputPath,
  ], null, 300000);

  onProgress({ phase: 'done', percent: 100, detail: 'Concluído!' });
}

// ── Register IPC handlers ──

function register(mainWindow) {
  const send = (data) => {
    try { mainWindow.webContents.send('smart-editor-progress', data); } catch (_) {}
  };

  // Main pipeline
  ipcMain.handle('smart-editor-generate', async (_event, opts) => {
    const { scriptId, scriptText: rawScriptText, audioPath: directAudioPath, voiceoverPath, seriesIds, outputFolder, outputFilename } = opts;
    const audioPath = directAudioPath || voiceoverPath;
    const settings = getSettings();

    if (!settings.elevateLabsApiKey) {
      return { success: false, error: 'API key não configurada. Vai a Definições.' };
    }

    console.log('[SmartEditor] audioPath:', audioPath);
    if (!audioPath || !fs.existsSync(audioPath)) {
      return { success: false, error: `Ficheiro de áudio não encontrado: ${audioPath || '(vazio)'}` };
    }

    // Load script text from ID if provided
    let scriptText = rawScriptText || '';
    if (scriptId && !scriptText) {
      const scriptPath = path.join(DATA_DIR, 'scripts', `${scriptId}.json`);
      const scriptData = readJson(scriptPath);
      if (scriptData && scriptData.content) {
        scriptText = scriptData.content;
      }
    }

    cancelled = false;
    ensureSmartDir();

    const tmpDir = path.join(os.tmpdir(), `pinehat-smart-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Step 1: Transcribe
      send({ phase: 'transcribing', percent: 0, detail: 'A transcrever áudio...' });
      const transcription = await transcribe(audioPath, 0, settings, (p) => {
        send({ phase: 'transcribing', percent: Math.round(p.percent * 0.2), detail: p.detail || 'A transcrever...' });
      });

      if (!transcription.words || transcription.words.length === 0) {
        return { success: false, error: 'Transcrição falhou — sem palavras detectadas.' };
      }

      console.log(`[SmartEditor] Transcription: ${transcription.words.length} words`);

      // Get audio duration for plan validation
      let audioDuration = 0;
      try {
        audioDuration = await probeDuration(audioPath);
        console.log(`[SmartEditor] Audio duration: ${audioDuration}s`);
      } catch (_) {}

      // Step 2: Group into segments
      send({ phase: 'segmenting', percent: 20, detail: 'A agrupar em segmentos...' });
      const segments = groupWordsIntoSegments(transcription.words);
      console.log(`[SmartEditor] Segments: ${segments.length}`);

      // Step 3: Load series and build scene database
      send({ phase: 'planning', percent: 25, detail: 'A preparar base de cenas...' });
      const seriesData = readJson(path.join(DATA_DIR, 'series.json'));
      const allSeries = seriesData?.series || [];

      // Support multiple series
      const selectedIds = Array.isArray(seriesIds) ? seriesIds : [seriesIds];
      let combinedSceneDb = '';
      let combinedSeries = { episodes: [], characters: [] };
      let seriesName = '';

      const seriesToSearch = [];
      for (const sid of selectedIds) {
        const s = allSeries.find(x => x.id === sid);
        if (!s) continue;
        seriesName += (seriesName ? ' + ' : '') + s.name;
        combinedSeries.episodes.push(...(s.episodes || []));
        combinedSeries.characters.push(...(s.characters || []));
        seriesToSearch.push(s);
      }

      if (combinedSeries.episodes.length === 0) {
        return { success: false, error: 'Nenhuma série selecionada ou séries sem episódios analisados.' };
      }

      const analyzedEps = combinedSeries.episodes.filter(ep => ep.scenes && ep.scenes.length > 0);
      if (analyzedEps.length === 0) {
        return { success: false, error: 'Nenhum episódio analisado. Corre a Análise Profunda primeiro.' };
      }

      // Build full scene database for intelligent search
      const allScenes = buildFullSceneDatabase(seriesToSearch);
      console.log(`[SmartEditor] Full scene DB: ${allScenes.length} scenes from ${analyzedEps.length} episodes`);

      // Step 4: AI Editorial Plan with intelligent scene matching
      const plan = await generateEditorialPlan(
        segments, allScenes, seriesName, combinedSeries.characters, settings,
        (p) => send({ phase: 'planning', percent: 25 + Math.round(p.percent * 0.25), detail: p.detail }),
      );

      console.log(`[SmartEditor] Raw plan: ${plan.length} items`);

      // Step 5: Validate
      send({ phase: 'validating', percent: 50, detail: 'A validar plano...' });
      const validPlan = validatePlan(plan, combinedSeries, audioDuration);
      console.log(`[SmartEditor] Valid plan: ${validPlan.length} items`);

      if (validPlan.length === 0) {
        return { success: false, error: 'Plano editorial vazio após validação.' };
      }

      // Save plan for review
      const planId = uuid();
      const planPath = path.join(SMART_DIR, `${planId}.json`);
      writeJson(planPath, {
        id: planId,
        seriesName,
        segments,
        plan: validPlan,
        audioPath,
        scriptText: scriptText?.slice(0, 500),
        createdAt: new Date().toISOString(),
      });

      // Step 6: Extract assets
      await extractAssets(validPlan, combinedSeries, tmpDir, (p) => {
        send({ phase: 'extracting', percent: 50 + Math.round(p.percent * 0.35), detail: p.detail, current: p.current, total: p.total });
      });

      // Step 7: Assemble
      const finalOutput = path.join(outputFolder || tmpDir, outputFilename || 'smart_edit.mp4');
      await assembleVideo(validPlan, audioPath, finalOutput, tmpDir, (p) => {
        send({ phase: p.phase, percent: 85 + Math.round(p.percent * 0.15), detail: p.detail });
      });

      return {
        success: true,
        outputPath: finalOutput,
        planId,
        segmentCount: validPlan.length,
        clipCount: validPlan.filter(i => i.type === 'video_clip').length,
        frameCount: validPlan.filter(i => i.type === 'still_frame').length,
      };
    } catch (err) {
      if (err.message === 'Cancelado') {
        return { success: false, error: 'Cancelado pelo utilizador.' };
      }
      console.error('[SmartEditor] Error:', err);
      return { success: false, error: err.message };
    } finally {
      // Cleanup tmp
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  // Cancel
  ipcMain.handle('smart-editor-cancel', () => {
    cancelled = true;
    if (currentProcess) {
      try { currentProcess.kill('SIGTERM'); } catch (_) {}
    }
    return { success: true };
  });

  // Save plan
  ipcMain.handle('smart-editor-save-plan', (_event, planData) => {
    ensureSmartDir();
    const planPath = path.join(SMART_DIR, `${planData.id}.json`);
    writeJson(planPath, planData);
    return { success: true };
  });

  // Load plan
  ipcMain.handle('smart-editor-load-plan', (_event, planId) => {
    const planPath = path.join(SMART_DIR, `${planId}.json`);
    const data = readJson(planPath);
    if (!data) return { success: false, error: 'Plano não encontrado.' };
    return { success: true, plan: data };
  });

  // List saved plans
  ipcMain.handle('smart-editor-list-plans', () => {
    ensureSmartDir();
    const files = fs.readdirSync(SMART_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const data = readJson(path.join(SMART_DIR, f));
      if (!data) return null;
      return { id: data.id, seriesName: data.seriesName, createdAt: data.createdAt, segmentCount: data.plan?.length || 0 };
    }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  });

  // Export from edited plan
  ipcMain.handle('smart-editor-export', async (_event, opts) => {
    const { planId, audioPath, outputFolder, outputFilename } = opts;

    cancelled = false;
    const planPath = path.join(SMART_DIR, `${planId}.json`);
    const planData = readJson(planPath);
    if (!planData) return { success: false, error: 'Plano não encontrado.' };

    const seriesData = readJson(path.join(DATA_DIR, 'series.json'));
    const allSeries = seriesData?.series || [];
    const combinedSeries = { episodes: [] };
    for (const s of allSeries) {
      combinedSeries.episodes.push(...(s.episodes || []));
    }

    const tmpDir = path.join(os.tmpdir(), `pinehat-smart-export-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await extractAssets(planData.plan, combinedSeries, tmpDir, (p) => {
        send({ phase: 'extracting', percent: Math.round(p.percent * 0.7), detail: p.detail, current: p.current, total: p.total });
      });

      const audio = audioPath || planData.audioPath;
      const finalOutput = path.join(outputFolder, outputFilename || 'smart_edit.mp4');
      await assembleVideo(planData.plan, audio, finalOutput, tmpDir, (p) => {
        send({ phase: p.phase, percent: 70 + Math.round(p.percent * 0.3), detail: p.detail });
      });

      return { success: true, outputPath: finalOutput };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });
}

module.exports = { register };
