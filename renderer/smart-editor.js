window.Hub = window.Hub || {};

Hub.state.smartEditor = {
  step: 'setup',        // 'setup' | 'generating' | 'result'
  scriptId: null,
  voiceoverPath: null,
  seriesIds: [],
  outputFolder: null,
  isGenerating: false,
  result: null,         // {outputPath, segmentCount, clipCount, frameCount}
};

Hub.renderSmartEditor = function () {
  const panel = document.getElementById('panel-smart-editor');
  if (!panel) return;

  const st = Hub.state.smartEditor;

  if (st.step === 'setup') {
    Hub._seRenderSetup(panel);
  } else if (st.step === 'generating') {
    Hub._seRenderGenerating(panel);
  } else if (st.step === 'result') {
    Hub._seRenderResult(panel);
  }
};

// ── Step 1: Setup ──
Hub._seRenderSetup = function (panel) {
  const st = Hub.state.smartEditor;

  panel.innerHTML = `
    <div class="section-header">
      <h2>Smart Editor</h2>
    </div>
    <div class="se-container">
      <div class="se-form">
        <div class="form-group">
          <label class="form-label">Script</label>
          <select class="input" id="seScriptSelect">
            <option value="">-- Seleciona um script --</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Voiceover (áudio)</label>
          <div class="se-file-row">
            <div class="se-path-display" id="seVoiceoverPath">Nenhum ficheiro selecionado</div>
            <button class="btn btn-secondary btn-small" id="seSelectVoiceover">${Hub.icons.mic} Escolher</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Séries (fontes de vídeo)</label>
          <div class="se-series-list" id="seSeriesList"></div>
          <div class="se-series-add-row">
            <select class="input" id="seSeriesSelect">
              <option value="">-- Adicionar série --</option>
            </select>
            <button class="btn btn-secondary btn-small" id="seAddSeries">${Hub.icons.plus} Adicionar</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Pasta de saída</label>
          <div class="se-file-row">
            <div class="se-path-display" id="seOutputPath">Automático</div>
            <button class="btn btn-secondary btn-small" id="seSelectOutput">${Hub.icons.folder} Escolher</button>
          </div>
        </div>
      </div>

      <div class="se-action-bar">
        <button class="btn btn-primary" id="seGenerateBtn" disabled>
          ${Hub.icons.play} Gerar
        </button>
      </div>
    </div>
  `;

  Hub._seLoadDropdowns();
  Hub._seBindSetupEvents();
  Hub._seUpdateGenerateBtn();
};

Hub._seLoadDropdowns = async function () {
  const st = Hub.state.smartEditor;

  // Load scripts
  try {
    const scripts = await window.api.getScripts();
    const sel = document.getElementById('seScriptSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Seleciona um script --</option>';
    for (const s of scripts) {
      const label = s.channel ? `${s.title} (${s.channel})` : s.title;
      sel.innerHTML += `<option value="${s.id}">${label}</option>`;
    }
    if (st.scriptId) sel.value = st.scriptId;
  } catch (_) { /* ignore */ }

  // Load series
  try {
    const series = await window.api.seriesGetAll();
    const sel = document.getElementById('seSeriesSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Adicionar série --</option>';
    for (const s of series) {
      if (st.seriesIds.includes(s.id)) continue;
      const epCount = s.episodes?.length || 0;
      sel.innerHTML += `<option value="${s.id}">${s.name} (${epCount} episódios)</option>`;
    }
  } catch (_) { /* ignore */ }

  // Render selected series
  Hub._seRenderSelectedSeries();
};

Hub._seRenderSelectedSeries = async function () {
  const st = Hub.state.smartEditor;
  const container = document.getElementById('seSeriesList');
  if (!container) return;

  if (st.seriesIds.length === 0) {
    container.innerHTML = '<div class="se-series-empty">Nenhuma série adicionada</div>';
    return;
  }

  try {
    const allSeries = await window.api.seriesGetAll();
    container.innerHTML = st.seriesIds.map((sid) => {
      const s = allSeries.find((x) => x.id === sid);
      if (!s) return '';
      const epCount = s.episodes?.length || 0;
      return `
        <div class="se-series-tag">
          <span>${s.name} (${epCount} ep.)</span>
          <button class="btn-icon se-series-remove" data-id="${sid}" title="Remover">${Hub.icons.x}</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.se-series-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        st.seriesIds = st.seriesIds.filter((id) => id !== btn.dataset.id);
        Hub._seRenderSelectedSeries();
        Hub._seLoadDropdowns();
        Hub._seUpdateGenerateBtn();
      });
    });
  } catch (_) { /* ignore */ }
};

Hub._seBindSetupEvents = function () {
  const st = Hub.state.smartEditor;

  // Script select
  document.getElementById('seScriptSelect')?.addEventListener('change', (e) => {
    st.scriptId = e.target.value || null;
    Hub._seUpdateGenerateBtn();
  });

  // Voiceover select
  document.getElementById('seSelectVoiceover')?.addEventListener('click', async () => {
    const filePath = await window.api.selectAudioFile();
    if (filePath) {
      st.voiceoverPath = filePath;
      const name = filePath.split(/[\\/]/).pop();
      document.getElementById('seVoiceoverPath').textContent = name;
      document.getElementById('seVoiceoverPath').title = filePath;
      Hub._seUpdateGenerateBtn();
    }
  });

  // Add series
  document.getElementById('seAddSeries')?.addEventListener('click', () => {
    const sel = document.getElementById('seSeriesSelect');
    const val = sel?.value;
    if (!val) { Hub.showToast('Seleciona uma série primeiro', 'error'); return; }
    if (st.seriesIds.includes(val)) return;
    st.seriesIds.push(val);
    Hub._seRenderSelectedSeries();
    Hub._seLoadDropdowns();
    Hub._seUpdateGenerateBtn();
  });

  // Output folder
  document.getElementById('seSelectOutput')?.addEventListener('click', async () => {
    const folder = await window.api.selectOutputFolder();
    if (folder) {
      st.outputFolder = folder;
      document.getElementById('seOutputPath').textContent = folder;
      document.getElementById('seOutputPath').title = folder;
    }
  });

  // Generate
  document.getElementById('seGenerateBtn')?.addEventListener('click', () => Hub._seGenerate());
};

Hub._seUpdateGenerateBtn = function () {
  const st = Hub.state.smartEditor;
  const btn = document.getElementById('seGenerateBtn');
  if (!btn) return;
  btn.disabled = !st.scriptId || !st.voiceoverPath || st.seriesIds.length === 0;
};

// ── Step 2: Generating ──
Hub._seGenerate = async function () {
  const st = Hub.state.smartEditor;
  st.isGenerating = true;
  st.step = 'generating';

  Hub._seRenderGenerating(document.getElementById('panel-smart-editor'));

  // Show the bottom progress bar
  const bar = document.getElementById('genBar');
  const barPhase = document.getElementById('genBarPhase');
  const barFill = document.getElementById('genBarFill');
  const barPercent = document.getElementById('genBarPercent');
  const barEta = document.getElementById('genBarEta');
  const barCancel = document.getElementById('genBarCancel');

  barPhase.textContent = 'A preparar...';
  barFill.style.width = '0%';
  barPercent.textContent = '0%';
  barEta.textContent = '';
  bar.classList.remove('done');
  bar.classList.add('visible');

  const startTime = Date.now();

  // Cancel handler
  const onCancel = async () => {
    await window.api.smartEditorCancel();
    bar.classList.remove('visible');
    st.isGenerating = false;
    st.step = 'setup';
    Hub.renderSmartEditor();
    Hub.showToast('Geração cancelada', 'error');
  };
  barCancel.addEventListener('click', onCancel, { once: true });

  // Also bind the in-panel cancel button
  document.getElementById('seCancelBtn')?.addEventListener('click', onCancel, { once: true });

  // Phase labels
  const phaseLabels = {
    transcribing: 'A transcrever áudio...',
    planning: 'A planear edição...',
    extracting: 'A extrair clips...',
    assembling: 'A montar vídeo...',
  };

  // Progress listener
  window.api.onSmartEditorProgress((data) => {
    const pct = data.percent || 0;
    barFill.style.width = `${pct}%`;
    barPercent.textContent = `${pct}%`;

    // Update phase text
    const phaseText = phaseLabels[data.phase] || data.phase;
    const detail = data.current && data.total
      ? `${phaseText} (${data.current}/${data.total})`
      : phaseText;

    barPhase.textContent = detail;

    // Update in-panel phase display
    const panelPhase = document.getElementById('sePhaseText');
    if (panelPhase) panelPhase.textContent = detail;

    const panelDetail = document.getElementById('seDetail');
    if (panelDetail && data.detail) panelDetail.textContent = data.detail;

    // Update step indicators
    Hub._seUpdateStepIndicators(data.phase);

    // ETA
    if (pct > 0 && data.phase !== 'done') {
      const elapsed = Date.now() - startTime;
      const remaining = (elapsed / pct) * (100 - pct);
      barEta.textContent = Hub._fmtEta(remaining);
    }
  });

  // Call the IPC
  try {
    const result = await window.api.smartEditorGenerate({
      scriptId: st.scriptId,
      voiceoverPath: st.voiceoverPath,
      seriesIds: st.seriesIds,
      outputFolder: st.outputFolder,
    });

    barCancel.removeEventListener('click', onCancel);
    st.isGenerating = false;

    if (result.success) {
      bar.classList.add('done');
      barPhase.textContent = 'Concluído!';
      barPercent.textContent = '100%';
      barEta.textContent = '';
      barFill.style.width = '100%';
      setTimeout(() => bar.classList.remove('visible', 'done'), 4000);

      st.result = result;
      st.step = 'result';
      Hub.renderSmartEditor();
      Hub.showToast('Smart Editor concluído!');
    } else {
      bar.classList.remove('visible');
      st.step = 'setup';
      Hub.renderSmartEditor();
      Hub.showToast(`Erro: ${result.error}`, 'error');
    }
  } catch (err) {
    barCancel.removeEventListener('click', onCancel);
    bar.classList.remove('visible');
    st.isGenerating = false;
    st.step = 'setup';
    Hub.renderSmartEditor();
    Hub.showToast(`Erro: ${err.message}`, 'error');
  }
};

Hub._seRenderGenerating = function (panel) {
  const phases = [
    { key: 'transcribing', label: 'Transcrever' },
    { key: 'planning', label: 'Planear' },
    { key: 'extracting', label: 'Extrair' },
    { key: 'assembling', label: 'Montar' },
  ];

  panel.innerHTML = `
    <div class="section-header">
      <h2>Smart Editor</h2>
    </div>
    <div class="se-container">
      <div class="se-generating">
        <div class="se-phase-steps">
          ${phases.map((p) => `
            <div class="se-phase-step" id="seStep-${p.key}">
              <div class="se-phase-dot"></div>
              <span>${p.label}</span>
            </div>
          `).join('')}
        </div>
        <div class="se-generating-info">
          <div class="se-phase-text" id="sePhaseText">A preparar...</div>
          <div class="se-detail" id="seDetail"></div>
        </div>
        <button class="btn btn-danger" id="seCancelBtn">${Hub.icons.x} Cancelar</button>
      </div>
    </div>
  `;
};

Hub._seUpdateStepIndicators = function (currentPhase) {
  const order = ['transcribing', 'planning', 'extracting', 'assembling'];
  const idx = order.indexOf(currentPhase);

  order.forEach((key, i) => {
    const el = document.getElementById(`seStep-${key}`);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
};

// ── Step 3: Result ──
Hub._seRenderResult = function (panel) {
  const st = Hub.state.smartEditor;
  const r = st.result || {};

  const stats = [];
  if (r.clipCount) stats.push(`<strong>${r.clipCount}</strong> clips`);
  if (r.frameCount) stats.push(`<strong>${r.frameCount}</strong> frames`);
  if (r.segmentCount) stats.push(`<strong>${r.segmentCount}</strong> segmentos`);

  panel.innerHTML = `
    <div class="section-header">
      <h2>Smart Editor</h2>
    </div>
    <div class="se-container">
      <div class="se-result">
        <div class="se-result-icon">${Hub.icons.check}</div>
        <h3>Edição concluída</h3>
        <div class="se-result-stats">${stats.join(' &middot; ')}</div>
        ${r.outputPath ? `<div class="se-result-path">${r.outputPath}</div>` : ''}
        <div class="se-result-actions">
          ${r.outputPath ? `<button class="btn btn-secondary" id="seOpenFolder">${Hub.icons.folder} Abrir pasta</button>` : ''}
          <button class="btn btn-primary" id="seNewBtn">${Hub.icons.plus} Nova edição</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('seOpenFolder')?.addEventListener('click', () => {
    window.api.openFolder(r.outputPath);
  });

  document.getElementById('seNewBtn')?.addEventListener('click', () => {
    Hub.state.smartEditor = {
      step: 'setup',
      scriptId: null,
      voiceoverPath: null,
      seriesIds: [],
      outputFolder: null,
      isGenerating: false,
      result: null,
    };
    Hub.renderSmartEditor();
  });
};
