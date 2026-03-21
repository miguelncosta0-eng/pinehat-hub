const { ipcMain, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

function sendToRenderer(channel, data) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

exports.register = function () {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    sendToRenderer('update-available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    sendToRenderer('update-downloaded', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Download: ${Math.round(progress.percent)}%`);
    sendToRenderer('update-download-progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('error', (err) => {
    console.log('[updater] Error:', err.message);
    sendToRenderer('update-error', { message: err.message });
  });

  ipcMain.handle('install-update', () => {
    // Force quit all windows, then install
    setImmediate(() => {
      autoUpdater.quitAndInstall(true, true);
    });
  });

  ipcMain.handle('check-for-updates', () => {
    return autoUpdater.checkForUpdates().catch(() => null);
  });

  // Check on startup (5s delay)
  setTimeout(() => {
    console.log('[updater] Checking for updates...');
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);

  // Periodic check
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL);
};
