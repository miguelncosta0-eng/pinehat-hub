const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Channels ──
  getChannelsConfig: () => ipcRenderer.invoke('get-channels-config'),

  // ── Settings ──
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),

  // ── Library (B-Roll) ──
  libraryGetFolders: () => ipcRenderer.invoke('library-get-folders'),
  libraryCreateFolder: (name) => ipcRenderer.invoke('library-create-folder', name),
  libraryDeleteFolder: (name) => ipcRenderer.invoke('library-delete-folder', name),
  libraryGetFiles: (folderName) => ipcRenderer.invoke('library-get-files', folderName),
  libraryAddFiles: (opts) => ipcRenderer.invoke('library-add-files', opts),
  libraryRemoveFile: (opts) => ipcRenderer.invoke('library-remove-file', opts),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectImage: () => ipcRenderer.invoke('select-image'),
  selectAndUploadThumbnail: () => ipcRenderer.invoke('select-and-upload-thumbnail'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getMediaInfo: (filePath) => ipcRenderer.invoke('get-media-info', filePath),
  getFileDir: (filePath) => ipcRenderer.invoke('get-file-dir', filePath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),

  // ── B-Roll Generation ──
  generateBroll: (options) => ipcRenderer.invoke('generate-broll', options),
  cancelGeneration: () => ipcRenderer.invoke('cancel-generation'),
  onGenerateProgress: (cb) => ipcRenderer.on('generate-progress', (_, d) => cb(d)),

  // ── Scripts ──
  getScripts: (filters) => ipcRenderer.invoke('get-scripts', filters),
  getScript: (id) => ipcRenderer.invoke('get-script', id),
  createScript: (data) => ipcRenderer.invoke('create-script', data),
  updateScript: (id, data) => ipcRenderer.invoke('update-script', id, data),
  deleteScript: (id) => ipcRenderer.invoke('delete-script', id),
  generateScript: (options) => ipcRenderer.invoke('generate-script', options),
  cancelScriptGeneration: () => ipcRenderer.invoke('cancel-script-generation'),
  onScriptProgress: (cb) => ipcRenderer.on('script-generation-progress', (_, d) => cb(d)),
  onScriptLive: (cb) => ipcRenderer.on('script-generation-live', (_, d) => cb(d)),

  // ── Projects ──
  getProjects: (filters) => ipcRenderer.invoke('get-projects', filters),
  createProject: (data) => ipcRenderer.invoke('create-project', data),
  updateProject: (id, data) => ipcRenderer.invoke('update-project', id, data),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),

  // ── Competitors ──
  competitorsGet: () => ipcRenderer.invoke('competitors-get'),
  competitorsAdd: (input) => ipcRenderer.invoke('competitors-add', input),
  competitorsRefresh: (id) => ipcRenderer.invoke('competitors-refresh', id),
  competitorsRefreshAll: () => ipcRenderer.invoke('competitors-refresh-all'),
  competitorsRemove: (id) => ipcRenderer.invoke('competitors-remove', id),
  competitorsGetTranscript: (videoId) => ipcRenderer.invoke('competitors-get-transcript', videoId),

  // ── Editor ──
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  saveAudioFile: (srcPath) => ipcRenderer.invoke('save-audio-file', srcPath),
  editorSaveProject: (data) => ipcRenderer.invoke('editor-save-project', data),
  editorLoadProject: (id) => ipcRenderer.invoke('editor-load-project', id),
  editorGetProjects: () => ipcRenderer.invoke('editor-get-projects'),
  editorDeleteProject: (id) => ipcRenderer.invoke('editor-delete-project', id),
  editorTranscribe: (options) => ipcRenderer.invoke('editor-transcribe', options),
  onEditorTranscribeProgress: (cb) => ipcRenderer.on('editor-transcribe-progress', (_, d) => cb(d)),
  editorDetectOverlays: (options) => ipcRenderer.invoke('editor-detect-overlays', options),
  onEditorOverlayProgress: (cb) => ipcRenderer.on('editor-overlay-progress', (_, d) => cb(d)),
  editorGenerateClips: (options) => ipcRenderer.invoke('editor-generate-clips', options),
  onEditorClipProgress: (cb) => ipcRenderer.on('editor-clip-progress', (_, d) => cb(d)),
  editorRemoveSilence: (opts) => ipcRenderer.invoke('editor-remove-silence', opts),
  onEditorSilenceProgress: (cb) => ipcRenderer.on('editor-silence-progress', (_, d) => cb(d)),
  editorGetWaveform: (audioPath) => ipcRenderer.invoke('editor-get-waveform', audioPath),
  editorGetThumbnail: (options) => ipcRenderer.invoke('editor-get-thumbnail', options),
  editorExport: (options) => ipcRenderer.invoke('editor-export', options),
  onEditorExportProgress: (cb) => ipcRenderer.on('editor-export-progress', (_, d) => cb(d)),
  editorCancelExport: () => ipcRenderer.invoke('editor-cancel-export'),

  // ── TTS ──
  editorTtsVoices: () => ipcRenderer.invoke('editor-tts-voices'),
  editorGenerateTts: (options) => ipcRenderer.invoke('editor-generate-tts', options),
  editorCancelTts: () => ipcRenderer.invoke('editor-cancel-tts'),
  onEditorTtsProgress: (cb) => ipcRenderer.on('editor-tts-progress', (_, d) => cb(d)),

  // ── Entities ──
  editorEntitiesGet: () => ipcRenderer.invoke('editor-entities-get'),
  editorEntitySave: (entity) => ipcRenderer.invoke('editor-entity-save', entity),
  editorEntityDelete: (id) => ipcRenderer.invoke('editor-entity-delete', id),
  editorEntitySelectImages: () => ipcRenderer.invoke('editor-entity-select-images'),
  editorDetectEntityEvents: (opts) => ipcRenderer.invoke('editor-detect-entity-events', opts),

  // ── Whisper Local ──
  whisperLocalStatus: () => ipcRenderer.invoke('whisper-local-status'),
  whisperDownloadModel: (modelSize) => ipcRenderer.invoke('whisper-download-model', modelSize),
  onWhisperDownloadProgress: (cb) => ipcRenderer.on('whisper-download-progress', (_, d) => cb(d)),

  // ── Series ──
  seriesGetAll: () => ipcRenderer.invoke('series-get-all'),
  seriesSelectFolder: () => ipcRenderer.invoke('series-select-folder'),
  seriesAdd: (opts) => ipcRenderer.invoke('series-add', opts),
  seriesRemove: (id) => ipcRenderer.invoke('series-remove', id),
  seriesRescan: (id) => ipcRenderer.invoke('series-rescan', id),
  seriesAnalyzeEpisode: (opts) => ipcRenderer.invoke('series-analyze-episode', opts),
  seriesCancelAnalysis: () => ipcRenderer.invoke('series-cancel-analysis'),
  seriesAssignClips: (opts) => ipcRenderer.invoke('series-assign-clips', opts),
  seriesDeepAnalyze: (opts) => ipcRenderer.invoke('series-deep-analyze-episode', opts),
  seriesDeepAnalyzeAll: (opts) => ipcRenderer.invoke('series-deep-analyze-all', opts),
  seriesUpdateCharacters: (opts) => ipcRenderer.invoke('series-update-characters', opts),
  seriesResetAnalysis: (id) => ipcRenderer.invoke('series-reset-analysis', id),
  seriesDiagnose: (id) => ipcRenderer.invoke('series-diagnose', id),
  seriesTraceOne: (id) => ipcRenderer.invoke('series-trace-one', id),
  onSeriesAnalyzeProgress: (cb) => ipcRenderer.on('series-analyze-progress', (_, d) => cb(d)),

  // ── Smart Editor ──
  smartEditorGenerate: (opts) => ipcRenderer.invoke('smart-editor-generate', opts),
  smartEditorCancel: () => ipcRenderer.invoke('smart-editor-cancel'),
  smartEditorSavePlan: (data) => ipcRenderer.invoke('smart-editor-save-plan', data),
  smartEditorLoadPlan: (id) => ipcRenderer.invoke('smart-editor-load-plan', id),
  smartEditorListPlans: () => ipcRenderer.invoke('smart-editor-list-plans'),
  smartEditorExport: (opts) => ipcRenderer.invoke('smart-editor-export', opts),
  onSmartEditorProgress: (cb) => ipcRenderer.on('smart-editor-progress', (_, d) => cb(d)),

  // ── Voiceover TTS (Elevate Labs) ──
  voiceoverGenerateTts: (opts) => ipcRenderer.invoke('voiceover-generate-tts', opts),
  onVoiceoverTtsProgress: (cb) => ipcRenderer.on('voiceover-tts-progress', (_, d) => cb(d)),

  // ── Ideation ──
  ideationGenerate: (opts) => ipcRenderer.invoke('ideation-generate', opts),
  ideationGetHistory: (channel) => ipcRenderer.invoke('ideation-get-history', channel),
  ideationDelete: (opts) => ipcRenderer.invoke('ideation-delete', opts),

  // ── SEO ──
  seoGenerate: (opts) => ipcRenderer.invoke('seo-generate', opts),
  seoGetHistory: (channel) => ipcRenderer.invoke('seo-get-history', channel),
  seoDelete: (opts) => ipcRenderer.invoke('seo-delete', opts),

  // ── Channel Sharing ──
  shareChannel: (channelId) => ipcRenderer.invoke('share-channel', channelId),
  joinChannel: (channelId, code) => ipcRenderer.invoke('join-channel', channelId, code),
  joinChannelDirect: (code) => ipcRenderer.invoke('join-channel-direct', code),
  syncProjectsToCloud: (channelId) => ipcRenderer.invoke('sync-projects-to-cloud', channelId),
  unshareChannel: (channelId) => ipcRenderer.invoke('unshare-channel', channelId),
  getShareInfo: (channelId) => ipcRenderer.invoke('get-share-info', channelId),
  onProjectsChanged: (cb) => ipcRenderer.on('projects-changed', (_, d) => cb(d)),
  onChatProjectsChanged: (cb) => ipcRenderer.on('chat-projects-changed', (_, d) => cb(d)),

  // ── Chat Projects ──
  getChatProjects: () => ipcRenderer.invoke('get-chat-projects'),
  createChatProject: (data) => ipcRenderer.invoke('create-chat-project', data),
  updateChatProject: (id, data) => ipcRenderer.invoke('update-chat-project', id, data),
  deleteChatProject: (id) => ipcRenderer.invoke('delete-chat-project', id),
  chatSendMessage: (projectId, message) => ipcRenderer.invoke('chat-send-message', projectId, message),
  chatStopStreaming: (projectId) => ipcRenderer.invoke('chat-stop-streaming', projectId),
  chatClearHistory: (projectId) => ipcRenderer.invoke('chat-clear-history', projectId),
  chatAddFile: (projectId) => ipcRenderer.invoke('chat-add-file', projectId),
  chatRemoveFile: (projectId, fileIdx) => ipcRenderer.invoke('chat-remove-file', projectId, fileIdx),
  onChatStreamDelta: (cb) => ipcRenderer.on('chat-stream-delta', (_, d) => cb(d)),
  onChatStreamDone: (cb) => ipcRenderer.on('chat-stream-done', (_, d) => cb(d)),

  // ── Auto-Update ──
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, d) => cb(d)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});
