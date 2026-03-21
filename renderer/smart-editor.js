window.Hub = window.Hub || {};

Hub.state.smartEditor = {
  step: 'setup',        // 'setup' | 'generating' | 'timeline' | 'result'
  scriptId: null,
  voiceoverPath: null,
  seriesIds: [],
  outputFolder: null,
  isGenerating: false,
  result: null,         // {outputPath, segmentCount, clipCount, frameCount, planId}
  plan: null,           // editorial plan array for timeline view
};

Hub.renderSmartEditor = function () {
  const panel = document.getElementById('panel-smart-editor');
  if (!panel) return;

  const st = Hub.state.smartEditor;

  if (st.step === 'setup') {
    Hub._seRenderSetup(panel);
  } else if (st.step === 'generating') {
    Hub._seRenderGenerating(panel);
  } else if (st.step === 'timeline') {
    Hub._seRenderTimeline(panel);
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

      // Load the plan for timeline view
      if (result.planId) {
        try {
          const planData = await window.api.smartEditorLoadPlan(result.planId);
          if (planData.success) st.plan = planData.plan;
        } catch (_) {}
      }

      st.step = 'timeline';
      Hub.renderSmartEditor();
      Hub.showToast('Edição gerada! Revê a timeline.');
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

// ── Step 3: Timeline Review ──
Hub._seRenderTimeline = function (panel) {
  const st = Hub.state.smartEditor;
  const planData = st.plan;
  const plan = planData?.plan || [];
  const r = st.result || {};

  const stats = [];
  const clips = plan.filter(i => i.type === 'video_clip').length;
  const frames = plan.filter(i => i.type === 'still_frame').length;
  const totalDur = plan.length > 0 ? plan[plan.length - 1].endTime : 0;
  if (clips) stats.push(`${clips} clips`);
  if (frames) stats.push(`${frames} frames`);
  stats.push(`${Hub.fmtDur(totalDur)}`);

  panel.innerHTML = `
    <div class="section-header">
      <h2>Smart Editor — Timeline</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" id="seBackBtn">${Hub.icons.back} Voltar</button>
        <button class="btn btn-primary" id="seExportBtn">${Hub.icons.play} Exportar vídeo</button>
      </div>
    </div>
    <div class="se-timeline-stats">
      ${stats.join(' &middot; ')}
      ${r.outputPath ? ` &middot; <span class="se-already-exported">Já exportado</span>` : ''}
    </div>
    <div class="se-timeline-scroll">
      <div class="se-timeline" id="seTimeline">
        ${plan.map((item, idx) => Hub._seRenderTimelineItem(item, idx)).join('')}
      </div>
    </div>
  `;

  // Bind events
  document.getElementById('seBackBtn')?.addEventListener('click', () => {
    st.step = 'setup';
    Hub.renderSmartEditor();
  });

  document.getElementById('seExportBtn')?.addEventListener('click', () => {
    if (r.outputPath) {
      // Already exported
      Hub.showToast('Vídeo já exportado: ' + r.outputPath.split(/[\\/]/).pop());
      return;
    }
    Hub._seExportFromTimeline();
  });

  // Drag & drop reorder
  Hub._seBindTimelineDrag();

  // Click to expand/collapse details
  panel.querySelectorAll('.se-tl-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.se-tl-delete') || e.target.closest('.se-tl-swap')) return;
      el.classList.toggle('expanded');
    });
  });

  // Delete buttons
  panel.querySelectorAll('.se-tl-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      plan.splice(idx, 1);
      // Recalculate times
      Hub._seRecalcTimes(plan);
      Hub._seRenderTimeline(panel);
    });
  });

  // Type swap buttons
  panel.querySelectorAll('.se-tl-swap').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const item = plan[idx];
      if (item.type === 'video_clip') {
        item.type = 'still_frame';
        item.effect = 'zoom_in';
        delete item.clipDuration;
      } else {
        item.type = 'video_clip';
        item.clipDuration = Math.min(5, item.endTime - item.startTime);
        delete item.effect;
      }
      Hub._seRenderTimeline(panel);
    });
  });
};

Hub._seRenderTimelineItem = function (item, idx) {
  const dur = (item.endTime - item.startTime).toFixed(1);
  const isClip = item.type === 'video_clip';
  const badge = isClip ? 'clip' : 'frame';
  const badgeClass = isClip ? 'se-badge-clip' : 'se-badge-frame';
  const effectLabel = item.effect ? ` (${item.effect.replace('_', ' ')})` : '';

  const sceneMin = Math.floor(item.sceneTime / 60);
  const sceneSec = item.sceneTime % 60;
  const sceneTimeStr = `${sceneMin}:${String(sceneSec).padStart(2, '0')}`;

  const startStr = Hub.fmtDur(item.startTime);
  const endStr = Hub.fmtDur(item.endTime);

  // Width proportional to duration (min 40px)
  const widthPx = Math.max(40, Math.round((item.endTime - item.startTime) * 15));

  return `
    <div class="se-tl-item ${badgeClass}" data-idx="${idx}" style="min-width:${widthPx}px" draggable="true">
      <div class="se-tl-header">
        <span class="se-tl-badge ${badgeClass}">${badge}${effectLabel}</span>
        <span class="se-tl-ep">${item.episode} @ ${sceneTimeStr}</span>
        <span class="se-tl-dur">${dur}s</span>
      </div>
      <div class="se-tl-time">${startStr} → ${endStr}</div>
      <div class="se-tl-actions">
        <button class="btn-icon se-tl-swap" data-idx="${idx}" title="Trocar clip/frame">⇄</button>
        <button class="btn-icon se-tl-delete" data-idx="${idx}" title="Remover">${Hub.icons.x}</button>
      </div>
    </div>
  `;
};

Hub._seRecalcTimes = function (plan) {
  let t = 0;
  for (const item of plan) {
    const dur = item.endTime - item.startTime;
    item.startTime = t;
    item.endTime = t + dur;
    t += dur;
  }
};

Hub._seBindTimelineDrag = function () {
  const container = document.getElementById('seTimeline');
  if (!container) return;

  let dragIdx = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.se-tl-item');
    if (!item) return;
    dragIdx = parseInt(item.dataset.idx);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.se-tl-item');
    if (target) target.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.se-tl-item');
    if (target) target.classList.remove('drag-over');
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.se-tl-item');
    if (!target || dragIdx === null) return;
    const dropIdx = parseInt(target.dataset.idx);

    if (dragIdx !== dropIdx) {
      const st = Hub.state.smartEditor;
      const plan = st.plan?.plan || [];
      const [moved] = plan.splice(dragIdx, 1);
      plan.splice(dropIdx, 0, moved);
      Hub._seRecalcTimes(plan);
      Hub._seRenderTimeline(document.getElementById('panel-smart-editor'));
    }
    dragIdx = null;
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.dragging, .drag-over').forEach(el => {
      el.classList.remove('dragging', 'drag-over');
    });
    dragIdx = null;
  });
};

Hub._seExportFromTimeline = async function () {
  const st = Hub.state.smartEditor;
  if (!st.result?.planId) { Hub.showToast('Plano não encontrado', 'error'); return; }

  // Save updated plan
  await window.api.smartEditorSavePlan(st.plan);

  const bar = document.getElementById('genBar');
  const barPhase = document.getElementById('genBarPhase');
  const barFill = document.getElementById('genBarFill');
  const barPercent = document.getElementById('genBarPercent');

  barPhase.textContent = 'A exportar...';
  barFill.style.width = '0%';
  barPercent.textContent = '0%';
  bar.classList.remove('done');
  bar.classList.add('visible');

  window.api.onSmartEditorProgress((data) => {
    barFill.style.width = `${data.percent || 0}%`;
    barPercent.textContent = `${data.percent || 0}%`;
    barPhase.textContent = data.detail || data.phase || 'A exportar...';
  });

  const result = await window.api.smartEditorExport({
    planId: st.result.planId,
    audioPath: st.voiceoverPath,
    outputFolder: st.outputFolder || st.result.outputPath?.split(/[\\/]/).slice(0, -1).join('/'),
    outputFilename: 'smart_edit.mp4',
  });

  bar.classList.remove('visible');

  if (result.success) {
    st.result.outputPath = result.outputPath;
    st.step = 'result';
    Hub.renderSmartEditor();
    Hub.showToast('Vídeo exportado!');
  } else {
    Hub.showToast(`Erro: ${result.error}`, 'error');
  }
};

// ── Step 4: Result ──
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
