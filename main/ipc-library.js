const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const LIBRARY_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'library')
  : path.join(__dirname, '..', 'library');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'];
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mts', '.ts', '.wmv'];
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS];

function isImage(filePath) { return IMAGE_EXTS.includes(path.extname(filePath).toLowerCase()); }
function isMedia(filePath) { return ALL_EXTS.includes(path.extname(filePath).toLowerCase()); }

function findBinary(name) {
  const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
  return new Promise((resolve) => {
    exec(cmd, (error, stdout) => {
      if (!error && stdout.trim()) resolve(stdout.trim().split('\n')[0].trim());
      else resolve(name);
    });
  });
}

function getVideoDuration(filePath, ffprobePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    let output = '';
    let err = '';
    proc.stdout.on('data', (d) => (output += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', (code) => {
      if (code === 0) resolve(parseFloat(output.trim()) || 0);
      else reject(new Error(err));
    });
  });
}

function register(mainWindow) {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });

  ipcMain.handle('library-get-folders', () => {
    if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
    return fs.readdirSync(LIBRARY_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const folderPath = path.join(LIBRARY_DIR, e.name);
        const files = fs.readdirSync(folderPath).filter((f) => isMedia(f));
        return { name: e.name, path: folderPath, fileCount: files.length };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('library-create-folder', (_event, name) => {
    const sanitized = name.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!sanitized) return { success: false, error: 'Nome inválido.' };
    const folderPath = path.join(LIBRARY_DIR, sanitized);
    if (fs.existsSync(folderPath)) return { success: false, error: 'Pasta já existe.' };
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true, name: sanitized, path: folderPath };
  });

  ipcMain.handle('library-delete-folder', (_event, name) => {
    const folderPath = path.join(LIBRARY_DIR, name);
    if (!fs.existsSync(folderPath)) return { success: false, error: 'Pasta não existe.' };
    fs.rmSync(folderPath, { recursive: true, force: true });
    return { success: true };
  });

  ipcMain.handle('library-get-files', async (_event, folderName) => {
    const ffprobePath = await findBinary('ffprobe');
    const folderPath = path.join(LIBRARY_DIR, folderName);
    if (!fs.existsSync(folderPath)) return [];
    const fileNames = fs.readdirSync(folderPath).filter((f) => isMedia(f));
    const results = [];
    for (const fileName of fileNames) {
      const filePath = path.join(folderPath, fileName);
      const img = isImage(filePath);
      let duration = 0;
      if (!img) { try { duration = await getVideoDuration(filePath, ffprobePath); } catch (_) {} }
      results.push({ name: fileName, path: filePath, duration, isImage: img });
    }
    return results;
  });

  ipcMain.handle('library-add-files', async (_event, { folderName, filePaths }) => {
    const folderPath = path.join(LIBRARY_DIR, folderName);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    const added = [];
    for (const src of filePaths) {
      const fileName = path.basename(src);
      const dest = path.join(folderPath, fileName);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      added.push(fileName);
    }
    return { success: true, added };
  });

  ipcMain.handle('library-remove-file', (_event, { folderName, fileName }) => {
    const filePath = path.join(LIBRARY_DIR, folderName, fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  });

  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ALL_EXTS.map((e) => e.slice(1)) }],
    });
    return result.filePaths;
  });

  ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle('get-file-dir', (_event, filePath) => {
    return path.dirname(filePath);
  });

  ipcMain.handle('get-media-info', async (_event, filePath) => {
    const ffprobePath = await findBinary('ffprobe');
    const img = isImage(filePath);
    if (img) return { name: path.basename(filePath), path: filePath, duration: 0, isImage: true };
    try {
      const duration = await getVideoDuration(filePath, ffprobePath);
      return { name: path.basename(filePath), path: filePath, duration, isImage: false };
    } catch (err) {
      return { name: path.basename(filePath), path: filePath, duration: 0, isImage: false, error: err.message };
    }
  });
}

module.exports = { register, findBinary, getVideoDuration, isImage };
