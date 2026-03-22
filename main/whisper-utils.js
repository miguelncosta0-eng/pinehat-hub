/**
 * Shared Whisper transcription utilities.
 * Used by both ipc-editor.js and ipc-smart-editor.js.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DATA_DIR, ensureDataDir } = require('./ipc-data');

const WHISPER_BIN_DIR = path.join(DATA_DIR, 'whisper-bin');
const WHISPER_MODELS_DIR = path.join(DATA_DIR, 'whisper-models');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

const WHISPER_BIN_URL = IS_WIN
  ? 'https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-blas-bin-x64.zip'
  : null;

const WHISPER_MODEL_URLS = {
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
};

const WHISPER_MODEL_SIZES = { base: 148, small: 466, medium: 1536 }; // MB

// ── Binary helpers ──

function findBinary(name) {
  const { execSync } = require('child_process');

  // On Mac, check common Homebrew paths first (Electron doesn't inherit shell PATH)
  if (IS_MAC) {
    const macPaths = [
      `/usr/local/bin/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/usr/bin/${name}`,
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  try {
    const cmd = IS_WIN ? `where ${name}` : `which ${name}`;
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch (_) {
    return name;
  }
}

function runFfmpeg(ffmpegPath, args, onProgress, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderrLines = [];
    let lastActivity = Date.now();
    let settled = false;

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

    proc.stderr.on('data', (d) => {
      lastActivity = Date.now();
      const text = d.toString();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !/^(frame=|size=|\s*\d+\s*$)/.test(trimmed) && !trimmed.startsWith('Press [q]')) {
          stderrLines.push(trimmed);
        }
      }
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && onProgress) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        onProgress(secs);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) done(resolve);
      else {
        const errorLines = stderrLines.filter((l) =>
          /error|invalid|no such|not found|fail|cannot|unable|unrecognized|does not exist/i.test(l),
        );
        const isCrash = code >= 0xC0000000 && code <= 0xC000FFFF;
        const errMsg = errorLines.length > 0
          ? errorLines.slice(-8).join('\n')
          : stderrLines.slice(isCrash ? -30 : -15).join('\n');
        const crashNote = isCrash ? ' (crash/segfault)' : '';
        console.error(`[FFmpeg] exit ${code} | stderr (${stderrLines.length} lines):\n${stderrLines.slice(-40).join('\n')}`);
        done(reject, new Error(`FFmpeg exit code ${code}${crashNote}:\n${errMsg}`));
      }
    });
    proc.on('error', (err) => done(reject, err));
  });
}

// ── Download helpers ──

function downloadFile(url, destPath, onProgress) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    const request = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? require('https') : require('http');
      mod.get(targetUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
        let downloaded = 0;
        const fileStream = fs.createWriteStream(destPath);
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded, totalBytes);
        });
        response.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve(); });
        fileStream.on('error', (err) => { try { fs.unlinkSync(destPath); } catch (_) {} reject(err); });
      }).on('error', reject);
    };
    request(url);
  });
}

function extractZip(zipPath, destDir) {
  const { execSync } = require('child_process');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  if (IS_WIN) {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { encoding: 'utf-8', timeout: 60000 });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { encoding: 'utf-8', timeout: 60000 });
  }
}

// ── Whisper binary management ──

function getWhisperBinPath() {
  if (!IS_WIN) {
    const { execSync } = require('child_process');
    const candidates = ['whisper-cpp', 'whisper-cli', 'whisper', 'main'];
    for (const name of candidates) {
      try {
        const p = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
        if (p) return p;
      } catch (_) {}
    }
    const brewPaths = ['/usr/local/bin/whisper-cpp', '/opt/homebrew/bin/whisper-cpp',
      '/usr/local/bin/whisper-cli', '/opt/homebrew/bin/whisper-cli'];
    for (const p of brewPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  const candidates = IS_WIN
    ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cpp', 'whisper-cli', 'whisper', 'main'];
  for (const name of candidates) {
    const p = path.join(WHISPER_BIN_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  if (fs.existsSync(WHISPER_BIN_DIR)) {
    try {
      const entries = fs.readdirSync(WHISPER_BIN_DIR, { recursive: true }).map(String);
      for (const name of candidates) {
        const match = entries.find(e => path.basename(e) === name);
        if (match) return path.join(WHISPER_BIN_DIR, match);
      }
    } catch (_) {}
  }
  return null;
}

function getWhisperModelPath(size) {
  const p = path.join(WHISPER_MODELS_DIR, `ggml-${size}.bin`);
  return fs.existsSync(p) ? p : null;
}

async function ensureWhisperBin(onProgress) {
  let binPath = getWhisperBinPath();
  if (binPath) return binPath;

  if (!IS_WIN) {
    throw new Error('whisper.cpp não encontrado. Instala no terminal com: brew install whisper-cpp');
  }

  onProgress({ phase: 'downloading-bin', percent: 0, detail: 'A descarregar whisper.cpp...' });
  const zipPath = path.join(WHISPER_BIN_DIR, 'whisper.zip');
  if (!fs.existsSync(WHISPER_BIN_DIR)) fs.mkdirSync(WHISPER_BIN_DIR, { recursive: true });

  await downloadFile(WHISPER_BIN_URL, zipPath, (dl, total) => {
    const pct = total > 0 ? Math.round((dl / total) * 100) : 0;
    onProgress({ phase: 'downloading-bin', percent: pct, detail: `whisper.cpp: ${(dl / 1024 / 1024).toFixed(1)} MB` });
  });

  onProgress({ phase: 'extracting-bin', percent: 100, detail: 'A extrair whisper.cpp...' });
  extractZip(zipPath, WHISPER_BIN_DIR);
  try { fs.unlinkSync(zipPath); } catch (_) {}

  binPath = getWhisperBinPath();
  if (!binPath) throw new Error('whisper.cpp binary not found after extraction');
  return binPath;
}

async function ensureWhisperModel(size, onProgress) {
  let modelPath = getWhisperModelPath(size);
  if (modelPath) return modelPath;

  const url = WHISPER_MODEL_URLS[size];
  if (!url) throw new Error(`Unknown whisper model size: ${size}`);

  const destPath = path.join(WHISPER_MODELS_DIR, `ggml-${size}.bin`);
  if (!fs.existsSync(WHISPER_MODELS_DIR)) fs.mkdirSync(WHISPER_MODELS_DIR, { recursive: true });

  const expectedMB = WHISPER_MODEL_SIZES[size] || 200;
  onProgress({ phase: 'downloading-model', percent: 0, detail: `A descarregar modelo ${size}...` });

  await downloadFile(url, destPath, (dl, total) => {
    const ref = total > 0 ? total : expectedMB * 1024 * 1024;
    const pct = ref > 0 ? Math.min(99, Math.round((dl / ref) * 100)) : 0;
    onProgress({ phase: 'downloading-model', percent: pct, detail: `Modelo ${size}: ${(dl / 1024 / 1024).toFixed(0)} / ${expectedMB} MB` });
  });

  onProgress({ phase: 'downloading-model', percent: 100, detail: `Modelo ${size} pronto.` });
  return destPath;
}

// ── Audio conversion ──

async function convertToWhisperWav(audioPath, outputWavPath) {
  const ffmpegPath = findBinary('ffmpeg');
  await runFfmpeg(ffmpegPath, ['-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', outputWavPath], null, 300000);
}

async function probeDuration(audioPath) {
  return new Promise((resolve) => {
    const ffprobePath = findBinary('ffprobe');
    const proc = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioPath]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', (code) => {
      if (code === 0) resolve(parseFloat(out.trim()) || 0);
      else resolve(0);
    });
    proc.on('error', () => resolve(0));
  });
}

async function splitAudioChunks(audioPath, duration, tmpDir, format = 'mp3') {
  const ffmpegPath = findBinary('ffmpeg');
  const chunkDuration = 20 * 60;
  const numChunks = Math.ceil(duration / chunkDuration);
  console.log(`[Whisper] Splitting ${(duration / 60).toFixed(0)}min audio into ${numChunks} chunks (${format})`);
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const startSec = i * chunkDuration;
    const ext = format === 'wav' ? '.wav' : '.mp3';
    const chunkPath = path.join(tmpDir, `chunk_${i}${ext}`);
    const args = format === 'wav'
      ? ['-i', audioPath, '-ss', String(startSec), '-t', String(chunkDuration), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', chunkPath]
      : ['-i', audioPath, '-ss', String(startSec), '-t', String(chunkDuration), '-ac', '1', '-ab', '64k', '-ar', '16000', '-y', chunkPath];
    await runFfmpeg(ffmpegPath, args, null, 300000);
    chunks.push({ path: chunkPath, startSec });
  }
  return chunks;
}

// ── Whisper API transcription ──

async function whisperTranscribeFile(filePath, apiKey) {
  const audioBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
  const mimeType = mimeMap[ext] || 'audio/mpeg';

  const audioBlob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('file', audioBlob, path.basename(filePath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API ${response.status}: ${err.slice(0, 300)}`);
  }
  return await response.json();
}

// ── Whisper local transcription ──

function parseWhisperCppJson(raw, modelSize) {
  const words = [];
  const textParts = [];
  const segments = raw.transcription || [];
  for (const segment of segments) {
    textParts.push((segment.text || '').trim());
    const tokens = segment.tokens || [];
    for (const token of tokens) {
      const text = (token.text || '').trim();
      if (!text || text.startsWith('[_') || text.startsWith('<|')) continue;
      const start = (token.offsets?.from ?? 0) / 1000;
      const end = (token.offsets?.to ?? 0) / 1000;
      if (start === 0 && end === 0 && words.length > 0) continue;
      words.push({ word: text, start, end });
    }
  }
  return { words, fullText: textParts.join(' ').replace(/\s+/g, ' ').trim(), model: `whisper.cpp-${modelSize}` };
}

function whisperLocalTranscribe(wavPath, binPath, modelPath, modelSize, langFlag) {
  const lf = langFlag || '-l';
  return new Promise((resolve, reject) => {
    const outputBase = wavPath.replace(/\.wav$/i, '');
    const threads = Math.max(1, Math.min(os.cpus().length - 1, 8));
    const args = ['-m', modelPath, '-f', wavPath, '--output-json-full', '--output-file', outputBase, lf, 'auto', '--threads', String(threads), '--print-progress'];
    console.log(`[WhisperLocal] ${binPath} ${args.join(' ')}`);

    const proc = spawn(binPath, args);
    let stderrText = '';
    let stdoutText = '';
    let settled = false;

    const done = (fn, arg) => { if (settled) return; settled = true; fn(arg); };

    proc.stderr.on('data', (d) => { stderrText += d.toString(); });
    proc.stdout.on('data', (d) => {
      stdoutText += d.toString();
      const m = d.toString().match(/progress\s*=\s*(\d+)/);
      if (m) console.log(`[WhisperLocal] Progress: ${m[1]}%`);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const errDetail = (stderrText + '\n' + stdoutText).trim().slice(-500);
        console.error(`[WhisperLocal] Exit ${code}. stderr: ${stderrText.slice(-300)}\nstdout: ${stdoutText.slice(-300)}`);
        done(reject, new Error(`whisper.cpp exit ${code}: ${errDetail}`));
        return;
      }
      const jsonPath = outputBase + '.json';
      if (!fs.existsSync(jsonPath)) { done(reject, new Error('whisper.cpp não produziu ficheiro JSON')); return; }
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const result = parseWhisperCppJson(raw, modelSize);
        try { fs.unlinkSync(jsonPath); } catch (_) {}
        done(resolve, result);
      } catch (err) { done(reject, new Error(`Erro ao ler output whisper.cpp: ${err.message}`)); }
    });
    proc.on('error', (err) => done(reject, err));
  });
}

// ── High-level transcription functions ──

async function transcribeApi(audioPath, duration, settings, onProgress) {
  const send = onProgress || (() => {});
  const fileStats = fs.statSync(audioPath);
  const needsSplit = fileStats.size > 25 * 1024 * 1024;

  if (!needsSplit) {
    send({ phase: 'uploading', percent: 10 });
    send({ phase: 'transcribing', percent: 30 });
    const result = await whisperTranscribeFile(audioPath, settings.openaiApiKey);
    send({ phase: 'done', percent: 100 });
    return {
      words: (result.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
      fullText: result.text,
      model: 'whisper-1',
    };
  }

  const tmpDir = path.join(os.tmpdir(), `pinehat-whisper-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    send({ phase: 'splitting', percent: 5 });
    let audioDuration = duration || 0;
    if (!audioDuration) audioDuration = await probeDuration(audioPath);
    if (!audioDuration) audioDuration = 7200;
    const chunks = await splitAudioChunks(audioPath, audioDuration, tmpDir, 'mp3');
    const allWords = [];
    const allTexts = [];

    for (let i = 0; i < chunks.length; i++) {
      const pct = Math.round(10 + (i / chunks.length) * 80);
      send({ phase: 'chunk', current: i + 1, total: chunks.length, percent: pct });
      const result = await whisperTranscribeFile(chunks[i].path, settings.openaiApiKey);
      const offset = chunks[i].startSec;
      const words = (result.words || []).map((w) => ({ word: w.word, start: w.start + offset, end: w.end + offset }));
      allWords.push(...words);
      allTexts.push(result.text);
    }

    send({ phase: 'done', percent: 100 });
    return { words: allWords, fullText: allTexts.join(' '), model: 'whisper-1' };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function transcribeLocal(audioPath, duration, settings, onProgress) {
  const modelSize = settings.whisperModelSize || 'base';
  const send = onProgress || (() => {});

  send({ phase: 'setup', percent: 2, detail: 'A verificar whisper.cpp...' });
  const binPath = await ensureWhisperBin((p) => send(p));
  send({ phase: 'setup', percent: 5, detail: `A verificar modelo ${modelSize}...` });
  const modelPath = await ensureWhisperModel(modelSize, (p) => send(p));

  let audioDuration = duration || 0;
  if (!audioDuration) audioDuration = await probeDuration(audioPath);
  if (!audioDuration) audioDuration = 7200;

  const tmpDir = path.join(os.tmpdir(), `pinehat-whisper-local-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  let langFlag = '-l';
  async function transcribeWithRetry(wavPath) {
    try {
      return await whisperLocalTranscribe(wavPath, binPath, modelPath, modelSize, langFlag);
    } catch (err) {
      if (err.message && err.message.includes('unknown argument') && langFlag === '-l') {
        console.log('[WhisperLocal] Retrying with --language flag');
        langFlag = '--language';
        return await whisperLocalTranscribe(wavPath, binPath, modelPath, modelSize, langFlag);
      }
      throw err;
    }
  }

  try {
    if (audioDuration <= 30 * 60) {
      send({ phase: 'converting', percent: 10, detail: 'A converter áudio para WAV 16kHz...' });
      const wavPath = path.join(tmpDir, 'audio.wav');
      await convertToWhisperWav(audioPath, wavPath);
      send({ phase: 'transcribing', percent: 20, detail: `Whisper local (${modelSize}) a transcrever...` });
      const result = await transcribeWithRetry(wavPath);
      send({ phase: 'done', percent: 100 });
      return result;
    }

    send({ phase: 'splitting', percent: 5, detail: 'A dividir áudio em partes...' });
    const chunks = await splitAudioChunks(audioPath, audioDuration, tmpDir, 'wav');
    const allWords = [];
    const allTexts = [];

    for (let i = 0; i < chunks.length; i++) {
      const pct = Math.round(10 + (i / chunks.length) * 85);
      send({ phase: 'chunk', current: i + 1, total: chunks.length, percent: pct, detail: `A transcrever parte ${i + 1}/${chunks.length} (${modelSize})...` });
      const result = await transcribeWithRetry(chunks[i].path);
      const offset = chunks[i].startSec;
      const words = result.words.map((w) => ({ word: w.word, start: w.start + offset, end: w.end + offset }));
      allWords.push(...words);
      allTexts.push(result.fullText);
      console.log(`[WhisperLocal] Chunk ${i + 1} done: ${words.length} words`);
    }

    send({ phase: 'done', percent: 100 });
    return { words: allWords, fullText: allTexts.join(' '), model: `whisper.cpp-${modelSize}` };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * High-level transcribe function.
 * @param {string} audioPath - Path to audio file
 * @param {number} duration - Audio duration in seconds (0 = auto-detect)
 * @param {object} settings - App settings (whisperMode, openaiApiKey, whisperModelSize)
 * @param {function} onProgress - Progress callback: ({phase, percent, detail})
 * @returns {Promise<{words: Array, fullText: string, model: string}>}
 */
async function transcribe(audioPath, duration, settings, onProgress) {
  const isLocal = settings.whisperMode === 'local';
  if (!isLocal && !settings.openaiApiKey) {
    throw new Error('Chave API da OpenAI não configurada. Vai a Definições.');
  }
  if (isLocal) return await transcribeLocal(audioPath, duration, settings, onProgress);
  return await transcribeApi(audioPath, duration, settings, onProgress);
}

module.exports = {
  findBinary,
  runFfmpeg,
  probeDuration,
  splitAudioChunks,
  convertToWhisperWav,
  transcribe,
  transcribeApi,
  transcribeLocal,
  downloadFile,
  ensureWhisperBin,
  ensureWhisperModel,
};
