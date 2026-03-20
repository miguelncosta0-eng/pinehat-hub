/**
 * Silence removal worker — runs in a separate Node process
 * so the main Electron process stays responsive.
 *
 * Receives: { audioPath, threshold, minSilenceDuration, ffmpegPath }
 * Sends:    { type: 'progress', phase, percent }
 *           { type: 'result', data: { success, ... } }
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const opts = JSON.parse(process.argv[2]);
const { audioPath, threshold, minSilenceDuration, ffmpegPath } = opts;

const noiseLevel = threshold || -40;
const minSilence = minSilenceDuration || 0.7;
// Scale padding with silence duration — more aggressive for short silences
const keepPad = Math.min(0.08, minSilence * 0.15);

function send(type, payload) {
  process.send({ type, ...payload });
}

function probeDuration(filePath) {
  return new Promise((resolve) => {
    const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const proc = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', () => resolve(parseFloat(out.trim()) || 0));
    proc.on('error', () => resolve(0));
  });
}

function runFfmpeg(args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let lastActivity = Date.now();
    let settled = false;
    let stderrOutput = '';

    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      fn(arg);
    };

    const watchdog = timeoutMs > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        proc.kill('SIGTERM');
        done(reject, new Error(`FFmpeg timeout — sem atividade há ${Math.round(timeoutMs / 1000)}s`));
      }
    }, 5000) : null;

    proc.stderr.on('data', (d) => { lastActivity = Date.now(); stderrOutput += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        done(resolve, undefined);
      } else {
        const lastLines = stderrOutput.split('\n').slice(-5).join('\n');
        done(reject, new Error(`FFmpeg exit code ${code}: ${lastLines}`));
      }
    });
    proc.on('error', (err) => done(reject, err));
  });
}

(async () => {
  try {
    // Step 1: Detect silence regions
    send('progress', { phase: 'detecting', percent: 10 });
    const silences = await new Promise((resolve, reject) => {
      const regions = [];
      const proc = spawn(ffmpegPath, [
        '-i', audioPath,
        '-af', `silencedetect=noise=${noiseLevel}dB:d=${minSilence}`,
        '-f', 'null', '-',
      ]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', () => {
        const lines = stderr.split('\n');
        let currentStart = null;
        for (const line of lines) {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/);
          const endMatch = line.match(/silence_end:\s*([\d.]+)/);
          if (startMatch) currentStart = parseFloat(startMatch[1]);
          if (endMatch && currentStart !== null) {
            regions.push({ start: currentStart, end: parseFloat(endMatch[1]) });
            currentStart = null;
          }
        }
        resolve(regions);
      });
      proc.on('error', reject);
    });

    send('progress', { phase: 'detecting', percent: 40 });

    if (silences.length === 0) {
      send('result', { data: { success: true, noChange: true, message: 'Nenhum silêncio detetado.' } });
      process.exit(0);
      return;
    }

    // Step 2: Get original duration
    const origDuration = await probeDuration(audioPath);

    // Step 3: Calculate audio segments to KEEP
    const segments = [];
    let pos = 0;
    for (const s of silences) {
      const segStart = pos;
      const segEnd = Math.min(s.start + keepPad, s.end);
      if (segEnd - segStart > 0.05) {
        segments.push({ start: segStart, end: segEnd });
      }
      pos = Math.max(s.end - keepPad, s.start);
    }
    if (pos < origDuration) {
      segments.push({ start: pos, end: origDuration });
    }

    if (segments.length === 0) {
      send('result', { data: { success: false, error: 'Todo o áudio é silêncio.' } });
      process.exit(0);
      return;
    }

    send('progress', { phase: 'trimming', percent: 50 });

    const ext = path.extname(audioPath);
    const base = audioPath.replace(ext, '');
    const tempDir = path.join(os.tmpdir(), `silence_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = `${base}_trimmed.mp3`;

    // Use individual segment extraction + concat for reliability on large files
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(segments.length / BATCH_SIZE);
    const batchFiles = [];

    for (let b = 0; b < totalBatches; b++) {
      const batchSegs = segments.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      const batchFile = path.join(tempDir, `batch_${b}.mp3`);

      const pct = 50 + Math.round((b / totalBatches) * 40);
      send('progress', { phase: `A cortar parte ${b + 1}/${totalBatches}...`, percent: pct });

      // Build select filter: select segments by time range using atrim+concat
      // Use -ss/-to per segment and concat — more memory-efficient
      const segFiles = [];
      for (let i = 0; i < batchSegs.length; i++) {
        const seg = batchSegs[i];
        const segFile = path.join(tempDir, `seg_${b}_${i}.mp3`);
        await runFfmpeg([
          '-y', '-ss', String(seg.start), '-to', String(seg.end),
          '-i', audioPath,
          '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100', '-ac', '1',
          segFile,
        ], 120000);
        segFiles.push(segFile);
      }

      // Concat batch segments
      const listFile = path.join(tempDir, `list_${b}.txt`);
      fs.writeFileSync(listFile, segFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      await runFfmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:a', 'copy', batchFile,
      ], 300000);

      // Cleanup segment files
      segFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
      batchFiles.push(batchFile);
    }

    // Final merge
    if (batchFiles.length === 1) {
      fs.renameSync(batchFiles[0], outputPath);
    } else {
      send('progress', { phase: 'A juntar...', percent: 93 });
      const mergeList = path.join(tempDir, 'merge.txt');
      fs.writeFileSync(mergeList, batchFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      await runFfmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', mergeList,
        '-c:a', 'copy', outputPath,
      ], 600000);
    }

    // Cleanup temp
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

    // Step 5: Get new duration
    const newDuration = await probeDuration(outputPath);
    const silenceRemoved = origDuration - newDuration;

    send('progress', { phase: 'done', percent: 100 });
    send('result', {
      data: {
        success: true,
        outputPath,
        originalDuration: origDuration,
        newDuration,
        silenceCount: silences.length,
        silenceRemoved,
      },
    });
    process.exit(0);
  } catch (err) {
    send('result', { data: { success: false, error: err.message } });
    process.exit(1);
  }
})();
