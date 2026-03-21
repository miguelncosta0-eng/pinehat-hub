window.Hub = window.Hub || {};

Hub.renderVoiceover = function () {
  const panel = document.getElementById('panel-voiceover');
  if (!Hub.state.voiceover) Hub.state.voiceover = {};
  const vo = Hub.state.voiceover;

  panel.innerHTML = `
    <div class="section-header">
      <h2>Voiceover</h2>
    </div>
    <div class="vo-content">
      <!-- Generate TTS -->
      <div class="vo-card">
        <div class="vo-card-header">
          <h3>1. Text to Speech</h3>
        </div>
        <div class="vo-card-body">
          <div class="form-group">
            <label class="form-label">Texto</label>
            <textarea class="textarea" id="voTtsText" rows="6" placeholder="Escreve ou cola o texto para converter em voz...">${Hub._escHtml(vo.ttsText || '')}</textarea>
            <div class="vo-hint" style="text-align:right;margin-top:4px;">
              <span id="voTtsCharCount">${(vo.ttsText || '').length}</span> chars
            </div>
          </div>
          <!-- Preset selector -->
          <div class="vo-preset-row" style="margin-top:8px;display:flex;gap:8px;align-items:flex-end;">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Preset</label>
              <select class="input" id="voPresetSelect">
                <option value="">— Sem preset —</option>
                ${(Hub.state.settings?.voPresets || []).map((p, i) => `<option value="${i}" ${vo.activePreset === i ? 'selected' : ''}>${Hub._escHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <button class="btn btn-small btn-secondary" id="voPresetSave" title="Guardar preset" style="margin-bottom:1px;">Guardar</button>
            <button class="btn btn-small btn-danger" id="voPresetDelete" title="Apagar preset" style="margin-bottom:1px;display:${vo.activePreset !== undefined && vo.activePreset !== '' ? '' : 'none'};">✕</button>
          </div>
          <div id="voPresetNameRow" style="display:none;margin-top:4px;display:none;gap:6px;align-items:center;">
            <input class="input" id="voPresetNameInput" placeholder="Nome do preset..." style="flex:1;font-size:12px;padding:4px 8px;">
            <button class="btn btn-small btn-primary" id="voPresetNameConfirm">OK</button>
            <button class="btn btn-small btn-secondary" id="voPresetNameCancel">✕</button>
          </div>

          <div class="vo-settings-row" style="margin-top:8px;">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Voice ID</label>
              <input class="input" type="text" id="voTtsVoiceId" value="${vo.ttsVoiceId || Hub.state.settings?.ttsVoiceId || ''}" placeholder="Ex: zNsotODqUhvbJ5wMG7Ei">
              <div class="vo-hint">Encontra em elevenlabs.io/voice-library</div>
            </div>
            <div class="form-group" style="flex:1;">
              <label class="form-label">Model</label>
              <select class="input" id="voTtsModel">
                <option value="eleven_multilingual_v2" ${(vo.ttsModel || 'eleven_multilingual_v2') === 'eleven_multilingual_v2' ? 'selected' : ''}>Multilingual v2 - Best stability</option>
                <option value="eleven_v3" ${vo.ttsModel === 'eleven_v3' ? 'selected' : ''}>Eleven v3 - Most expressive</option>
                <option value="eleven_turbo_v2" ${vo.ttsModel === 'eleven_turbo_v2' ? 'selected' : ''}>Turbo v2 - Fast</option>
                <option value="eleven_turbo_v2_5" ${vo.ttsModel === 'eleven_turbo_v2_5' ? 'selected' : ''}>Turbo v2.5 - Balanced</option>
                <option value="eleven_flash_v2" ${vo.ttsModel === 'eleven_flash_v2' ? 'selected' : ''}>Flash v2 - Fastest</option>
                <option value="eleven_flash_v2_5" ${vo.ttsModel === 'eleven_flash_v2_5' ? 'selected' : ''}>Flash v2.5 - Low latency</option>
              </select>
            </div>
          </div>

          <!-- Advanced Options -->
          <details class="vo-advanced" style="margin-top:12px;">
            <summary style="cursor:pointer;color:var(--text-dim);font-size:13px;user-select:none;">Advanced Options</summary>
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:14px;">
              <div class="vo-slider-group">
                <div class="vo-slider-header">
                  <label class="form-label">Stability</label>
                  <span class="vo-slider-val" id="voStabilityVal">${((vo.ttsStability ?? 0.5) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" class="input-range" id="voStability" min="0" max="1" step="0.05" value="${vo.ttsStability ?? 0.5}">
                <div class="vo-hint">Higher = consistent, lower = expressive</div>
              </div>
              <div class="vo-slider-group">
                <div class="vo-slider-header">
                  <label class="form-label">Similarity Boost</label>
                  <span class="vo-slider-val" id="voSimilarityVal">${((vo.ttsSimilarity ?? 0.75) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" class="input-range" id="voSimilarity" min="0" max="1" step="0.05" value="${vo.ttsSimilarity ?? 0.75}">
                <div class="vo-hint">How closely to match the original voice</div>
              </div>
              <div class="vo-slider-group">
                <div class="vo-slider-header">
                  <label class="form-label">Style</label>
                  <span class="vo-slider-val" id="voStyleVal">${((vo.ttsStyle ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" class="input-range" id="voStyle" min="0" max="1" step="0.05" value="${vo.ttsStyle ?? 0}">
                <div class="vo-hint">Style exaggeration (higher = more dramatic)</div>
              </div>
              <div class="vo-slider-group">
                <div class="vo-slider-header">
                  <label class="form-label">Speed</label>
                  <span class="vo-slider-val" id="voSpeedVal">${(vo.ttsSpeed ?? 1.0).toFixed(1)}x</span>
                </div>
                <input type="range" class="input-range" id="voSpeed" min="0.5" max="2.0" step="0.1" value="${vo.ttsSpeed ?? 1.0}">
                <div class="vo-hint">Playback speed (0.5x to 2x)</div>
              </div>
              <div style="display:flex;gap:24px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
                  <input type="checkbox" id="voSpeakerBoost" ${vo.ttsSpeakerBoost ? 'checked' : ''}>
                  Speaker Boost
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
                  <input type="checkbox" id="voUsePauses" ${vo.ttsUsePauses ? 'checked' : ''}>
                  Use Pauses
                </label>
              </div>
            </div>
          </details>

          <button class="btn btn-primary" id="voGenerateTts" style="margin-top:12px;">
            Generate Audio
          </button>
          <div class="vo-progress" id="voTtsProgress" style="display:none">
            <div class="vo-progress-bar"><div class="vo-progress-fill" id="voTtsProgressFill"></div></div>
            <div class="vo-progress-text" id="voTtsProgressText"></div>
          </div>
          ${vo.ttsResult ? `
            <div class="vo-result" style="margin-top:12px;">
              <div class="vo-result-file" style="display:flex;align-items:center;justify-content:space-between;">
                <span>Audio gerado: ${vo.ttsResult.split(/[\\/]/).pop()}</span>
                <button id="voSaveAudioBtn" class="btn btn-sm" style="background:var(--accent);color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;">💾 Guardar</button>
              </div>
              <audio controls src="file://${vo.ttsResult}" style="width:100%;margin-top:8px;"></audio>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Import audio -->
      <div class="vo-card">
        <div class="vo-card-header">
          <h3>2. Import Audio</h3>
        </div>
        <div class="vo-card-body">
          ${vo.path ? `
            <div class="vo-file-info">
              <div class="vo-file-name">${Hub._escHtml(vo.name || vo.path.split(/[\\/]/).pop())}</div>
              <div class="vo-file-meta">
                ${vo.duration ? Hub.fmtDuration(vo.duration) : ''}
              </div>
              <button class="btn btn-small btn-secondary" id="voRemoveFile">✕ Remove</button>
            </div>
          ` : `
            <div class="vo-drop-zone" id="voDropZone">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <p>Drop audio file here or click to browse</p>
              <span class="vo-formats">MP3, WAV, M4A, OGG</span>
            </div>
          `}
        </div>
      </div>

      <!-- Silence removal -->
      <div class="vo-card ${!vo.path ? 'vo-card-disabled' : ''}">
        <div class="vo-card-header">
          <h3>3. Remove Silence</h3>
        </div>
        <div class="vo-card-body">
          <div class="vo-settings-row">
            <div class="form-group">
              <label class="form-label">Threshold (dB)</label>
              <input class="input" type="number" id="voThreshold" value="${vo.threshold || -30}" min="-60" max="-20" step="1">
              <span class="vo-hint">Lower = only deep silence. Higher (-25, -20) = more aggressive.</span>
            </div>
            <div class="form-group">
              <label class="form-label">Min Silence Duration (s)</label>
              <input class="input" type="number" id="voMinSilence" value="${vo.minSilence || 0.7}" min="0.2" max="3" step="0.1">
              <span class="vo-hint">Only remove pauses longer than this.</span>
            </div>
          </div>

          <button class="btn btn-primary" id="voRemoveSilence" ${!vo.path ? 'disabled' : ''}>
            ✂️ Remove Silence
          </button>

          <div class="vo-progress" id="voProgress" style="display:none">
            <div class="vo-progress-bar"><div class="vo-progress-fill" id="voProgressFill"></div></div>
            <div class="vo-progress-text" id="voProgressText"></div>
          </div>

          ${vo.result ? `
            <div class="vo-result">
              <div class="vo-result-stat">
                <span class="vo-result-label">Original</span>
                <span class="vo-result-value">${Hub.fmtDuration(vo.result.originalDuration)}</span>
              </div>
              <div class="vo-result-stat">
                <span class="vo-result-label">Trimmed</span>
                <span class="vo-result-value">${Hub.fmtDuration(vo.result.newDuration)}</span>
              </div>
              <div class="vo-result-stat">
                <span class="vo-result-label">Removed</span>
                <span class="vo-result-value vo-result-highlight">${Hub.fmtDuration(vo.result.silenceRemoved)} (${vo.result.silenceCount} silences)</span>
              </div>
              <div class="vo-result-file">
                <span>📁 ${vo.result.outputPath.split(/[\\/]/).pop()}</span>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // Drop zone / file select
  const dropZone = panel.querySelector('#voDropZone');
  if (dropZone) {
    dropZone.addEventListener('click', async () => {
      const files = await window.api.selectFiles();
      if (files && files[0]) Hub._voLoadFile(files[0]);
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('vo-drag-active'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('vo-drag-active'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('vo-drag-active');
      const file = e.dataTransfer.files[0];
      if (file) {
        const filePath = window.api.getDroppedFilePath(file);
        if (filePath) Hub._voLoadFile(filePath);
      }
    });
  }

  // TTS char counter
  const ttsTextarea = panel.querySelector('#voTtsText');
  const ttsCharCount = panel.querySelector('#voTtsCharCount');
  if (ttsTextarea && ttsCharCount) {
    ttsTextarea.addEventListener('input', () => {
      ttsCharCount.textContent = ttsTextarea.value.length;
    });
  }

  // Advanced sliders — update display values
  const sliderBindings = [
    { id: 'voStability', valId: 'voStabilityVal', fmt: v => `${(v * 100).toFixed(0)}%` },
    { id: 'voSimilarity', valId: 'voSimilarityVal', fmt: v => `${(v * 100).toFixed(0)}%` },
    { id: 'voStyle', valId: 'voStyleVal', fmt: v => `${(v * 100).toFixed(0)}%` },
    { id: 'voSpeed', valId: 'voSpeedVal', fmt: v => `${parseFloat(v).toFixed(1)}x` },
  ];
  sliderBindings.forEach(({ id, valId, fmt }) => {
    const slider = panel.querySelector(`#${id}`);
    const val = panel.querySelector(`#${valId}`);
    if (slider && val) slider.addEventListener('input', () => { val.textContent = fmt(slider.value); });
  });

  // ── Preset management ──
  const presetSelect = panel.querySelector('#voPresetSelect');
  const presetDeleteBtn = panel.querySelector('#voPresetDelete');

  // Load preset when selected
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const idx = presetSelect.value;
      if (idx === '') {
        Hub.state.voiceover.activePreset = undefined;
        if (presetDeleteBtn) presetDeleteBtn.style.display = 'none';
        return;
      }
      const preset = (Hub.state.settings?.voPresets || [])[parseInt(idx)];
      if (!preset) return;

      Hub.state.voiceover.activePreset = parseInt(idx);
      Hub.state.voiceover.ttsVoiceId = preset.voiceId;
      Hub.state.voiceover.ttsModel = preset.model;
      Hub.state.voiceover.ttsStability = preset.stability;
      Hub.state.voiceover.ttsSimilarity = preset.similarity;
      Hub.state.voiceover.ttsStyle = preset.style;
      Hub.state.voiceover.ttsSpeed = preset.speed;
      Hub.state.voiceover.ttsSpeakerBoost = preset.speakerBoost;
      Hub.state.voiceover.ttsUsePauses = preset.usePauses;

      if (presetDeleteBtn) presetDeleteBtn.style.display = '';
      Hub.renderVoiceover();
    });
  }

  // Save preset
  // Show name input when clicking Guardar
  panel.querySelector('#voPresetSave')?.addEventListener('click', () => {
    const row = panel.querySelector('#voPresetNameRow');
    if (row) {
      row.style.display = 'flex';
      const input = panel.querySelector('#voPresetNameInput');
      if (input) { input.value = ''; input.focus(); }
    }
  });

  // Confirm preset save
  const savePreset = async () => {
    const nameInput = panel.querySelector('#voPresetNameInput');
    const name = nameInput?.value?.trim();
    if (!name) { Hub.showToast('Escreve um nome para o preset', 'error'); return; }

    const preset = {
      name,
      voiceId: panel.querySelector('#voTtsVoiceId')?.value?.trim() || '',
      model: panel.querySelector('#voTtsModel')?.value || 'eleven_multilingual_v2',
      stability: parseFloat(panel.querySelector('#voStability')?.value ?? 0.5),
      similarity: parseFloat(panel.querySelector('#voSimilarity')?.value ?? 0.75),
      style: parseFloat(panel.querySelector('#voStyle')?.value ?? 0),
      speed: parseFloat(panel.querySelector('#voSpeed')?.value ?? 1.0),
      speakerBoost: panel.querySelector('#voSpeakerBoost')?.checked || false,
      usePauses: panel.querySelector('#voUsePauses')?.checked || false,
    };

    const presets = Hub.state.settings?.voPresets || [];
    presets.push(preset);
    await window.api.saveSetting('voPresets', presets);
    Hub.state.settings = await window.api.getSettings();
    Hub.state.voiceover.activePreset = presets.length - 1;
    Hub.showToast(`Preset "${name}" guardado!`);
    Hub.renderVoiceover();
  };

  panel.querySelector('#voPresetNameConfirm')?.addEventListener('click', savePreset);
  panel.querySelector('#voPresetNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') savePreset();
  });
  panel.querySelector('#voPresetNameCancel')?.addEventListener('click', () => {
    const row = panel.querySelector('#voPresetNameRow');
    if (row) row.style.display = 'none';
  });

  // Delete preset
  panel.querySelector('#voPresetDelete')?.addEventListener('click', async () => {
    const idx = Hub.state.voiceover.activePreset;
    if (idx === undefined || idx === '') return;
    const presets = Hub.state.settings?.voPresets || [];
    const name = presets[idx]?.name || 'Preset';
    presets.splice(idx, 1);
    await window.api.saveSetting('voPresets', presets);
    Hub.state.settings = await window.api.getSettings();
    Hub.state.voiceover.activePreset = undefined;
    Hub.showToast(`Preset "${name}" apagado.`);
    Hub.renderVoiceover();
  });

  // Generate TTS (non-blocking — uses gen-bar)
  panel.querySelector('#voGenerateTts')?.addEventListener('click', () => {
    const text = panel.querySelector('#voTtsText')?.value;
    const voiceId = panel.querySelector('#voTtsVoiceId')?.value?.trim();
    if (!text?.trim()) { Hub.showToast('Escreve texto primeiro.', 'error'); return; }
    if (Hub._voTtsRunning) { Hub.showToast('Já está a gerar...', 'info'); return; }

    const ttsModel = panel.querySelector('#voTtsModel')?.value || 'eleven_multilingual_v2';
    const ttsStability = parseFloat(panel.querySelector('#voStability')?.value ?? 0.5);
    const ttsSimilarity = parseFloat(panel.querySelector('#voSimilarity')?.value ?? 0.75);
    const ttsStyle = parseFloat(panel.querySelector('#voStyle')?.value ?? 0);
    const ttsSpeed = parseFloat(panel.querySelector('#voSpeed')?.value ?? 1.0);
    const ttsSpeakerBoost = panel.querySelector('#voSpeakerBoost')?.checked || false;
    const ttsUsePauses = panel.querySelector('#voUsePauses')?.checked || false;

    Hub.state.voiceover = Hub.state.voiceover || {};
    Object.assign(Hub.state.voiceover, { ttsText: text, ttsVoiceId: voiceId, ttsModel, ttsStability, ttsSimilarity, ttsStyle, ttsSpeed, ttsSpeakerBoost, ttsUsePauses });

    // Show gen-bar
    Hub._voShowGenBar('Voiceover TTS', 'A gerar áudio...', 0);
    Hub._voTtsRunning = true;

    // Fire and forget — don't await
    window.api.voiceoverGenerateTts({
      text, voiceId, model: ttsModel,
      stability: ttsStability, similarity_boost: ttsSimilarity,
      style: ttsStyle, speed: ttsSpeed,
      speaker_boost: ttsSpeakerBoost, use_pauses: ttsUsePauses,
    }).then(result => {
      Hub._voTtsRunning = false;
      if (result.success) {
        Hub.state.voiceover.ttsResult = result.outputPath;
        Hub._voShowGenBar('Voiceover TTS', 'Concluído!', 100, true);
        Hub.showToast('Audio gerado com sucesso!');
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error || result);
        Hub._voHideGenBar();
        Hub.showToast(errMsg, 'error');
      }
      if (Hub.state.activeSection === 'voiceover') Hub.renderVoiceover();
    }).catch(err => {
      Hub._voTtsRunning = false;
      Hub._voHideGenBar();
      const msg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
      Hub.showToast(msg, 'error');
    });

    Hub.showToast('A gerar voiceover em background...', 'info');
  });

  // TTS progress listener — updates gen-bar
  if (!Hub._voTtsProgressBound) {
    Hub._voTtsProgressBound = true;
    window.api.onVoiceoverTtsProgress((data) => {
      const labels = { generating: 'A gerar áudio...', downloading: 'A descarregar...', done: 'Concluído!' };
      Hub._voShowGenBar('Voiceover TTS', labels[data.phase] || data.phase, data.percent, data.phase === 'done');
    });
  }

  // Save audio file
  panel.querySelector('#voSaveAudioBtn')?.addEventListener('click', async () => {
    const vo = Hub.state.voiceover;
    if (!vo?.ttsResult) return;
    const result = await window.api.saveAudioFile(vo.ttsResult);
    if (result?.success) {
      Hub.showToast(`Audio guardado em: ${result.path.split(/[\\/]/).pop()}`);
    }
  });

  // Remove file
  panel.querySelector('#voRemoveFile')?.addEventListener('click', () => {
    Hub.state.voiceover = {};
    Hub.renderVoiceover();
  });

  // Remove silence (non-blocking — uses gen-bar)
  panel.querySelector('#voRemoveSilence')?.addEventListener('click', () => {
    const vo = Hub.state.voiceover;
    if (!vo || !vo.path) return;
    if (Hub._voSilenceRunning) { Hub.showToast('Já está a processar...', 'info'); return; }

    const threshold = parseFloat(panel.querySelector('#voThreshold').value) || -30;
    const minSilence = parseFloat(panel.querySelector('#voMinSilence').value) || 0.7;
    vo.threshold = threshold;
    vo.minSilence = minSilence;

    Hub._voShowGenBar('Remove Silence', 'A detectar silêncio...', 0);
    Hub._voSilenceRunning = true;

    window.api.editorRemoveSilence({
      audioPath: vo.path,
      threshold,
      minSilenceDuration: minSilence,
    }).then(result => {
      Hub._voSilenceRunning = false;
      if (result.success && !result.noChange) {
        vo.result = result;
        Hub._voShowGenBar('Remove Silence', 'Concluído!', 100, true);
        Hub.showToast(`Removed ${Hub.fmtDuration(result.silenceRemoved)} of silence!`);
      } else if (result.noChange) {
        Hub._voHideGenBar();
        Hub.showToast('No silence detected with current settings.', 'info');
      } else {
        Hub._voHideGenBar();
        Hub.showToast(result.error || 'Error', 'error');
      }
      if (Hub.state.activeSection === 'voiceover') Hub.renderVoiceover();
    }).catch(err => {
      Hub._voSilenceRunning = false;
      Hub._voHideGenBar();
      Hub.showToast(`Error: ${err.message}`, 'error');
    });

    Hub.showToast('A remover silêncio em background...', 'info');
  });

  // Silence progress listener — updates gen-bar
  if (!Hub._voProgressBound) {
    Hub._voProgressBound = true;
    window.api.onEditorSilenceProgress((data) => {
      const labels = { detecting: 'A detectar silêncio...', trimming: 'A cortar áudio...', done: 'Concluído!' };
      Hub._voShowGenBar('Remove Silence', labels[data.phase] || data.phase, data.percent, data.phase === 'done');
    });
  }
};

Hub._voLoadFile = async function (filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'wma'];
  if (!audioExts.includes(ext)) {
    Hub.showToast('Select an audio file (MP3, WAV, M4A...)', 'error');
    return;
  }

  Hub.state.voiceover = Hub.state.voiceover || {};
  Hub.state.voiceover.path = filePath;
  Hub.state.voiceover.name = filePath.split(/[\\/]/).pop();
  Hub.state.voiceover.result = null;

  // Get duration
  try {
    const info = await window.api.getMediaInfo(filePath);
    Hub.state.voiceover.duration = info.duration;
  } catch (_) {}

  Hub.renderVoiceover();
};

// Gen-bar helpers for background voiceover tasks
Hub._voShowGenBar = function (title, phase, percent, done) {
  const bar = document.getElementById('genBar');
  const barPhase = document.getElementById('genBarPhase');
  const barFill = document.getElementById('genBarFill');
  const barPercent = document.getElementById('genBarPercent');
  const barEta = document.getElementById('genBarEta');
  if (!bar) return;

  bar.classList.add('visible');
  if (done) {
    bar.classList.add('done');
    setTimeout(() => { bar.classList.remove('visible', 'done'); }, 4000);
  } else {
    bar.classList.remove('done');
  }

  if (barPhase) barPhase.textContent = `${title} — ${phase}`;
  if (barFill) barFill.style.width = `${percent}%`;
  if (barPercent) barPercent.textContent = `${Math.round(percent)}%`;
  if (barEta) barEta.textContent = '';
};

Hub._voHideGenBar = function () {
  const bar = document.getElementById('genBar');
  if (bar) bar.classList.remove('visible', 'done');
};

// Duration formatter
Hub.fmtDuration = Hub.fmtDuration || function (seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
