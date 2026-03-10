const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, ensureDataDir } = require('./ipc-data');

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  anthropicApiKey: '',
  model: 'claude-opus-4-6',
  activeChannel: 'pinehat',
  lastSection: 'dashboard',
  outputFolderBroll: null,
  openaiApiKey: '',
  editorClipDurationMin: 3,
  editorClipDurationMax: 8,
  editorSkipStart: 30,
  editorSkipEnd: 30,
  editorOverlayDefaultDuration: 3,
  editorOverlayDefaultFontSize: 72,
  editorOverlayDefaultAnimation: 'auto',
  editorExportResolution: '1920x1080',
  editorExportBitrate: '18M',
  whisperMode: 'api',           // 'api' | 'local'
  whisperModelSize: 'base',     // 'base' | 'small' | 'medium'
  ttsVoice: 'en-US-AndrewMultilingualNeural',
  ttsSpeed: 0.85,               // 0.5 – 1.0 (slower = better for sleep content)
};

function getSettings() {
  ensureDataDir();
  const data = readJson(SETTINGS_PATH);
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

function saveSettings(settings) {
  const current = getSettings();
  const merged = { ...current, ...settings };
  writeJson(SETTINGS_PATH, merged);
  return merged;
}

function register() {
  ipcMain.handle('get-settings', () => getSettings());

  ipcMain.handle('save-settings', (_event, settings) => {
    return saveSettings(settings);
  });

  ipcMain.handle('save-setting', (_event, key, value) => {
    return saveSettings({ [key]: value });
  });
}

module.exports = { register, getSettings };
