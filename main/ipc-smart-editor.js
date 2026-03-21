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

function buildSceneDatabase(series) {
  const lines = [];
  for (const ep of (series.episodes || [])) {
    if (!ep.scenes || ep.scenes.length === 0) continue;
    lines.push(`\n${ep.code}:`);
    for (const scene of ep.scenes) {
      const mins = Math.floor(scene.time / 60);
      const secs = scene.time % 60;
      const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
      const desc = scene.description || 'No description';
      lines.push(`  [${scene.time}s / ${timeStr}]: ${desc}`);
    }
  }
  return lines.join('\n');
}

// ── AI Editorial Plan ──

async function generateEditorialPlan(segments, sceneDb, seriesName, characters, settings, onProgress) {
  const model = settings.model || 'claude-sonnet-4.5';
  const apiKey = settings.elevateLabsApiKey;

  // Batch segments for long videos (max ~2 min of content per batch)
  const batches = [];
  let batch = [];
  let batchDuration = 0;
  const MAX_BATCH_DURATION = 120; // 2 minutes per batch

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
  const charactersList = (characters || []).join(', ') || 'não especificados';

  for (let b = 0; b < batches.length; b++) {
    if (cancelled) throw new Error('Cancelado');

    onProgress({
      phase: 'planning',
      percent: Math.round((b / batches.length) * 100),
      detail: `A planear batch ${b + 1}/${batches.length}...`,
    });

    const batchSegs = batches[b];
    const segList = batchSegs.map((s, i) => `${i}: [${s.startTime.toFixed(2)}s → ${s.endTime.toFixed(2)}s] "${s.text}"`).join('\n');

    // Include last 3 items from previous batch for continuity
    const prevContext = allItems.length > 0
      ? `\nÚLTIMOS SEGMENTOS DO BATCH ANTERIOR (para continuidade):\n${JSON.stringify(allItems.slice(-3), null, 2)}\n`
      : '';

    const prompt = `És um editor de vídeo profissional do YouTube. Estás a criar o B-Roll para um vídeo ensaio sobre "${seriesName}".
Personagens conhecidos: ${charactersList}

SEGMENTOS DO VOICEOVER (com timestamps do áudio):
${segList}
${prevContext}
BASE DE DADOS DE CENAS DISPONÍVEIS:
${sceneDb}

TAREFA:
Cria um plano editorial — um JSON array de segmentos visuais que cobrem toda a duração do voiceover.
Cada segmento é "video_clip" (máx 5 seg de vídeo) ou "still_frame" (frame parada com efeito Ken Burns).

REGRAS EDITORIAIS:
1. Os visuais devem corresponder ao conteúdo da narração — quando menciona um personagem ou evento, mostra footage relevante
2. Varia o ritmo baseado no conteúdo:
   - Discussão de ação rápida → vários clips curtos seguidos
   - Análise/explicação → clip + frame parada com zoom + clip
   - Momento dramático → frame parada longa com zoom lento
   - Podes meter 2-3 clips seguidos se fizer sentido
3. Segurança de copyright:
   - Video clips: máximo 5 segundos cada
   - Nunca usar dois clips consecutivos do mesmo range de tempo (mínimo 180 seg de distância na fonte)
   - Não mais que 3 clips do mesmo episódio seguidos
   - Frames paradas não têm restrições de copyright
4. Cobrir TODA a duração do voiceover sem gaps
5. Frames paradas devem usar efeitos: "zoom_in", "zoom_out", "pan_left", "pan_right"
6. As frames paradas também devem ser RELEVANTES ao que está a ser dito, não aleatórias
7. Escolhe cenas que sejam CONTEXTUALMENTE relevantes ao que está a ser dito

Devolve APENAS um JSON array (sem texto extra):
[
  {"startTime": 0.0, "endTime": 5.2, "type": "video_clip", "episode": "S01E01", "sceneTime": 842, "clipDuration": 5},
  {"startTime": 5.2, "endTime": 12.0, "type": "still_frame", "episode": "S01E03", "sceneTime": 1200, "effect": "zoom_in"}
]`;

    const response = await fetch(`${CHAT_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[SmartEditor] Batch ${b + 1} response (${content.length} chars):`, content.slice(0, 300));

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
      throw new Error(`AI não devolveu JSON válido no batch ${b + 1}. Tenta novamente.`);
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

function validatePlan(plan, series) {
  const episodes = {};
  for (const ep of (series.episodes || [])) {
    episodes[ep.code] = ep;
  }

  const valid = [];
  for (const item of plan) {
    // Check episode exists
    if (!episodes[item.episode]) {
      console.warn(`[SmartEditor] Episode ${item.episode} not found, skipping`);
      continue;
    }
    // Ensure required fields
    item.startTime = parseFloat(item.startTime) || 0;
    item.endTime = parseFloat(item.endTime) || item.startTime + 5;
    item.sceneTime = parseInt(item.sceneTime) || 0;
    item.type = item.type === 'still_frame' ? 'still_frame' : 'video_clip';
    if (item.type === 'video_clip') {
      item.clipDuration = Math.min(parseFloat(item.clipDuration) || 5, 5);
    }
    if (item.type === 'still_frame') {
      item.effect = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'].includes(item.effect) ? item.effect : 'zoom_in';
    }
    valid.push(item);
  }

  // Sort by startTime
  valid.sort((a, b) => a.startTime - b.startTime);

  return valid;
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

  // Step 1: Extract frame
  await runFfmpeg(ffmpegPath, [
    '-y', '-ss', String(sceneTime), '-i', episodePath,
    '-vframes', '1', '-q:v', '2', tmpFrame,
  ], null, 30000);

  if (!fs.existsSync(tmpFrame)) {
    throw new Error(`Frame extraction failed at ${sceneTime}s`);
  }

  // Step 2: Ken Burns effect
  const frames = Math.round(duration * 30); // 30fps
  let vf;

  switch (effect) {
    case 'zoom_in':
      vf = `scale=2160:1620,zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
      break;
    case 'zoom_out':
      vf = `scale=2880:1620,zoompan=z='if(eq(on\\,0)\\,1.5\\,max(zoom-0.0015\\,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30`;
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
      if (!episodePath || !fs.existsSync(episodePath)) {
        console.warn(`[SmartEditor] Episode file not found: ${item.episode}`);
        // Create black frame fallback
        const ffmpegPath = findBinary('ffmpeg');
        const dur = item.endTime - item.startTime;
        await runFfmpeg(ffmpegPath, [
          '-y', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:d=${dur}:r=30`,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an',
          outputPath,
        ], null, 30000);
        return;
      }

      const duration = item.endTime - item.startTime;

      if (item.type === 'video_clip') {
        const clipDur = Math.min(item.clipDuration || 5, duration);
        await extractVideoClip(episodePath, item.sceneTime, clipDur, outputPath);

        // If clip is shorter than segment, extend with freeze frame
        if (clipDur < duration - 0.1) {
          const extendPath = path.join(tmpDir, `extend_${String(idx).padStart(5, '0')}.mp4`);
          const lastFramePath = path.join(tmpDir, `lastframe_${idx}.jpg`);
          const ffmpegPath = findBinary('ffmpeg');

          // Extract last frame
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

            // Concat clip + extension
            const concatFile = path.join(tmpDir, `concat_${idx}.txt`);
            fs.writeFileSync(concatFile, `file '${outputPath.replace(/'/g, "'\\''")}'\\nfile '${extendPath.replace(/'/g, "'\\''")}'`);
            const mergedPath = path.join(tmpDir, `merged_${String(idx).padStart(5, '0')}.mp4`);
            await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', mergedPath], null, 30000);

            // Replace original
            fs.unlinkSync(outputPath);
            fs.renameSync(mergedPath, outputPath);
            try { fs.unlinkSync(extendPath); fs.unlinkSync(lastFramePath); fs.unlinkSync(concatFile); } catch (_) {}
          }
        }
      } else {
        await extractStillFrame(episodePath, item.sceneTime, duration, item.effect, outputPath);
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

  // Write concat file
  const concatFile = path.join(tmpDir, 'concat_final.txt');
  const lines = plan
    .filter(item => item._outputPath && fs.existsSync(item._outputPath))
    .map(item => `file '${item._outputPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);

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
    '-shortest', '-movflags', '+faststart',
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

      for (const sid of selectedIds) {
        const s = allSeries.find(x => x.id === sid);
        if (!s) continue;
        seriesName += (seriesName ? ' + ' : '') + s.name;
        combinedSeries.episodes.push(...(s.episodes || []));
        combinedSeries.characters.push(...(s.characters || []));
        combinedSceneDb += `\n\n=== ${s.name} ===\n` + buildSceneDatabase(s);
      }

      if (combinedSeries.episodes.length === 0) {
        return { success: false, error: 'Nenhuma série selecionada ou séries sem episódios analisados.' };
      }

      const analyzedEps = combinedSeries.episodes.filter(ep => ep.scenes && ep.scenes.length > 0);
      if (analyzedEps.length === 0) {
        return { success: false, error: 'Nenhum episódio analisado. Corre a Análise Profunda primeiro.' };
      }

      console.log(`[SmartEditor] Scene DB: ${analyzedEps.length} episodes, ${seriesName}`);

      // Step 4: AI Editorial Plan
      const plan = await generateEditorialPlan(
        segments, combinedSceneDb, seriesName, combinedSeries.characters, settings,
        (p) => send({ phase: 'planning', percent: 25 + Math.round(p.percent * 0.25), detail: p.detail }),
      );

      console.log(`[SmartEditor] Raw plan: ${plan.length} items`);

      // Step 5: Validate
      send({ phase: 'validating', percent: 50, detail: 'A validar plano...' });
      const validPlan = validatePlan(plan, combinedSeries);
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
