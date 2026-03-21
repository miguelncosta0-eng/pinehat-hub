// Centralized state
window.Hub = window.Hub || {};

Hub.state = {
  activeChannel: 'pinehat',
  activeSection: 'dashboard',
  channels: {},         // loaded from main process
  settings: {},

  // Dashboard
  projects: [],
  scripts: [],

  // B-Roll
  broll: {
    files: [],
    outputFolder: null,
    isGenerating: false,
  },

  // Scripts
  editingScript: null,  // script id being edited

  // Projects
  editingProject: null, // project id being edited
  projectsView: 'kanban',    // 'kanban' | 'calendar'
  calendarMonth: new Date(), // current month for calendar view

  // Competitors
  viewingCompetitor: null, // competitor id when viewing detail

  // Series
  viewingSeries: null, // series id when viewing detail

  // Voiceover
  voiceover: {},

  // Smart Editor
  smartEditor: {
    scriptId: null,
    voiceoverPath: null,
    seriesIds: [],
    outputFolder: null,
    step: 'setup',
    isGenerating: false,
  },

  // Editor
  editor: {
    projectId: null,
    voiceover: null,
    transcription: null,
    episodes: [],
    clips: [],
    overlays: [],
    clipDurationMin: 3,
    clipDurationMax: 8,
    skipStart: 30,
    skipEnd: 30,
    outputFolder: null,
    outputFilename: 'editor_output.mp4',
    isRemovingSilence: false,
    isTranscribing: false,
    isDetectingOverlays: false,
    isGeneratingClips: false,
    isExporting: false,
    isGeneratingTts: false,
    ttsTab: 'import',
    currentStep: 'voiceover',
    captionsEnabled: false,
    imageEvents: [],    // timed image overlays from entity detection
    entities: [],       // loaded from DB on overlays step
  },
};
