window.Hub = window.Hub || {};

// ═══════════════════════════════════════════
//  EDITOR — Main Render
// ═══════════════════════════════════════════

Hub.renderEditor = function () {
  const panel = document.getElementById('panel-editor');
  const st = Hub.state.editor;

  panel.innerHTML = `
    <div class="editor-container">
      <div class="section-header">
        <h2>Editor</h2>
        <div class="editor-project-actions">
          <button class="btn btn-secondary btn-small" id="editorLoadBtn">Carregar Projeto</button>
          <button class="btn btn-secondary btn-small" id="editorNewBtn">Novo Projeto</button>
          <button class="btn btn-primary btn-small" id="editorSaveBtn">Guardar</button>
        </div>
      </div>
      <div class="editor-step-nav" id="editorStepNav">
        ${['voiceover', 'media', 'clips', 'overlays', 'timeline', 'export'].map((step, i) => `
          <button class="editor-step-btn${st.currentStep === step ? ' active' : ''}${Hub._editorStepDone(step) ? ' done' : ''}" data-step="${step}">
            <span class="step-num">${i + 1}</span>
            <span class="step-label">${Hub._editorStepLabel(step)}</span>
          </button>
          ${i < 5 ? '<div class="step-connector"></div>' : ''}
        `).join('')}
      </div>
      <div class="editor-content" id="editorContent"></div>
    </div>
  `;

  // Step nav
  panel.querySelectorAll('.editor-step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      st.currentStep = btn.dataset.step;
      Hub.renderEditor();
    });
  });

  // Project actions
  panel.querySelector('#editorSaveBtn').addEventListener('click', () => Hub._editorSave());
  panel.querySelector('#editorLoadBtn').addEventListener('click', () => Hub._editorOpenLoadModal());
  panel.querySelector('#editorNewBtn').addEventListener('click', () => {
    Object.assign(st, {
      projectId: null, voiceover: null, transcription: null,
      episodes: [], clips: [], overlays: [],
      currentStep: 'voiceover', outputFolder: null,
    });
    Hub.renderEditor();
  });

  // Render current step
  Hub._editorRenderStep(st.currentStep);
};

Hub._editorStepLabel = function (step) {
  const labels = {
    voiceover: 'Voiceover', media: 'Media', clips: 'Clips',
    overlays: 'Overlays', timeline: 'Timeline', export: 'Exportar',
  };
  return labels[step] || step;
};

Hub._editorStepDone = function (step) {
  const st = Hub.state.editor;
  if (step === 'voiceover') return !!st.voiceover;
  if (step === 'media') return st.episodes.length > 0;
  if (step === 'clips') return st.clips.length > 0;
  if (step === 'overlays') return st.overlays.length > 0;
  return false;
};

Hub._editorRenderStep = function (step) {
  if (step === 'voiceover') Hub._editorRenderVoiceover();
  else if (step === 'media') Hub._editorRenderMedia();
  else if (step === 'clips') Hub._editorRenderClips();
  else if (step === 'overlays') Hub._editorRenderOverlays();
  else if (step === 'timeline') Hub._editorRenderTimeline();
  else if (step === 'export') Hub._editorRenderExport();
};

// ═══════════════════════════════════════════
//  STEP 1: Voiceover Import
// ═══════════════════════════════════════════

Hub._editorRenderVoiceover = function () {
  const content = document.getElementById('editorContent');
  const st = Hub.state.editor;

  if (!st.voiceover) {
    const activeTab = st.ttsTab || 'import';
    content.innerHTML = `
      <div class="vo-tabs">
        <button class="vo-tab-btn${activeTab === 'import' ? ' active' : ''}" data-tab="import">
          ${Hub.icons.mic} Importar Áudio
        </button>
        <button class="vo-tab-btn${activeTab === 'generate' ? ' active' : ''}" data-tab="generate">
          🔊 Gerar do Script
        </button>
      </div>
      <div class="vo-tab-content" id="voTabContent">
        ${activeTab === 'import' ? Hub._editorVoiceoverImportHTML() : Hub._editorVoiceoverGenerateHTML()}
      </div>
    `;

    content.querySelectorAll('.vo-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        st.ttsTab = btn.dataset.tab;
        Hub._editorRenderVoiceover();
      });
    });

    if (activeTab === 'import') {
      Hub._editorBindImportTab(content);
    } else {
      Hub._editorBindGenerateTab(content);
    }
  } else {
    const audioSrc = st.voiceover.path.replace(/\\/g, '/');
    content.innerHTML = `
      <div class="editor-voiceover-info">
        <div class="vo-header">
          <div class="vo-details">
            <h3>${st.voiceover.name}</h3>
            <p class="vo-duration">Duração: ${Hub.fmtDur(st.voiceover.duration)}</p>
          </div>
          <button class="btn btn-danger btn-small" id="editorRemoveVo">${Hub.icons.trash} Remover</button>
        </div>
        <audio controls src="file://${audioSrc}" style="width:100%;margin-top:12px;"></audio>
        <div class="vo-actions">
          <button class="btn btn-secondary" id="editorSilenceBtn" ${st.isRemovingSilence ? 'disabled' : ''}>
            ${st.isRemovingSilence ? '<span class="spinner"></span> A cortar...' : '✂️ Cortar Silêncio'}
          </button>
          <button class="btn btn-primary" id="editorTranscribeBtn" ${st.isTranscribing ? 'disabled' : ''}>
            ${st.isTranscribing ? '<span class="spinner"></span> A transcrever...' : `🎙️ Transcrever ${Hub.state.settings?.whisperMode === 'local' ? '(Local)' : '(API)'}`}
          </button>
          <button class="btn btn-secondary" id="editorUseScriptBtn">📝 Usar Script</button>
          <button class="btn btn-secondary" id="editorNextStep">Próximo Passo →</button>
        </div>
        ${st.isRemovingSilence ? `
          <div class="silence-progress" id="silenceProgress">
            <span class="silence-progress-text" id="silenceProgressText">A analisar áudio...</span>
            <div class="progress-big-bar" style="width:240px"><div class="progress-big-fill" id="silenceProgressFill" style="width:0%"></div></div>
          </div>
        ` : ''}
        ${st.transcription ? Hub._editorTranscriptionHTML() : ''}
      </div>
    `;
    content.querySelector('#editorRemoveVo').addEventListener('click', () => {
      st.voiceover = null;
      st.transcription = null;
      Hub._editorRenderStep('voiceover');
    });
    content.querySelector('#editorSilenceBtn').addEventListener('click', () => Hub._editorRemoveSilence());
    content.querySelector('#editorTranscribeBtn').addEventListener('click', () => Hub._editorTranscribe());
    content.querySelector('#editorUseScriptBtn').addEventListener('click', () => Hub._editorUseScript());
    content.querySelector('#editorNextStep').addEventListener('click', () => {
      st.currentStep = 'media';
      Hub.renderEditor();
    });
  }
};

// ── Silence Removal ──
Hub._editorRemoveSilence = async function () {
  const st = Hub.state.editor;
  if (st.isRemovingSilence || !st.voiceover) return;

  st.isRemovingSilence = true;
  Hub._editorRenderStep('voiceover');

  window.api.onEditorSilenceProgress((data) => {
    const text = document.getElementById('silenceProgressText');
    const fill = document.getElementById('silenceProgressFill');
    if (text) {
      if (data.phase === 'detecting') text.textContent = 'A detetar silêncio...';
      else if (data.phase === 'trimming') text.textContent = 'A cortar silêncio...';
      else if (data.phase === 'done') text.textContent = 'Concluído!';
    }
    if (fill) fill.style.width = `${data.percent}%`;
  });

  const result = await window.api.editorRemoveSilence({
    audioPath: st.voiceover.path,
    threshold: -30,
    minSilenceDuration: 0.5,
  });

  st.isRemovingSilence = false;

  if (result.success) {
    if (result.noChange) {
      Hub.showToast('Nenhum silêncio detetado no áudio');
    } else {
      // Update voiceover with trimmed file
      st.voiceover.path = result.outputPath;
      st.voiceover.name = result.outputPath.split(/[\\/]/).pop();
      st.voiceover.duration = result.newDuration;

      // Clear transcription since timestamps are now different
      if (st.transcription) {
        st.transcription = null;
        Hub.showToast(`Removidos ${Hub.fmtDur(result.silenceRemoved)} de silêncio (${result.silenceCount} pausas). Transcrição limpa — re-transcreve.`);
      } else {
        Hub.showToast(`Removidos ${Hub.fmtDur(result.silenceRemoved)} de silêncio (${result.silenceCount} pausas)`);
      }
    }
  } else {
    Hub.showToast(`Erro: ${result.error}`, 'error');
  }

  Hub._editorRenderStep('voiceover');
};

// ── Import tab ──
Hub._editorVoiceoverImportHTML = function () {
  return `
    <div class="editor-import-zone" id="editorVoiceoverDrop">
      <div class="editor-import-icon">${Hub.icons.mic}</div>
      <h3>Importar Voiceover</h3>
      <p class="editor-import-hint">Arrasta um ficheiro de áudio ou clica para selecionar</p>
      <p class="editor-import-formats">MP3, WAV, AAC, M4A, OGG, FLAC</p>
      <button class="btn btn-primary" id="editorSelectAudio">Escolher Ficheiro</button>
    </div>
  `;
};

Hub._editorBindImportTab = function (content) {
  content.querySelector('#editorSelectAudio')?.addEventListener('click', async () => {
    const filePath = await window.api.selectAudioFile();
    if (filePath) await Hub._editorImportVoiceover(filePath);
  });
  Hub._editorBindAudioDrop(content.querySelector('#editorVoiceoverDrop'));
};

// ── Generate from Script tab ──
Hub._editorVoiceoverGenerateHTML = function () {
  const settings = Hub.state.settings || {};
  return `
    <div class="tts-generate-panel">
      <div class="tts-script-select">
        <label class="form-label">Script</label>
        <select class="input" id="ttsScriptSelect">
          <option value="">Escolher um script...</option>
        </select>
        <div class="tts-script-preview" id="ttsScriptPreview"></div>
      </div>

      <div class="tts-controls">
        <div class="tts-control-group">
          <label class="form-label">Voice</label>
          <select class="input" id="ttsVoiceSelect"></select>
          <div class="tts-preview-row">
            <button class="btn btn-secondary btn-small" id="ttsPreviewVoice">${Hub.icons.play} Preview</button>
            <button class="btn btn-danger btn-small" id="ttsStopPreview" style="display:none;">⬛ Parar</button>
            <div class="tts-volume-control">
              <span class="tts-volume-icon">🔊</span>
              <input type="range" class="input-range" id="ttsPreviewVolume" min="0" max="1" step="0.05" value="0.8">
              <span class="tts-volume-value" id="ttsPreviewVolumeVal">80%</span>
            </div>
          </div>
        </div>
        <div class="tts-control-group">
          <label class="form-label">Speed</label>
          <div class="tts-speed-row">
            <input type="range" class="input-range" id="ttsSpeedSlider"
              min="0.5" max="1.0" step="0.05" value="${settings.ttsSpeed || 0.85}">
            <span class="tts-speed-value" id="ttsSpeedValue">${((settings.ttsSpeed || 0.85) * 100).toFixed(0)}%</span>
          </div>
          <div class="hint">Mais lento = melhor para sleep content</div>
        </div>
      </div>

      <div class="tts-script-info" id="ttsScriptInfo" style="display:none;">
        <span id="ttsWordCount"></span> · <span id="ttsEstDuration"></span> estimado
      </div>

      <button class="btn btn-primary" id="ttsGenerateBtn" disabled>
        🔊 Gerar Voiceover
      </button>
    </div>
  `;
};

Hub._editorBindGenerateTab = async function (content) {
  const scriptSelect = content.querySelector('#ttsScriptSelect');
  const voiceSelect = content.querySelector('#ttsVoiceSelect');
  const speedSlider = content.querySelector('#ttsSpeedSlider');
  const speedValue = content.querySelector('#ttsSpeedValue');
  const generateBtn = content.querySelector('#ttsGenerateBtn');
  const previewBtn = content.querySelector('#ttsPreviewVoice');

  // Load scripts list
  const scripts = await window.api.getScripts({});
  scripts.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.title} (${s.wordCount} palavras)`;
    scriptSelect.appendChild(opt);
  });

  // Load voices
  const voices = await window.api.editorTtsVoices();
  const settings = Hub.state.settings || {};
  const savedVoice = settings.ttsVoice || 'en-US-AndrewMultilingualNeural';
  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.name} (${v.gender}, ${v.lang}) — ${v.desc}`;
    opt.selected = v.id === savedVoice;
    voiceSelect.appendChild(opt);
  });

  // Speed slider
  speedSlider.addEventListener('input', () => {
    speedValue.textContent = `${(parseFloat(speedSlider.value) * 100).toFixed(0)}%`;
  });

  // Script selection
  let selectedScriptContent = null;
  let selectedScriptTitle = '';
  scriptSelect.addEventListener('change', async () => {
    const scriptId = scriptSelect.value;
    const infoEl = content.querySelector('#ttsScriptInfo');
    const previewEl = content.querySelector('#ttsScriptPreview');

    if (!scriptId) {
      generateBtn.disabled = true;
      infoEl.style.display = 'none';
      previewEl.innerHTML = '';
      selectedScriptContent = null;
      return;
    }

    const script = await window.api.getScript(scriptId);
    selectedScriptContent = script.content;
    selectedScriptTitle = script.title;

    const wordCount = script.wordCount || script.content.split(/\s+/).length;
    const speed = parseFloat(speedSlider.value);
    const estimatedMinutes = Math.ceil(wordCount / (150 * speed));

    content.querySelector('#ttsWordCount').textContent = `${wordCount} words`;
    content.querySelector('#ttsEstDuration').textContent = `~${estimatedMinutes} min`;
    infoEl.style.display = 'block';

    previewEl.innerHTML = `<p class="tts-preview-text">${script.content.substring(0, 300)}${script.content.length > 300 ? '...' : ''}</p>`;
    generateBtn.disabled = false;
  });

  // Generate button
  generateBtn.addEventListener('click', async () => {
    if (!selectedScriptContent || Hub.state.editor.isGeneratingTts) return;
    Hub._editorStartTtsGeneration(selectedScriptContent, voiceSelect.value, parseFloat(speedSlider.value), selectedScriptTitle);
  });

  // Preview voice
  const stopBtn = content.querySelector('#ttsStopPreview');
  const volumeSlider = content.querySelector('#ttsPreviewVolume');
  const volumeVal = content.querySelector('#ttsPreviewVolumeVal');
  let currentPreviewAudio = null;
  let isGeneratingPreview = false;

  // Volume slider
  volumeSlider.addEventListener('input', () => {
    const vol = parseFloat(volumeSlider.value);
    volumeVal.textContent = `${Math.round(vol * 100)}%`;
    if (currentPreviewAudio) currentPreviewAudio.volume = vol;
  });

  function resetPreviewUI() {
    previewBtn.style.display = '';
    previewBtn.disabled = false;
    previewBtn.innerHTML = `${Hub.icons.play} Preview`;
    stopBtn.style.display = 'none';
    isGeneratingPreview = false;
    currentPreviewAudio = null;
  }

  // Stop preview
  stopBtn.addEventListener('click', () => {
    if (currentPreviewAudio) {
      currentPreviewAudio.pause();
      currentPreviewAudio.currentTime = 0;
      currentPreviewAudio = null;
    }
    if (isGeneratingPreview) {
      window.api.editorCancelTts();
    }
    resetPreviewUI();
  });

  // Play preview
  previewBtn.addEventListener('click', async () => {
    const sampleText = 'Welcome to another episode. Tonight, we explore the hidden mysteries and secrets that lie beneath the surface.';
    previewBtn.disabled = true;
    previewBtn.innerHTML = '<span class="spinner"></span>';
    stopBtn.style.display = '';
    isGeneratingPreview = true;

    try {
      const result = await window.api.editorGenerateTts({
        text: sampleText,
        voice: voiceSelect.value,
        speed: parseFloat(speedSlider.value),
        scriptTitle: 'preview',
      });

      isGeneratingPreview = false;

      if (result.success) {
        currentPreviewAudio = new Audio(`file://${result.voiceover.path.replace(/\\/g, '/')}`);
        currentPreviewAudio.volume = parseFloat(volumeSlider.value);
        currentPreviewAudio.play();

        // When audio finishes, reset UI
        currentPreviewAudio.addEventListener('ended', () => {
          resetPreviewUI();
        });

        // Update button to show playing state
        previewBtn.style.display = 'none';
      } else if (result.error === 'cancelled') {
        // User cancelled — UI already reset by stop handler
        return;
      } else {
        resetPreviewUI();
      }
    } catch (e) {
      console.error('TTS preview error:', e);
      resetPreviewUI();
    }
  });
};

Hub._editorStartTtsGeneration = async function (text, voice, speed, scriptTitle) {
  const st = Hub.state.editor;
  st.isGeneratingTts = true;
  Hub._editorRenderStep('voiceover');

  const genBar = document.getElementById('genBar');
  const barFill = document.getElementById('genBarFill');
  const barPhase = document.getElementById('genBarPhase');
  const barPercent = document.getElementById('genBarPercent');
  const barEta = document.getElementById('genBarEta');
  const barCancel = document.getElementById('genBarCancel');
  genBar.classList.add('visible');
  genBar.classList.remove('done');
  barPhase.textContent = 'A preparar TTS...';
  barFill.style.width = '0%';
  barPercent.textContent = '0%';
  barEta.textContent = '';

  // Wire up cancel button
  const onCancel = async () => {
    barPhase.textContent = 'A cancelar...';
    await window.api.editorCancelTts();
  };
  barCancel.addEventListener('click', onCancel, { once: true });

  window.api.onEditorTtsProgress((data) => {
    barFill.style.width = `${data.percent}%`;
    barPercent.textContent = `${data.percent}%`;
    barPhase.textContent = data.detail || data.phase;
    if (data.totalChunks) {
      barEta.textContent = `${data.chunk || 0}/${data.totalChunks}`;
    }
  });

  // Save preferred voice and speed
  await window.api.saveSetting('ttsVoice', voice);
  await window.api.saveSetting('ttsSpeed', speed);
  Hub.state.settings = await window.api.getSettings();

  const result = await window.api.editorGenerateTts({ text, voice, speed, scriptTitle });

  barCancel.removeEventListener('click', onCancel);
  st.isGeneratingTts = false;

  if (result.success) {
    st.voiceover = result.voiceover;
    st.transcription = null;
    genBar.classList.add('done');
    barPhase.textContent = `Voiceover gerado — ${Hub.fmtDur(result.voiceover.duration)}`;
    barFill.style.width = '100%';
    barPercent.textContent = '100%';
    setTimeout(() => genBar.classList.remove('visible', 'done'), 4000);
    Hub.showToast('Voiceover gerado com sucesso!');
  } else if (result.error === 'cancelled') {
    genBar.classList.add('done');
    barPhase.textContent = 'Geração cancelada.';
    barFill.style.width = '0%';
    barPercent.textContent = '✗';
    Hub.showToast('Geração de voiceover cancelada.', 'error');
    setTimeout(() => genBar.classList.remove('visible', 'done'), 3000);
  } else {
    Hub.showToast(result.error, 'error');
    barPhase.textContent = result.error;
    genBar.classList.add('done');
    barFill.style.width = '0%';
    barPercent.textContent = '✗';
    setTimeout(() => genBar.classList.remove('visible', 'done'), 6000);
  }

  Hub._editorRenderStep('voiceover');
};

Hub._editorImportVoiceover = async function (filePath) {
  const st = Hub.state.editor;
  const info = await window.api.getMediaInfo(filePath);
  st.voiceover = {
    path: info.path,
    name: info.name,
    duration: info.duration || 0,
  };
  Hub._editorRenderStep('voiceover');
};

Hub._editorBindAudioDrop = function (zone) {
  if (!zone) return;
  const audioExts = /\.(mp3|wav|aac|m4a|ogg|flac)$/i;

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('active');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('active'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('active');
    const files = [...e.dataTransfer.files];
    const audio = files.find((f) => audioExts.test(f.name));
    if (audio) {
      const filePath = window.api.getDroppedFilePath(audio);
      if (filePath) await Hub._editorImportVoiceover(filePath);
    }
  });
  zone.addEventListener('click', async (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const filePath = await window.api.selectAudioFile();
    if (filePath) await Hub._editorImportVoiceover(filePath);
  });
};

Hub._editorTranscribe = async function () {
  const st = Hub.state.editor;
  if (!st.voiceover || st.isTranscribing) return;

  st.isTranscribing = true;
  Hub._editorRenderStep('voiceover');

  // Show gen-bar
  const genBar = document.getElementById('genBar');
  const barFill = document.getElementById('genBarFill');
  const barPhase = document.getElementById('genBarPhase');
  const barPercent = document.getElementById('genBarPercent');
  const barEta = document.getElementById('genBarEta');
  genBar.classList.add('visible');
  genBar.classList.remove('done');
  barPhase.textContent = 'A transcrever...';
  barFill.style.width = '10%';
  barPercent.textContent = '10%';
  barEta.textContent = '';

  window.api.onEditorTranscribeProgress((data) => {
    barFill.style.width = `${data.percent}%`;
    barPercent.textContent = `${data.percent}%`;
    if (data.phase === 'uploading') barPhase.textContent = 'A enviar áudio...';
    else if (data.phase === 'transcribing') barPhase.textContent = 'Whisper a transcrever...';
    else if (data.phase === 'splitting') barPhase.textContent = 'A dividir áudio em partes...';
    else if (data.phase === 'chunk') barPhase.textContent = `A transcrever parte ${data.current}/${data.total}...`;
    else if (data.phase === 'setup') barPhase.textContent = 'A preparar...';
    else if (data.phase === 'downloading-bin') barPhase.textContent = 'A descarregar whisper.cpp...';
    else if (data.phase === 'downloading-model') barPhase.textContent = 'A descarregar modelo Whisper...';
    else if (data.phase === 'converting') barPhase.textContent = 'A converter áudio para WAV...';
  });

  const result = await window.api.editorTranscribe({ audioPath: st.voiceover.path, duration: st.voiceover.duration });

  st.isTranscribing = false;

  if (result.success) {
    st.transcription = result.transcription;
    genBar.classList.add('done');
    barPhase.textContent = `Transcrição completa — ${result.transcription.words.length} palavras`;
    barFill.style.width = '100%';
    barPercent.textContent = '100%';
    setTimeout(() => genBar.classList.remove('visible', 'done'), 4000);
  } else {
    Hub.showToast(result.error, 'error');
    genBar.classList.remove('visible');
  }

  Hub._editorRenderStep('voiceover');
};

Hub._editorApplyScriptText = function (text) {
  const st = Hub.state.editor;
  const clean = text.trim();
  if (!clean) return Hub.showToast('Texto vazio.', 'error');

  const wordsArr = clean.split(/\s+/).filter(w => w.length > 0);
  const duration = st.voiceover.duration || 60;
  const timePerWord = duration / wordsArr.length;

  st.transcription = {
    words: wordsArr.map((word, i) => ({
      word,
      start: +(i * timePerWord).toFixed(3),
      end: +((i + 1) * timePerWord).toFixed(3),
    })),
    fullText: clean,
    model: 'script',
  };

  document.getElementById('modalBackdrop').classList.remove('visible');
  Hub.showToast(`Script aplicado como transcrição — ${wordsArr.length} palavras`, 'success');
  Hub._editorRenderStep('voiceover');
};

Hub._editorUseScript = async function () {
  const st = Hub.state.editor;
  if (!st.voiceover) return Hub.showToast('Adiciona um voiceover primeiro.', 'error');

  const scripts = await window.api.getScripts();
  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <h2>Usar Script como Transcrição</h2>
    <p class="modal-desc">Escreve/cola o texto ou seleciona um script existente.</p>
    <textarea class="input" id="scriptTextArea" rows="8" placeholder="Cola ou escreve o teu script aqui..." style="width:100%;resize:vertical;margin:12px 0;font-size:14px;"></textarea>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button class="btn btn-primary" id="scriptTextApply">Aplicar Texto</button>
      <span id="scriptWordCount" style="opacity:0.5;line-height:36px;"></span>
    </div>
    ${scripts && scripts.length > 0 ? `
      <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;margin-top:4px;">
        <p style="opacity:0.5;margin-bottom:8px;">Ou seleciona um script existente:</p>
        <div class="script-list" style="max-height:200px;overflow-y:auto;">
          ${scripts.map(s => `
            <button class="btn btn-secondary script-pick-btn" data-id="${s.id}" style="display:block;width:100%;text-align:left;margin-bottom:6px;padding:8px 12px;">
              <strong>${s.title}</strong>
              <span style="opacity:0.5;margin-left:8px;">${s.wordCount || '?'} palavras</span>
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
  backdrop.classList.add('visible');

  // Word count live update
  const textarea = modal.querySelector('#scriptTextArea');
  const wordCountEl = modal.querySelector('#scriptWordCount');
  textarea.addEventListener('input', () => {
    const count = textarea.value.trim().split(/\s+/).filter(w => w).length;
    wordCountEl.textContent = count > 0 ? `${count} palavras` : '';
  });
  textarea.focus();

  // Apply typed/pasted text
  modal.querySelector('#scriptTextApply').addEventListener('click', () => {
    Hub._editorApplyScriptText(textarea.value);
  });

  // Pick existing script
  modal.querySelectorAll('.script-pick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const script = await window.api.getScript(btn.dataset.id);
      if (script && script.content) Hub._editorApplyScriptText(script.content);
    });
  });
};

Hub._editorTranscriptionHTML = function () {
  const st = Hub.state.editor;
  if (!st.transcription) return '';
  return `
    <div class="editor-transcription">
      <div class="editor-transcription-header">
        <h4>Transcrição</h4>
        <span class="editor-transcription-stats">${st.transcription.words.length} palavras com timestamps</span>
      </div>
      <div class="editor-transcription-text">${st.transcription.fullText}</div>
    </div>
  `;
};

// ═══════════════════════════════════════════
//  STEP 2: Media / Episode Import
// ═══════════════════════════════════════════

Hub._editorRenderMedia = function () {
  const content = document.getElementById('editorContent');
  const st = Hub.state.editor;
  const hasFiles = st.episodes.length > 0;
  const videoExts = /\.(mp4|mov|avi|mkv|webm|mts|ts|wmv)$/i;

  content.innerHTML = `
    <div class="editor-media-container">
      <div class="broll-drop-zone${hasFiles ? ' compact' : ''}" id="editorMediaDrop">
        ${hasFiles ? `
          <span class="broll-drop-icon">${Hub.icons.video}</span>
          <span>Arrasta mais episódios ou <a href="#" id="editorBrowseMore">adiciona</a></span>
        ` : `
          <div class="editor-import-icon">${Hub.icons.video}</div>
          <h3>Importar Episódios / Vídeos</h3>
          <p class="editor-import-hint">Arrasta ficheiros de vídeo (S01E01.mp4, S01E02.mp4...)</p>
          <p class="editor-import-formats">MP4, MOV, AVI, MKV, WEBM</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-primary" id="editorSelectVideos">Escolher Ficheiros</button>
            <button class="btn btn-secondary" id="editorImportFromSeries">📺 Importar da Série</button>
          </div>
        `}
      </div>
      ${hasFiles ? `
        <div class="editor-settings-bar">
          <div class="editor-setting">
            <label>Clip Min (seg)</label>
            <input type="number" class="input input-small" id="editorClipMin" value="${st.clipDurationMin}" min="1" max="30" step="1">
          </div>
          <div class="editor-setting">
            <label>Clip Max (seg)</label>
            <input type="number" class="input input-small" id="editorClipMax" value="${st.clipDurationMax}" min="2" max="60" step="1">
          </div>
          <div class="editor-setting">
            <label>Saltar Início (seg)</label>
            <input type="number" class="input input-small" id="editorSkipStart" value="${st.skipStart}" min="0" max="600" step="5">
          </div>
          <div class="editor-setting">
            <label>Saltar Fim (seg)</label>
            <input type="number" class="input input-small" id="editorSkipEnd" value="${st.skipEnd}" min="0" max="600" step="5">
          </div>
        </div>
        <div class="editor-episode-list">
          ${st.episodes.map((ep, i) => `
            <div class="broll-file-card" data-index="${i}">
              <div class="broll-file-icon">${Hub.icons.video}</div>
              <div class="broll-file-info">
                <div class="broll-file-name">${ep.name}</div>
                <div class="broll-file-meta">${Hub.fmtDur(ep.duration)} · ${ep.label}</div>
              </div>
              <button class="btn-icon broll-file-remove" data-index="${i}">${Hub.icons.x}</button>
            </div>
          `).join('')}
        </div>
        <div class="editor-media-footer">
          <div class="editor-media-summary">
            ${st.episodes.length} episódio${st.episodes.length !== 1 ? 's' : ''} ·
            ${Hub.fmtDur(st.episodes.reduce((sum, ep) => sum + ep.duration, 0))} total
          </div>
          <div>
            <button class="btn btn-secondary" id="editorPrevStep">← Voiceover</button>
            <button class="btn btn-primary" id="editorNextStepMedia">Gerar Clips →</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Bind events
  const dropZone = content.querySelector('#editorMediaDrop');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('active'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('active');
    const files = [...e.dataTransfer.files].filter((f) => videoExts.test(f.name));
    const paths = files.map((f) => window.api.getDroppedFilePath(f)).filter(Boolean);
    if (paths.length > 0) await Hub._editorAddEpisodes(paths);
  });

  const selectBtn = content.querySelector('#editorSelectVideos');
  if (selectBtn) {
    selectBtn.addEventListener('click', async () => {
      const paths = await window.api.selectFiles();
      if (paths && paths.length > 0) await Hub._editorAddEpisodes(paths.filter((p) => videoExts.test(p)));
    });
  }
  const importSeriesBtn = content.querySelector('#editorImportFromSeries');
  if (importSeriesBtn) {
    importSeriesBtn.addEventListener('click', () => Hub._editorOpenSeriesImportModal());
  }

  const browseMore = content.querySelector('#editorBrowseMore');
  if (browseMore) {
    browseMore.addEventListener('click', async (e) => {
      e.preventDefault();
      const paths = await window.api.selectFiles();
      if (paths && paths.length > 0) await Hub._editorAddEpisodes(paths.filter((p) => videoExts.test(p)));
    });
  }

  // Settings inputs
  ['editorClipMin', 'editorClipMax', 'editorSkipStart', 'editorSkipEnd'].forEach((id) => {
    const input = content.querySelector(`#${id}`);
    if (input) {
      input.addEventListener('change', () => {
        st.clipDurationMin = parseInt(content.querySelector('#editorClipMin').value) || 3;
        st.clipDurationMax = parseInt(content.querySelector('#editorClipMax').value) || 8;
        st.skipStart = parseInt(content.querySelector('#editorSkipStart').value) || 30;
        st.skipEnd = parseInt(content.querySelector('#editorSkipEnd').value) || 30;
      });
    }
  });

  // Remove episodes
  content.querySelectorAll('.broll-file-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      st.episodes.splice(parseInt(btn.dataset.index), 1);
      Hub._editorRenderStep('media');
    });
  });

  // Nav
  content.querySelector('#editorPrevStep')?.addEventListener('click', () => { st.currentStep = 'voiceover'; Hub.renderEditor(); });
  content.querySelector('#editorNextStepMedia')?.addEventListener('click', () => { st.currentStep = 'clips'; Hub.renderEditor(); });
};

Hub._editorAddEpisodes = async function (filePaths) {
  const st = Hub.state.editor;
  for (const fp of filePaths) {
    if (st.episodes.some((ep) => ep.path === fp)) continue;
    const info = await window.api.getMediaInfo(fp);
    const parsed = Hub._editorParseEpisodeLabel(info.name);
    st.episodes.push({
      path: info.path,
      name: info.name,
      duration: info.duration || 0,
      ...parsed,
    });
  }
  if (!st.outputFolder && filePaths.length > 0) {
    st.outputFolder = await window.api.getFileDir(filePaths[0]);
  }
  Hub._editorRenderStep('media');
};

Hub._editorParseEpisodeLabel = function (filename) {
  const match = filename.match(/[Ss](\d+)[Ee](\d+)/);
  if (match) {
    return {
      label: `S${match[1].padStart(2, '0')}E${match[2].padStart(2, '0')}`,
      seasonNum: parseInt(match[1]),
      episodeNum: parseInt(match[2]),
    };
  }
  return { label: filename.replace(/\.[^.]+$/, ''), seasonNum: 0, episodeNum: 0 };
};

// ═══════════════════════════════════════════
//  STEP 3: Clip Generation
// ═══════════════════════════════════════════

Hub._editorRenderClips = function () {
  const content = document.getElementById('editorContent');
  const st = Hub.state.editor;

  if (!st.voiceover) {
    content.innerHTML = '<div class="editor-empty"><h3>Importa um voiceover primeiro</h3><p>Volta ao passo 1 para importar um ficheiro de áudio.</p></div>';
    return;
  }
  if (st.episodes.length === 0) {
    content.innerHTML = '<div class="editor-empty"><h3>Importa episódios primeiro</h3><p>Volta ao passo 2 para adicionar vídeos.</p></div>';
    return;
  }

  content.innerHTML = `
    <div class="editor-clips-container">
      <div class="editor-clips-header">
        <div>
          <h3>${st.clips.length > 0 ? `${st.clips.length} Clips Gerados` : 'Gerar Clips'}</h3>
          <p class="editor-clips-info">
            Voiceover: ${Hub.fmtDur(st.voiceover.duration)} · ${st.episodes.length} episódios ·
            Clips de ${st.clipDurationMin}–${st.clipDurationMax}s
            ${st.transcription ? ' · Transcrição disponível (match por episódio ativo)' : ''}
          </p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" id="editorAssignWithAiBtn" ${st.isGeneratingClips ? 'disabled' : ''} title="Usa a base de dados de séries para atribuir clips com IA">
            🎯 Atribuir com IA
          </button>
          <button class="btn btn-primary" id="editorGenerateClipsBtn" ${st.isGeneratingClips ? 'disabled' : ''}>
            ${st.isGeneratingClips ? '<span class="spinner"></span> A gerar...' : '🎬 Gerar Clips'}
          </button>
        </div>
      </div>
      ${st.clips.length > 0 ? `
        <div class="editor-clip-list">
          ${st.clips.map((c, i) => `
            <div class="editor-clip-card" data-index="${i}">
              <span class="clip-index">${i + 1}</span>
              <span class="clip-episode badge badge-purple">${c.episodeLabel}</span>
              <span class="clip-time">${c.startTime.toFixed(1)}s → ${(c.startTime + c.duration).toFixed(1)}s</span>
              <span class="clip-duration">${c.duration.toFixed(1)}s</span>
              <span class="clip-timeline">@ ${Hub.fmtDur(c.timelineStart)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="editor-clips-footer">
        <button class="btn btn-secondary" id="editorPrevStepClips">← Media</button>
        <button class="btn btn-primary" id="editorNextStepClips" ${st.clips.length === 0 ? 'disabled' : ''}>Overlays →</button>
      </div>
    </div>
  `;

  content.querySelector('#editorGenerateClipsBtn').addEventListener('click', () => Hub._editorGenerateClips());
  content.querySelector('#editorAssignWithAiBtn').addEventListener('click', () => Hub._editorOpenSeriesAssignModal());
  content.querySelector('#editorPrevStepClips').addEventListener('click', () => { st.currentStep = 'media'; Hub.renderEditor(); });
  content.querySelector('#editorNextStepClips').addEventListener('click', () => { st.currentStep = 'overlays'; Hub.renderEditor(); });
};

Hub._editorGenerateClips = async function () {
  const st = Hub.state.editor;
  if (st.isGeneratingClips) return;

  st.isGeneratingClips = true;
  Hub._editorRenderStep('clips');

  const genBar = document.getElementById('genBar');
  const barFill = document.getElementById('genBarFill');
  const barPhase = document.getElementById('genBarPhase');
  const barPercent = document.getElementById('genBarPercent');
  genBar.classList.add('visible');
  genBar.classList.remove('done');
  barPhase.textContent = 'A planear clips...';
  barFill.style.width = '0%';
  barPercent.textContent = '0%';

  window.api.onEditorClipProgress((data) => {
    barFill.style.width = `${data.percent}%`;
    barPercent.textContent = `${data.percent}%`;
    barPhase.textContent = `A planear... ${data.clipCount || 0} clips`;
  });

  const result = await window.api.editorGenerateClips({
    voiceoverDuration: st.voiceover.duration,
    episodes: st.episodes,
    clipDurationMin: st.clipDurationMin,
    clipDurationMax: st.clipDurationMax,
    skipStart: st.skipStart,
    skipEnd: st.skipEnd,
    transcription: st.transcription,
  });

  st.isGeneratingClips = false;

  if (result.success) {
    st.clips = result.clips;
    genBar.classList.add('done');
    barPhase.textContent = `${result.clips.length} clips gerados!`;
    barFill.style.width = '100%';
    barPercent.textContent = '100%';
    setTimeout(() => genBar.classList.remove('visible', 'done'), 3000);
  } else {
    Hub.showToast(result.error, 'error');
    genBar.classList.remove('visible');
  }

  Hub._editorRenderStep('clips');
};

// ═══════════════════════════════════════════
//  STEP 4: Overlay Detection & Editing
// ═══════════════════════════════════════════

Hub._editorRenderOverlays = function () {
  const content = document.getElementById('editorContent');
  const st = Hub.state.editor;

  const typeLabels = {
    episode: 'Episódio', date: 'Data', rating: 'Rating', character: 'Personagem',
    location: 'Local', statistic: 'Estatística', impact: 'Impacto',
  };

  content.innerHTML = `
    <div class="editor-overlays-container">
      <div class="editor-overlays-header">
        <div>
          <h3>${st.overlays.length} Overlay${st.overlays.length !== 1 ? 's' : ''}</h3>
          <span class="editor-overlays-hint">Clica num overlay para ver preview</span>
        </div>
        <div class="editor-overlays-actions">
          <button class="btn btn-primary btn-small" id="editorDetectOverlaysBtn"
            ${!st.transcription || st.isDetectingOverlays ? 'disabled' : ''}>
            ${st.isDetectingOverlays ? '<span class="spinner"></span> A detetar...' : '🤖 Detetar com Claude'}
          </button>
          <button class="btn btn-secondary btn-small" id="editorAddOverlayBtn">
            ${Hub.icons.plus} Adicionar Manual
          </button>
        </div>
      </div>
      ${!st.transcription ? '<div class="editor-overlay-warning">⚠️ Transcrição necessária para deteção automática. Volta ao passo 1.</div>' : ''}
      <div class="editor-overlays-body">
        <div class="editor-overlay-list" id="editorOverlayList">
          ${st.overlays.map((o, i) => `
            <div class="editor-overlay-card" data-index="${i}">
              <span class="overlay-type-badge overlay-type-${o.type}">${typeLabels[o.type] || o.type}</span>
              <span class="overlay-text-display">${o.text}</span>
              <span class="overlay-time">${o.startTime.toFixed(1)}s · ${(o.duration || 3).toFixed(1)}s</span>
              ${o.isCountingNumber ? '<span class="overlay-counting-badge">#</span>' : ''}
              <button class="btn-icon overlay-edit-btn" data-index="${i}" title="Editar">${Hub.icons.settings}</button>
              <button class="btn-icon overlay-delete-btn" data-index="${i}" title="Remover">${Hub.icons.x}</button>
            </div>
          `).join('')}
        </div>
        <div class="editor-overlay-preview" id="editorOverlayPreview">
          <div class="overlay-preview-screen" id="overlayPreviewScreen">
            <span class="overlay-preview-placeholder">Seleciona um overlay</span>
          </div>
          <div class="overlay-preview-controls" id="overlayPreviewControls" style="display:none;">
            <div class="form-group">
              <label class="form-label">Animação</label>
              <select class="input input-small" id="previewAnimation">
                <option value="auto">Auto (rotação)</option>
                <option value="slide-up">Slide Up ↑</option>
                <option value="slide-down">Slide Down ↓</option>
                <option value="fade-zoom">Fade Zoom</option>
                <option value="slide-left">Slide Left ←</option>
                <option value="slide-right">Slide Right →</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Cor</label>
              <input type="color" class="input input-small" id="previewColor" value="#ffffff">
            </div>
            <div class="form-group">
              <label class="form-label">Tamanho <span id="previewFontSizeVal">72</span>px</label>
              <input type="range" min="36" max="120" value="72" id="previewFontSize" class="input-range">
            </div>
            <div class="form-group">
              <label class="form-label">Duração</label>
              <input type="number" class="input input-small" id="previewDuration" min="2" max="6" step="0.5" value="3">
            </div>
            <div class="form-group" style="grid-column:1/-1;">
              <label class="form-label">Texto</label>
              <input class="input" id="previewText" value="">
            </div>
            <button class="btn btn-secondary btn-small" id="previewReplay" style="grid-column:1/-1;">▶ Replay</button>
          </div>
        </div>
      </div>
      <!-- ── Entity Image Overlays ── -->
      <div class="editor-entities-section">
        <div class="editor-entities-header">
          <div>
            <h4>Entidades &amp; Imagens</h4>
            <span class="editor-entities-hint">Quando uma entidade é mencionada, aparece uma imagem aleatória</span>
          </div>
          <div class="editor-entities-actions">
            <button class="btn btn-secondary btn-small" id="editorDetectEntitiesBtn"
              ${!st.transcription || st.entities.length === 0 ? 'disabled' : ''}>
              🔍 Detetar no Áudio
            </button>
            <button class="btn btn-secondary btn-small" id="editorAddEntityBtn">+ Entidade</button>
          </div>
        </div>
        <div class="entity-list" id="entityList">
          ${st.entities.length === 0 ? '<div class="entity-empty">Sem entidades. Adiciona personagens, locais, etc.</div>' : ''}
          ${st.entities.map((e, i) => `
            <div class="entity-card" data-index="${i}">
              <div class="entity-card-info">
                <span class="entity-name">${e.name}</span>
                ${e.aliases && e.aliases.length > 0 ? `<span class="entity-aliases">${e.aliases.join(', ')}</span>` : ''}
                <span class="entity-img-count">${e.images ? e.images.length : 0} imagens</span>
              </div>
              <div class="entity-card-btns">
                <button class="btn-icon entity-edit-btn" data-index="${i}" title="Editar">${Hub.icons.settings}</button>
                <button class="btn-icon entity-delete-btn" data-index="${i}" title="Remover">${Hub.icons.x}</button>
              </div>
            </div>
          `).join('')}
        </div>
        ${st.imageEvents.length > 0 ? `
          <div class="entity-events-summary">
            <span>🎯 ${st.imageEvents.length} eventos detetados</span>
            <button class="btn btn-danger btn-small" id="editorClearImageEvents">Limpar</button>
          </div>
        ` : ''}
      </div>

      <div class="editor-overlays-footer">
        <button class="btn btn-secondary" id="editorPrevStepOv">← Clips</button>
        <button class="btn btn-primary" id="editorNextStepOv">Timeline →</button>
      </div>
    </div>
  `;

  content.querySelector('#editorDetectOverlaysBtn')?.addEventListener('click', () => Hub._editorDetectOverlays());
  content.querySelector('#editorAddOverlayBtn')?.addEventListener('click', () => Hub._editorAddOverlayManual());

  content.querySelectorAll('.overlay-delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      st.overlays.splice(parseInt(btn.dataset.index), 1);
      Hub._editorRenderStep('overlays');
    });
  });

  content.querySelectorAll('.overlay-edit-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Hub._editorEditOverlay(parseInt(btn.dataset.index));
    });
  });

  // Click on overlay card → show preview
  content.querySelectorAll('.editor-overlay-card').forEach((card) => {
    card.addEventListener('click', () => {
      content.querySelectorAll('.editor-overlay-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      Hub._editorShowOverlayPreview(parseInt(card.dataset.index));
    });
  });

  content.querySelector('#editorPrevStepOv').addEventListener('click', () => { st.currentStep = 'clips'; Hub.renderEditor(); });
  content.querySelector('#editorNextStepOv').addEventListener('click', () => { st.currentStep = 'timeline'; Hub.renderEditor(); });

  // ── Entity bindings ──
  // Load entities into state on first render
  if (!st.entities || st.entities.length === 0) {
    window.api.editorEntitiesGet().then((entities) => {
      st.entities = entities || [];
      if (entities && entities.length > 0) Hub._editorRenderStep('overlays');
    });
  }

  content.querySelector('#editorAddEntityBtn')?.addEventListener('click', () => Hub._editorOpenEntityModal(null));

  content.querySelectorAll('.entity-edit-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Hub._editorOpenEntityModal(parseInt(btn.dataset.index));
    });
  });

  content.querySelectorAll('.entity-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const entity = st.entities[idx];
      if (!entity) return;
      await window.api.editorEntityDelete(entity.id);
      st.entities.splice(idx, 1);
      Hub._editorRenderStep('overlays');
    });
  });

  content.querySelector('#editorDetectEntitiesBtn')?.addEventListener('click', async () => {
    const result = await window.api.editorDetectEntityEvents({
      transcription: st.transcription,
      entities: st.entities,
    });
    st.imageEvents = result;
    Hub.showToast(`${result.length} eventos de imagem detetados!`);
    Hub._editorRenderStep('overlays');
  });

  content.querySelector('#editorClearImageEvents')?.addEventListener('click', () => {
    st.imageEvents = [];
    Hub._editorRenderStep('overlays');
  });
};

// ── Overlay Preview ──

Hub._editorShowOverlayPreview = function (index) {
  const st = Hub.state.editor;
  const overlay = st.overlays[index];
  if (!overlay) return;

  const screen = document.getElementById('overlayPreviewScreen');
  const controls = document.getElementById('overlayPreviewControls');
  if (!screen || !controls) return;

  controls.style.display = '';
  const textColor = overlay.color || '#ffffff';
  const fontSize = Math.round((overlay.fontSize || 72) * 0.45);
  const dur = overlay.duration || 3;
  const animClass = overlay.animation === 'auto' ? 'fade-zoom' : (overlay.animation || 'fade-zoom');

  function renderPreview() {
    const c = overlay.color || '#ffffff';
    const fs = Math.round((overlay.fontSize || 72) * 0.45);
    const ac = overlay.animation === 'auto' ? 'fade-zoom' : (overlay.animation || 'fade-zoom');
    const d = overlay.duration || 3;

    if (overlay.isCountingNumber && overlay.numberValue != null) {
      screen.innerHTML = `
        <div class="overlay-preview-text preview-anim-${ac}" style="color:${c};font-size:${fs + 10}px;animation-duration:${d}s;">
          ${overlay.numberPrefix || ''}${overlay.numberValue}${overlay.numberUnit ? ' ' + overlay.numberUnit : ''}
        </div>
        ${overlay.numberLabel ? `<div class="overlay-preview-label preview-anim-${ac}" style="color:${c};opacity:0.7;animation-duration:${d}s;">${overlay.numberLabel}</div>` : ''}
      `;
    } else {
      screen.innerHTML = `
        <div class="overlay-preview-text preview-anim-${ac}" style="color:${c};font-size:${fs}px;animation-duration:${d}s;">
          ${overlay.text}
        </div>
      `;
    }
  }

  renderPreview();

  // Populate controls
  const animSel = document.getElementById('previewAnimation');
  const colorIn = document.getElementById('previewColor');
  const fontSlider = document.getElementById('previewFontSize');
  const fontVal = document.getElementById('previewFontSizeVal');
  const durIn = document.getElementById('previewDuration');
  const textIn = document.getElementById('previewText');
  const replayBtn = document.getElementById('previewReplay');

  animSel.value = overlay.animation || 'auto';
  colorIn.value = overlay.color || '#ffffff';
  fontSlider.value = overlay.fontSize || 72;
  fontVal.textContent = overlay.fontSize || 72;
  durIn.value = overlay.duration || 3;
  textIn.value = overlay.text;

  // Remove old listeners by cloning
  const newAnimSel = animSel.cloneNode(true); animSel.parentNode.replaceChild(newAnimSel, animSel);
  const newColorIn = colorIn.cloneNode(true); colorIn.parentNode.replaceChild(newColorIn, colorIn);
  const newFontSlider = fontSlider.cloneNode(true); fontSlider.parentNode.replaceChild(newFontSlider, fontSlider);
  const newDurIn = durIn.cloneNode(true); durIn.parentNode.replaceChild(newDurIn, durIn);
  const newTextIn = textIn.cloneNode(true); textIn.parentNode.replaceChild(newTextIn, textIn);
  const newReplayBtn = replayBtn.cloneNode(true); replayBtn.parentNode.replaceChild(newReplayBtn, replayBtn);

  newAnimSel.addEventListener('change', () => { overlay.animation = newAnimSel.value; renderPreview(); });
  newColorIn.addEventListener('input', () => { overlay.color = newColorIn.value; renderPreview(); });
  newFontSlider.addEventListener('input', () => {
    overlay.fontSize = parseInt(newFontSlider.value);
    document.getElementById('previewFontSizeVal').textContent = newFontSlider.value;
    renderPreview();
  });
  newDurIn.addEventListener('change', () => { overlay.duration = parseFloat(newDurIn.value) || 3; renderPreview(); });
  newTextIn.addEventListener('change', () => {
    overlay.text = newTextIn.value;
    // Update the card text too
    const cards = document.querySelectorAll('.editor-overlay-card');
    if (cards[index]) cards[index].querySelector('.overlay-text-display').textContent = newTextIn.value;
    renderPreview();
  });
  newReplayBtn.addEventListener('click', renderPreview);
};

Hub._editorDetectOverlays = async function () {
  const st = Hub.state.editor;
  if (!st.transcription || st.isDetectingOverlays) return;

  st.isDetectingOverlays = true;
  Hub._editorRenderStep('overlays');

  const genBar = document.getElementById('genBar');
  const barFill = document.getElementById('genBarFill');
  const barPhase = document.getElementById('genBarPhase');
  const barPercent = document.getElementById('genBarPercent');
  genBar.classList.add('visible');
  genBar.classList.remove('done');
  barPhase.textContent = 'Claude a analisar...';
  barFill.style.width = '5%';
  barPercent.textContent = '5%';

  // Listen for chunk progress
  window.api.onEditorOverlayProgress((data) => {
    if (data.phase === 'analyzing' && data.detail) {
      barPhase.textContent = data.detail;
    }
    if (data.percent) {
      barFill.style.width = `${data.percent}%`;
      barPercent.textContent = `${data.percent}%`;
    }
  });

  const result = await window.api.editorDetectOverlays({ transcription: st.transcription, channel: Hub.state.activeChannel });

  st.isDetectingOverlays = false;

  if (result.success) {
    st.overlays = result.overlays;
    genBar.classList.add('done');
    const errNote = result.errors > 0 ? ` (${result.errors}/${result.numChunks} segmentos falharam)` : '';
    barPhase.textContent = `${result.overlays.length} overlays detetados!${errNote}`;
    barFill.style.width = '100%';
    barPercent.textContent = '100%';
    if (result.errors > 0) Hub.showToast(`${result.errors} segmentos falharam — poderá haver gaps`, 'error');
    setTimeout(() => genBar.classList.remove('visible', 'done'), 4000);
  } else {
    Hub.showToast(result.error, 'error');
    // Keep error visible in the progress bar area
    barPhase.textContent = result.error;
    barPhase.style.whiteSpace = 'pre-wrap';
    barPhase.style.fontSize = '11px';
    genBar.classList.add('done');
    barFill.style.width = '0%';
    barPercent.textContent = '✗';
  }

  Hub._editorRenderStep('overlays');
};

Hub._editorAddOverlayManual = function () {
  const st = Hub.state.editor;
  const modal = document.getElementById('modalContent');
  const backdrop = document.getElementById('modalBackdrop');

  modal.innerHTML = `
    <div class="modal-header"><h3>Adicionar Overlay</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <select class="input" id="overlayType">
          <option value="episode">Episódio</option>
          <option value="date">Data</option>
          <option value="rating">Rating</option>
          <option value="character">Personagem</option>
          <option value="location">Local</option>
          <option value="statistic">Estatística</option>
          <option value="impact">Impacto</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Texto</label>
        <input class="input" id="overlayText" placeholder="Texto do overlay...">
      </div>
      <div class="form-group" style="display:flex;gap:8px;">
        <div style="flex:1;">
          <label class="form-label">Início (seg)</label>
          <input class="input" type="number" id="overlayStart" value="0" step="0.1" min="0">
        </div>
        <div style="flex:1;">
          <label class="form-label">Duração (seg)</label>
          <input class="input" type="number" id="overlayDuration" value="3" step="0.5" min="2" max="6">
        </div>
      </div>
      <div class="form-group" style="display:flex;gap:8px;">
        <div style="flex:1;">
          <label class="form-label">Animação</label>
          <select class="input" id="overlayAnimation">
            <option value="auto">Auto (rotação)</option>
            <option value="slide-up">Slide Up ↑</option>
            <option value="slide-down">Slide Down ↓</option>
            <option value="fade-zoom">Fade Zoom</option>
            <option value="slide-left">Slide Left ←</option>
            <option value="slide-right">Slide Right →</option>
          </select>
        </div>
        <div style="flex:1;">
          <label class="form-label">Cor</label>
          <input type="color" class="input" id="overlayColor" value="#ffffff">
        </div>
      </div>
      <div class="form-group" id="overlayNumberSection" style="display:none;">
        <label class="form-label" style="margin-bottom:6px;">Contagem animada</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
          <input type="checkbox" id="overlayIsCountingNumber"> Ativar contagem de 0 até valor
        </label>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <div style="flex:1;"><label class="form-label">Valor</label><input class="input" type="number" id="overlayNumberValue" step="0.1"></div>
          <div style="flex:1;"><label class="form-label">Label</label><input class="input" id="overlayNumberLabel" placeholder="ex: IMDB RATING"></div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="overlayCancel">Cancelar</button>
      <button class="btn btn-primary" id="overlayConfirm">Adicionar</button>
    </div>
  `;

  // Show number section for rating/statistic
  modal.querySelector('#overlayType').addEventListener('change', (e) => {
    modal.querySelector('#overlayNumberSection').style.display =
      (e.target.value === 'rating' || e.target.value === 'statistic') ? 'block' : 'none';
  });

  backdrop.classList.add('visible');
  modal.querySelector('#overlayCancel').addEventListener('click', () => backdrop.classList.remove('visible'));
  modal.querySelector('#overlayConfirm').addEventListener('click', () => {
    const text = modal.querySelector('#overlayText').value.trim();
    if (!text) return;
    st.overlays.push({
      id: Date.now().toString(36),
      type: modal.querySelector('#overlayType').value,
      text,
      startTime: parseFloat(modal.querySelector('#overlayStart').value) || 0,
      duration: parseFloat(modal.querySelector('#overlayDuration').value) || 3,
      animation: modal.querySelector('#overlayAnimation').value,
      color: modal.querySelector('#overlayColor').value,
      fontSize: 72,
      isCountingNumber: modal.querySelector('#overlayIsCountingNumber')?.checked || false,
      numberValue: parseFloat(modal.querySelector('#overlayNumberValue')?.value) || null,
      numberLabel: modal.querySelector('#overlayNumberLabel')?.value || null,
      numberPrefix: null,
      numberUnit: null,
    });
    st.overlays.sort((a, b) => a.startTime - b.startTime);
    backdrop.classList.remove('visible');
    Hub._editorRenderStep('overlays');
  });
};

Hub._editorEditOverlay = function (index) {
  const st = Hub.state.editor;
  const o = st.overlays[index];
  if (!o) return;

  const modal = document.getElementById('modalContent');
  const backdrop = document.getElementById('modalBackdrop');

  modal.innerHTML = `
    <div class="modal-header"><h3>Editar Overlay</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <select class="input" id="overlayType">
          ${['episode', 'date', 'rating', 'character', 'location', 'statistic', 'impact'].map((t) =>
    `<option value="${t}" ${o.type === t ? 'selected' : ''}>${t}</option>`,
  ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Texto</label>
        <input class="input" id="overlayText" value="${o.text}">
      </div>
      <div class="form-group" style="display:flex;gap:8px;">
        <div style="flex:1;">
          <label class="form-label">Início (seg)</label>
          <input class="input" type="number" id="overlayStart" value="${o.startTime}" step="0.1">
        </div>
        <div style="flex:1;">
          <label class="form-label">Duração (seg)</label>
          <input class="input" type="number" id="overlayDuration" value="${o.duration || 3}" step="0.5" min="2" max="6">
        </div>
      </div>
      <div class="form-group" style="display:flex;gap:8px;">
        <div style="flex:1;">
          <label class="form-label">Animação</label>
          <select class="input" id="overlayAnimation">
            ${['auto', 'slide-up', 'slide-down', 'fade-zoom', 'slide-left', 'slide-right'].map((a) =>
    `<option value="${a}" ${(o.animation || 'auto') === a ? 'selected' : ''}>${a === 'auto' ? 'Auto (rotação)' : a}</option>`,
  ).join('')}
          </select>
        </div>
        <div style="flex:1;">
          <label class="form-label">Cor</label>
          <input type="color" class="input" id="overlayColor" value="${o.color || '#ffffff'}">
        </div>
      </div>
      <div class="form-group" id="overlayNumberSection" style="display:${o.type === 'rating' || o.type === 'statistic' ? 'block' : 'none'};">
        <label class="form-label" style="margin-bottom:6px;">Contagem animada</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
          <input type="checkbox" id="overlayIsCountingNumber" ${o.isCountingNumber ? 'checked' : ''}> Ativar contagem
        </label>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <div style="flex:1;"><label class="form-label">Valor</label><input class="input" type="number" id="overlayNumberValue" step="0.1" value="${o.numberValue || ''}"></div>
          <div style="flex:1;"><label class="form-label">Label</label><input class="input" id="overlayNumberLabel" value="${o.numberLabel || ''}"></div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="overlayCancel">Cancelar</button>
      <button class="btn btn-primary" id="overlayConfirm">Guardar</button>
    </div>
  `;

  modal.querySelector('#overlayType').addEventListener('change', (e) => {
    modal.querySelector('#overlayNumberSection').style.display =
      (e.target.value === 'rating' || e.target.value === 'statistic') ? 'block' : 'none';
  });

  backdrop.classList.add('visible');
  modal.querySelector('#overlayCancel').addEventListener('click', () => backdrop.classList.remove('visible'));
  modal.querySelector('#overlayConfirm').addEventListener('click', () => {
    o.type = modal.querySelector('#overlayType').value;
    o.text = modal.querySelector('#overlayText').value.trim();
    o.startTime = parseFloat(modal.querySelector('#overlayStart').value) || 0;
    o.duration = parseFloat(modal.querySelector('#overlayDuration').value) || 3;
    o.animation = modal.querySelector('#overlayAnimation').value;
    o.color = modal.querySelector('#overlayColor').value;
    o.isCountingNumber = modal.querySelector('#overlayIsCountingNumber')?.checked || false;
    o.numberValue = parseFloat(modal.querySelector('#overlayNumberValue')?.value) || null;
    o.numberLabel = modal.querySelector('#overlayNumberLabel')?.value || null;
    st.overlays.sort((a, b) => a.startTime - b.startTime);
    backdrop.classList.remove('visible');
    Hub._editorRenderStep('overlays');
  });
};

// ── Entity Modal ──

Hub._editorOpenEntityModal = function (editIndex) {
  const st = Hub.state.editor;
  const existing = editIndex != null ? st.entities[editIndex] : null;
  const modal = document.getElementById('modalContent');
  const backdrop = document.getElementById('modalBackdrop');

  const animOptions = ['slide-up', 'slide-down', 'slide-left', 'slide-right'];

  modal.innerHTML = `
    <div class="modal-header"><h3>${existing ? 'Editar Entidade' : 'Nova Entidade'}</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Nome</label>
        <input class="input" id="entityName" placeholder="ex: Dipper Pines" value="${existing ? existing.name : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Aliases (separados por vírgula)</label>
        <input class="input" id="entityAliases" placeholder="ex: dipper, dipper pines"
          value="${existing && existing.aliases ? existing.aliases.join(', ') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Animação da imagem</label>
        <select class="input" id="entityAnimation">
          ${animOptions.map((a) => `<option value="${a}" ${(existing?.animation || 'slide-up') === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Imagens (${existing ? existing.images.length : 0})</label>
        <div class="entity-images-preview" id="entityImagesPreview">
          ${existing ? existing.images.map((p) => `<div class="entity-img-thumb" title="${p}">${p.split(/[/\\]/).pop()}</div>`).join('') : ''}
        </div>
        <button class="btn btn-secondary btn-small" id="entityAddImagesBtn" style="margin-top:6px;">+ Adicionar Imagens</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="entityModalCancel">Cancelar</button>
      <button class="btn btn-primary" id="entityModalSave">Guardar</button>
    </div>
  `;

  backdrop.classList.add('visible');

  let currentImages = existing ? [...existing.images] : [];

  const previewEl = modal.querySelector('#entityImagesPreview');
  const refreshPreview = () => {
    previewEl.innerHTML = currentImages.map((p) => `<div class="entity-img-thumb" title="${p}">${p.split(/[/\\]/).pop()}</div>`).join('');
    previewEl.querySelectorAll('.entity-img-thumb').forEach((thumb, idx) => {
      thumb.addEventListener('click', () => {
        currentImages.splice(idx, 1);
        refreshPreview();
      });
    });
  };
  refreshPreview();

  modal.querySelector('#entityAddImagesBtn').addEventListener('click', async () => {
    const paths = await window.api.editorEntitySelectImages();
    if (paths && paths.length > 0) {
      currentImages.push(...paths.filter((p) => !currentImages.includes(p)));
      refreshPreview();
    }
  });

  modal.querySelector('#entityModalCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  modal.querySelector('#entityModalSave').addEventListener('click', async () => {
    const name = modal.querySelector('#entityName').value.trim();
    if (!name) { Hub.showToast('Nome obrigatório', 'error'); return; }

    const aliasesRaw = modal.querySelector('#entityAliases').value;
    const aliases = aliasesRaw.split(',').map((a) => a.trim()).filter(Boolean);
    const animation = modal.querySelector('#entityAnimation').value;

    const entity = {
      id: existing ? existing.id : `ent_${Date.now()}`,
      name,
      aliases,
      animation,
      images: currentImages,
    };

    await window.api.editorEntitySave(entity);

    if (existing) st.entities[editIndex] = entity;
    else st.entities.push(entity);

    backdrop.classList.remove('visible');
    Hub._editorRenderStep('overlays');
  });
};

// ═══════════════════════════════════════════
//  STEP 5: Timeline Preview
// ═══════════════════════════════════════════

Hub._editorRenderTimeline = function () {
  const content = document.getElementById('editorContent');
  const st = Hub.state.editor;

  if (!st.voiceover) {
    content.innerHTML = '<div class="editor-empty"><h3>Importa um voiceover primeiro</h3></div>';
    return;
  }

  const dur = st.voiceover.duration;

  content.innerHTML = `
    <div class="editor-timeline-container">
      <h3>Timeline</h3>
      <p class="editor-timeline-info">Duração: ${Hub.fmtDur(dur)} · ${st.clips.length} clips · ${st.overlays.length} overlays · ${(st.imageEvents || []).length} imagens</p>

      <div class="timeline-wrapper">
        <div class="timeline-label">Áudio</div>
        <div class="timeline-track timeline-waveform">
          <canvas id="waveformCanvas" height="60"></canvas>
        </div>
      </div>

      <div class="timeline-wrapper">
        <div class="timeline-label">Clips</div>
        <div class="timeline-track timeline-clips" id="timelineClips">
          ${st.clips.map((c) => {
    const left = (c.timelineStart / dur) * 100;
    const width = Math.max(0.3, (c.duration / dur) * 100);
    return `<div class="timeline-clip tl-item" data-id="${c.id}" data-kind="clip" style="left:${left}%;width:${width}%;" title="${c.sourceName} @ ${c.startTime.toFixed(1)}s">
              <span>${c.episodeLabel}</span>
              <div class="tl-resize-handle"></div>
            </div>`;
  }).join('')}
        </div>
      </div>

      <div class="timeline-wrapper">
        <div class="timeline-label">Overlays</div>
        <div class="timeline-track timeline-overlays" id="timelineOverlays">
          ${st.overlays.map((o) => {
    const left = (o.startTime / dur) * 100;
    const width = Math.max(0.5, ((o.duration || 3) / dur) * 100);
    return `<div class="timeline-overlay timeline-overlay-${o.type} tl-item" data-id="${o.id}" data-kind="overlay" style="left:${left}%;width:${width}%;" title="${o.text}">
              <span>${o.text}</span>
              <div class="tl-resize-handle"></div>
            </div>`;
  }).join('')}
        </div>
      </div>

      ${(st.imageEvents || []).length > 0 ? `
      <div class="timeline-wrapper">
        <div class="timeline-label">Imagens</div>
        <div class="timeline-track timeline-images" id="timelineImages">
          ${(st.imageEvents || []).map((ev) => {
    const left = (ev.startTime / dur) * 100;
    const width = Math.max(0.5, ((ev.duration || 5) / dur) * 100);
    return `<div class="timeline-image-ev tl-item" data-id="${ev.id}" data-kind="image" style="left:${left}%;width:${width}%;" title="${ev.entityName} @ ${Hub.fmtDur(ev.startTime)}">
              <span>${ev.entityName}</span>
            </div>`;
  }).join('')}
        </div>
      </div>
      ` : ''}

      <div id="tlSelectionPanel"></div>

      <div class="editor-timeline-footer">
        <button class="btn btn-secondary" id="editorPrevStepTl">← Overlays</button>
        <button class="btn btn-primary" id="editorNextStepTl">Exportar →</button>
      </div>
    </div>
  `;

  Hub._editorLoadWaveform();

  content.querySelector('#editorPrevStepTl').addEventListener('click', () => { st.currentStep = 'overlays'; Hub.renderEditor(); });
  content.querySelector('#editorNextStepTl').addEventListener('click', () => { st.currentStep = 'export'; Hub.renderEditor(); });

  Hub._editorInitTimelineDrag(content, dur);
};

// ── Timeline drag & selection ──
Hub._editorInitTimelineDrag = function (content, dur) {
  const st = Hub.state.editor;
  let dragging = null;

  content.querySelectorAll('.tl-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const isResize = e.target.classList.contains('tl-resize-handle');
      const track = el.parentElement;
      const trackW = track.clientWidth;
      const rect = el.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();

      content.querySelectorAll('.tl-item.selected').forEach((s) => s.classList.remove('selected'));
      el.classList.add('selected');
      Hub._editorShowSelectionPanel(el.dataset.kind, el.dataset.id);

      dragging = {
        el, kind: el.dataset.kind, id: el.dataset.id,
        mode: isResize ? 'resize' : 'move',
        startX: e.clientX,
        origLeftPx: rect.left - trackRect.left,
        origWidthPx: rect.width,
        trackW,
      };
    });
  });

  content.querySelectorAll('.timeline-track').forEach((track) => {
    track.addEventListener('mousedown', (e) => {
      if (e.target === track) {
        content.querySelectorAll('.tl-item.selected').forEach((s) => s.classList.remove('selected'));
        const panel = document.getElementById('tlSelectionPanel');
        if (panel) panel.innerHTML = '';
      }
    });
  });

  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const { el, mode, origLeftPx, origWidthPx, trackW } = dragging;

    if (mode === 'move') {
      const newLeftPx = Math.max(0, Math.min(trackW - origWidthPx, origLeftPx + dx));
      el.style.left = (newLeftPx / trackW * 100) + '%';
    } else {
      const newWidthPx = Math.max(10, origWidthPx + dx);
      el.style.width = (newWidthPx / trackW * 100) + '%';
    }
  };

  const onMouseUp = () => {
    if (!dragging) return;
    const { el, kind, id, mode } = dragging;

    const newLeftPct = parseFloat(el.style.left) / 100;
    const newWidthPct = parseFloat(el.style.width) / 100;
    const newStart = newLeftPct * dur;
    const newDuration = newWidthPct * dur;

    if (kind === 'clip') {
      const clip = st.clips.find((c) => c.id === id);
      if (clip) {
        if (mode === 'move') clip.timelineStart = Math.max(0, newStart);
        else clip.duration = Math.max(0.5, newDuration);
      }
    } else {
      const overlay = st.overlays.find((o) => o.id === id);
      if (overlay) {
        if (mode === 'move') overlay.startTime = Math.max(0, newStart);
        else overlay.duration = Math.max(0.5, newDuration);
      }
    }

    Hub._editorShowSelectionPanel(kind, id);
    dragging = null;
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
};

Hub._editorShowSelectionPanel = function (kind, id) {
  const st = Hub.state.editor;
  const panel = document.getElementById('tlSelectionPanel');
  if (!panel) return;

  if (kind === 'clip') {
    const clip = st.clips.find((c) => c.id === id);
    if (!clip) { panel.innerHTML = ''; return; }
    panel.innerHTML = `
      <div class="tl-selection-panel">
        <span class="badge badge-purple">${clip.episodeLabel}</span>
        <span class="tl-sel-info">${clip.sourceName}</span>
        <span class="tl-sel-detail">Posição: ${clip.timelineStart.toFixed(1)}s · Duração: ${clip.duration.toFixed(1)}s</span>
        <button class="btn-icon tl-sel-delete" title="Remover">${Hub.icons.trash}</button>
      </div>
    `;
  } else {
    const o = st.overlays.find((ov) => ov.id === id);
    if (!o) { panel.innerHTML = ''; return; }
    panel.innerHTML = `
      <div class="tl-selection-panel">
        <span class="badge badge-purple">${o.type}</span>
        <input class="input tl-sel-text" value="${o.text.replace(/"/g, '&quot;')}" data-id="${id}" style="flex:1;padding:4px 8px;font-size:12px;">
        <span class="tl-sel-detail">Posição: ${o.startTime.toFixed(1)}s · Duração: ${(o.duration || 3).toFixed(1)}s</span>
        <button class="btn-icon tl-sel-delete" title="Remover">${Hub.icons.trash}</button>
      </div>
    `;
    panel.querySelector('.tl-sel-text')?.addEventListener('change', (e) => {
      o.text = e.target.value;
      const tlEl = document.querySelector(`.tl-item[data-id="${id}"] span`);
      if (tlEl) tlEl.textContent = o.text;
    });
  }

  panel.querySelector('.tl-sel-delete')?.addEventListener('click', () => {
    if (kind === 'clip') st.clips = st.clips.filter((c) => c.id !== id);
    else st.overlays = st.overlays.filter((o) => o.id !== id);
    Hub._editorRenderTimeline();
  });
};

Hub._editorLoadWaveform = async function () {
  const st = Hub.state.editor;
  if (!st.voiceover) return;

  const canvas = document.getElementById('waveformCanvas');
  if (!canvas) return;

  if (st.voiceover.waveformData) {
    Hub._editorDrawWaveform(canvas, st.voiceover.waveformData);
    return;
  }

  try {
    const data = await window.api.editorGetWaveform(st.voiceover.path);
    st.voiceover.waveformData = data;
    Hub._editorDrawWaveform(canvas, data);
  } catch (_) {
    // Waveform failed, just leave blank
  }
};

Hub._editorDrawWaveform = function (canvas, data) {
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.clientWidth || 800;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(139, 92, 246, 0.3)';
  ctx.strokeStyle = 'rgba(139, 92, 246, 0.7)';
  ctx.lineWidth = 1;

  const step = data.length / w;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const idx = Math.floor(x * step);
    const val = data[idx] || 0;
    const barH = val * h * 0.9;
    ctx.fillRect(x, (h - barH) / 2, 1, barH);
  }
};

// ═══════════════════════════════════════════
//  STEP 6: Export
// ═══════════════════════════════════════════

Hub._editorRenderExport = function () {
  const content = document.getElementById('editorContent');
  const st = Hub.state.editor;

  const canExport = st.voiceover && st.clips.length > 0 && st.outputFolder;

  content.innerHTML = `
    <div class="editor-export-container">
      <h3>Exportar Vídeo</h3>

      <div class="editor-export-summary">
        <div class="export-stat">
          <span class="export-stat-label">Voiceover</span>
          <span class="export-stat-value">${st.voiceover ? Hub.fmtDur(st.voiceover.duration) : 'Nenhum'}</span>
        </div>
        <div class="export-stat">
          <span class="export-stat-label">Clips</span>
          <span class="export-stat-value">${st.clips.length}</span>
        </div>
        <div class="export-stat">
          <span class="export-stat-label">Overlays</span>
          <span class="export-stat-value">${st.overlays.length}</span>
        </div>
        <div class="export-stat">
          <span class="export-stat-label">Imagens</span>
          <span class="export-stat-value">${st.imageEvents.length}</span>
        </div>
      </div>

      <div class="editor-export-settings">
        <div class="form-group">
          <label class="form-label">Nome do ficheiro</label>
          <input class="input" id="editorExportFilename" value="${st.outputFilename}">
        </div>
        <div class="form-group">
          <label class="form-label">Resolução</label>
          <select class="input" id="editorExportRes">
            <option value="1920x1080" selected>1920×1080 (Full HD)</option>
            <option value="2560x1440">2560×1440 (2K)</option>
            <option value="3840x2160">3840×2160 (4K)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Bitrate</label>
          <select class="input" id="editorExportBitrate">
            <option value="12M">12 Mbps</option>
            <option value="16M">16 Mbps</option>
            <option value="18M" selected>18 Mbps</option>
            <option value="20M">20 Mbps</option>
            <option value="25M">25 Mbps</option>
          </select>
        </div>
      </div>

      <div class="editor-export-extra">
        <label class="export-toggle-label">
          <input type="checkbox" id="exportCaptionsToggle" ${st.captionsEnabled && st.transcription ? 'checked' : ''} ${!st.transcription ? 'disabled' : ''}>
          <span>Legendas por palavra ${!st.transcription ? '(requer transcrição)' : `(${st.transcription?.words?.length || 0} palavras)`}</span>
        </label>
      </div>

      <div class="editor-export-output">
        <label class="form-label">Pasta de saída</label>
        <div class="editor-output-row">
          <div class="broll-path-display" id="editorOutputPath">${st.outputFolder || 'Selecionar...'}</div>
          <button class="btn btn-secondary btn-small" id="editorSelectOutput">Escolher</button>
        </div>
      </div>

      <div class="editor-export-actions">
        <button class="btn btn-secondary" id="editorPrevStepEx">← Timeline</button>
        <button class="btn btn-primary btn-large" id="editorExportBtn" ${canExport ? '' : 'disabled'}>
          ${Hub.icons.play} Exportar Vídeo
        </button>
      </div>
    </div>
  `;

  content.querySelector('#editorSelectOutput').addEventListener('click', async () => {
    const folder = await window.api.selectOutputFolder();
    if (folder) {
      st.outputFolder = folder;
      content.querySelector('#editorOutputPath').textContent = folder;
      content.querySelector('#editorExportBtn').disabled = false;
    }
  });

  content.querySelector('#editorExportFilename').addEventListener('change', (e) => {
    st.outputFilename = e.target.value || 'editor_output.mp4';
  });

  content.querySelector('#exportCaptionsToggle')?.addEventListener('change', (e) => {
    st.captionsEnabled = e.target.checked;
  });

  content.querySelector('#editorPrevStepEx').addEventListener('click', () => { st.currentStep = 'timeline'; Hub.renderEditor(); });
  content.querySelector('#editorExportBtn').addEventListener('click', () => Hub._editorStartExport());
};

Hub._editorStartExport = async function () {
  const st = Hub.state.editor;
  if (st.isExporting || !st.voiceover || st.clips.length === 0) return;

  st.isExporting = true;

  // Use floating bar (non-blocking) for export
  const bar = document.getElementById('exportFloatBar');
  const efbTitle = document.getElementById('efbTitle');
  const efbDetail = document.getElementById('efbDetail');
  const efbFill = document.getElementById('efbFill');
  const efbPercent = document.getElementById('efbPercent');
  const efbCancel = document.getElementById('efbCancel');

  bar.classList.add('visible');
  bar.classList.remove('done', 'error');
  efbTitle.textContent = 'A exportar vídeo...';
  efbDetail.textContent = 'A preparar...';
  efbFill.style.width = '0%';
  efbPercent.textContent = '0%';

  const content = document.getElementById('editorContent');
  const res = content.querySelector('#editorExportRes')?.value || '1920x1080';
  const bitrate = content.querySelector('#editorExportBitrate')?.value || '18M';

  window.api.onEditorExportProgress((data) => {
    efbFill.style.width = `${data.percent}%`;
    efbPercent.textContent = `${data.percent}%`;
    if (data.phase === 'extracting') efbDetail.textContent = data.detail || 'A extrair clips...';
    else if (data.phase === 'concatenating') efbDetail.textContent = 'A juntar clips...';
    else if (data.phase === 'rendering') efbDetail.textContent = data.detail || 'A aplicar overlays...';
    else if (data.phase === 'merging') efbDetail.textContent = 'A juntar vídeo e áudio...';
    else if (data.phase === 'done') efbDetail.textContent = 'Concluído!';
  });

  const onCancel = () => window.api.editorCancelExport();
  efbCancel.addEventListener('click', onCancel, { once: true });

  const result = await window.api.editorExport({
    clips: st.clips,
    voiceover: st.voiceover,
    overlays: st.overlays,
    outputFolder: st.outputFolder,
    outputFilename: st.outputFilename,
    channel: Hub.state.activeChannel,
    captionsEnabled: st.captionsEnabled && !!st.transcription,
    imageEvents: st.imageEvents || [],
    transcription: st.transcription,
    settings: {
      exportResolution: res,
      exportBitrate: bitrate,
    },
  });

  st.isExporting = false;
  efbCancel.removeEventListener('click', onCancel);

  if (result.success) {
    bar.classList.add('done');
    efbTitle.textContent = 'Exportação concluída!';
    efbDetail.textContent = result.outputFile;
    efbFill.style.width = '100%';
    efbPercent.textContent = '100%';
    Hub.showToast('Vídeo exportado com sucesso!');
    // Auto-hide after 8 seconds
    setTimeout(() => bar.classList.remove('visible', 'done'), 8000);
    // Click to dismiss
    efbCancel.addEventListener('click', () => bar.classList.remove('visible', 'done'), { once: true });
  } else {
    bar.classList.add('error');
    efbTitle.textContent = 'Erro na exportação';
    efbDetail.textContent = result.error.slice(0, 200);
    efbPercent.textContent = '❌';
    Hub.showToast('Erro na exportação — ver detalhes', 'error');
    // Click X to dismiss error
    efbCancel.addEventListener('click', () => bar.classList.remove('visible', 'error'), { once: true });
  }
};

// ═══════════════════════════════════════════
//  Project Save/Load
// ═══════════════════════════════════════════

Hub._editorSave = async function () {
  const st = Hub.state.editor;

  let title = 'Editor Project';
  if (!st.projectId) {
    const input = prompt('Nome do projeto:');
    if (!input) return;
    title = input;
  }

  const projectData = {
    id: st.projectId || undefined,
    title,
    channel: Hub.state.activeChannel,
    voiceover: st.voiceover ? { path: st.voiceover.path, name: st.voiceover.name, duration: st.voiceover.duration } : null,
    transcription: st.transcription,
    episodes: st.episodes,
    clips: st.clips,
    overlays: st.overlays,
    imageEvents: st.imageEvents,
    captionsEnabled: st.captionsEnabled,
    settings: {
      clipDurationMin: st.clipDurationMin,
      clipDurationMax: st.clipDurationMax,
      skipStart: st.skipStart,
      skipEnd: st.skipEnd,
    },
    outputFolder: st.outputFolder,
    outputFilename: st.outputFilename,
  };

  const saved = await window.api.editorSaveProject(projectData);
  st.projectId = saved.id;
  Hub.showToast('Projeto guardado!');
};

Hub._editorOpenLoadModal = async function () {
  const projects = await window.api.editorGetProjects();
  const modal = document.getElementById('modalContent');
  const backdrop = document.getElementById('modalBackdrop');

  modal.innerHTML = `
    <div class="modal-header"><h3>Carregar Projeto</h3></div>
    <div class="modal-body">
      ${projects.length === 0 ? '<p style="color:var(--text-dim);">Nenhum projeto guardado.</p>' : `
        <div class="editor-project-list">
          ${projects.map((p) => `
            <div class="editor-project-item" data-id="${p.id}">
              <div class="editor-project-info">
                <strong>${p.title}</strong>
                <span class="editor-project-date">${Hub.fmtDate(p.updatedAt)}</span>
              </div>
              <button class="btn btn-danger btn-small editor-project-delete" data-id="${p.id}">Apagar</button>
            </div>
          `).join('')}
        </div>
      `}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="loadProjectCancel">Fechar</button>
    </div>
  `;

  backdrop.classList.add('visible');

  modal.querySelector('#loadProjectCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  modal.querySelectorAll('.editor-project-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('editor-project-delete')) return;
      const data = await window.api.editorLoadProject(item.dataset.id);
      if (data) {
        Hub._editorLoadProjectData(data);
        backdrop.classList.remove('visible');
        Hub.renderEditor();
      }
    });
  });

  modal.querySelectorAll('.editor-project-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.editorDeleteProject(btn.dataset.id);
      Hub._editorOpenLoadModal(); // refresh
    });
  });
};

Hub._editorLoadProjectData = function (data) {
  const st = Hub.state.editor;
  st.projectId = data.id;
  st.voiceover = data.voiceover || null;
  st.transcription = data.transcription || null;
  st.episodes = data.episodes || [];
  st.clips = data.clips || [];
  st.overlays = data.overlays || [];
  st.imageEvents = data.imageEvents || [];
  st.captionsEnabled = data.captionsEnabled || false;
  st.outputFolder = data.outputFolder || null;
  st.outputFilename = data.outputFilename || 'editor_output.mp4';
  if (data.settings) {
    st.clipDurationMin = data.settings.clipDurationMin || 3;
    st.clipDurationMax = data.settings.clipDurationMax || 8;
    st.skipStart = data.settings.skipStart || 30;
    st.skipEnd = data.settings.skipEnd || 30;
  }
  st.currentStep = 'voiceover';
};

// ══════════════════════════════════════════════════════
//  SERIES IMPORT MODAL (Media step)
// ══════════════════════════════════════════════════════
Hub._editorOpenSeriesImportModal = async function () {
  const allSeries = await window.api.seriesGetAll();

  const backdrop = document.getElementById('modalBackdrop');
  const modal    = document.getElementById('modalContent');

  if (allSeries.length === 0) {
    Hub.showToast('Nenhuma série adicionada. Vai a Séries para adicionar.', 'error');
    return;
  }

  modal.innerHTML = `
    <h3>Importar da Série</h3>
    <div class="project-detail">
      <div class="form-group">
        <label class="form-label">Série</label>
        <select class="input" id="siSeriesSelect">
          ${allSeries.map(s => `<option value="${s.id}">${Hub._escHtml(s.name)} (${s.episodes.length} episódios)</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Episódios a importar</label>
        <div id="siEpisodeList" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;border:1px solid var(--border);border-radius:6px;padding:8px;"></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="btn btn-secondary btn-small" id="siSelectAll">Selecionar Todos</button>
        <button class="btn btn-secondary btn-small" id="siSelectNone">Nenhum</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="siCancel">Cancelar</button>
        <button class="btn btn-primary" id="siImport">Importar</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');

  const seriesSelect = modal.querySelector('#siSeriesSelect');
  const episodeListEl = modal.querySelector('#siEpisodeList');

  function renderEpisodes() {
    const seriesId = seriesSelect.value;
    const series = allSeries.find(s => s.id === seriesId);
    if (!series) return;
    episodeListEl.innerHTML = series.episodes.map(ep => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border-radius:4px;cursor:pointer;">
        <input type="checkbox" class="si-ep-check" value="${ep.filePath}" data-code="${ep.code}" checked>
        <span style="font-family:monospace;font-size:12px;color:var(--accent);min-width:60px;">${ep.code}</span>
        <span style="font-size:12px;color:var(--text-dim);">${Hub._escHtml(ep.filename)}</span>
      </label>
    `).join('');
  }

  renderEpisodes();
  seriesSelect.addEventListener('change', renderEpisodes);

  modal.querySelector('#siSelectAll').addEventListener('click', () => {
    episodeListEl.querySelectorAll('.si-ep-check').forEach(cb => cb.checked = true);
  });
  modal.querySelector('#siSelectNone').addEventListener('click', () => {
    episodeListEl.querySelectorAll('.si-ep-check').forEach(cb => cb.checked = false);
  });
  modal.querySelector('#siCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  modal.querySelector('#siImport').addEventListener('click', async () => {
    const checked = [...episodeListEl.querySelectorAll('.si-ep-check:checked')];
    if (checked.length === 0) { Hub.showToast('Seleciona pelo menos um episódio', 'error'); return; }
    backdrop.classList.remove('visible');
    const paths = checked.map(cb => cb.value);
    await Hub._editorAddEpisodes(paths);
    Hub.showToast(`${paths.length} episódios importados`);
  });
};

// ══════════════════════════════════════════════════════
//  AI CLIP ASSIGNMENT MODAL (Clips step)
// ══════════════════════════════════════════════════════
Hub._editorOpenSeriesAssignModal = async function () {
  const st = Hub.state.editor;
  const allSeries = await window.api.seriesGetAll();
  const analyzedSeries = allSeries.filter(s => s.episodes.some(ep => ep.analyzed));

  const backdrop = document.getElementById('modalBackdrop');
  const modal    = document.getElementById('modalContent');

  if (analyzedSeries.length === 0) {
    Hub.showToast('Nenhuma série com episódios analisados. Vai a Séries e analisa os episódios primeiro.', 'error');
    return;
  }
  if (!st.transcription) {
    Hub.showToast('Faz a transcrição do voiceover primeiro (passo 1).', 'error');
    return;
  }

  modal.innerHTML = `
    <h3>Atribuir Clips com IA</h3>
    <div class="project-detail">
      <div class="form-group">
        <label class="form-label">Série</label>
        <select class="input" id="aaSeriesSelect">
          ${analyzedSeries.map(s => {
            const n = s.episodes.filter(ep => ep.analyzed).length;
            return `<option value="${s.id}">${Hub._escHtml(s.name)} (${n} episódios analisados)</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-hint">
        A IA vai ler a transcrição do voiceover e atribuir o episódio mais relevante a cada segmento de 30s.
        Os clips existentes serão substituídos.
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="aaCancel">Cancelar</button>
        <button class="btn btn-primary" id="aaAssign">🎯 Atribuir</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');

  modal.querySelector('#aaCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  modal.querySelector('#aaAssign').addEventListener('click', async () => {
    const seriesId = modal.querySelector('#aaSeriesSelect').value;
    backdrop.classList.remove('visible');
    await Hub._editorRunAIAssignment(seriesId);
  });
};

Hub._editorRunAIAssignment = async function (seriesId) {
  const st = Hub.state.editor;
  const dur = st.voiceover.duration;

  // Build 30-second segments from transcription
  const segments = [];
  const segLen = 30;
  for (let t = 0; t < dur; t += segLen) {
    const end = Math.min(t + segLen, dur);
    const words = (st.transcription.words || [])
      .filter(w => w.start >= t && w.start < end)
      .map(w => w.word).join(' ');
    if (words.trim()) segments.push({ startTime: t, endTime: end, text: words.trim() });
  }

  if (segments.length === 0) { Hub.showToast('Sem transcrição para usar', 'error'); return; }

  // Show gen bar
  const genBar = document.getElementById('genBar');
  const barFill = document.getElementById('genBarFill');
  const barPhase = document.getElementById('genBarPhase');
  const barPercent = document.getElementById('genBarPercent');
  genBar.classList.add('visible');
  genBar.classList.remove('done');
  barPhase.textContent = `A analisar ${segments.length} segmentos com IA...`;
  barFill.style.width = '30%';
  barPercent.textContent = '';

  const result = await window.api.seriesAssignClips({ seriesId, segments });

  if (!result.success) {
    genBar.classList.remove('visible');
    Hub.showToast(`Erro: ${result.error}`, 'error');
    return;
  }

  // Build episode map: code → episode file in st.episodes
  const epMap = {};
  st.episodes.forEach(ep => { epMap[ep.label] = ep; });

  // Also get series episodes to find file paths
  const allSeries = await window.api.seriesGetAll();
  const series = allSeries.find(s => s.id === seriesId);
  const seriesEpMap = {};
  if (series) series.episodes.forEach(ep => { seriesEpMap[ep.code] = ep; });

  // Generate clips from AI assignments
  const CLIP_DUR = st.clipDurationMin + Math.floor((st.clipDurationMax - st.clipDurationMin) / 2);
  const clips = [];
  let timelinePos = 0;

  result.assignments.forEach((code, i) => {
    if (i >= segments.length) return;
    const seg = segments[i];
    const segDur = seg.endTime - seg.startTime;

    // Find episode in current episodes list
    let episode = epMap[code];
    let episodeLabel = code;

    // If not in current list, try to find it from series
    if (!episode) {
      const seriesEp = seriesEpMap[code];
      if (seriesEp) {
        episode = st.episodes.find(ep => ep.name.includes(code) || ep.path === seriesEp.filePath);
      }
    }

    // Fallback: pick a random episode from the media list to avoid gaps
    if (!episode && st.episodes.length > 0) {
      episode = st.episodes[Math.floor(Math.random() * st.episodes.length)];
      episodeLabel = episode.label || episode.name;
    }

    if (!episode) return;

    // Fill the segment duration with clips of random duration
    let remaining = segDur;
    while (remaining > 0.5) {
      const clipDur = Math.min(
        st.clipDurationMin + Math.random() * (st.clipDurationMax - st.clipDurationMin),
        remaining
      );

      // Pick a random start within the episode (skip first/last 30s)
      const margin = Math.min(30, episode.duration * 0.1);
      const usable = Math.max(0, episode.duration - margin * 2 - clipDur);
      const startTime = margin + Math.random() * usable;

      clips.push({
        id: Math.random().toString(36).slice(2),
        source: episode.path,
        episodeIndex: st.episodes.indexOf(episode),
        episodeLabel,
        sourceName: episode.name,
        startTime,
        duration: clipDur,
        timelineStart: timelinePos,
      });
      timelinePos += clipDur;
      remaining -= clipDur;
    }
  });

  // Ensure clips cover full voiceover duration (fill any remaining gap)
  const totalDur = st.voiceover.duration;
  while (timelinePos < totalDur - 0.5 && st.episodes.length > 0) {
    const episode = st.episodes[Math.floor(Math.random() * st.episodes.length)];
    const clipDur = Math.min(
      st.clipDurationMin + Math.random() * (st.clipDurationMax - st.clipDurationMin),
      totalDur - timelinePos
    );
    const margin = Math.min(30, episode.duration * 0.1);
    const usable = Math.max(0, episode.duration - margin * 2 - clipDur);
    const startTime = margin + Math.random() * usable;
    clips.push({
      id: Math.random().toString(36).slice(2),
      source: episode.path,
      episodeIndex: st.episodes.indexOf(episode),
      episodeLabel: episode.label || episode.name,
      sourceName: episode.name,
      startTime,
      duration: clipDur,
      timelineStart: timelinePos,
    });
    timelinePos += clipDur;
  }

  st.clips = clips;
  genBar.classList.add('done');
  barPhase.textContent = `${clips.length} clips atribuídos pela IA!`;
  barFill.style.width = '100%';
  barPercent.textContent = '100%';
  setTimeout(() => genBar.classList.remove('visible', 'done'), 3000);
  Hub.showToast(`${clips.length} clips atribuídos com base na análise da série`);
  Hub._editorRenderStep('clips');
};
