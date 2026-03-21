window.Hub = window.Hub || {};

Hub.renderBroll = function () {
  const panel = document.getElementById('panel-broll');

  if (!panel.querySelector('.broll-container')) {
    panel.innerHTML = `
      <div class="section-header">
        <h2>B-Roll Generator</h2>
      </div>
      <div class="broll-container" id="brollContainer">
        <div class="broll-settings">
          <div class="form-group"><label class="form-label">Duração total (h)</label><input class="input input-small" type="number" id="brollTotalHours" value="2" min="1" max="8" step="0.5"></div>
          <div class="form-group"><label class="form-label">Clip (seg)</label><input class="input input-small" type="number" id="brollClipDuration" value="5" min="2" max="30"></div>
          <div class="form-group"><label class="form-label">Saltar início (seg)</label><input class="input input-small" type="number" id="brollSkipStart" value="30" min="0" max="300" step="5"></div>
          <div class="form-group"><label class="form-label">Saltar fim (seg)</label><input class="input input-small" type="number" id="brollSkipEnd" value="30" min="0" max="300" step="5"></div>
          <div class="form-group"><label class="form-label">Nome ficheiro</label><input class="input input-small" type="text" id="brollFilename" value="broll_compilation.mp4"></div>
        </div>

        <div class="broll-output-row">
          <label>Saída:</label>
          <div class="broll-path-display" id="brollOutputPath">Automático (pasta do primeiro ficheiro)</div>
          <button class="btn btn-secondary btn-small" id="brollSelectOutput">Escolher</button>
        </div>

        <div class="broll-series-row">
          <label class="form-label">Carregar série</label>
          <select class="input" id="brollSeriesSelect"><option value="">-- Seleciona uma série --</option></select>
          <button class="btn btn-secondary btn-small" id="brollLoadSeries">Carregar</button>
        </div>

        <div class="broll-content-area" id="brollContent"></div>

        <div class="broll-action-bar" id="brollActionBar">
          <div class="broll-summary" id="brollSummary"></div>
          <button class="btn btn-primary" id="brollGenerateBtn" disabled>${Hub.icons.play} Gerar B-Roll</button>
        </div>
      </div>
    `;

    Hub._brollBindEvents();
    Hub._brollLoadSeriesDropdown();
  }

  Hub._brollRenderContent();
};

Hub._brollLoadSeriesDropdown = async function () {
  const select = document.getElementById('brollSeriesSelect');
  if (!select) return;
  try {
    const series = await window.api.seriesGetAll();
    select.innerHTML = '<option value="">-- Seleciona uma série --</option>';
    for (const s of series) {
      const epCount = s.episodes?.length || 0;
      select.innerHTML += `<option value="${s.id}">${s.name} (${epCount} episódios)</option>`;
    }
  } catch (_) { /* ignore */ }
};

Hub._brollLoadSeries = async function () {
  const select = document.getElementById('brollSeriesSelect');
  const seriesId = select?.value;
  if (!seriesId) { Hub.showToast('Seleciona uma série primeiro', 'error'); return; }

  const series = await window.api.seriesGetAll();
  const s = series.find(x => x.id === seriesId);
  if (!s || !s.episodes?.length) { Hub.showToast('Série sem episódios', 'error'); return; }

  const filePaths = s.episodes.map(ep => ep.filePath).filter(Boolean);
  if (filePaths.length === 0) { Hub.showToast('Nenhum ficheiro encontrado', 'error'); return; }

  // Clear existing files and load series episodes
  Hub.state.broll.files = [];
  Hub.state.broll.outputFolder = null;
  await Hub._brollAddFiles(filePaths);
  Hub.showToast(`${filePaths.length} episódios de "${s.name}" carregados`);
};

Hub._brollBindEvents = function () {
  const container = document.getElementById('brollContainer');

  document.getElementById('brollSelectOutput').addEventListener('click', async () => {
    const folder = await window.api.selectOutputFolder();
    if (folder) {
      Hub.state.broll.outputFolder = folder;
      document.getElementById('brollOutputPath').textContent = folder;
      Hub._brollUpdateSummary();
    }
  });

  ['brollTotalHours', 'brollClipDuration'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => Hub._brollUpdateSummary());
  });

  document.getElementById('brollGenerateBtn').addEventListener('click', () => Hub._brollGenerate());
  document.getElementById('brollLoadSeries').addEventListener('click', () => Hub._brollLoadSeries());

  // Drag & drop on entire container
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const dz = document.getElementById('brollDropZone');
    if (dz) dz.classList.add('active');
  });

  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      const dz = document.getElementById('brollDropZone');
      if (dz) dz.classList.remove('active');
    }
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dz = document.getElementById('brollDropZone');
    if (dz) dz.classList.remove('active');

    const files = Hub._extractDroppedMediaFiles(e);
    if (files.length > 0) {
      await Hub._brollAddFiles(files);
    } else if (e.dataTransfer.files.length > 0) {
      Hub.showToast('Formato não suportado. Usa MP4, MOV, MKV, AVI, JPG, PNG.', 'error');
    }
  });
};

Hub._extractDroppedMediaFiles = function (e) {
  const validExts = /\.(mp4|mov|avi|mkv|webm|mts|ts|wmv|jpg|jpeg|png|bmp|tiff|webp)$/i;
  const paths = [];
  if (e.dataTransfer && e.dataTransfer.files) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i];
      const filePath = window.api.getDroppedFilePath(file);
      if (filePath && validExts.test(filePath)) {
        paths.push(filePath);
      }
    }
  }
  return paths;
};

Hub._brollRenderContent = function () {
  const st = Hub.state.broll;
  const content = document.getElementById('brollContent');
  const hasFiles = st.files.length > 0;

  content.innerHTML = `
    <div class="broll-drop-zone${hasFiles ? ' compact' : ''}" id="brollDropZone">
      <div class="broll-drop-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </div>
      <h3>${hasFiles ? 'Arrasta mais ficheiros' : 'Arrasta vídeos e imagens para aqui'}</h3>
      <p>MP4, MOV, MKV, AVI, JPG, PNG</p>
      <button class="btn btn-secondary btn-small broll-browse-btn" type="button">Adicionar ficheiros</button>
    </div>
    ${hasFiles ? `
      <div class="broll-file-list">
        <div class="broll-file-list-header">
          <h4>${st.files.length} ficheiro${st.files.length !== 1 ? 's' : ''}</h4>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-secondary btn-small" id="brollAddFilesBtn">${Hub.icons.plus} Adicionar</button>
            <button class="btn btn-danger btn-small" id="brollClearBtn">${Hub.icons.trash} Limpar</button>
          </div>
        </div>
        ${st.files.map((f, i) => `
          <div class="broll-file-card">
            <div class="broll-file-icon${f.isImage ? ' img' : ''}">${f.isImage ? Hub.icons.image : Hub.icons.video}</div>
            <div class="broll-file-info">
              <div class="broll-file-name">${f.name}</div>
              <div class="broll-file-meta">${Hub.fmtDur(f.duration)}</div>
            </div>
            <button class="btn-icon broll-remove-btn" data-idx="${i}" title="Remover">${Hub.icons.x}</button>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  content.querySelector('#brollDropZone').addEventListener('click', async (e) => {
    if (e.target.closest('.broll-browse-btn')) return;
    const files = await window.api.selectFiles();
    if (files.length > 0) await Hub._brollAddFiles(files);
  });

  const browseBtn = content.querySelector('.broll-browse-btn');
  if (browseBtn) {
    browseBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const files = await window.api.selectFiles();
      if (files.length > 0) await Hub._brollAddFiles(files);
    });
  }

  content.querySelector('#brollAddFilesBtn')?.addEventListener('click', async () => {
    const files = await window.api.selectFiles();
    if (files.length > 0) await Hub._brollAddFiles(files);
  });

  content.querySelector('#brollClearBtn')?.addEventListener('click', () => {
    st.files = [];
    st.outputFolder = null;
    document.getElementById('brollOutputPath').textContent = 'Automático (pasta do primeiro ficheiro)';
    Hub._brollRenderContent();
  });

  content.querySelectorAll('.broll-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      st.files.splice(parseInt(btn.dataset.idx), 1);
      Hub._brollRenderContent();
    });
  });

  Hub._brollUpdateSummary();
};

Hub._brollAddFiles = async function (filePaths) {
  const st = Hub.state.broll;
  const imageExts = /\.(jpg|jpeg|png|bmp|tiff|webp)$/i;

  for (const fp of filePaths) {
    if (st.files.some((f) => f.path === fp)) continue;

    const name = fp.split(/[\\/]/).pop();
    const isImage = imageExts.test(fp);
    let duration = 0;

    if (!isImage) {
      try {
        const info = await window.api.getMediaInfo(fp);
        duration = info?.duration || 0;
      } catch { /* ignore */ }
    }

    st.files.push({ path: fp, name, duration, isImage });
  }

  if (!st.outputFolder && filePaths.length > 0) {
    const defaultFolder = await window.api.getFileDir(filePaths[0]);
    if (defaultFolder) {
      st.outputFolder = defaultFolder;
      document.getElementById('brollOutputPath').textContent = defaultFolder;
    }
  }

  Hub._brollRenderContent();
  Hub.showToast(`${filePaths.length} ficheiro(s) adicionado(s)`);
};

Hub._brollUpdateSummary = function () {
  const st = Hub.state.broll;
  const bar = document.getElementById('brollActionBar');
  const btn = document.getElementById('brollGenerateBtn');

  if (st.files.length === 0) {
    bar.classList.remove('visible');
    return;
  }

  bar.classList.add('visible');
  const videos = st.files.filter((f) => !f.isImage);
  const totalSrc = videos.reduce((s, v) => s + v.duration, 0);
  const hours = parseFloat(document.getElementById('brollTotalHours')?.value) || 2;
  const clipD = parseInt(document.getElementById('brollClipDuration')?.value) || 5;
  const numClips = Math.floor((hours * 3600) / clipD);

  document.getElementById('brollSummary').innerHTML = `
    <strong>${videos.length}</strong> vídeo${videos.length !== 1 ? 's' : ''}
    &middot; fonte: <strong>${Hub.fmtDur(totalSrc)}</strong>
    &middot; output: <strong>${hours}h</strong> (<strong>${numClips.toLocaleString()}</strong> clips)
  `;

  btn.disabled = st.isGenerating || st.files.length === 0;
};

Hub._fmtEta = function (ms) {
  if (!ms || !isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `~${totalSec}s restante`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `~${m}m ${s}s restante` : `~${m}m restante`;
};

Hub._brollGenerate = async function () {
  const st = Hub.state.broll;
  if (st.files.length === 0) return;

  let outputFolder = st.outputFolder;
  if (!outputFolder) {
    outputFolder = await window.api.getFileDir(st.files[0].path);
    if (!outputFolder) {
      Hub.showToast('Seleciona uma pasta de saída', 'error');
      return;
    }
  }

  st.isGenerating = true;
  Hub._brollUpdateSummary();

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

  // Cancel button
  const onCancel = async () => {
    await window.api.cancelGeneration();
    bar.classList.remove('visible');
    st.isGenerating = false;
    Hub._brollUpdateSummary();
    Hub.showToast('Geração cancelada', 'error');
  };
  barCancel.addEventListener('click', onCancel, { once: true });

  // Progress listener
  window.api.onGenerateProgress((data) => {
    barFill.style.width = `${data.percent}%`;
    barPercent.textContent = `${data.percent}%`;

    // Calculate ETA
    if (data.percent > 0 && data.phase !== 'done') {
      const elapsed = Date.now() - startTime;
      const remaining = (elapsed / data.percent) * (100 - data.percent);
      barEta.textContent = Hub._fmtEta(remaining);
    }

    if (data.phase === 'extracting') {
      barPhase.textContent = `A extrair clips... (${data.current.toLocaleString()}/${data.total.toLocaleString()})`;
    } else if (data.phase === 'concatenating') {
      barPhase.textContent = 'A juntar vídeo...';
    } else if (data.phase === 'done') {
      barPhase.textContent = 'Concluído!';
      barPercent.textContent = '100%';
      barEta.textContent = '';
    }
  });

  const result = await window.api.generateBroll({
    files: st.files.map((f) => ({ path: f.path, duration: f.duration, isImage: f.isImage })),
    outputFolder,
    totalHours: parseFloat(document.getElementById('brollTotalHours').value) || 2,
    clipDuration: parseInt(document.getElementById('brollClipDuration').value) || 5,
    skipStart: parseInt(document.getElementById('brollSkipStart').value) || 0,
    skipEnd: parseInt(document.getElementById('brollSkipEnd').value) || 0,
    outputFilename: document.getElementById('brollFilename').value || 'broll_compilation.mp4',
  });

  barCancel.removeEventListener('click', onCancel);
  st.isGenerating = false;
  Hub._brollUpdateSummary();

  if (result.success) {
    bar.classList.add('done');
    barPhase.textContent = `Concluído! ${result.numClips} clips`;
    barPercent.textContent = '100%';
    barEta.textContent = '';
    barFill.style.width = '100%';
    Hub.showToast(`B-Roll gerado! ${result.numClips} clips`);
    setTimeout(() => bar.classList.remove('visible', 'done'), 4000);
  } else {
    bar.classList.remove('visible');
    Hub.showToast(`Erro: ${result.error}`, 'error');
  }
};

// Prevent default Electron drag behavior
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
});
