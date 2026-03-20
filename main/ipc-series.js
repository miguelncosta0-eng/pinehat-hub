const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { CHAT_BASE } = require('./elevate-api');

const SERIES_FILE = path.join(DATA_DIR, 'series.json');
const FRAMES_DIR  = path.join(DATA_DIR, 'series_frames');

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
    const s = { id: uuid(), name, folderPath, episodes, createdAt: new Date().toISOString() };
    all.push(s);
    saveSeries(all);
    return s;
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
}

module.exports = { register };
