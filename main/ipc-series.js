const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { CHAT_BASE } = require('./elevate-api');

const SERIES_FILE = path.join(DATA_DIR, 'series.json');
const FRAMES_DIR  = path.join(DATA_DIR, 'series_frames');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'series_transcripts');

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];
const EP_REGEX   = /[Ss](\d{1,2})[Ee](\d{1,2})/;

let analysisCancelled = false;

// ── Helpers ──

function getSeries() {
  ensureDataDir();
  const data = readJson(SERIES_FILE);
  return (data && data.series) || [];
}

function saveSeries(series) {
  writeJson(SERIES_FILE, { series });
}

function parseEpisodeCode(filename) {
  const m = filename.match(EP_REGEX);
  if (!m) return null;
  return `S${m[1].padStart(2, '0')}E${m[2].padStart(2, '0')}`;
}

function scanFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath)
    .filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const code = parseEpisodeCode(f);
      if (!code) return null;
      return { code, filename: f, filePath: path.join(folderPath, f), analyzed: false, scenes: [] };
    })
    .filter(Boolean)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function findBinary(name) {
  const { execSync } = require('child_process');
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch (_) { return name; }
}

// Get video duration in seconds via ffprobe (10s timeout, fallback 20min)
function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    const ffprobe = findBinary('ffprobe');
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath];
    const proc = spawn(ffprobe, args);
    let out = '';
    const timer = setTimeout(() => { proc.kill(); resolve(1200); }, 10000);
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const dur = parseFloat(JSON.parse(out).format.duration);
        resolve(isNaN(dur) ? 1200 : dur);
      } catch (_) { resolve(1200); }
    });
    proc.on('error', () => { clearTimeout(timer); resolve(1200); });
  });
}

// Extract a single frame at a specific timestamp using fast seeking (-ss before -i)
function extractFrameAt(filePath, seconds, outPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = findBinary('ffmpeg');
    const args = [
      '-y',
      '-ss', String(seconds),
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'scale=384:216',
      '-q:v', '5',
      outPath,
    ];
    const proc = spawn(ffmpeg, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    // timeout: 30s per frame
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 30000);
    proc.on('close', () => {
      clearTimeout(timer);
      // Success = output file exists with content (ffmpeg sometimes exits non-zero but still writes the file)
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        resolve();
      } else {
        reject(new Error(stderr.slice(-200) || 'no output file'));
      }
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── IPC Handlers ──

function register(mainWindow) {

  // ── Diagnostic: test ffprobe + ffmpeg on first episode ──
  ipcMain.handle('series-diagnose', async (_event, seriesId) => {
    const all = getSeries();
    const series = all.find(s => s.id === seriesId);
    if (!series || series.episodes.length === 0) return { error: 'Série não encontrada ou sem episódios' };
    const ep = series.episodes[0];

    const steps = [];

    // 1. Check API key
    const settings = getSettings();
    steps.push({ step: 'API key', ok: !!settings.elevateLabsApiKey, detail: settings.elevateLabsApiKey ? `set (${settings.elevateLabsApiKey.length} chars)` : 'MISSING' });

    // 2. Check file exists
    steps.push({ step: 'Ficheiro', ok: fs.existsSync(ep.filePath), detail: ep.filePath });

    // 3. Test ffprobe
    const ffprobeResult = await new Promise(resolve => {
      const ffprobe = findBinary('ffprobe');
      const proc = spawn(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', ep.filePath]);
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d; });
      proc.stderr.on('data', d => { err += d; });
      const t = setTimeout(() => { proc.kill(); resolve({ ok: false, detail: 'timeout' }); }, 8000);
      proc.on('close', () => {
        clearTimeout(t);
        try {
          const dur = parseFloat(JSON.parse(out).format.duration);
          resolve({ ok: true, detail: `${Math.round(dur)}s duration, binary: ${ffprobe}` });
        } catch (_) { resolve({ ok: false, detail: `parse error, binary: ${ffprobe}, stderr: ${err.slice(0, 100)}` }); }
      });
      proc.on('error', e => { clearTimeout(t); resolve({ ok: false, detail: `${e.message}, binary: ${ffprobe}` }); });
    });
    steps.push({ step: 'ffprobe', ...ffprobeResult });

    // 4. Test frame extraction
    const { DATA_DIR } = require('./ipc-data');
    const testDir = path.join(DATA_DIR, 'series_frames', 'diag_test');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const testFrame = path.join(testDir, 'test_frame.jpg');
    const ffmpegResult = await new Promise(resolve => {
      const ffmpeg = findBinary('ffmpeg');
      const args = ['-y', '-ss', '30', '-i', ep.filePath, '-vframes', '1', '-vf', 'scale=384:216', '-q:v', '5', testFrame];
      const proc = spawn(ffmpeg, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d; });
      const t = setTimeout(() => { proc.kill(); resolve({ ok: false, detail: 'timeout after 30s' }); }, 30000);
      proc.on('close', () => {
        clearTimeout(t);
        const exists = fs.existsSync(testFrame);
        const size = exists ? fs.statSync(testFrame).size : 0;
        try { if (exists) fs.unlinkSync(testFrame); } catch (_) {}
        if (exists && size > 0) resolve({ ok: true, detail: `frame OK, ${size} bytes, binary: ${ffmpeg}` });
        else resolve({ ok: false, detail: `no output (${exists ? size + 'B' : 'missing'}), stderr: ${stderr.slice(-200)}, binary: ${ffmpeg}` });
      });
      proc.on('error', e => { clearTimeout(t); resolve({ ok: false, detail: `${e.message}, binary: ${ffmpeg}` }); });
    });
    steps.push({ step: 'ffmpeg extract', ...ffmpegResult });
    try { fs.rmdirSync(testDir); } catch (_) {}

    return { steps };
  });

  // ── Trace: run full analysis on ONE episode and report every step ──
  ipcMain.handle('series-trace-one', async (_event, seriesId) => {
    const all = getSeries();
    const series = all.find(s => s.id === seriesId);
    if (!series) return { error: 'Série não encontrada' };
    const ep = series.episodes.find(e => !e.analyzed) || series.episodes[0];

    const log = [];
    const L = (msg) => { log.push(msg); console.log('[Trace]', msg); };

    L(`Episode: ${ep.code} — ${ep.filePath}`);
    L(`analysisCancelled at start: ${analysisCancelled}`);

    const settings = getSettings();
    L(`API key: ${settings.elevateLabsApiKey ? 'set' : 'MISSING'}`);
    if (!settings.elevateLabsApiKey) return { log };

    const duration = await getVideoDuration(ep.filePath);
    L(`Duration: ${duration}s`);

    const INTERVAL_SEC = 60;
    const timestamps = [];
    for (let t = 30; t < duration - 30; t += INTERVAL_SEC) timestamps.push(Math.floor(t));
    if (timestamps.length === 0) timestamps.push(30);
    const total = Math.min(timestamps.length, 30);
    L(`Timestamps: ${timestamps.length} → total=${total} (first: ${timestamps[0]}s, last: ${timestamps[Math.min(timestamps.length-1, total-1)]}s)`);

    const framesDir = path.join(FRAMES_DIR, seriesId, `${ep.code}_trace`);
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
    L(`framesDir: ${framesDir}`);

    // Test just first 3 frames
    const testTotal = Math.min(total, 3);

    for (let i = 0; i < testTotal; i++) {
      const timeSeconds = timestamps[i];
      const framePath = path.join(framesDir, `frame_${String(i).padStart(4, '0')}.jpg`);
      L(`Frame ${i+1}/${testTotal} @${timeSeconds}s — extracting...`);

      try {
        await extractFrameAt(ep.filePath, timeSeconds, framePath);
        const size = fs.existsSync(framePath) ? fs.statSync(framePath).size : 0;
        L(`  ffmpeg: OK (${size} bytes)`);
      } catch (e) {
        L(`  ffmpeg: FAILED — ${e.message}`);
        continue;
      }

      try {
        const base64 = fs.readFileSync(framePath).toString('base64');
        L(`  base64: ${base64.length} chars`);
        const resp = await fetch(`${CHAT_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.elevateLabsApiKey}` },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 100,
            messages: [{ role: 'user', content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              { type: 'text', text: 'Describe this frame in 1 sentence.' },
            ]}],
          }),
        });
        if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 100)}`);
        const data = await resp.json();
        L(`  AI: "${(data.choices?.[0]?.message?.content || '').trim().slice(0, 80)}"`);
      } catch (e) {
        L(`  Claude: FAILED — ${e.message}`);
      }
      try { fs.unlinkSync(framePath); } catch (_) {}
    }

    // Test save
    const eIdx = series.episodes.findIndex(e => e.code === ep.code);
    L(`eIdx for ${ep.code}: ${eIdx}`);
    const dummyScenes = [{ time: 30, description: 'trace test' }];
    series.episodes[eIdx] = { ...ep, analyzed: true, scenes: dummyScenes };
    const allIdx = all.findIndex(s => s.id === seriesId);
    all[allIdx] = series;
    try {
      saveSeries(all);
      L(`Save: OK`);
      // Verify
      const verify = getSeries().find(s => s.id === seriesId)?.episodes.find(e => e.code === ep.code);
      L(`Verify: analyzed=${verify?.analyzed}, scenes=${verify?.scenes?.length}`);
    } catch (saveErr) {
      L(`Save: FAILED — ${saveErr.message}`);
    }

    try { fs.rmdirSync(framesDir); } catch (_) {}
    return { log };
  });

  ipcMain.handle('series-get-all', () => getSeries());

  ipcMain.handle('series-select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleciona a pasta com os episódios',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('series-add', (_event, { name, folderPath }) => {
    const all = getSeries();
    const episodes = scanFolder(folderPath);
    const s = { id: uuid(), name, folderPath, episodes, characters: [], createdAt: new Date().toISOString() };
    all.push(s);
    saveSeries(all);
    return s;
  });

  ipcMain.handle('series-update-characters', (_event, { seriesId, characters }) => {
    const all = getSeries();
    const idx = all.findIndex(s => s.id === seriesId);
    if (idx === -1) return { success: false };
    all[idx].characters = characters || [];
    saveSeries(all);
    return { success: true };
  });

  ipcMain.handle('series-remove', (_event, id) => {
    saveSeries(getSeries().filter(s => s.id !== id));
    return { success: true };
  });

  ipcMain.handle('series-rescan', (_event, id) => {
    const all = getSeries();
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return { success: false };
    const series = all[idx];
    const fresh = scanFolder(series.folderPath);
    const existing = {};
    series.episodes.forEach(ep => { existing[ep.code] = ep; });
    series.episodes = fresh.map(ep => existing[ep.code] || ep);
    all[idx] = series;
    saveSeries(all);
    return series;
  });

  // Reset all episodes to unanalyzed (clear bad data)
  ipcMain.handle('series-reset-analysis', (_event, id) => {
    const all = getSeries();
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return { success: false };
    all[idx].episodes = all[idx].episodes.map(ep => ({ ...ep, analyzed: false, scenes: [] }));
    saveSeries(all);
    return { success: true };
  });

  ipcMain.handle('series-cancel-analysis', () => {
    analysisCancelled = true;
    return { success: true };
  });

  ipcMain.handle('series-analyze-episode', async (_event, { seriesId, episodeCode }) => {
    analysisCancelled = false;
    const settings = getSettings();
    if (!settings.elevateLabsApiKey) return { success: false, error: 'API key não configurada nas Definições' };

    const all = getSeries();
    const sIdx = all.findIndex(s => s.id === seriesId);
    if (sIdx === -1) return { success: false, error: 'Série não encontrada' };

    const series = all[sIdx];
    const eIdx = series.episodes.findIndex(ep => ep.code === episodeCode);
    if (eIdx === -1) return { success: false, error: 'Episódio não encontrado' };

    const episode = series.episodes[eIdx];
    if (!fs.existsSync(episode.filePath)) return { success: false, error: `Ficheiro não encontrado: ${episode.filePath}` };

    // Get duration and build timestamp list (1 frame per 2 minutes, max 20 frames)
    mainWindow.webContents.send('series-analyze-progress', { episodeCode, phase: 'extracting', current: 0, total: 0 });

    const duration = await getVideoDuration(episode.filePath);
    const INTERVAL_SEC = 60; // 1 frame per minute
    const timestamps = [];
    for (let t = 30; t < duration - 30; t += INTERVAL_SEC) timestamps.push(Math.floor(t));
    if (timestamps.length === 0) timestamps.push(30);
    const total = Math.min(timestamps.length, 30);

    const framesDir = path.join(FRAMES_DIR, seriesId, episodeCode);
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

    // Analyze frames with Claude Haiku Vision — extract each frame on-demand (fast seek)
    const scenes = [];
    let firstExtractError = null;

    for (let i = 0; i < total; i++) {
      if (analysisCancelled) break;

      const timeSeconds = timestamps[i];
      mainWindow.webContents.send('series-analyze-progress', {
        episodeCode, phase: 'analyzing', current: i + 1, total, timeSeconds,
      });

      const framePath = path.join(framesDir, `frame_${String(i).padStart(4, '0')}.jpg`);

      // Extract single frame with fast seek
      let frameExtracted = false;
      try {
        await extractFrameAt(episode.filePath, timeSeconds, framePath);
        frameExtracted = true;
      } catch (extractErr) {
        const errMsg = extractErr.message || String(extractErr);
        console.error(`[Series] Frame extraction failed ${episodeCode} @${timeSeconds}s: ${errMsg}`);
        if (!firstExtractError) {
          firstExtractError = errMsg;
          mainWindow.webContents.send('series-analyze-progress', {
            episodeCode, phase: 'frame-error', error: errMsg,
          });
        }
        scenes.push({ time: timeSeconds, description: '' });
        await new Promise(r => setTimeout(r, 50));
        continue;
      }

      // Analyze with Claude via fetch (same as editor)
      try {
        const base64 = fs.readFileSync(framePath).toString('base64');
        const resp = await fetch(`${CHAT_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.elevateLabsApiKey}`,
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 150,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
                { type: 'text', text: `Frame from "${series.name}" ${episodeCode} at ~${Math.floor(timeSeconds / 60)}min. Briefly describe: characters present, what is happening, setting. 1-2 sentences.` },
              ],
            }],
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`API ${resp.status}: ${errText.slice(0, 150)}`);
        }
        const data = await resp.json();
        scenes.push({ time: timeSeconds, description: (data.choices?.[0]?.message?.content || '').trim() });
      } catch (claudeErr) {
        console.error(`[Series] Claude analysis failed ${episodeCode} @${timeSeconds}s:`, claudeErr.message);
        scenes.push({ time: timeSeconds, description: '' });
      }

      // Clean up frame immediately
      try { fs.unlinkSync(framePath); } catch (_) {}

      await new Promise(r => setTimeout(r, 300));
    }

    // Clean up frames dir
    try { fs.rmdirSync(framesDir); } catch (_) {}

    const cancelled = analysisCancelled;
    const validScenes = scenes.filter(s => s.description).length;
    console.log(`[Series] ${episodeCode} done — ${scenes.length} frames, ${validScenes} with description, cancelled=${cancelled}`);

    if (!cancelled) {
      try {
        series.episodes[eIdx] = { ...episode, analyzed: true, scenes };
        all[sIdx] = series;
        saveSeries(all);
        const savedAnalyzedCount = all[sIdx].episodes.filter(ep => ep.analyzed).length;
        console.log(`[Series] Saved ${episodeCode} OK — total analyzed in series: ${savedAnalyzedCount}`);
        mainWindow.webContents.send('series-analyze-progress', {
          episodeCode, phase: 'episode-saved', analyzedCount: savedAnalyzedCount, validScenes,
        });
      } catch (saveErr) {
        console.error(`[Series] SAVE FAILED for ${episodeCode}:`, saveErr.message);
        mainWindow.webContents.send('series-analyze-progress', {
          episodeCode, phase: 'save-error', error: saveErr.message,
        });
      }
    } else {
      console.log(`[Series] ${episodeCode} skipped (cancelled)`);
    }

    mainWindow.webContents.send('series-analyze-progress', { episodeCode, phase: 'done', cancelled });
    return { success: !cancelled, scenes };
  });

  // ── Deep Analysis function (extracted so it can be called from both single and all) ──
  async function deepAnalyzeEpisode(seriesId, episodeCode) {
    const settings = getSettings();
    if (!settings.openaiApiKey && !settings.elevateLabsApiKey) return { success: false, error: 'API key não configurada nas Definições (OpenAI ou Elevate Labs)' };
    // Prefer OpenAI for deep analysis (cheaper, no daily limit)
    const useOpenAI = !!settings.openaiApiKey;
    const deepApiBase = useOpenAI ? 'https://api.openai.com/v1' : CHAT_BASE;
    const deepApiKey = useOpenAI ? settings.openaiApiKey : settings.elevateLabsApiKey;
    const deepModel = useOpenAI ? 'gpt-4o-mini' : 'claude-sonnet-4.5';
    console.log(`[DeepAnalysis] Using ${useOpenAI ? 'OpenAI (gpt-4o-mini)' : 'Elevate Labs'} for vision`);

    const all = getSeries();
    const sIdx = all.findIndex(s => s.id === seriesId);
    if (sIdx === -1) return { success: false, error: 'Série não encontrada' };

    const series = all[sIdx];
    const eIdx = series.episodes.findIndex(ep => ep.code === episodeCode);
    if (eIdx === -1) return { success: false, error: 'Episódio não encontrado' };

    const episode = series.episodes[eIdx];
    if (!fs.existsSync(episode.filePath)) return { success: false, error: `Ficheiro não encontrado: ${episode.filePath}` };

    mainWindow.webContents.send('series-analyze-progress', { episodeCode, phase: 'extracting', current: 0, total: 0 });

    const duration = await getVideoDuration(episode.filePath);
    const INTERVAL_SEC = 10; // 1 frame per 10 seconds
    const timestamps = [];
    for (let t = 10; t < duration - 10; t += INTERVAL_SEC) timestamps.push(Math.floor(t));
    if (timestamps.length === 0) timestamps.push(10);
    const total = timestamps.length; // no cap

    const framesDir = path.join(FRAMES_DIR, seriesId, episodeCode);
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

    const scenes = [];
    const BATCH_SIZE = 2; // 2 frames per API call (less chance of rate limit)
    const MAX_RETRIES = 3;
    const characters = (series.characters || []).join(', ') || 'unknown';

    for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
      if (analysisCancelled) break;

      const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
      const batchTimestamps = timestamps.slice(batchStart, batchEnd);

      mainWindow.webContents.send('series-analyze-progress', {
        episodeCode, phase: 'analyzing', current: batchStart + 1, total,
        timeSeconds: batchTimestamps[0],
      });

      // Extract frames for this batch
      const frameData = [];
      for (let j = 0; j < batchTimestamps.length; j++) {
        const ts = batchTimestamps[j];
        const framePath = path.join(framesDir, `frame_${String(batchStart + j).padStart(5, '0')}.jpg`);
        try {
          await extractFrameAt(episode.filePath, ts, framePath);
          const base64 = fs.readFileSync(framePath).toString('base64');
          frameData.push({ ts, base64 });
          try { fs.unlinkSync(framePath); } catch (_) {}
        } catch (err) {
          console.error(`[DeepAnalysis] Frame extract failed @${ts}s: ${err.message}`);
          scenes.push({ time: ts, description: '', characters: [], mood: 'unknown' });
        }
      }

      if (frameData.length === 0) continue;

      // Build multi-image message
      const content = [];
      for (const fd of frameData) {
        content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fd.base64}` } });
      }

      const timeLabels = frameData.map(fd => `${Math.floor(fd.ts / 60)}:${String(fd.ts % 60).padStart(2, '0')}`).join(', ');

      content.push({
        type: 'text',
        text: `Frames from "${series.name}" ${episodeCode} at ${timeLabels}. Characters: ${characters}. For each frame return JSON: [{"description":"1-2 sentences with character names","characters":["name"],"mood":"action|dialogue|quiet|dramatic"}]`,
      });

      // Retry logic
      let success = false;
      for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
        if (attempt > 0) {
          console.log(`[DeepAnalysis] Retry ${attempt}/${MAX_RETRIES} for batch @${batchTimestamps[0]}s`);
          await new Promise(r => setTimeout(r, 3000 * attempt)); // exponential backoff
        }

        try {
          const resp = await fetch(`${deepApiBase}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${deepApiKey}`,
            },
            body: JSON.stringify({
              model: deepModel,
              max_tokens: 500,
              messages: [{ role: 'user', content }],
            }),
          });

          if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[DeepAnalysis] API ${resp.status}: ${errText.slice(0, 150)}`);
            if (resp.status === 429) {
              // Rate limited — wait longer and retry
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
            continue; // retry other errors too
          }

          const data = await resp.json();
          const rawContent = data.choices?.[0]?.message?.content || '';

          if (!rawContent) {
            console.error(`[DeepAnalysis] Empty response for batch @${batchTimestamps[0]}s`);
            continue; // retry
          }

          // Parse JSON
          const jsonMatch = rawContent.match(/\[[\s\S]*\]/) || rawContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            let items;
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              items = Array.isArray(parsed) ? parsed : [parsed];
            } catch (_) {
              console.error(`[DeepAnalysis] JSON parse failed, using raw text`);
              items = null;
            }

            if (items) {
              for (let j = 0; j < frameData.length; j++) {
                const item = items[j] || items[0] || {};
                scenes.push({
                  time: frameData[j].ts,
                  description: item.description || rawContent.slice(0, 150),
                  characters: item.characters || [],
                  mood: item.mood || 'unknown',
                });
              }
              success = true;
            }
          }

          if (!success) {
            // Use raw text as fallback
            for (const fd of frameData) {
              scenes.push({ time: fd.ts, description: rawContent.slice(0, 150), characters: [], mood: 'unknown' });
            }
            success = true; // don't retry, we got something
          }
        } catch (err) {
          console.error(`[DeepAnalysis] Batch error: ${err.message}`);
        }
      }

      // If all retries failed, push empty scenes
      if (!success) {
        for (const fd of frameData) {
          scenes.push({ time: fd.ts, description: '', characters: [], mood: 'unknown' });
        }
      }

      // Periodically save progress to disk (every 10 batches = ~20 frames)
      // so that progress survives app crashes mid-episode
      if ((batchStart + BATCH_SIZE) % (BATCH_SIZE * 10) === 0 && scenes.length > 0) {
        try {
          const freshAll = getSeries();
          const freshSIdx = freshAll.findIndex(s => s.id === seriesId);
          if (freshSIdx !== -1) {
            freshAll[freshSIdx].episodes[eIdx] = { ...episode, analyzed: false, deepAnalyzed: false, scenes: [...scenes], partialAnalysis: true };
            saveSeries(freshAll);
            console.log(`[DeepAnalysis] Intermediate save: ${scenes.length} scenes for ${episodeCode}`);
          }
        } catch (saveErr) {
          console.error(`[DeepAnalysis] Intermediate save failed: ${saveErr.message}`);
        }
      }

      // Delay between batches
      await new Promise(r => setTimeout(r, useOpenAI ? 2000 : 500));
    }

    // Clean up
    try { fs.rmdirSync(framesDir); } catch (_) {}

    const cancelled = analysisCancelled;
    const validScenes = scenes.filter(s => s.description).length;
    console.log(`[DeepAnalysis] ${episodeCode} done — ${scenes.length} frames, ${validScenes} with description`);

    if (!cancelled) {
      // Re-read fresh data from disk to avoid overwriting other episodes' progress
      const freshAll = getSeries();
      const freshSIdx = freshAll.findIndex(s => s.id === seriesId);
      if (freshSIdx === -1) {
        console.error(`[DeepAnalysis] Series ${seriesId} not found on final save`);
      } else {
        // Only mark deepAnalyzed if at least 40% of frames got descriptions
        const successRate = total > 0 ? validScenes / total : 0;
        const isGoodAnalysis = successRate >= 0.4;
        console.log(`[DeepAnalysis] ${episodeCode}: ${validScenes}/${total} valid (${(successRate * 100).toFixed(0)}%) — ${isGoodAnalysis ? 'GOOD' : 'FAILED, will retry'}`);
        const freshEp = freshAll[freshSIdx].episodes[eIdx] || episode;
        freshAll[freshSIdx].episodes[eIdx] = { ...freshEp, analyzed: true, deepAnalyzed: isGoodAnalysis, scenes, partialAnalysis: false };
        saveSeries(freshAll);
        mainWindow.webContents.send('series-analyze-progress', {
          episodeCode, phase: 'episode-saved', analyzedCount: freshAll[freshSIdx].episodes.filter(ep => ep.analyzed).length, validScenes,
        });
      }
    }

    mainWindow.webContents.send('series-analyze-progress', { episodeCode, phase: 'done', cancelled });
    return { success: !cancelled, scenes, total: scenes.length, valid: validScenes };
  }

  // ── Single episode deep analysis (IPC wrapper) ──
  ipcMain.handle('series-deep-analyze-episode', async (_event, { seriesId, episodeCode }) => {
    analysisCancelled = false;
    return deepAnalyzeEpisode(seriesId, episodeCode);
  });

  // ── Deep Analyze ALL (runs in main process, survives navigation) ──
  let deepAnalyzeRunning = false;
  ipcMain.handle('series-deep-analyze-all', async (_event, { seriesId, forceAll }) => {
    if (deepAnalyzeRunning) return { success: false, error: 'Análise já em curso.' };
    deepAnalyzeRunning = true;
    analysisCancelled = false;

    const all = getSeries();
    const series = all.find(s => s.id === seriesId);
    if (!series) { deepAnalyzeRunning = false; return { success: false, error: 'Série não encontrada.' }; }

    const toAnalyze = forceAll
      ? series.episodes.map(ep => ep.code)
      : series.episodes.filter(ep => !ep.deepAnalyzed).map(ep => ep.code);

    if (toAnalyze.length === 0) { deepAnalyzeRunning = false; return { success: true, message: 'Todos já analisados.' }; }

    mainWindow.webContents.send('series-analyze-progress', {
      phase: 'deep-all-start', total: toAnalyze.length, episodeCodes: toAnalyze,
    });

    // Fire-and-forget: run the loop in the background (survives navigation)
    (async () => {
      let completed = 0;
      for (const code of toAnalyze) {
        if (analysisCancelled) break;

        mainWindow.webContents.send('series-analyze-progress', {
          phase: 'deep-all-episode', episodeCode: code, current: completed + 1, total: toAnalyze.length,
        });

        try {
          const result = await deepAnalyzeEpisode(seriesId, code);
          if (!result.success) {
            console.warn(`[DeepAll] ${code} failed: ${result.error}`);
          } else {
            console.log(`[DeepAll] ${code} done: ${result.valid}/${result.total} valid scenes`);
          }
        } catch (err) {
          console.error(`[DeepAll] Error on ${code}: ${err.message}`);
        }

        completed++;
      }

      deepAnalyzeRunning = false;
      analysisCancelled = false;
      mainWindow.webContents.send('series-analyze-progress', { phase: 'deep-all-done', completed, total: toAnalyze.length });
    })();

    return { success: true, started: true, total: toAnalyze.length };
  });

  // ── AI Clip Assignment ──
  ipcMain.handle('series-assign-clips', async (_event, { seriesId, segments }) => {
    const settings = getSettings();
    if (!settings.elevateLabsApiKey) return { success: false, error: 'API key não configurada' };

    const all = getSeries();
    const series = all.find(s => s.id === seriesId);
    if (!series) return { success: false, error: 'Série não encontrada' };

    const analyzed = series.episodes.filter(ep => ep.analyzed && ep.scenes.length > 0);
    if (analyzed.length === 0) return { success: false, error: 'Nenhum episódio analisado. Analisa os episódios primeiro.' };

    // Build episode context with scene timestamps
    const episodeCtx = analyzed.map(ep => {
      const sceneList = ep.scenes
        .filter(s => s.description)
        .map(s => `  ${s.time}s: ${s.description.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80)}`)
        .slice(0, 5)
        .join('\n');
      return `${ep.code}:\n${sceneList}`;
    }).join('\n');

    // For very long voiceovers, batch segments into chunks to stay within token limits
    const BATCH_SIZE = 40;
    const allAssignments = [];

    for (let batch = 0; batch < segments.length; batch += BATCH_SIZE) {
      const batchSegments = segments.slice(batch, batch + BATCH_SIZE);

      const segmentList = batchSegments.map((seg, i) =>
        `${batch + i + 1}. [${seg.startTime.toFixed(0)}s-${seg.endTime.toFixed(0)}s]: "${seg.text}"`
      ).join('\n');

      console.log(`[series-assign] Batch ${Math.floor(batch / BATCH_SIZE) + 1}: ${batchSegments.length} segments, ${analyzed.length} episodes`);

      const resp = await fetch(`${CHAT_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.elevateLabsApiKey}`,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: `You are assigning B-roll footage to a YouTube voiceover video about "${series.name}".

EPISODE SCENES DATABASE (episode code + scenes with timestamps in seconds):
${episodeCtx}

VOICEOVER SEGMENTS:
${segmentList}

For each numbered segment, pick the most contextually relevant episode AND scene timestamp.
Return ONLY a JSON array of objects with "ep" (episode code) and "t" (scene timestamp in seconds).
Example: [{"ep":"S01E01","t":90},{"ep":"S01E03","t":210}]
Use only episode codes and timestamps that exist in the database above. No explanation, no markdown.`,
          }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { success: false, error: `API ${resp.status}: ${errText.slice(0, 150)}` };
      }

      try {
        const respData = await resp.json();
        const text = (respData.choices?.[0]?.message?.content || respData.content?.[0]?.text || '').trim();
        console.log(`[series-assign] Response text (first 300): ${text.slice(0, 300)}`);
        // Find the largest JSON array in the response (greedy match)
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('No JSON array in response: ' + text.slice(0, 200));
        const parsed = JSON.parse(match[0]);
        // Support both old format ["S01E01"] and new format [{"ep":"S01E01","t":90}]
        for (const item of parsed) {
          if (typeof item === 'string') {
            allAssignments.push({ ep: item, t: null });
          } else {
            allAssignments.push({ ep: item.ep || item.episode || '', t: item.t ?? item.time ?? null });
          }
        }
      } catch (err) {
        return { success: false, error: 'Erro ao processar resposta: ' + err.message };
      }
    }

    return { success: true, assignments: allAssignments };
  });

  // ═══════════════════════════════════════════════════════════
  // EPISODE TRANSCRIPTION (Whisper API)
  // ═══════════════════════════════════════════════════════════

  ipcMain.handle('series-transcribe-all', async (_event, { seriesId }) => {
    try {
    const settings = getSettings();
    if (!settings.openaiApiKey) return { success: false, error: 'OpenAI API key não configurada nas Definições.' };

    const data = getSeries();
    const series = data.series.find(s => s.id === seriesId);
    if (!series) return { success: false, error: 'Série não encontrada.' };

    if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

    analysisCancelled = false; // Reset cancel flag

    const episodes = series.episodes || [];
    let completed = 0;
    let failed = 0;

    console.log(`[Transcribe] Starting transcription of ${episodes.length} episodes for "${series.name}"`);

    for (const ep of episodes) {
      if (analysisCancelled) break;

      // Skip if already transcribed
      const transcriptPath = path.join(TRANSCRIPTS_DIR, `${seriesId}_${ep.code}.json`);
      if (fs.existsSync(transcriptPath)) {
        completed++;
        mainWindow.webContents.send('series-analyze-progress', {
          episodeCode: ep.code, phase: 'transcribing',
          current: completed, total: episodes.length,
          detail: `${ep.code}: já transcrito ✓`,
        });
        continue;
      }

      if (!ep.filePath || !fs.existsSync(ep.filePath)) {
        failed++;
        continue;
      }

      mainWindow.webContents.send('series-analyze-progress', {
        episodeCode: ep.code, phase: 'transcribing',
        current: completed + 1, total: episodes.length,
        detail: `A transcrever ${ep.code}...`,
      });

      try {
        // Extract audio from video as mp3 (small file for API)
        const tmpDir = path.join(require('os').tmpdir(), `pinehat-transcript-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });

        const whisperUtils = require('./whisper-utils');
        const duration = await whisperUtils.probeDuration(ep.filePath);
        const ffmpegPath = whisperUtils.findBinary('ffmpeg');

        // Split into 20-min chunks for Whisper API (25MB limit)
        const chunkDuration = 20 * 60;
        const numChunks = Math.ceil(duration / chunkDuration);
        const allWords = [];
        let fullText = '';

        for (let c = 0; c < numChunks; c++) {
          const startSec = c * chunkDuration;
          const chunkPath = path.join(tmpDir, `chunk_${c}.mp3`);

          // Extract audio chunk
          await whisperUtils.runFfmpeg(ffmpegPath, [
            '-y', '-i', ep.filePath, '-ss', String(startSec), '-t', String(chunkDuration),
            '-ac', '1', '-ab', '64k', '-ar', '16000', '-vn', chunkPath,
          ], null, 300000);

          if (!fs.existsSync(chunkPath)) continue;

          // Transcribe with OpenAI Whisper API
          const audioBuffer = fs.readFileSync(chunkPath);
          const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
          const formData = new FormData();
          formData.append('file', audioBlob, `${ep.code}_chunk${c}.mp3`);
          formData.append('model', 'whisper-1');
          formData.append('response_format', 'verbose_json');
          formData.append('timestamp_granularities[]', 'word');
          formData.append('timestamp_granularities[]', 'segment');

          const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.openaiApiKey}` },
            body: formData,
          });

          if (!resp.ok) {
            const err = await resp.text();
            console.error(`[Transcribe] ${ep.code} chunk ${c} failed: ${resp.status} ${err.slice(0, 200)}`);
            continue;
          }

          const result = await resp.json();

          // Offset timestamps for chunks beyond the first
          if (result.words) {
            for (const w of result.words) {
              allWords.push({
                word: w.word,
                start: (w.start || 0) + startSec,
                end: (w.end || 0) + startSec,
              });
            }
          }

          // Collect segments with timestamps
          if (result.segments) {
            for (const seg of result.segments) {
              fullText += (seg.text || '') + ' ';
            }
          } else if (result.text) {
            fullText += result.text + ' ';
          }

          // Clean up chunk
          try { fs.unlinkSync(chunkPath); } catch (_) {}

          mainWindow.webContents.send('series-analyze-progress', {
            episodeCode: ep.code, phase: 'transcribing',
            current: completed + 1, total: episodes.length,
            detail: `${ep.code}: chunk ${c + 1}/${numChunks}...`,
          });

          // Small delay between chunks
          await new Promise(r => setTimeout(r, 500));
        }

        // Save transcript
        const transcript = {
          episodeCode: ep.code,
          seriesId,
          words: allWords,
          fullText: fullText.trim(),
          duration,
          transcribedAt: new Date().toISOString(),
        };

        fs.writeFileSync(transcriptPath, JSON.stringify(transcript), 'utf8');
        completed++;

        // Clean up tmp dir
        try { fs.rmdirSync(tmpDir, { recursive: true }); } catch (_) {}

        console.log(`[Transcribe] ${ep.code} done: ${allWords.length} words, ${fullText.length} chars`);

        mainWindow.webContents.send('series-analyze-progress', {
          episodeCode: ep.code, phase: 'transcribing',
          current: completed, total: episodes.length,
          detail: `${ep.code}: ✓ ${allWords.length} palavras`,
        });

        // Delay between episodes
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.error(`[Transcribe] ${ep.code} error:`, err.message);
        failed++;
      }
    }

    mainWindow.webContents.send('series-analyze-progress', {
      phase: 'transcribe-done', completed, failed, total: episodes.length,
    });

    return { success: true, completed, failed };
    } catch (outerErr) {
      console.error('[Transcribe] Fatal error:', outerErr.message, outerErr.stack);
      return { success: false, error: outerErr.message };
    }
  });
}

module.exports = { register };
