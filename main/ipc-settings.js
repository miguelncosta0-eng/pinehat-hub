const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, ensureDataDir } = require('./ipc-data');

// Lazy require to avoid circular dependency
function supabaseHelpers() {
  return require('./supabase');
}

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  elevateLabsApiKey: '',
  model: 'claude-sonnet-4.5',
  activeChannel: '',
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
  channels: {},
};

function getSettings() {
  ensureDataDir();
  const data = readJson(SETTINGS_PATH);
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

function getChannels() {
  const settings = getSettings();
  return settings.channels || {};
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

  // Channels config — now stored in settings
  ipcMain.handle('get-channels-config', () => getChannels());

  // ── Share / Join / Unshare channel via Supabase ──

  ipcMain.handle('share-channel', async (_event, channelId) => {
    const settings = getSettings();
    const ch = settings.channels?.[channelId];
    if (!ch) return { success: false, error: 'Canal não encontrado.' };

    if (ch.shared && ch.supabaseChannelId) {
      return { success: true, code: ch.shareCode, alreadyShared: true };
    }

    const { getSupabase, generateShareCode } = supabaseHelpers();
    const supabase = getSupabase();
    const code = generateShareCode(ch.name);

    // Create shared channel in Supabase
    const { data, error } = await supabase
      .from('shared_channels')
      .insert({ code, name: ch.name })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    // Update local settings
    ch.shared = true;
    ch.shareCode = code;
    ch.supabaseChannelId = data.id;
    saveSettings({ channels: settings.channels });

    return { success: true, code };
  });

  ipcMain.handle('join-channel', async (_event, channelId, code) => {
    const supabase = supabaseHelpers().getSupabase();

    // Find channel by code
    const { data, error } = await supabase
      .from('shared_channels')
      .select('id, name')
      .eq('code', code.trim())
      .single();

    if (error || !data) return { success: false, error: 'Código não encontrado.' };

    // Update local channel settings
    const settings = getSettings();
    const ch = settings.channels?.[channelId];
    if (!ch) return { success: false, error: 'Canal local não encontrado.' };

    ch.shared = true;
    ch.shareCode = code.trim();
    ch.supabaseChannelId = data.id;
    saveSettings({ channels: settings.channels });

    return { success: true, name: data.name };
  });

  ipcMain.handle('unshare-channel', async (_event, channelId) => {
    const settings = getSettings();
    const ch = settings.channels?.[channelId];
    if (!ch) return { success: false, error: 'Canal não encontrado.' };

    // Just remove local sharing flags — don't delete from Supabase (other users may still use it)
    delete ch.shared;
    delete ch.shareCode;
    delete ch.supabaseChannelId;
    saveSettings({ channels: settings.channels });

    return { success: true };
  });

  // Join directly with code — creates local channel automatically
  ipcMain.handle('join-channel-direct', async (_event, code) => {
    const supabase = supabaseHelpers().getSupabase();

    // Find shared channel by code
    const { data, error } = await supabase
      .from('shared_channels')
      .select('id, name')
      .eq('code', code.trim())
      .single();

    if (error || !data) return { success: false, error: 'Código não encontrado.' };

    // Generate local channel ID from name
    const channelId = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shared';

    // Create or update local channel
    const settings = getSettings();
    if (!settings.channels) settings.channels = {};

    const existing = settings.channels[channelId];
    if (existing) {
      // Channel with this ID already exists — link it
      existing.shared = true;
      existing.shareCode = code.trim();
      existing.supabaseChannelId = data.id;
    } else {
      // Create new local channel linked to shared one
      settings.channels[channelId] = {
        name: data.name,
        accent: '#8b5cf6',
        accentHover: '#7748e2',
        accentGlow: 'rgba(139, 92, 246, 0.10)',
        shows: '',
        formats: [],
        shared: true,
        shareCode: code.trim(),
        supabaseChannelId: data.id,
      };
    }

    // Switch to this channel
    settings.activeChannel = channelId;
    saveSettings(settings);

    return { success: true, name: data.name, channelId };
  });

  ipcMain.handle('get-share-info', (_event, channelId) => {
    const settings = getSettings();
    const ch = settings.channels?.[channelId];
    if (!ch) return null;
    return {
      shared: !!ch.shared,
      shareCode: ch.shareCode || '',
      supabaseChannelId: ch.supabaseChannelId || '',
    };
  });
}

module.exports = { register, getSettings, getChannels };
