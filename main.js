const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { CHANNELS } = require('./main/prompt-templates');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0D0D0F',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    title: 'PineHat Hub',
  });

  mainWindow.loadFile('index.html');

  // Register all IPC handlers
  require('./main/ipc-settings').register();
  require('./main/ipc-library').register(mainWindow);
  require('./main/ipc-broll').register();
  require('./main/ipc-projects').register();
  require('./main/ipc-scripts').register();
  require('./main/ipc-competitors').register();
  require('./main/ipc-editor').register(mainWindow);
  require('./main/ipc-series').register(mainWindow);
  require('./main/ipc-updater').register();

  // Channels config (shared with renderer)
  ipcMain.handle('get-channels-config', () => CHANNELS);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
