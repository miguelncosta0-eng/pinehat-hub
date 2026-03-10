const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { findBinary, isImage: checkIsImage } = require('./ipc-library');

let currentProcess = null;
const PARALLEL = Math.min(8, Math.max(2, Math.floor(os.cpus().length / 2)));

function runFfmpeg(ffmpegPath, args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    currentProcess = proc;
    let errorOutput = '';
    proc.stderr.on('data', (data) => {
      const str = data.toString();
      errorOutput += str;
      if (onProgress) {
        const m = str.match(/time=(\d+):(\d+):(\d+)/);
        if (m) onProgress(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]));
      }
    });
    proc.on('close', (code) => {
      currentProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg code ${code}: ${errorOutput.slice(-500)}`));
    });
    proc.on('error', (err) => { currentProcess = null; reject(err); });
  });
}

function register() {
  ipcMain.handle('generate-broll', async (event, options) => {
    const { files, outputFolder, totalHours, clipDuration, skipStart, skipEnd, outputFilename } = options;
    const ffmpegPath = await findBinary('ffmpeg');
    const totalSeconds = totalHours * 3600;
    const numClips = Math.floor(totalSeconds / clipDuration);

    const videos = files.filter((f) => !f.isImage);
    const images = files.filter((f) => f.isImage);
    const videoPool = videos.filter((v) => v.duration > skipStart + skipEnd + clipDuration);

    if (videoPool.length === 0 && images.length === 0) {
      return { success: false, error: 'Nenhum ficheiro válido após aplicar o skip.' };
    }

    const clips = [];
    for (let i = 0; i < numClips; i++) {
      const useImage = images.length > 0 && videoPool.length === 0
        ? true : images.length > 0 && Math.random() < 0.05;
      if (useImage) {
        clips.push({ source: images[Math.floor(Math.random() * images.length)].path, isImage: true });
      } else {
        const vid = videoPool[Math.floor(Math.random() * videoPool.length)];
        const minStart = skipStart;
        const maxStart = vid.duration - skipEnd - clipDuration;
        clips.push({ source: vid.path, startTime: minStart + Math.random() * (maxStart - minStart), isImage: false });
      }
    }

    const tempDir = path.join(os.tmpdir(), `broll_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const outputFile = path.join(outputFolder, outputFilename || 'broll_compilation.mp4');

    try {
      // Parallel clip extraction
      let completed = 0;
      for (let batch = 0; batch < clips.length; batch += PARALLEL) {
        const batchEnd = Math.min(batch + PARALLEL, clips.length);
        const promises = [];
        for (let i = batch; i < batchEnd; i++) {
          const clip = clips[i];
          const clipFile = path.join(tempDir, `clip_${String(i).padStart(6, '0')}.mp4`);
          const args = clip.isImage
            ? ['-y', '-loop', '1', '-i', clip.source, '-t', String(clipDuration),
               '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
               '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an', clipFile]
            : ['-y', '-ss', String(clip.startTime), '-i', clip.source, '-t', String(clipDuration),
               '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,hflip',
               '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', '-an', clipFile];
          promises.push(
            runFfmpeg(ffmpegPath, args).then(() => {
              completed++;
              event.sender.send('generate-progress', {
                phase: 'extracting', current: completed, total: numClips,
                percent: Math.round((completed / numClips) * 80),
                detail: `${completed}/${numClips} (${PARALLEL}x paralelo)`,
              });
            })
          );
        }
        await Promise.all(promises);
      }

      const concatListPath = path.join(tempDir, 'concat.txt');
      fs.writeFileSync(concatListPath, clips.map((_, i) => `file 'clip_${String(i).padStart(6, '0')}.mp4'`).join('\n'));

      event.sender.send('generate-progress', { phase: 'concatenating', current: 0, total: 1, percent: 85 });

      // Use -c copy since all clips have identical codec/res/fps — no re-encoding needed
      await runFfmpeg(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
        '-c', 'copy', '-movflags', '+faststart', outputFile,
      ], (progressSec) => {
        const pct = Math.min(100, 85 + Math.round((progressSec / totalSeconds) * 15));
        event.sender.send('generate-progress', { phase: 'concatenating', current: 0, total: 1, percent: pct });
      });

      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      event.sender.send('generate-progress', { phase: 'done', current: 1, total: 1, percent: 100 });
      return { success: true, outputFile, numClips };
    } catch (err) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cancel-generation', () => {
    if (currentProcess) { currentProcess.kill('SIGTERM'); currentProcess = null; return true; }
    return false;
  });
}

module.exports = { register };
