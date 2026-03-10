window.Hub = window.Hub || {};

// ── Register progress listener once ──
window.api.onSeriesAnalyzeProgress((data) => {
  Hub._seriesAnalysisProgress(data);
});

Hub.renderSeries = async function () {
  const panel = document.getElementById('panel-series');
  const allSeries = await window.api.seriesGetAll();

  if (Hub.state.viewingSeries) {
    await Hub._renderSeriesDetail(panel, Hub.state.viewingSeries);
    return;
  }

  panel.innerHTML = `
    <div class="section-header">
      <h2>Séries</h2>
      <button class="btn btn-primary" id="addSeriesBtn">${Hub.icons.plus} Adicionar Série</button>
    </div>
    <div class="series-content">
      ${allSeries.length === 0 ? `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <h3>Nenhuma série adicionada</h3>
          <p>Adiciona uma série para criar uma base de dados de cenas com IA</p>
        </div>
      ` : `
        <div class="series-list">
          ${allSeries.map(s => {
            const total = s.episodes.length;
            const analyzed = s.episodes.filter(ep => ep.analyzed).length;
            return `
              <div class="series-card" data-id="${s.id}">
                <div class="sc-info">
                  <div class="sc-name">${Hub._escHtml(s.name)}</div>
                  <div class="sc-path">${Hub._escHtml(s.folderPath)}</div>
                  <div class="sc-stats">
                    <span class="badge badge-purple">${total} episódios</span>
                    ${analyzed > 0 ? `<span class="badge badge-green">${analyzed} analisados</span>` : ''}
                  </div>
                </div>
                <div class="sc-actions">
                  <button class="btn btn-secondary btn-small" data-action="open" data-id="${s.id}">Ver Episódios</button>
                  <button class="btn-icon" data-action="delete" data-id="${s.id}" title="Remover série">${Hub.icons.trash}</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  panel.querySelector('#addSeriesBtn')?.addEventListener('click', () => Hub._openAddSeriesModal());

  panel.querySelectorAll('[data-action="open"]').forEach(btn => {
    btn.addEventListener('click', () => {
      Hub.state.viewingSeries = btn.dataset.id;
      Hub.renderSeries();
    });
  });

  panel.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Hub._confirmAction('Tens a certeza que queres remover esta série e todos os dados de análise?', async () => {
        await window.api.seriesRemove(btn.dataset.id);
        Hub.showToast('Série removida');
        Hub.renderSeries();
      });
    });
  });
};

// ── Series Detail (episode list) ──
Hub._renderSeriesDetail = async function (panel, seriesId) {
  const allSeries = await window.api.seriesGetAll();
  const series = allSeries.find(s => s.id === seriesId);
  if (!series) { Hub.state.viewingSeries = null; Hub.renderSeries(); return; }

  const analyzing = Hub._seriesCurrentAnalysis;
  const analyzedCount = series.episodes.filter(ep => ep.analyzed).length;

  panel.innerHTML = `
    <div class="section-header">
      <button class="btn btn-ghost btn-small" id="seriesBackBtn">${Hub.icons.back} Séries</button>
      <h2>${Hub._escHtml(series.name)}</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-danger btn-small" id="seriesRemoveBtn" title="Remover esta série">🗑 Remover Série</button>
        <button class="btn btn-secondary btn-small" id="seriesRescanBtn">🔄 Re-scan</button>
        <button class="btn btn-secondary btn-small" id="seriesResetBtn" title="Apaga todos os dados de análise e começa do zero">🗑 Limpar Análise</button>
        <button class="btn btn-primary btn-small" id="seriesAnalyzeAllBtn" ${analyzing ? 'disabled' : ''}>
          ${analyzing ? '<span class="spinner"></span> A analisar...' : '🤖 Analisar Todos'}
        </button>
      </div>
    </div>

    <div class="series-detail-info">
      <span>${series.episodes.length} episódios · ${analyzedCount} analisados</span>
      <span class="series-folder-path">${Hub._escHtml(series.folderPath)}</span>
    </div>

    ${analyzing ? `
      <div class="series-analysis-bar" id="seriesAnalysisBar">
        <div class="series-analysis-status" id="seriesAnalysisStatus">A analisar...</div>
        <div class="series-progress-track"><div class="series-progress-fill" id="seriesProgressFill"></div></div>
        <button class="btn btn-secondary btn-small" id="seriesCancelBtn">Cancelar</button>
      </div>
    ` : ''}

    <div class="series-episode-list" id="seriesEpisodeList">
      ${series.episodes.map(ep => Hub._episodeRowHTML(ep, analyzing)).join('')}
    </div>
  `;

  panel.querySelector('#seriesBackBtn').addEventListener('click', () => {
    Hub.state.viewingSeries = null;
    Hub.renderSeries();
  });

  panel.querySelector('#seriesRemoveBtn').addEventListener('click', () => {
    Hub._confirmAction(`Tens a certeza que queres remover "${series.name}" e todos os dados de análise?`, async () => {
      await window.api.seriesRemove(seriesId);
      Hub.state.viewingSeries = null;
      Hub.showToast('Série removida');
      Hub.renderSeries();
    });
  });

  panel.querySelector('#seriesRescanBtn').addEventListener('click', async () => {
    await window.api.seriesRescan(seriesId);
    Hub.renderSeries();
    Hub.showToast('Episódios actualizados');
  });

  panel.querySelector('#seriesResetBtn').addEventListener('click', async () => {
    await window.api.seriesResetAnalysis(seriesId);
    Hub.showToast('Dados de análise limpos — podes analisar novamente');
    Hub.renderSeries();
  });

  panel.querySelector('#seriesAnalyzeAllBtn')?.addEventListener('click', () => {
    Hub._seriesAnalyzeAll(seriesId, series.episodes.filter(ep => !ep.analyzed));
  });

  panel.querySelector('#seriesCancelBtn')?.addEventListener('click', async () => {
    await window.api.seriesCancelAnalysis();
  });

  panel.querySelectorAll('[data-action="analyze-ep"]').forEach(btn => {
    btn.addEventListener('click', () => {
      Hub._seriesAnalyzeAll(seriesId, [{ code: btn.dataset.code }]);
    });
  });

  panel.querySelectorAll('.ep-scenes-toggle').forEach(badge => {
    badge.addEventListener('click', () => {
      const scenesEl = document.getElementById(`epScenes_${badge.dataset.code}`);
      if (!scenesEl) return;
      const open = !scenesEl.classList.contains('hidden');
      scenesEl.classList.toggle('hidden', open);
      badge.textContent = badge.textContent.replace(open ? ' ▴' : ' ▾', open ? ' ▾' : ' ▴');
    });
  });
};

Hub._episodeRowHTML = function (ep, analyzing) {
  const isActive = analyzing && analyzing.code === ep.code;
  const hasScenes = ep.analyzed && ep.scenes && ep.scenes.filter(s => s.description).length > 0;
  return `
    <div class="series-ep-row ${ep.analyzed ? 'analyzed' : ''} ${isActive ? 'analyzing' : ''}" data-code="${ep.code}">
      <span class="ep-code">${ep.code}</span>
      <span class="ep-filename">${Hub._escHtml(ep.filename)}</span>
      <div class="ep-status">
        ${ep.analyzed
          ? `<span class="badge badge-green ${hasScenes ? 'ep-scenes-toggle' : ''}" data-code="${ep.code}" style="${hasScenes ? 'cursor:pointer;' : ''}">✓ ${ep.scenes.filter(s => s.description).length} cenas${hasScenes ? ' ▾' : ''}</span>`
          : isActive
            ? `<span class="ep-progress-text" id="epProgress_${ep.code}">A extrair frames...</span>`
            : `<button class="btn btn-secondary btn-small" data-action="analyze-ep" data-code="${ep.code}">Analisar</button>`
        }
      </div>
    </div>
    ${hasScenes ? `<div class="ep-scenes-list hidden" id="epScenes_${ep.code}">${ep.scenes.filter(s => s.description).map(s => `
      <div class="ep-scene-item">
        <span class="ep-scene-time">${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2,'0')}</span>
        <span class="ep-scene-desc">${Hub._escHtml(s.description)}</span>
      </div>`).join('')}</div>` : ''}
  `;
};

// ── Analysis queue ──
Hub._seriesCurrentAnalysis = null;
Hub._seriesAnalysisQueue   = [];

Hub._seriesAnalyzeAll = async function (seriesId, episodes) {
  if (Hub._seriesCurrentAnalysis) return;
  const unanalyzed = episodes.filter(ep => !ep.analyzed || ep.scenes?.length === 0);
  if (unanalyzed.length === 0) { Hub.showToast('Todos os episódios já estão analisados'); return; }

  Hub._seriesAnalysisQueue = [...unanalyzed];
  await Hub._seriesAnalyzeNext(seriesId);
};

Hub._seriesAnalyzeNext = async function (seriesId) {
  if (Hub._seriesAnalysisQueue.length === 0) {
    Hub._seriesCurrentAnalysis = null;
    Hub.showToast('Análise concluída!');
    Hub.renderSeries();
    return;
  }

  const ep = Hub._seriesAnalysisQueue.shift();
  Hub._seriesCurrentAnalysis = { seriesId, code: ep.code };
  Hub.renderSeries();

  try {
    const result = await window.api.seriesAnalyzeEpisode({ seriesId, episodeCode: ep.code });
    if (!result.success) {
      // Log error but continue to next episode
      console.warn(`Erro em ${ep.code}: ${result.error}`);
    }
  } catch (err) {
    console.warn(`Exceção em ${ep.code}:`, err);
  }

  // Always continue to next episode regardless of error
  Hub._seriesAnalyzeNext(seriesId);
};

Hub._seriesAnalysisProgress = function (data) {
  if (Hub.state.activeSection !== 'series') return;

  const statusEl = document.getElementById('seriesAnalysisStatus');
  const fillEl   = document.getElementById('seriesProgressFill');
  const epEl     = document.getElementById(`epProgress_${data.episodeCode}`);

  if (data.phase === 'extracting') {
    if (statusEl) statusEl.textContent = `${data.episodeCode}: A extrair frames...`;
    if (epEl) epEl.textContent = 'A extrair frames...';
  } else if (data.phase === 'analyzing') {
    const pct = Math.round((data.current / data.total) * 100);
    if (statusEl) statusEl.textContent = `${data.episodeCode}: Frame ${data.current}/${data.total} (~${Math.floor(data.timeSeconds / 60)}min)`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (epEl) epEl.textContent = `Frame ${data.current}/${data.total}...`;
  } else if (data.phase === 'frame-error') {
    if (statusEl) { statusEl.textContent = `${data.episodeCode}: Erro ffmpeg: ${data.error}`; statusEl.style.color = '#f87171'; }
    console.error('[Series] Frame extraction error:', data.error);
    Hub.showToast(`ffmpeg: ${data.error.slice(0, 80)}`, 'error');
  } else if (data.phase === 'episode-saved') {
    const detailInfo = document.querySelector('.series-detail-info span');
    if (detailInfo) {
      const m = detailInfo.textContent.match(/(\d+) episódios/);
      if (m) detailInfo.textContent = `${m[1]} episódios · ${data.analyzedCount} analisados`;
    }
    if (statusEl) { statusEl.textContent = `${data.episodeCode}: guardado (${data.validScenes} cenas)`; statusEl.style.color = ''; }
  } else if (data.phase === 'save-error') {
    if (statusEl) { statusEl.textContent = `${data.episodeCode}: ERRO ao guardar: ${data.error}`; statusEl.style.color = '#f87171'; }
    Hub.showToast(`Erro ao guardar ${data.episodeCode}: ${data.error}`, 'error');
    console.error('[Series] Save error:', data.error);
  } else if (data.phase === 'done') {
    if (data.cancelled) {
      Hub._seriesCurrentAnalysis = null;
      Hub._seriesAnalysisQueue = [];
      Hub.showToast('Análise cancelada');
      Hub.renderSeries();
    }
  }
};

// ── Add Series Modal ──
Hub._openAddSeriesModal = function () {
  const backdrop = document.getElementById('modalBackdrop');
  const modal    = document.getElementById('modalContent');

  modal.innerHTML = `
    <h3>Adicionar Série</h3>
    <div class="project-detail">
      <div class="form-group">
        <label class="form-label">Nome da série</label>
        <input class="input" id="asName" placeholder="ex: Gravity Falls">
      </div>
      <div class="form-group">
        <label class="form-label">Pasta dos episódios</label>
        <div style="display:flex;gap:8px;">
          <input class="input" id="asFolder" placeholder="Seleciona a pasta..." readonly style="flex:1;">
          <button class="btn btn-secondary" id="asFolderBtn">Procurar</button>
        </div>
        <div class="form-hint">Ficheiros devem ter S01E01, S02E03, etc. no nome</div>
      </div>
      <div id="asScanPreview"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="asCancel">Cancelar</button>
        <button class="btn btn-primary" id="asAdd" disabled>Adicionar</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');
  setTimeout(() => modal.querySelector('#asName')?.focus(), 100);

  const folderInput  = modal.querySelector('#asFolder');
  const addBtn       = modal.querySelector('#asAdd');
  const previewEl    = modal.querySelector('#asScanPreview');

  modal.querySelector('#asFolderBtn').addEventListener('click', async () => {
    const folder = await window.api.seriesSelectFolder();
    if (!folder) return;
    folderInput.value = folder;
    previewEl.innerHTML = '<div class="form-hint">A verificar episódios...</div>';
    // Quick feedback - just show path
    previewEl.innerHTML = `<div class="form-hint">Pasta seleccionada. Clica "Adicionar" para detetar episódios.</div>`;
    addBtn.disabled = !modal.querySelector('#asName').value.trim();
  });

  modal.querySelector('#asName').addEventListener('input', () => {
    addBtn.disabled = !modal.querySelector('#asName').value.trim() || !folderInput.value;
  });

  modal.querySelector('#asCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  addBtn.addEventListener('click', async () => {
    const name = modal.querySelector('#asName').value.trim();
    const folderPath = folderInput.value;
    if (!name || !folderPath) return;

    addBtn.disabled = true;
    addBtn.textContent = 'A adicionar...';
    const series = await window.api.seriesAdd({ name, folderPath });
    backdrop.classList.remove('visible');
    Hub.showToast(`Série "${name}" adicionada — ${series.episodes.length} episódios detetados`);
    Hub.state.viewingSeries = series.id;
    Hub.renderSeries();
  });
};
