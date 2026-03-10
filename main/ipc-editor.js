const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const EDITOR_DIR = path.join(DATA_DIR, 'editor');
const TTS_DIR = path.join(DATA_DIR, 'editor', 'tts');
const WHISPER_BIN_DIR = path.join(DATA_DIR, 'whisper-bin');
const WHISPER_MODELS_DIR = path.join(DATA_DIR, 'whisper-models');

let currentProcess = null;
let ttsCancelled = false;

function ensureEditorDir() {
  ensureDataDir();
  if (!fs.existsSync(EDITOR_DIR)) fs.mkdirSync(EDITOR_DIR, { recursive: true });
}

// ── FFmpeg helper (same pattern as ipc-broll.js) ──

function findBinary(name) {
  const { execSync } = require('child_process');
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    const result = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
    return result;
  } catch (_) {
    return name; // hope it's in PATH
  }
}

function runFfmpeg(ffmpegPath, args, onProgress, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    currentProcess = proc;
    let stderrLines = [];
    let lastActivity = Date.now();
    let settled = false;

    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      currentProcess = null;
      fn(arg);
    };

    // Watchdog: kill if no stderr output for timeoutMs (0 = disabled)
    const watchdog = timeoutMs > 0 ? setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        proc.kill('SIGTERM');
        done(reject, new Error(`FFmpeg timeout — sem atividade há ${Math.round(timeoutMs / 1000)}s`));
      }
    }, 5000) : null;

    proc.stderr.on('data', (d) => {
      lastActivity = Date.now();
      const text = d.toString();
      // Collect non-progress lines for error reporting
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !/^(frame=|size=|\s*\d+\s*$)/.test(trimmed) && !trimmed.startsWith('Press [q]')) {
          stderrLines.push(trimmed);
        }
      }
      // Parse progress from stderr: time=HH:MM:SS.mm
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && onProgress) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        onProgress(secs);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) done(resolve);
      else {
        // Get the last meaningful error lines (skip header/config lines)
        const errorLines = stderrLines.filter((l) =>
          /error|invalid|no such|not found|fail|cannot|unable|unrecognized|does not exist/i.test(l),
        );
        // Windows crash codes: 0xC0000000–0xC000FFFF (e.g. 0xC0000005 = access violation)
        const isCrash = code >= 0xC0000000 && code <= 0xC000FFFF;
        // Show more context for crashes — include surrounding lines
        const errMsg = errorLines.length > 0
          ? errorLines.slice(-8).join('\n')
          : stderrLines.slice(isCrash ? -30 : -15).join('\n');
        const crashNote = isCrash ? ' (crash/segfault)' : '';
        // Log full stderr for debugging
        console.error(`[FFmpeg] exit ${code} | stderr (${stderrLines.length} lines):\n${stderrLines.slice(-40).join('\n')}`);
        done(reject, new Error(`FFmpeg exit code ${code}${crashNote}:\n${errMsg}`));
      }
    });
    proc.on('error', (err) => done(reject, err));
  });
}

// ── Whisper Local (whisper.cpp) ──

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

const WHISPER_BIN_URL = IS_WIN
  ? 'https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-blas-bin-x64.zip'
  : null; // Mac uses brew install whisper-cpp

const WHISPER_MODEL_URLS = {
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
};

const WHISPER_MODEL_SIZES = { base: 148, small: 466, medium: 1536 }; // MB

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

function getWhisperBinPath() {
  // On Mac, check if installed via Homebrew or in PATH first
  if (!IS_WIN) {
    const { execSync } = require('child_process');
    const candidates = ['whisper-cpp', 'whisper-cli', 'whisper', 'main'];
    for (const name of candidates) {
      try {
        const p = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
        if (p) return p;
      } catch (_) {}
    }
    // Also check Homebrew common paths
    const brewPaths = ['/usr/local/bin/whisper-cpp', '/opt/homebrew/bin/whisper-cpp',
      '/usr/local/bin/whisper-cli', '/opt/homebrew/bin/whisper-cli'];
    for (const p of brewPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Check local whisper-bin directory
  const candidates = IS_WIN
    ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cpp', 'whisper-cli', 'whisper', 'main'];
  for (const name of candidates) {
    const p = path.join(WHISPER_BIN_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  // Check subdirectories (zip may extract into a folder) — prefer whisper-cli over main
  if (fs.existsSync(WHISPER_BIN_DIR)) {
    try {
      const entries = fs.readdirSync(WHISPER_BIN_DIR, { recursive: true }).map(String);
      // Search in priority order
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

  // On Mac, whisper.cpp must be installed via Homebrew
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

async function convertToWhisperWav(audioPath, outputWavPath) {
  const ffmpegPath = findBinary('ffmpeg');
  await runFfmpeg(ffmpegPath, ['-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', outputWavPath], null, 300000);
}

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
    currentProcess = proc;
    let stderrText = '';
    let stdoutText = '';
    let settled = false;

    const done = (fn, arg) => { if (settled) return; settled = true; currentProcess = null; fn(arg); };

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

// ── Episode mention parsing ──

function parseEpisodeMentions(transcription) {
  if (!transcription || !transcription.words) return [];
  const mentions = [];
  const words = transcription.words;

  for (let i = 0; i < words.length; i++) {
    const windowText = words.slice(i, i + 8).map((w) => w.word).join(' ').toLowerCase();

    // Pattern: "season X episode Y"
    const match1 = windowText.match(/season\s*(\d+)\s*episode\s*(\d+)/);
    if (match1) {
      mentions.push({
        seasonNum: parseInt(match1[1]),
        episodeNum: parseInt(match1[2]),
        time: words[i].start,
      });
      continue;
    }

    // Pattern: "S01E05" in a single word
    const match2 = words[i].word.match(/s(\d+)e(\d+)/i);
    if (match2) {
      mentions.push({
        seasonNum: parseInt(match2[1]),
        episodeNum: parseInt(match2[2]),
        time: words[i].start,
      });
    }
  }
  return mentions;
}

function findEpisodeForTime(currentTime, mentions, episodes) {
  let bestMention = null;
  for (const m of mentions) {
    if (m.time <= currentTime) bestMention = m;
  }

  if (bestMention) {
    const match = episodes.find(
      (ep) => ep.seasonNum === bestMention.seasonNum && ep.episodeNum === bestMention.episodeNum,
    );
    if (match) return match;
  }

  // Fallback: random episode
  return episodes[Math.floor(Math.random() * episodes.length)];
}

function pickClipFromEpisode(episode, clipDuration, skipStart, skipEnd, usedSegments) {
  const minDistance = 300; // 5 minutes
  const usable = episode.duration - skipStart - skipEnd - clipDuration;
  if (usable <= 0) return null;

  const used = usedSegments[episode.path] || [];

  for (let attempt = 0; attempt < 50; attempt++) {
    const startTime = skipStart + Math.random() * usable;
    const tooClose = used.some((seg) => Math.abs(seg.start - startTime) < minDistance);
    if (!tooClose) {
      used.push({ start: startTime, end: startTime + clipDuration });
      usedSegments[episode.path] = used;
      return { source: episode.path, startTime };
    }
  }

  // Exhausted — allow repeat
  const startTime = skipStart + Math.random() * usable;
  used.push({ start: startTime, end: startTime + clipDuration });
  usedSegments[episode.path] = used;
  return { source: episode.path, startTime };
}

// ── Overlay detection prompt ──

function buildOverlayDetectionPrompt(chunkText, chunkWords, chunkStartSec, chunkEndSec, totalDurationSec) {
  // Include all word timestamps for this chunk (no sampling needed per-chunk)
  const maxWords = 2000;
  const stride = Math.max(1, Math.floor(chunkWords.length / maxWords));
  const wordTimestamps = chunkWords
    .filter((_, i) => i % stride === 0)
    .map((w) => `[${w.start.toFixed(1)}] ${w.word}`)
    .join(' ');

  const startMin = Math.floor(chunkStartSec / 60);
  const endMin = Math.floor(chunkEndSec / 60);
  const totalMin = Math.floor(totalDurationSec / 60);

  return `You are analyzing a segment of a voiceover script for a YouTube video editor. The video is about TV show analysis.

THIS SEGMENT covers minutes ${startMin}–${endMin} of a ${totalMin}-minute video (timestamps ${chunkStartSec.toFixed(0)}s – ${chunkEndSec.toFixed(0)}s).

TRANSCRIPTION (with word-level timestamps in seconds):
${wordTimestamps}

FULL TEXT OF THIS SEGMENT:
${chunkText}

Analyze this segment and identify moments where a BLACK SCREEN TEXT OVERLAY should appear. These overlays PAUSE the video and show bold text centered on a black background for 2-4 seconds — like dramatic emphasis moments.

For each overlay, provide:
1. **type**: One of: "episode", "date", "rating", "character", "location", "statistic", "impact"
2. **text**: The text to display (concise, max 30 characters)
3. **startTime**: Timestamp in seconds (absolute, NOT relative to segment start)
4. **duration**: How long the overlay shows (2-4 seconds; use 4 for counting numbers)
5. **isCountingNumber**: true if the overlay has a number that should count up from 0
6. **numberValue**: If isCountingNumber, the final numeric value (e.g. 9.2, 600, 20)
7. **numberLabel**: If isCountingNumber, a short label below the number (e.g. "IMDB RATING", "YEARS")
8. **numberPrefix**: If applicable, prefix like "$"
9. **numberUnit**: If applicable, unit like "/ 10" or "Million"

Return as a JSON array. Example:
[
  {"type":"episode","text":"Season 1, Episode 5","startTime":${(chunkStartSec + 12).toFixed(1)},"duration":3},
  {"type":"rating","text":"9.2 / 10","startTime":${(chunkStartSec + 45).toFixed(1)},"duration":4,"isCountingNumber":true,"numberValue":9.2,"numberLabel":"IMDB RATING","numberUnit":"/ 10"},
  {"type":"impact","text":"Nothing is what it seems","startTime":${(chunkStartSec + 80).toFixed(1)},"duration":3}
]

Rules:
- Only include overlays that add genuine value — think dramatic pauses
- Space overlays at least 10 seconds apart
- Maximum 1 overlay per 30 seconds of content
- Use ABSOLUTE timestamps (the timestamps in the transcription above are already absolute)
- For ratings and statistics with numbers, always set isCountingNumber to true
- For impact phrases, use exact words from the transcript
- Return ONLY the JSON array, no explanation`;
}

// ── FFmpeg overlay system — black screen pause with animations ──

function escapeDrawtext(text) {
  // Strip ALL control characters including newlines/tabs (break filter_complex_script)
  let s = text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
  // FFmpeg drawtext escaping — order matters!
  s = s.replace(/\\/g, '\\\\');     // \ → \\
  s = s.replace(/'/g, '\u2019');     // ' → \u2019 (typographic apostrophe — can't escape ' inside single-quoted filter values)
  s = s.replace(/:/g, '\\:');       // : → \:
  s = s.replace(/;/g, '\\;');       // ; → \;
  s = s.replace(/%/g, '%%');        // % → %%
  s = s.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return s;
}

// Find a font that exists on the system
function getDrawtextFontFile() {
  const fontsDir = 'C:\\Windows\\Fonts';
  const candidates = ['arialbd.ttf', 'arial.ttf', 'segoeui.ttf', 'tahomabd.ttf', 'tahoma.ttf'];
  for (const font of candidates) {
    if (fs.existsSync(path.join(fontsDir, font))) {
      return `C\\:/Windows/Fonts/${font}`;
    }
  }
  return 'C\\:/Windows/Fonts/arial.ttf';
}

// ── Color palettes per channel ──

const OVERLAY_PALETTES = {
  pinehat:   ['#ffffff', '#8b5cf6', '#c4b5fd', '#e879f9', '#f0abfc'],
  papertown: ['#ffffff', '#f59e0b', '#fcd34d', '#fb923c', '#fdba74'],
  cortoon:   ['#ffffff', '#22c55e', '#86efac', '#34d399', '#a7f3d0'],
};

function assignOverlayColors(overlays, channel) {
  const palette = OVERLAY_PALETTES[channel] || OVERLAY_PALETTES.pinehat;
  overlays.forEach((o, i) => {
    if (!o.color) o.color = palette[i % palette.length];
  });
}

// ── Animation expressions for drawtext ──

const ANIMATIONS = ['slide-up', 'slide-down', 'fade-zoom', 'slide-left', 'slide-right'];
let animationCounter = 0;

function getAnimationType(requested) {
  if (requested && requested !== 'auto') return requested;
  const anim = ANIMATIONS[animationCounter % ANIMATIONS.length];
  animationCounter++;
  return anim;
}

// ── Build drawbox+drawtext filter for one overlay (absolute timestamps) ──

function buildOverlayFilter(overlay, fontFile) {
  const start = overlay.startTime;
  const dur = overlay.duration || 3;
  const end = start + dur;
  const fontSize = overlay.fontSize || 72;
  const color = (overlay.color || '#ffffff').replace('#', '');
  const entryDur = 0.4;
  const exitLocal = dur - 0.4;
  const animType = getAnimationType(overlay.animation);
  const escapedText = escapeDrawtext(overlay.text);

  const en = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;
  const lt = `(t-${start.toFixed(3)})`;  // local time

  const cx = '(w-tw)/2';
  const cy = '(h-th)/2';

  let xExpr, yExpr, alphaExpr;

  switch (animType) {
  case 'slide-up':
    xExpr = cx;
    yExpr = `if(lt(${lt}\\,${entryDur})\\, h*(1-${lt}/${entryDur})+(${cy})*(${lt}/${entryDur})\\, if(gt(${lt}\\,${exitLocal})\\, (${cy})*(1-(${lt}-${exitLocal})/${entryDur})+(-th)*((${lt}-${exitLocal})/${entryDur})\\, ${cy}))`;
    break;
  case 'slide-down':
    xExpr = cx;
    yExpr = `if(lt(${lt}\\,${entryDur})\\, (-th)*(1-${lt}/${entryDur})+(${cy})*(${lt}/${entryDur})\\, if(gt(${lt}\\,${exitLocal})\\, (${cy})*(1-(${lt}-${exitLocal})/${entryDur})+(h)*((${lt}-${exitLocal})/${entryDur})\\, ${cy}))`;
    break;
  case 'fade-zoom':
    xExpr = cx;
    yExpr = cy;
    alphaExpr = `if(lt(${lt}\\,${entryDur})\\, ${lt}/${entryDur}\\, if(gt(${lt}\\,${exitLocal})\\, 1-(${lt}-${exitLocal})/${entryDur}\\, 1))`;
    break;
  case 'slide-left':
    xExpr = `if(lt(${lt}\\,${entryDur})\\, w*(1-${lt}/${entryDur})+(${cx})*(${lt}/${entryDur})\\, if(gt(${lt}\\,${exitLocal})\\, (${cx})*(1-(${lt}-${exitLocal})/${entryDur})+(-tw)*((${lt}-${exitLocal})/${entryDur})\\, ${cx}))`;
    yExpr = cy;
    break;
  case 'slide-right':
    xExpr = `if(lt(${lt}\\,${entryDur})\\, (-tw)*(1-${lt}/${entryDur})+(${cx})*(${lt}/${entryDur})\\, if(gt(${lt}\\,${exitLocal})\\, (${cx})*(1-(${lt}-${exitLocal})/${entryDur})+(w)*((${lt}-${exitLocal})/${entryDur})\\, ${cx}))`;
    yExpr = cy;
    break;
  default:
    xExpr = cx;
    yExpr = cy;
    alphaExpr = `if(lt(${lt}\\,${entryDur})\\, ${lt}/${entryDur}\\, if(gt(${lt}\\,${exitLocal})\\, 1-(${lt}-${exitLocal})/${entryDur}\\, 1))`;
  }

  // drawbox blacks out the frame, drawtext shows animated text
  let filter = `drawbox=enable='${en}':color=black:t=fill`;
  filter += `,drawtext=enable='${en}'`;
  filter += `:fontfile='${fontFile}'`;
  filter += `:text='${escapedText}'`;
  filter += `:fontsize=${fontSize}`;
  filter += `:fontcolor=0x${color}`;
  if (alphaExpr) filter += `:alpha='${alphaExpr}'`;
  filter += `:x='${xExpr}':y='${yExpr}'`;

  return filter;
}

// ── Number counting overlay filter (absolute timestamps) ──

function buildCountingOverlayFilter(overlay, fontFile) {
  const start = overlay.startTime;
  const dur = overlay.duration || 3;
  const end = start + dur;
  const numValue = overlay.numberValue;
  const prefix = overlay.numberPrefix || '';
  const unit = overlay.numberUnit || '';
  const label = overlay.numberLabel || '';
  const color = (overlay.color || '#ffffff').replace('#', '');
  const countDur = 1.5;
  const steps = 5; // low step count to keep filter chain manageable
  const stepDur = countDur / steps;
  const isFloat = numValue % 1 !== 0;

  const en = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;

  // drawbox background
  let filter = `drawbox=enable='${en}':color=black:t=fill`;

  // Counting steps — absolute timestamps (6 drawtext entries instead of 31)
  for (let i = 0; i <= steps; i++) {
    const t0 = (start + i * stepDur).toFixed(4);
    const t1 = i < steps ? (start + (i + 1) * stepDur).toFixed(4) : end.toFixed(3);
    const progress = i / steps;
    const currentNum = numValue * progress;
    const displayNum = isFloat ? currentNum.toFixed(1) : Math.round(currentNum).toString();
    const displayText = escapeDrawtext(`${prefix}${displayNum}${unit ? ' ' + unit : ''}`);

    filter += `,drawtext=fontfile='${fontFile}':text='${displayText}':fontsize=96:fontcolor=0x${color}:x=(w-tw)/2:y=(h-th)/2-40:enable='between(t\\,${t0}\\,${t1})'`;
  }

  // Label below (visible during entire overlay)
  if (label) {
    const labelText = escapeDrawtext(label.toUpperCase());
    filter += `,drawtext=fontfile='${fontFile}':text='${labelText}':fontsize=36:fontcolor=0x${color}@0.7:x=(w-tw)/2:y=(h+th)/2+20:enable='${en}'`;
  }

  return filter;
}

// ── Build complete overlay filtergraph (all overlays chained) ──

function buildOverlayFiltergraph(overlays, fontFile) {
  if (!overlays || overlays.length === 0) return null;

  const sorted = [...overlays].sort((a, b) => a.startTime - b.startTime);
  const filters = [];

  for (const overlay of sorted) {
    if (overlay.isCountingNumber && overlay.numberValue != null) {
      filters.push(buildCountingOverlayFilter(overlay, fontFile));
    } else {
      filters.push(buildOverlayFilter(overlay, fontFile));
    }
  }

  return filters.join(',');
}

// ── Captions: ASS subtitle generation from word-level transcription ──

function toASSTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const si = Math.floor(s % 60);
  const cs = Math.min(99, Math.round(((s % 60) - si) * 100));
  return `${h}:${String(m).padStart(2, '0')}:${String(si).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function generateCaptionsASS(transcription, resW = 1920, resH = 1080) {
  if (!transcription || !transcription.words || transcription.words.length === 0) return null;

  const midX = Math.round(resW / 2);
  const baseY = Math.round(resH * 0.90);   // text bottom at 90% height (10% from bottom)
  const slideY = Math.round(resH + 60);    // starts 60px below frame bottom
  const slideMs = 200; // 200ms slide

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${resW}`,
    `PlayResY: ${resH}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Word,Arial,62,&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,-1,0,0,0,100,100,0.5,0,1,4,2,2,30,30,40,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  for (const w of transcription.words) {
    // Sanitize for ASS: strip control chars, escape backslash and curly braces
    const word = (w.word || '').trim()
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\\/g, '')
      .replace(/[{}]/g, '');
    if (!word) continue;

    const start = Math.max(0, w.start);
    // Keep word visible for at least 0.3s or until word ends
    const end = Math.max(start + 0.3, (w.end || start + 0.4));

    // \blur5 = initial gaussian blur (motion blur effect)
    // \t(0,slideMs,\blur0) = animate blur from 5 to 0 over slideMs
    // \move(x1,y1,x2,y2,t1ms,t2ms) = slide from below to position
    const tags = `{\\blur5\\t(0,${slideMs},\\blur0)\\move(${midX},${slideY},${midX},${baseY},0,${slideMs})}`;
    lines.push(`Dialogue: 0,${toASSTime(start)},${toASSTime(end)},Word,,0,0,0,,${tags}${word}`);
  }

  return lines.join('\n');
}

// ── Entity image overlay helpers ──

const ENTITIES_DIR = path.join(DATA_DIR, 'editor', 'entities');
const ENTITIES_FILE = path.join(ENTITIES_DIR, 'entities.json');

function loadEntities() {
  if (!fs.existsSync(ENTITIES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ENTITIES_FILE, 'utf-8')); } catch (_) { return []; }
}

function saveEntities(entities) {
  if (!fs.existsSync(ENTITIES_DIR)) fs.mkdirSync(ENTITIES_DIR, { recursive: true });
  fs.writeFileSync(ENTITIES_FILE, JSON.stringify(entities, null, 2));
}

function detectEntityEvents(transcription, entities) {
  if (!transcription || !transcription.words || entities.length === 0) return [];

  const words = transcription.words;
  const events = [];

  for (const entity of entities) {
    if (!entity.images || entity.images.length === 0) continue;
    const validImages = entity.images.filter((p) => fs.existsSync(p));
    if (validImages.length === 0) continue;

    // Build all name patterns to match (name + aliases)
    const rawPatterns = [entity.name, ...(entity.aliases || [])];
    const patterns = rawPatterns.map((p) => p.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, '')));

    for (let i = 0; i < words.length; i++) {
      for (const pattern of patterns) {
        if (i + pattern.length > words.length) continue;
        const windowClean = words.slice(i, i + pattern.length)
          .map((w) => w.word.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (windowClean.join(' ') === pattern.join(' ')) {
          const imgPath = validImages[Math.floor(Math.random() * validImages.length)];
          events.push({
            id: uuid(),
            entityId: entity.id,
            entityName: entity.name,
            imagePath: imgPath,
            startTime: words[i].start,
            duration: 5,
            animation: 'slide-up',
          });
          break;
        }
      }
    }
  }

  // Deduplicate: same entity can't appear within 30s of itself
  const sorted = events.sort((a, b) => a.startTime - b.startTime);
  const deduped = [];
  const lastSeen = {};
  for (const ev of sorted) {
    const last = lastSeen[ev.entityId] || -99;
    if (ev.startTime - last >= 30) {
      deduped.push(ev);
      lastSeen[ev.entityId] = ev.startTime;
    }
  }
  return deduped;
}

// ── Build image overlay filter chain (using extra FFmpeg inputs -loop 1 -i img) ──

function buildImageOverlayFilters(imageEvents, imgBaseIndex, resW = 1920, resH = 1080) {
  // Returns { filters: string[], inputArgs: string[] }
  // inputArgs: flat array of '-loop','1','-i','path',...
  // filters: array of filter strings to be joined with ';' in filter_complex
  // Each filter: "[prevLabel][imgN_scaled]overlay=...[outN]"
  // Final output label is '[outv_img]'
  if (!imageEvents || imageEvents.length === 0) return null;

  const inputArgs = [];
  const filterParts = [];
  const imgW = Math.round(resW * 0.28); // 28% of video width

  for (let i = 0; i < imageEvents.length; i++) {
    const ev = imageEvents[i];
    const imgIdx = imgBaseIndex + i;

    // Input args: -loop 1 makes still image loop for output duration
    inputArgs.push('-loop', '1', '-i', ev.imagePath);

    // Scale filter
    filterParts.push(`[${imgIdx}:v]scale=${imgW}:-1[img${i}s]`);

    // Position and animation
    const start = ev.startTime;
    const dur = ev.duration || 5;
    const end = start + dur;
    const entryDur = 0.3;
    const exitStart = end - entryDur;

    // Compute target position for lower-right corner
    // main_w, main_h, overlay_w, overlay_h are available in overlay filter
    const tx = `(main_w-overlay_w-40)`;
    const ty = `(main_h-overlay_h-40)`;

    const lt = `(t-${start.toFixed(3)})`;
    const lt_exit = `(t-${exitStart.toFixed(3)})`;

    let xExpr, yExpr;
    switch (ev.animation) {
    case 'slide-up':
      xExpr = tx;
      yExpr = `if(lt(${lt},${entryDur}),(1-${lt}/${entryDur})*main_h+${lt}/${entryDur}*${ty},if(gte(t,${exitStart.toFixed(3)}),${lt_exit}/${entryDur}*main_h+(1-${lt_exit}/${entryDur})*${ty},${ty}))`;
      break;
    case 'slide-down':
      xExpr = tx;
      yExpr = `if(lt(${lt},${entryDur}),(1-${lt}/${entryDur})*(-overlay_h)+${lt}/${entryDur}*${ty},if(gte(t,${exitStart.toFixed(3)}),(1-${lt_exit}/${entryDur})*${ty}+${lt_exit}/${entryDur}*(-overlay_h),${ty}))`;
      break;
    case 'slide-left':
      xExpr = `if(lt(${lt},${entryDur}),(1-${lt}/${entryDur})*main_w+${lt}/${entryDur}*${tx},if(gte(t,${exitStart.toFixed(3)}),(1-${lt_exit}/${entryDur})*${tx}+${lt_exit}/${entryDur}*main_w,${tx}))`;
      yExpr = ty;
      break;
    case 'slide-right':
      xExpr = `if(lt(${lt},${entryDur}),(1-${lt}/${entryDur})*(-overlay_w)+${lt}/${entryDur}*${tx},if(gte(t,${exitStart.toFixed(3)}),(1-${lt_exit}/${entryDur})*${tx}+${lt_exit}/${entryDur}*(-overlay_w),${tx}))`;
      yExpr = ty;
      break;
    default:
      xExpr = tx;
      yExpr = ty;
    }

    // Image already loops via '-loop 1' input arg — overlay directly from scaled stream
    filterParts.push(
      `[PREV][img${i}s]overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[NEXT]`,
    );
  }

  return { filterParts, inputArgs };
}

// ── TTS text splitting ──
function splitTextForTTS(text, maxChunkChars = 2000) {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChunkChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

// ═══════════════════════════════════════════
//  REGISTER
// ═══════════════════════════════════════════

function register(mainWindow) {
  // ── Audio file selection ──
  ipcMain.handle('select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }],
    });
    return result.filePaths[0] || null;
  });

  // ── Project CRUD ──
  ipcMain.handle('editor-save-project', (_event, data) => {
    ensureEditorDir();
    const id = data.id || uuid();
    const project = { ...data, id, updatedAt: new Date().toISOString() };
    if (!project.createdAt) project.createdAt = new Date().toISOString();
    writeJson(path.join(EDITOR_DIR, `${id}.json`), project);
    return project;
  });

  ipcMain.handle('editor-load-project', (_event, id) => {
    return readJson(path.join(EDITOR_DIR, `${id}.json`));
  });

  ipcMain.handle('editor-get-projects', () => {
    ensureEditorDir();
    const files = fs.readdirSync(EDITOR_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const data = readJson(path.join(EDITOR_DIR, f));
      if (!data) return null;
      return { id: data.id, title: data.title, channel: data.channel, createdAt: data.createdAt, updatedAt: data.updatedAt };
    }).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  });

  ipcMain.handle('editor-delete-project', (_event, id) => {
    const filePath = path.join(EDITOR_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  });

  // ── Whisper API Transcription ──

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

  function probeDuration(audioPath) {
    return new Promise((resolve, reject) => {
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
    const chunkDuration = 20 * 60; // 20 minutes per chunk
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

  // ── Transcribe via OpenAI Whisper API ──
  async function transcribeApi(event, audioPath, duration, settings) {
    const send = (data) => event.sender.send('editor-transcribe-progress', data);
    const fileStats = fs.statSync(audioPath);
    const needsSplit = fileStats.size > 25 * 1024 * 1024;

    if (!needsSplit) {
      send({ phase: 'uploading', percent: 10 });
      send({ phase: 'transcribing', percent: 30 });
      const result = await whisperTranscribeFile(audioPath, settings.openaiApiKey);
      send({ phase: 'done', percent: 100 });
      return {
        success: true,
        transcription: {
          words: (result.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
          fullText: result.text,
          model: 'whisper-1',
        },
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
      return { success: true, transcription: { words: allWords, fullText: allTexts.join(' '), model: 'whisper-1' } };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── Transcribe via local whisper.cpp ──
  async function transcribeLocal(event, audioPath, duration, settings) {
    const modelSize = settings.whisperModelSize || 'base';
    const send = (data) => event.sender.send('editor-transcribe-progress', data);

    // Ensure binary + model are downloaded
    send({ phase: 'setup', percent: 2, detail: 'A verificar whisper.cpp...' });
    const binPath = await ensureWhisperBin((p) => send(p));
    send({ phase: 'setup', percent: 5, detail: `A verificar modelo ${modelSize}...` });
    const modelPath = await ensureWhisperModel(modelSize, (p) => send(p));

    let audioDuration = duration || 0;
    if (!audioDuration) audioDuration = await probeDuration(audioPath);
    if (!audioDuration) audioDuration = 7200;

    const tmpDir = path.join(os.tmpdir(), `pinehat-whisper-local-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Auto-detect language flag: try -l first, fallback to --language
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
        // Short file — single transcription
        send({ phase: 'converting', percent: 10, detail: 'A converter áudio para WAV 16kHz...' });
        const wavPath = path.join(tmpDir, 'audio.wav');
        await convertToWhisperWav(audioPath, wavPath);
        send({ phase: 'transcribing', percent: 20, detail: `Whisper local (${modelSize}) a transcrever...` });
        const result = await transcribeWithRetry(wavPath);
        send({ phase: 'done', percent: 100 });
        return { success: true, transcription: result };
      }

      // Long file — split into chunks
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
      return { success: true, transcription: { words: allWords, fullText: allTexts.join(' '), model: `whisper.cpp-${modelSize}` } };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  ipcMain.handle('editor-transcribe', async (event, options) => {
    const { audioPath, duration } = options;
    const settings = getSettings();
    const isLocal = settings.whisperMode === 'local';

    if (!isLocal && !settings.openaiApiKey) {
      return { success: false, error: 'Chave API da OpenAI não configurada. Vai a Definições.' };
    }

    try {
      if (isLocal) return await transcribeLocal(event, audioPath, duration, settings);
      else return await transcribeApi(event, audioPath, duration, settings);
    } catch (err) {
      return { success: false, error: `Erro na transcrição: ${err.message}` };
    }
  });

  // ── Claude Overlay Detection ──
  ipcMain.handle('editor-detect-overlays', async (event, options) => {
    const { transcription, channel } = options;
    const settings = getSettings();

    if (!settings.anthropicApiKey) {
      return { success: false, error: 'Chave API da Anthropic não configurada.' };
    }

    try {
      const words = transcription.words || [];
      if (words.length === 0) {
        return { success: false, error: 'Transcrição sem palavras com timestamps.' };
      }

      const totalDuration = words[words.length - 1].start + 1; // approx total duration
      const CHUNK_SECS = 1200; // 20 minutes per chunk
      const numChunks = Math.max(1, Math.ceil(totalDuration / CHUNK_SECS));
      const allOverlays = [];
      let errors = 0;

      // Log word distribution for debugging
      const firstWord = words[0];
      const lastWord = words[words.length - 1];
      console.log(`[Overlays] ${words.length} words, first=${firstWord.start.toFixed(1)}s, last=${lastWord.start.toFixed(1)}s, totalDur=${totalDuration.toFixed(0)}s, ${numChunks} chunks`);

      // Use Sonnet for overlay detection — much cheaper than Opus and sufficient for this task
      const modelName = 'claude-sonnet-4-6';
      console.log(`[Overlays] Model: ${modelName}, API key: ${settings.anthropicApiKey ? '✓ ' + settings.anthropicApiKey.slice(0, 12) + '...' : '✗ MISSING'}`);

      const chunkLog = []; // track per-chunk results for user feedback

      for (let c = 0; c < numChunks; c++) {
        const chunkStart = c * CHUNK_SECS;
        const chunkEnd = Math.min((c + 1) * CHUNK_SECS, totalDuration);

        // Get words in this chunk
        const chunkWords = words.filter((w) => w.start >= chunkStart && w.start < chunkEnd);
        const chunkStatus = { chunk: c + 1, start: chunkStart, end: chunkEnd, words: chunkWords.length, overlays: 0, error: null };

        if (chunkWords.length === 0) {
          chunkStatus.error = 'sem palavras';
          chunkLog.push(chunkStatus);
          console.log(`[Overlays] Chunk ${c + 1}/${numChunks}: SKIP — no words in ${chunkStart.toFixed(0)}s–${chunkEnd.toFixed(0)}s`);
          continue;
        }

        const pct = Math.round(5 + (c / numChunks) * 85);
        event.sender.send('editor-overlay-progress', {
          phase: 'analyzing',
          detail: `Segmento ${c + 1}/${numChunks} (${chunkWords.length} palavras, ${Math.floor(chunkStart / 60)}–${Math.floor(chunkEnd / 60)} min)...`,
          percent: pct,
        });

        // Build chunk text from words
        const chunkText = chunkWords.map((w) => w.word).join(' ');
        const prompt = buildOverlayDetectionPrompt(chunkText, chunkWords, chunkStart, chunkEnd, totalDuration);

        // Delay between API calls to avoid rate limiting (longer for larger models)
        if (c > 0) await new Promise((r) => setTimeout(r, 2000));

        try {
          // Sanitize prompt — strip control chars that can cause API rejection (keep \n \r \t)
          const sanitizedPrompt = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
          const requestBody = JSON.stringify({
            model: modelName,
            max_tokens: 4096,
            messages: [{ role: 'user', content: sanitizedPrompt }],
          });
          console.log(`[Overlays] Chunk ${c + 1} API → model=${modelName}, prompt=${sanitizedPrompt.length} chars, body=${requestBody.length} bytes`);

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': settings.anthropicApiKey,
              'anthropic-version': '2023-06-01',
            },
            body: requestBody,
          });

          if (!response.ok) {
            // Capture full error response body
            let errBody = '';
            try { errBody = await response.text(); } catch (e) { errBody = `(failed to read body: ${e.message})`; }

            // Log FULL error details for debugging
            console.error(`[Overlays] Chunk ${c + 1} API ERROR:\n  Status: ${response.status} ${response.statusText}\n  Model: ${modelName}\n  Request: ${requestBody.length} bytes\n  Response: ${errBody.slice(0, 600)}`);

            // Parse error body for user-friendly message
            let errDetail = errBody || '(sem resposta do servidor)';
            try {
              const errJson = JSON.parse(errBody);
              errDetail = errJson.error?.message || errJson.message || JSON.stringify(errJson).slice(0, 250);
            } catch (_) {
              if (errBody) errDetail = errBody.slice(0, 250);
            }

            const errShort = `API ${response.status} [${modelName}]: ${errDetail}`;
            chunkStatus.error = errShort;
            chunkLog.push(chunkStatus);
            errors++;

            // On first 400 error, run diagnostic test to isolate model vs prompt issue
            if (c === 0 && response.status === 400) {
              console.log('[Overlays] Running diagnostic test with minimal prompt...');
              try {
                const testResp = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': settings.anthropicApiKey,
                    'anthropic-version': '2023-06-01',
                  },
                  body: JSON.stringify({ model: modelName, max_tokens: 10, messages: [{ role: 'user', content: 'Reply OK' }] }),
                });
                if (testResp.ok) {
                  console.log('[Overlays] ✓ Diagnostic OK — model and key work fine. Issue is in the prompt content/size.');
                  chunkStatus.error += ' (modelo OK — problema no prompt)';
                } else {
                  const testBody = await testResp.text();
                  console.error(`[Overlays] ✗ Diagnostic ALSO FAILED — ${testResp.status}: ${testBody.slice(0, 300)}`);
                  chunkStatus.error += ` (teste modelo: ${testResp.status})`;
                }
              } catch (diagErr) {
                console.error(`[Overlays] Diagnostic exception: ${diagErr.message}`);
              }
            }

            event.sender.send('editor-overlay-progress', {
              phase: 'analyzing',
              detail: `Seg ${c + 1}/${numChunks}: ERRO ${response.status} — ${errDetail.slice(0, 60)}`,
              percent: pct,
            });
            continue;
          }

          const result = await response.json();
          const text = result.content[0].text;
          const jsonMatch = text.match(/\[[\s\S]*\]/);

          if (jsonMatch) {
            const rawOverlays = JSON.parse(jsonMatch[0]);

            // Detect if Claude returned relative timestamps instead of absolute:
            // If most overlays have startTime < chunkStart, they're likely relative → offset them
            const inRange = rawOverlays.filter((o) => o.startTime >= chunkStart && o.startTime < chunkEnd).length;
            const needsOffset = c > 0 && inRange < rawOverlays.length / 2;

            if (needsOffset) {
              console.log(`[Overlays] Chunk ${c + 1}: relative timestamps detected → adding offset ${chunkStart.toFixed(0)}s`);
            }

            const chunkOverlays = rawOverlays
              .map((o) => {
                let st = o.startTime;
                if (needsOffset) st += chunkStart;
                return { ...o, startTime: st };
              })
              .filter((o) => o.startTime >= chunkStart - 5 && o.startTime < chunkEnd + 5)
              .map((o) => ({
                id: uuid(),
                type: o.type,
                text: o.text,
                startTime: Math.max(chunkStart, Math.min(o.startTime, chunkEnd - 1)),
                duration: o.duration || 3,
                animation: 'auto',
                color: null,
                fontSize: 72,
                isCountingNumber: o.isCountingNumber || false,
                numberValue: o.numberValue || null,
                numberLabel: o.numberLabel || null,
                numberPrefix: o.numberPrefix || null,
                numberUnit: o.numberUnit || null,
              }));
            allOverlays.push(...chunkOverlays);
            chunkStatus.overlays = chunkOverlays.length;
            chunkLog.push(chunkStatus);

            const detail = `Seg ${c + 1}/${numChunks}: ${chunkOverlays.length} overlays ✓${needsOffset ? ' (offset)' : ''} [raw: ${rawOverlays.length}]`;
            console.log(`[Overlays] Chunk ${c + 1}/${numChunks}: ${chunkOverlays.length} overlays (${chunkStart.toFixed(0)}s–${chunkEnd.toFixed(0)}s) [raw: ${rawOverlays.length}${needsOffset ? ', offset' : ''}, words: ${chunkWords.length}]`);
            event.sender.send('editor-overlay-progress', { phase: 'analyzing', detail, percent: pct + 5 });
          } else {
            chunkStatus.error = 'JSON inválido';
            chunkLog.push(chunkStatus);
            console.error(`[Overlays] Chunk ${c + 1}: no valid JSON in response: ${text.slice(0, 200)}`);
            errors++;
          }
        } catch (chunkErr) {
          chunkStatus.error = chunkErr.message.slice(0, 80);
          chunkLog.push(chunkStatus);
          console.error(`[Overlays] Chunk ${c + 1} error: ${chunkErr.message}`);
          errors++;
        }
      }

      // Log full summary
      console.log('[Overlays] === SUMMARY ===');
      for (const cs of chunkLog) {
        console.log(`  Chunk ${cs.chunk}: ${cs.words} words, ${cs.overlays} overlays, ${cs.error ? 'ERROR: ' + cs.error : 'OK'} (${cs.start.toFixed(0)}s–${cs.end.toFixed(0)}s)`);
      }

      if (allOverlays.length === 0) {
        // Include actual error details so the user can see what went wrong
        const firstError = chunkLog.find((cs) => cs.error);
        const errorDetail = firstError ? `\n${firstError.error}` : '';
        const wordsInfo = `${words.length} palavras, ${lastWord.start.toFixed(0)}s`;
        return { success: false, error: `Nenhum overlay detetado (${numChunks} segmentos, ${errors} erros) [${wordsInfo}]${errorDetail}` };
      }

      // Sort by startTime and deduplicate (remove overlays too close together)
      allOverlays.sort((a, b) => a.startTime - b.startTime);
      const deduped = [allOverlays[0]];
      for (let i = 1; i < allOverlays.length; i++) {
        if (allOverlays[i].startTime - deduped[deduped.length - 1].startTime >= 5) {
          deduped.push(allOverlays[i]);
        }
      }

      // Assign colors from channel palette
      assignOverlayColors(deduped, channel || 'pinehat');

      event.sender.send('editor-overlay-progress', { phase: 'done', percent: 100 });
      console.log(`[Overlays] Total: ${deduped.length} overlays across ${numChunks} chunks (${errors} errors)`);
      return { success: true, overlays: deduped, errors, numChunks };
    } catch (err) {
      return { success: false, error: `Erro na deteção: ${err.message}` };
    }
  });

  // ── Clip Generation ──
  ipcMain.handle('editor-generate-clips', async (event, options) => {
    const { voiceoverDuration, episodes, clipDurationMin, clipDurationMax,
      skipStart, skipEnd, transcription } = options;

    const episodeMentions = parseEpisodeMentions(transcription);
    const validEpisodes = episodes.filter((ep) => ep.duration > skipStart + skipEnd + clipDurationMin);

    if (validEpisodes.length === 0) {
      return { success: false, error: 'Nenhum episódio tem duração suficiente para gerar clips.' };
    }

    const clips = [];
    let currentTime = 0;
    const usedSegments = {};

    while (currentTime < voiceoverDuration) {
      const clipDuration = clipDurationMin + Math.random() * (clipDurationMax - clipDurationMin);
      const remaining = voiceoverDuration - currentTime;

      // Skip if remaining time is too short for a usable clip
      if (remaining < 1.0) break;

      const effectiveDuration = Math.max(1.0, Math.min(clipDuration, remaining));

      const targetEpisode = findEpisodeForTime(currentTime, episodeMentions, validEpisodes);
      const clip = pickClipFromEpisode(targetEpisode, effectiveDuration, skipStart, skipEnd, usedSegments);

      if (clip) {
        clips.push({
          id: uuid(),
          source: clip.source,
          sourceName: path.basename(clip.source),
          startTime: clip.startTime,
          duration: effectiveDuration,
          episodeLabel: targetEpisode.label,
          timelineStart: currentTime,
        });
      }

      currentTime += effectiveDuration;
      event.sender.send('editor-clip-progress', {
        phase: 'planning',
        percent: Math.min(100, Math.round((currentTime / voiceoverDuration) * 100)),
        clipCount: clips.length,
      });
    }

    return { success: true, clips };
  });

  // ── Silence removal ──
  ipcMain.handle('editor-remove-silence', async (event, { audioPath, threshold, minSilenceDuration }) => {
    const ffmpegPath = findBinary('ffmpeg');
    const noiseLevel = threshold || -30;    // dB
    const minSilence = minSilenceDuration || 0.5; // seconds
    const keepPad = 0.15; // keep 150ms of silence at edges for natural speech

    const send = (phase, percent) => {
      event.sender.send('editor-silence-progress', { phase, percent });
    };

    try {
      // Step 1: Detect silence regions
      send('detecting', 10);
      const silences = await new Promise((resolve, reject) => {
        const regions = [];
        const proc = spawn(ffmpegPath, [
          '-i', audioPath,
          '-af', `silencedetect=noise=${noiseLevel}dB:d=${minSilence}`,
          '-f', 'null', '-',
        ]);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          // Parse silence_start / silence_end pairs
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

      send('detecting', 40);

      if (silences.length === 0) {
        return { success: true, noChange: true, message: 'Nenhum silêncio detetado.' };
      }

      // Step 2: Get original duration
      const origDuration = await probeDuration(audioPath);

      // Step 3: Calculate audio segments to KEEP (inverse of silences, with padding)
      const segments = [];
      let pos = 0;
      for (const s of silences) {
        const segStart = pos;
        const segEnd = Math.min(s.start + keepPad, s.end); // keep small pad before silence
        if (segEnd - segStart > 0.05) {
          segments.push({ start: segStart, end: segEnd });
        }
        pos = Math.max(s.end - keepPad, s.start); // keep small pad after silence
      }
      // Final segment after last silence
      if (pos < origDuration) {
        segments.push({ start: pos, end: origDuration });
      }

      if (segments.length === 0) {
        return { success: false, error: 'Todo o áudio é silêncio.' };
      }

      send('trimming', 50);

      // Step 4: Extract each segment to a temp file, then concat
      // (avoids ENAMETOOLONG with huge filter_complex strings)
      const ext = path.extname(audioPath);
      const base = audioPath.replace(ext, '');
      const tempDir = path.join(os.tmpdir(), `silence_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const segFiles = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segFile = path.join(tempDir, `seg_${String(i).padStart(5, '0')}${ext}`);
        await runFfmpeg(ffmpegPath, [
          '-y', '-ss', String(seg.start), '-i', audioPath,
          '-t', String(seg.end - seg.start),
          '-c', 'copy',
          segFile,
        ], null, 30000);
        segFiles.push(segFile);
        const pct = 50 + Math.round((i / segments.length) * 40);
        send('trimming', pct);
      }

      // Concat all segments and re-encode to mp3 for clean output
      send('trimming', 92);
      const concatList = path.join(tempDir, 'concat.txt');
      fs.writeFileSync(concatList, segFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      const outputPath = `${base}_trimmed.mp3`;
      await runFfmpeg(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
        '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100', '-ac', '1',
        outputPath,
      ], null, 300000);

      // Cleanup temp
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

      // Step 5: Get new duration
      const newDuration = await probeDuration(outputPath);
      const silenceRemoved = origDuration - newDuration;

      send('done', 100);

      return {
        success: true,
        outputPath,
        originalDuration: origDuration,
        newDuration,
        silenceCount: silences.length,
        silenceRemoved,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Waveform extraction ──
  ipcMain.handle('editor-get-waveform', async (_event, audioPath) => {
    const ffmpegPath = findBinary('ffmpeg');
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', audioPath, '-ac', '1', '-ar', '1000',
        '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
      ]);
      const chunks = [];
      proc.stdout.on('data', (d) => chunks.push(d));
      proc.stderr.on('data', () => {}); // swallow
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error('Waveform extraction failed'));
        const buffer = Buffer.concat(chunks);
        const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));
        const pointCount = Math.min(2000, samples.length);
        const blockSize = Math.max(1, Math.floor(samples.length / pointCount));
        const waveform = [];
        for (let i = 0; i < pointCount; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            const idx = i * blockSize + j;
            if (idx < samples.length) sum += Math.abs(samples[idx]);
          }
          waveform.push(sum / blockSize / 32768);
        }
        resolve(waveform);
      });
      proc.on('error', reject);
    });
  });

  // ── Thumbnail extraction ──
  ipcMain.handle('editor-get-thumbnail', async (_event, { videoPath, time }) => {
    const ffmpegPath = findBinary('ffmpeg');
    const tempPath = path.join(os.tmpdir(), `thumb_${Date.now()}.jpg`);
    await runFfmpeg(ffmpegPath, [
      '-ss', String(time), '-i', videoPath, '-vframes', '1',
      '-vf', 'scale=160:90', '-q:v', '5', '-y', tempPath,
    ]);
    const data = fs.readFileSync(tempPath).toString('base64');
    try { fs.unlinkSync(tempPath); } catch (_) {}
    return `data:image/jpeg;base64,${data}`;
  });

  // ── Export ──
  ipcMain.handle('editor-export', async (event, options) => {
    const { clips, voiceover, overlays, outputFolder, outputFilename, settings: editorSettings, channel, captionsEnabled, imageEvents, transcription } = options;
    const ffmpegPath = findBinary('ffmpeg');
    const tempDir = path.join(os.tmpdir(), `editor_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Weighted progress
    const W_CLIPS = 40, W_CONCAT = 5, W_RENDER = 50;
    let progressPct = 0;

    const sendProgress = (phase, detail, pct) => {
      if (pct !== undefined) progressPct = pct;
      event.sender.send('editor-export-progress', {
        phase, detail,
        percent: Math.min(Math.round(progressPct), 100),
      });
    };

    // Reset animation counter for consistent auto-rotation
    animationCounter = 0;

    try {
      const resolution = editorSettings?.exportResolution || '1920x1080';
      const [resW, resH] = resolution.split('x');
      const vfScale = `scale=${resW}:${resH}:force_original_aspect_ratio=decrease,pad=${resW}:${resH}:(ow-iw)/2:(oh-ih)/2:black`;

      const hasOverlays = overlays && overlays.length > 0;

      // Validate overlay data
      if (hasOverlays) {
        for (const o of overlays) {
          if (!o.text || typeof o.text !== 'string') o.text = 'Overlay';
          if (!o.duration || isNaN(o.duration) || o.duration <= 0) o.duration = 3;
          if (o.startTime == null || isNaN(o.startTime)) o.startTime = 0;
          if (o.fontSize && isNaN(o.fontSize)) o.fontSize = 72;
        }
        assignOverlayColors(overlays, channel);
      }

      // Step 1: Extract clips in parallel batches (0% → 40%)
      sendProgress('extracting', 'A extrair clips...');
      const PARALLEL = Math.min(8, Math.max(2, Math.floor(require('os').cpus().length / 2)));
      const clipFiles = new Array(clips.length);
      let completed = 0;

      for (let batch = 0; batch < clips.length; batch += PARALLEL) {
        const batchEnd = Math.min(batch + PARALLEL, clips.length);
        const promises = [];
        for (let i = batch; i < batchEnd; i++) {
          const outFile = path.join(tempDir, `seg_${String(i).padStart(4, '0')}.mp4`);
          clipFiles[i] = outFile;
          promises.push(
            runFfmpeg(ffmpegPath, [
              '-y', '-ss', String(clips[i].startTime), '-i', clips[i].source, '-t', String(clips[i].duration),
              '-vf', `${vfScale},hflip`,
              '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an', outFile,
            ]).then(() => {
              completed++;
              progressPct = (completed / clips.length) * W_CLIPS;
              sendProgress('extracting', `Clip ${completed}/${clips.length} (${PARALLEL}x paralelo)`);
            })
          );
        }
        await Promise.all(promises);
      }

      // Step 2: Concat clips (40% → 45%)
      sendProgress('concatenating', 'A juntar clips...', W_CLIPS);
      const concatLines = clipFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`);
      const concatPath = path.join(tempDir, 'concat.txt');
      fs.writeFileSync(concatPath, concatLines.join('\n'));
      const concatOutput = path.join(tempDir, 'concat.mp4');
      await runFfmpeg(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-c', 'copy', concatOutput,
      ]);

      // Step 3: Apply overlays, image events, captions + merge audio (45% → 95%)
      // Ensure .mp4 extension — FFmpeg needs it to choose the output format
      const safeName = outputFilename.endsWith('.mp4') ? outputFilename : `${outputFilename}.mp4`;
      const outputFile = path.join(outputFolder, safeName);
      const totalDur = voiceover.duration || 600;
      const [resWNum, resHNum] = [parseInt(resW), parseInt(resH)];

      // Validate image events
      const validImageEvents = (imageEvents || []).filter((ev) => ev.imagePath && fs.existsSync(ev.imagePath));

      // Generate ASS captions file if enabled
      let captionsFile = null;
      if (captionsEnabled && transcription && transcription.words && transcription.words.length > 0) {
        const assContent = generateCaptionsASS(transcription, resWNum, resHNum);
        if (assContent) {
          captionsFile = path.join(tempDir, 'captions.ass');
          fs.writeFileSync(captionsFile, assContent, 'utf-8');
        }
      }

      const hasComplexFiltering = hasOverlays || validImageEvents.length > 0 || captionsFile;

      if (hasComplexFiltering) {
        sendProgress('rendering', 'A renderizar vídeo final...', W_CLIPS + W_CONCAT);

        const fontFile = getDrawtextFontFile();
        const filterParts = [];

        // Build filter chain: text overlays → image overlays → captions → [outv]
        // Extra inputs: 0=video, 1=audio, 2+=images (added via -loop 1 -i)
        const imgBaseIndex = 2;

        // Phase 1: text overlays → [chain0]
        let chainLabel = '[chain0]';
        if (hasOverlays) {
          const textFilter = buildOverlayFiltergraph(overlays, fontFile);
          filterParts.push(`[0:v]${textFilter}${chainLabel}`);
        } else {
          chainLabel = '[0:v]'; // pass through directly — no extra filter needed
        }

        // Phase 2: image overlays, chained sequentially
        if (validImageEvents.length > 0) {
          const imgResult = buildImageOverlayFilters(validImageEvents, imgBaseIndex, resWNum, resHNum);
          if (imgResult) {
            let prevLabel = chainLabel;
            let imgOvIdx = 0;
            for (let pi = 0; pi < imgResult.filterParts.length; pi++) {
              const part = imgResult.filterParts[pi];
              if (part.includes('[PREV]') && part.includes('[NEXT]')) {
                const isLast = !imgResult.filterParts.slice(pi + 1).some((p) => p.includes('[PREV]'));
                const nextLabel = isLast ? '[chainN]' : `[chn${imgOvIdx}]`;
                filterParts.push(part.replace('[PREV]', prevLabel).replace('[NEXT]', nextLabel));
                prevLabel = nextLabel;
                imgOvIdx++;
              } else {
                filterParts.push(part);
              }
            }
            chainLabel = '[chainN]';
          }
        }

        // Phase 3: captions (subtitles filter via libass)
        if (captionsFile) {
          const assPath = captionsFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
          filterParts.push(`${chainLabel}subtitles='${assPath}'[outv]`);
        } else {
          // Rename the last label in the filter chain to [outv]
          const lastIdx = filterParts.length - 1;
          filterParts[lastIdx] = filterParts[lastIdx].replace(chainLabel, '[outv]');
        }

        const filterContent = filterParts.join(';\n');
        const filterFile = path.join(tempDir, 'export_filters.txt');
        fs.writeFileSync(filterFile, filterContent);

        const debugFilterFile = path.join(EDITOR_DIR, 'last_export_filter.txt');
        fs.writeFileSync(debugFilterFile, filterContent);
        console.log(`[Export] Filter: ${filterContent.length} chars, overlays:${overlays?.length || 0}, imgs:${validImageEvents.length}, captions:${!!captionsFile} → ${debugFilterFile}`);

        // Build image input args
        const imgInputArgs = validImageEvents.length > 0
          ? validImageEvents.flatMap((ev) => ['-loop', '1', '-i', ev.imagePath])
          : [];

        await runFfmpeg(ffmpegPath, [
          '-y', '-i', concatOutput, '-i', voiceover.path, ...imgInputArgs,
          '-filter_complex_script', filterFile,
          '-map', '[outv]', '-map', '1:a',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '192k',
          '-shortest', '-movflags', '+faststart',
          outputFile,
        ], (timeSecs) => {
          progressPct = W_CLIPS + W_CONCAT + (timeSecs / totalDur) * W_RENDER;
          const detail = captionsFile
            ? `A renderizar com legendas... ${Math.round(timeSecs)}s/${Math.round(totalDur)}s`
            : `A aplicar overlays... ${Math.round(timeSecs)}s/${Math.round(totalDur)}s`;
          sendProgress('rendering', detail);
        }, 0); // no timeout for complex renders
      } else {
        // No overlays — just merge video + audio directly
        sendProgress('merging', 'A juntar vídeo e áudio...', W_CLIPS + W_CONCAT);
        await runFfmpeg(ffmpegPath, [
          '-y', '-i', concatOutput, '-i', voiceover.path,
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
          '-map', '0:v', '-map', '1:a', '-shortest',
          '-movflags', '+faststart',
          outputFile,
        ]);
      }

      sendProgress('done', 'Concluído!', 100);

      // Cleanup
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

      return { success: true, outputFile };
    } catch (err) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      // Truncate error — FFmpeg filter chains can be enormous
      let errMsg = err.message || 'Erro desconhecido';
      if (errMsg.length > 500) {
        // Keep diagnostic lines, remove verbose filter dump lines
        const lines = errMsg.split('\n').filter((l) => !l.includes('drawtext=fontfile') && !l.includes('drawbox=enable'));
        errMsg = lines.length > 0 ? lines.slice(-12).join('\n') : errMsg.slice(0, 500) + '...';
      }
      // Point to saved filter file if it exists
      const debugFilter = path.join(EDITOR_DIR, 'last_export_filter.txt');
      if (fs.existsSync(debugFilter)) {
        console.error(`[Export] Filtro guardado em: ${debugFilter}`);
      }
      return { success: false, error: errMsg };
    }
  });

  // ── Cancel export ──
  ipcMain.handle('editor-cancel-export', () => {
    if (currentProcess) {
      currentProcess.kill('SIGTERM');
      currentProcess = null;
      return true;
    }
    return false;
  });

  // ── Whisper local status ──
  ipcMain.handle('whisper-local-status', async () => {
    const binReady = !!getWhisperBinPath();
    const models = {};
    for (const size of ['base', 'small', 'medium']) {
      models[size] = !!getWhisperModelPath(size);
    }
    return { binReady, models };
  });

  // ── Whisper download model ──
  ipcMain.handle('whisper-download-model', async (event, modelSize) => {
    try {
      const sendProgress = (phase, message, percent) => {
        event.sender.send('whisper-download-progress', { phase, message, percent });
      };

      // Download binary if needed
      sendProgress('downloading-bin', 'A verificar whisper.cpp...', 0);
      await ensureWhisperBin((p) => {
        sendProgress('downloading-bin', `A descarregar whisper.cpp... ${p}%`, Math.round(p * 0.4));
      });

      // Download model
      sendProgress('downloading-model', `A descarregar modelo ${modelSize}...`, 40);
      await ensureWhisperModel(modelSize, (p) => {
        sendProgress('downloading-model', `A descarregar modelo ${modelSize}... ${p}%`, 40 + Math.round(p * 0.6));
      });

      sendProgress('done', 'Pronto!', 100);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Entity CRUD ──

  ipcMain.handle('editor-entities-get', () => loadEntities());

  ipcMain.handle('editor-entity-save', (_event, entity) => {
    const entities = loadEntities();
    const idx = entities.findIndex((e) => e.id === entity.id);
    if (idx >= 0) entities[idx] = entity;
    else entities.push(entity);
    saveEntities(entities);
    return { success: true };
  });

  ipcMain.handle('editor-entity-delete', (_event, id) => {
    const entities = loadEntities().filter((e) => e.id !== id);
    saveEntities(entities);
    return { success: true };
  });

  ipcMain.handle('editor-entity-select-images', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    return result.filePaths || [];
  });

  ipcMain.handle('editor-detect-entity-events', (_event, { transcription, entities }) => {
    return detectEntityEvents(transcription, entities);
  });

  // ── TTS Voice List ──
  ipcMain.handle('editor-tts-voices', async () => {
    return [
      { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew', lang: 'en-US', gender: 'Male', desc: 'Calm, deep narration' },
      { id: 'en-US-GuyNeural', name: 'Guy', lang: 'en-US', gender: 'Male', desc: 'Warm, natural' },
      { id: 'en-US-DavisNeural', name: 'Davis', lang: 'en-US', gender: 'Male', desc: 'Deep, steady' },
      { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', gender: 'Female', desc: 'Natural, clear' },
      { id: 'en-US-JennyNeural', name: 'Jenny', lang: 'en-US', gender: 'Female', desc: 'Warm, smooth' },
      { id: 'en-US-EmmaMultilingualNeural', name: 'Emma', lang: 'en-US', gender: 'Female', desc: 'Smooth, relaxing' },
      { id: 'en-GB-RyanNeural', name: 'Ryan', lang: 'en-GB', gender: 'Male', desc: 'British, calm' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB', gender: 'Female', desc: 'British, soothing' },
    ];
  });

  // ── TTS Generate ──
  ipcMain.handle('editor-generate-tts', async (event, options) => {
    const { text, voice, speed, scriptTitle } = options;
    const send = (data) => event.sender.send('editor-tts-progress', data);

    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Script text is empty.' };
    }

    if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true });

    ttsCancelled = false;

    const timestamp = Date.now();
    const safeName = (scriptTitle || 'voiceover').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const outputPath = path.join(TTS_DIR, `${safeName}_${timestamp}.mp3`);

    try {
      send({ phase: 'preparing', percent: 0, detail: 'A preparar texto...' });

      const chunks = splitTextForTTS(text, 2000);
      const totalChunks = chunks.length;
      console.log(`[TTS] Script split into ${totalChunks} chunks`);

      send({ phase: 'generating', percent: 2, detail: `Dividido em ${totalChunks} partes` });

      const voiceName = voice || 'en-US-AndrewMultilingualNeural';
      const ratePercent = Math.round(((speed || 0.85) - 1) * 100);
      const rateStr = `${ratePercent >= 0 ? '+' : ''}${ratePercent}%`;

      const chunkDir = path.join(os.tmpdir(), `pinehat-tts-${timestamp}`);
      fs.mkdirSync(chunkDir, { recursive: true });

      const chunkPaths = [];

      for (let i = 0; i < totalChunks; i++) {
        // Check cancellation flag before each chunk
        if (ttsCancelled) {
          console.log(`[TTS] Cancelled at chunk ${i + 1}/${totalChunks}`);
          try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}
          send({ phase: 'cancelled', percent: 0, detail: 'Geração cancelada.' });
          return { success: false, error: 'cancelled' };
        }

        const chunkSubDir = path.join(chunkDir, `chunk_${String(i).padStart(4, '0')}`);
        fs.mkdirSync(chunkSubDir, { recursive: true });

        send({
          phase: 'generating',
          percent: Math.round(2 + (i / totalChunks) * 85),
          detail: `A gerar parte ${i + 1}/${totalChunks}...`,
          chunk: i + 1,
          totalChunks,
        });

        // Create fresh TTS instance per chunk — msedge-tts WebSocket state breaks on reuse
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        // toFile expects a DIRECTORY — it writes audio.mp3 inside it
        const result = await tts.toFile(chunkSubDir, chunks[i], { rate: rateStr });
        chunkPaths.push(result.audioFilePath);
      }

      // Check cancellation after all chunks done, before concat
      if (ttsCancelled) {
        console.log('[TTS] Cancelled before concatenation');
        try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}
        send({ phase: 'cancelled', percent: 0, detail: 'Geração cancelada.' });
        return { success: false, error: 'cancelled' };
      }

      send({ phase: 'concatenating', percent: 90, detail: 'A juntar áudio...' });

      if (chunkPaths.length === 1) {
        fs.copyFileSync(chunkPaths[0], outputPath);
      } else {
        const concatListPath = path.join(chunkDir, 'concat.txt');
        const concatContent = chunkPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(concatListPath, concatContent, 'utf-8');

        const ffmpegPath = findBinary('ffmpeg');
        await runFfmpeg(ffmpegPath, [
          '-f', 'concat', '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy',
          '-y', outputPath,
        ], null, 300000);
      }

      const duration = await probeDuration(outputPath);

      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}

      send({ phase: 'done', percent: 100, detail: 'Voiceover gerado!' });
      console.log(`[TTS] Generated: ${outputPath} (${(duration / 60).toFixed(1)} min)`);

      return {
        success: true,
        voiceover: {
          path: outputPath,
          name: `${safeName}.mp3`,
          duration: duration || 0,
        },
      };
    } catch (err) {
      if (ttsCancelled) {
        console.log('[TTS] Cancelled (caught in error handler)');
        try { fs.rmSync(path.join(os.tmpdir(), `pinehat-tts-${timestamp}`), { recursive: true, force: true }); } catch (_) {}
        return { success: false, error: 'cancelled' };
      }
      console.error('[TTS] Error:', err.message);
      try { fs.rmSync(path.join(os.tmpdir(), `pinehat-tts-${timestamp}`), { recursive: true, force: true }); } catch (_) {}
      return { success: false, error: `TTS error: ${err.message}` };
    }
  });

  // ── Cancel TTS ──
  ipcMain.handle('editor-cancel-tts', () => {
    ttsCancelled = true;
    if (currentProcess) {
      currentProcess.kill('SIGTERM');
      currentProcess = null;
    }
    console.log('[TTS] Cancel requested');
    return { success: true };
  });
}

module.exports = { register };
