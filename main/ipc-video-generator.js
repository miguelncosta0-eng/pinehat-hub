/**
 * Video Generator — Random B-Roll clips + Remotion Motion Graphics
 * Pipeline: voiceover → transcribe → random clips → motion graphics every ~5min → export
 */

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DATA_DIR, readJson, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { renderMotionGraphic } = require('./remotion-render');

const SERIES_FILE = path.join(DATA_DIR, 'series.json');
let currentProcess = null;
let cancelled = false;

function findBinary(name) {
  if (process.platform === 'darwin') {
    const macPaths = [`/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/bin/${name}`];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  const { execSync } = require('child_process');
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch (_) { return name; }
}

function runFfmpeg(ffmpegPath, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    currentProcess = proc;
    let stderr = '';
    let settled = false;
    const done = (fn, arg) => { if (settled) return; settled = true; currentProcess = null; fn(arg); };

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) done(resolve);
      else done(reject, new Error(`FFmpeg code ${code}: ${stderr.slice(-300)}`));
    });
    proc.on('error', (err) => done(reject, err));

    if (timeoutMs > 0) {
      setTimeout(() => { proc.kill('SIGTERM'); done(reject, new Error('FFmpeg timeout')); }, timeoutMs);
    }
  });
}

function getVideoDuration(filePath) {
  const ffprobePath = findBinary('ffprobe');
  return new Promise((resolve) => {
    const proc = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', (code) => resolve(code === 0 ? parseFloat(out.trim()) || 0 : 0));
    proc.on('error', () => resolve(0));
  });
}

// Detect what type of motion graphic fits the text
function detectMotionGraphic(text) {
  const low = text.toLowerCase();

  // Numbers/years/dates → Counter
  const numMatch = low.match(/\b(1[89]\d{2}|20[0-3]\d)\b/) || low.match(/\b(\d{1,3}(?:,\d{3})+)\b/) || low.match(/\b(\d+)\s*(million|billion|percent|%|episodes|seasons|views|subscribers)/i);
  if (numMatch) {
    const num = parseInt(numMatch[1].replace(/,/g, ''));
    const label = numMatch[2] || '';
    return { type: 'NumberCounter', props: { number: num, label: label.toUpperCase(), accentColor: '#a855f7' } };
  }

  // Mystery/dark/secret → Glitch
  if (/mystery|secret|hidden|dark|shadow|conspiracy|theory|twist|reveal|unknown|cipher|code|disappear/i.test(low)) {
    const words = text.split(/\s+/).slice(0, 3).join(' ').toUpperCase();
    return { type: 'GlitchText', props: { text: words, accentColor: '#a855f7' } };
  }

  // Quotes or important statements → Typewriter
  if (/said|says|quote|famous|once|never forget|always remember|the truth|the answer/i.test(low) || text.includes('"')) {
    const quote = text.length > 60 ? text.slice(0, 57) + '...' : text;
    return { type: 'Typewriter', props: { text: quote, accentColor: '#a855f7' } };
  }

  // Statistics/growth/comparison → Chart
  if (/growth|increase|decrease|rating|rank|season|episode|compare|statistics|data|chart|graph|percent|rise|fall|trend/i.test(low)) {
    return { type: 'AnimatedChart', props: {
      values: [20, 45, 65, 80, 95],
      labels: ['S1', 'S2', 'S3', 'S4', 'S5'],
      title: text.length > 40 ? text.slice(0, 37) + '...' : text,
      accentColor: '#a855f7',
    }};
  }

  // Default: Typewriter with key phrase
  const phrase = text.length > 50 ? text.slice(0, 47) + '...' : text;
  return { type: 'Typewriter', props: { text: phrase, accentColor: '#a855f7' } };
}

function register() {
  ipcMain.handle('video-generator-generate', async (event, options) => {
    const { voiceoverPath, seriesIds, outputFolder, clipDuration = 5, skipStart = 30, skipEnd = 20, mgInterval = 300 } = options;
    cancelled = false;

    const settings = getSettings();
    const ffmpegPath = findBinary('ffmpeg');

    const send = (data) => {
      try { event.sender.send('video-generator-progress', data); } catch (_) {}
    };

    if (!voiceoverPath || !fs.existsSync(voiceoverPath)) {
      return { success: false, error: 'Ficheiro de áudio não encontrado.' };
    }

    try {
      // ═══════════════════════════════════════
      // STEP 1: Get voiceover duration
      // ═══════════════════════════════════════
      send({ phase: 'preparing', percent: 0, detail: 'A analisar áudio...' });

      const voDuration = await getVideoDuration(voiceoverPath);
      if (voDuration < 1) return { success: false, error: 'Não foi possível obter a duração do áudio.' };

      console.log(`[VideoGen] Voiceover duration: ${(voDuration / 60).toFixed(1)} min`);

      // ═══════════════════════════════════════
      // STEP 2: Transcribe voiceover (for motion graphic detection)
      // ═══════════════════════════════════════
      send({ phase: 'transcribing', percent: 5, detail: 'A transcrever áudio...' });

      let segments = [];
      if (settings.openaiApiKey) {
        try {
          const audioBuffer = fs.readFileSync(voiceoverPath);
          const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
          const formData = new FormData();
          formData.append('file', audioBlob, path.basename(voiceoverPath));
          formData.append('model', 'whisper-1');
          formData.append('response_format', 'verbose_json');
          formData.append('timestamp_granularities[]', 'segment');

          const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.openaiApiKey}` },
            body: formData,
          });

          if (resp.ok) {
            const data = await resp.json();
            segments = (data.segments || []).map(s => ({
              start: s.start || 0,
              end: s.end || 0,
              text: (s.text || '').trim(),
            }));
            console.log(`[VideoGen] Transcribed: ${segments.length} segments`);
          }
        } catch (err) {
          console.error(`[VideoGen] Transcription failed: ${err.message}`);
        }
      }

      // ═══════════════════════════════════════
      // STEP 3: Collect video pool from series
      // ═══════════════════════════════════════
      send({ phase: 'preparing', percent: 10, detail: 'A preparar clips...' });

      const seriesData = readJson(SERIES_FILE) || {};
      const allSeries = seriesData.series || [];
      const videoPool = [];

      for (const sid of (seriesIds || [])) {
        const series = allSeries.find(s => s.id === sid);
        if (!series) continue;
        for (const ep of (series.episodes || [])) {
          if (ep.filePath && fs.existsSync(ep.filePath)) {
            const dur = ep.duration || await getVideoDuration(ep.filePath);
            if (dur > skipStart + skipEnd + clipDuration) {
              videoPool.push({ path: ep.filePath, duration: dur, episode: ep.code });
            }
          }
        }
      }

      if (videoPool.length === 0) {
        return { success: false, error: 'Nenhum episódio válido encontrado.' };
      }

      console.log(`[VideoGen] Video pool: ${videoPool.length} episodes`);

      // ═══════════════════════════════════════
      // STEP 4: Plan segments (clips + motion graphics)
      // ═══════════════════════════════════════
      send({ phase: 'planning', percent: 15, detail: 'A planear segmentos...' });

      const plan = [];
      let t = 0;
      let lastMgTime = -mgInterval; // ensure first MG can appear early
      let mgCount = 0;

      while (t < voDuration) {
        if (cancelled) throw new Error('Cancelado');

        const remaining = voDuration - t;
        if (remaining < 1) break;

        // Check if it's time for a motion graphic (every ~mgInterval seconds)
        const timeSinceLastMg = t - lastMgTime;
        if (timeSinceLastMg >= mgInterval && t > 30 && remaining > 10) {
          // Find transcription text near this timestamp
          const nearSegments = segments.filter(s => s.start >= t - 10 && s.start <= t + 10);
          const mgText = nearSegments.map(s => s.text).join(' ').trim() || 'The story continues...';
          const mg = detectMotionGraphic(mgText);

          plan.push({
            type: 'motion_graphic',
            startTime: t,
            duration: 3,
            mg,
          });

          t += 3;
          lastMgTime = t;
          mgCount++;
          continue;
        }

        // Normal clip
        const dur = Math.min(clipDuration, remaining);
        const vid = videoPool[Math.floor(Math.random() * videoPool.length)];
        const maxStart = vid.duration - skipEnd - dur;
        const minStart = skipStart;
        const startTime = minStart + Math.random() * (maxStart - minStart);

        plan.push({
          type: 'clip',
          startTime: t,
          duration: dur,
          source: vid.path,
          sourceStart: startTime,
          episode: vid.episode,
        });

        t += dur;
      }

      console.log(`[VideoGen] Plan: ${plan.length} segments (${mgCount} motion graphics)`);

      // ═══════════════════════════════════════
      // STEP 5: Extract clips + render motion graphics
      // ═══════════════════════════════════════
      const tempDir = path.join(os.tmpdir(), `videogen_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const PARALLEL = Math.min(6, Math.max(2, Math.floor(os.cpus().length / 2)));
      let completed = 0;

      // Process clips in parallel batches
      for (let batch = 0; batch < plan.length; batch += PARALLEL) {
        if (cancelled) throw new Error('Cancelado');

        const batchEnd = Math.min(batch + PARALLEL, plan.length);
        const promises = [];

        for (let i = batch; i < batchEnd; i++) {
          const item = plan[i];
          const outputPath = path.join(tempDir, `seg_${String(i).padStart(6, '0')}.mp4`);
          item._outputPath = outputPath;

          if (item.type === 'motion_graphic') {
            // Render motion graphic with Remotion
            promises.push(
              renderMotionGraphic(item.mg.type, item.mg.props, item.duration, outputPath)
                .then(() => {
                  completed++;
                  send({
                    phase: 'extracting', percent: 20 + Math.round((completed / plan.length) * 60),
                    detail: `${completed}/${plan.length} — Motion Graphic (${item.mg.type})`,
                  });
                })
                .catch(err => {
                  console.error(`[VideoGen] MG render failed: ${err.message}`);
                  // Fallback: black frame
                  return runFfmpeg(ffmpegPath, [
                    '-y', '-f', 'lavfi', '-i', `color=c=0x0a0a0f:s=1920x1080:d=${item.duration}:r=30`,
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', outputPath,
                  ]);
                })
            );
          } else {
            // Extract random clip
            promises.push(
              runFfmpeg(ffmpegPath, [
                '-y', '-ss', String(item.sourceStart), '-i', item.source, '-t', String(item.duration),
                '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,hflip',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an', outputPath,
              ]).then(() => {
                completed++;
                send({
                  phase: 'extracting', percent: 20 + Math.round((completed / plan.length) * 60),
                  detail: `${completed}/${plan.length} — ${item.episode}`,
                });
              }).catch(err => {
                console.error(`[VideoGen] Clip extract failed: ${err.message}`);
              })
            );
          }
        }

        await Promise.all(promises);
      }

      // ═══════════════════════════════════════
      // STEP 6: Concatenate all segments
      // ═══════════════════════════════════════
      send({ phase: 'concatenating', percent: 82, detail: 'A juntar segmentos...' });

      const validSegments = plan.filter(item => item._outputPath && fs.existsSync(item._outputPath));
      const concatPath = path.join(tempDir, 'concat.txt');
      fs.writeFileSync(concatPath, validSegments.map(item =>
        `file '${item._outputPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
      ).join('\n'));

      const concatOutput = path.join(tempDir, 'concat_video.mp4');
      await runFfmpeg(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-c', 'copy', '-movflags', '+faststart', concatOutput,
      ], 600000);

      // ═══════════════════════════════════════
      // STEP 7: Merge with voiceover audio
      // ═══════════════════════════════════════
      send({ phase: 'merging', percent: 90, detail: 'A adicionar voiceover...' });

      const outputFile = path.join(outputFolder, `video_${Date.now()}.mp4`);
      await runFfmpeg(ffmpegPath, [
        '-y', '-i', concatOutput, '-i', voiceoverPath,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-map', '0:v:0', '-map', '1:a:0', '-shortest',
        '-movflags', '+faststart', outputFile,
      ], 600000);

      // Cleanup
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

      send({ phase: 'done', percent: 100, detail: 'Concluído!' });
      console.log(`[VideoGen] Done: ${outputFile}`);

      return { success: true, outputFile, totalClips: plan.length, motionGraphics: mgCount };

    } catch (err) {
      if (err.message === 'Cancelado') return { success: false, error: 'Cancelado' };
      console.error(`[VideoGen] Error:`, err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('video-generator-cancel', () => {
    cancelled = true;
    if (currentProcess) { currentProcess.kill('SIGTERM'); currentProcess = null; }
    return true;
  });
}

module.exports = { register };
