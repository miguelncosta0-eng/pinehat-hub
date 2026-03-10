window.Hub = window.Hub || {};

Hub.renderCompetitors = async function () {
  const panel = document.getElementById('panel-competitors');

  // Detail view
  if (Hub.state.viewingCompetitor) {
    await Hub._renderCompetitorDetail(panel, Hub.state.viewingCompetitor);
    return;
  }

  const competitors = await window.api.competitorsGet();

  panel.innerHTML = `
    <div class="section-header">
      <h2>Competidores</h2>
      <div class="section-header-actions">
        <button class="btn btn-secondary btn-small" id="compRefreshAllBtn">${Hub.icons.refresh} Atualizar Todos</button>
        <button class="btn btn-primary" id="compAddBtn">${Hub.icons.plus} Adicionar Canal</button>
      </div>
    </div>
    <div class="competitors-content">
      ${competitors.length === 0 ? `
        <div class="empty-state">
          ${Hub.icons.competitors}
          <h3>Nenhum competidor adicionado</h3>
          <p>Adiciona canais YouTube para acompanhar as suas métricas</p>
        </div>
      ` : `
        <div class="comp-grid">
          ${competitors.map((c) => Hub._renderCompCard(c)).join('')}
        </div>
      `}
    </div>
  `;

  panel.querySelector('#compAddBtn').addEventListener('click', () => Hub._openAddCompetitorModal());

  panel.querySelector('#compRefreshAllBtn').addEventListener('click', async () => {
    Hub.showToast('A atualizar todos os canais...');
    const result = await window.api.competitorsRefreshAll();
    if (result.success) {
      if (result.errors.length === 0) {
        Hub.showToast('Todos os canais atualizados!');
      } else if (result.errors.length < result.total) {
        Hub.showToast(`${result.total - result.errors.length}/${result.total} canais atualizados`);
        Hub.showToast(result.errors[0], 'error');
      } else {
        Hub.showToast(result.errors[0], 'error');
      }
      Hub.renderCompetitors();
    } else Hub.showToast(result.error, 'error');
  });

  panel.querySelectorAll('.comp-refresh-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await window.api.competitorsRefresh(btn.dataset.id);
      if (result.success) {
        Hub.showToast('Canal atualizado!');
        Hub.renderCompetitors();
      } else Hub.showToast(result.error, 'error');
    });
  });

  panel.querySelectorAll('.comp-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.comp-card');
      const name = card?.querySelector('.comp-card-title')?.textContent || 'este canal';
      Hub._confirmAction(`Remover "${name}" dos competidores?`, async () => {
        await window.api.competitorsRemove(btn.dataset.id);
        Hub.showToast('Canal removido');
        Hub.renderCompetitors();
      });
    });
  });

  // Click card → detail page
  panel.querySelectorAll('.comp-card').forEach((card) => {
    card.addEventListener('click', () => {
      Hub.state.viewingCompetitor = card.dataset.id;
      Hub.renderCompetitors();
    });
  });
};

Hub._renderCompCard = function (c) {
  return `
    <div class="comp-card" data-id="${c.id}">
      <div class="comp-card-header">
        <img class="comp-avatar" src="${c.thumbnail}" alt="${c.title}" onerror="this.style.display='none'">
        <div class="comp-card-info">
          <div class="comp-card-title">${c.title}</div>
          <div class="comp-card-url">${c.customUrl || c.channelId}</div>
        </div>
        <div class="comp-card-actions">
          <button class="btn-icon comp-refresh-btn" data-id="${c.id}" title="Atualizar">${Hub.icons.refresh}</button>
          <button class="btn-icon comp-remove-btn" data-id="${c.id}" title="Remover">${Hub.icons.x}</button>
        </div>
      </div>
      <div class="comp-stats">
        <div class="comp-stat">
          <div class="comp-stat-value">${Hub._fmtNum(c.subscriberCount)}</div>
          <div class="comp-stat-label">Subs</div>
        </div>
        <div class="comp-stat">
          <div class="comp-stat-value">${Hub._fmtNum(c.viewCount)}</div>
          <div class="comp-stat-label">Views</div>
        </div>
        <div class="comp-stat">
          <div class="comp-stat-value">${c.videoCount}</div>
          <div class="comp-stat-label">Vídeos</div>
        </div>
      </div>
      <div class="comp-updated">Atualizado: ${Hub.fmtDate(c.lastUpdated)}</div>
    </div>
  `;
};

Hub._fmtNum = function (n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(n);
};

Hub._fmtYtDuration = function (iso) {
  if (!iso) return '';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ── Add competitor modal ──
Hub._openAddCompetitorModal = function () {
  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <h3>Adicionar Canal</h3>
    <div class="project-detail">
      <div class="form-group">
        <label class="form-label">Canal YouTube</label>
        <input class="input" id="compInput" placeholder="@handle, URL do canal, ou ID do canal (UC...)">
        <div class="form-hint" style="font-size:11px;color:var(--text-dim);margin-top:4px;">
          Exemplos: @MrBeast, https://youtube.com/@ChannelName, UCxxxxxx
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="compAddCancel">Cancelar</button>
        <button class="btn btn-primary" id="compAddConfirm">${Hub.icons.plus} Adicionar</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');
  modal.querySelector('#compInput').focus();

  modal.querySelector('#compAddCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  const doAdd = async () => {
    const input = modal.querySelector('#compInput').value.trim();
    if (!input) { Hub.showToast('Introduz um canal', 'error'); return; }

    const btn = modal.querySelector('#compAddConfirm');
    btn.disabled = true;
    btn.textContent = 'A procurar...';

    const result = await window.api.competitorsAdd(input);
    if (result.success) {
      backdrop.classList.remove('visible');
      Hub.showToast(`Canal "${result.competitor.title}" adicionado!`);
      Hub.renderCompetitors();
    } else {
      btn.disabled = false;
      btn.innerHTML = `${Hub.icons.plus} Adicionar`;
      Hub.showToast(result.error, 'error');
    }
  };

  modal.querySelector('#compAddConfirm').addEventListener('click', doAdd);
  modal.querySelector('#compInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
  });
};

// ── Competitor detail page ──
Hub._renderCompetitorDetail = async function (panel, competitorId) {
  const competitors = await window.api.competitorsGet();
  const comp = competitors.find((c) => c.id === competitorId);
  if (!comp) {
    Hub.state.viewingCompetitor = null;
    Hub.renderCompetitors();
    return;
  }

  const history = comp.history || [];
  const hasHistory = history.length >= 2;

  panel.innerHTML = `
    <div class="comp-detail-page">
      <div class="section-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="btn btn-ghost btn-small" id="compBackBtn">${Hub.icons.back} Voltar</button>
          <img class="comp-detail-avatar" src="${comp.thumbnail}" alt="" onerror="this.style.display='none'">
          <div>
            <h2 style="margin:0;font-size:18px;">${comp.title}</h2>
            <div class="comp-detail-url">${comp.customUrl || comp.channelId}</div>
          </div>
        </div>
        <div class="section-header-actions">
          <button class="btn btn-secondary btn-small" id="compDetailRefresh">${Hub.icons.refresh} Atualizar</button>
        </div>
      </div>

      <div class="comp-detail-content">
        <div class="comp-detail-stats">
          <div class="comp-stat-big">
            <div class="comp-stat-value">${Hub._fmtNum(comp.subscriberCount)}</div>
            <div class="comp-stat-label">Subscritores</div>
          </div>
          <div class="comp-stat-big">
            <div class="comp-stat-value">${Hub._fmtNum(comp.viewCount)}</div>
            <div class="comp-stat-label">Views Totais</div>
          </div>
          <div class="comp-stat-big">
            <div class="comp-stat-value">${comp.videoCount}</div>
            <div class="comp-stat-label">Vídeos</div>
          </div>
        </div>

        ${hasHistory ? `
          <div class="chart-range-selector">
            <button class="chart-range-btn" data-range="7D">7D</button>
            <button class="chart-range-btn active" data-range="30D">30D</button>
            <button class="chart-range-btn" data-range="3M">3M</button>
            <button class="chart-range-btn" data-range="6M">6M</button>
            <button class="chart-range-btn" data-range="1Y">1Y</button>
          </div>

          <div class="chart-section">
            <h4>Subscritores</h4>
            <div class="chart-container" id="chartSubsContainer">
              <canvas id="chartSubs"></canvas>
            </div>
          </div>

          <div class="chart-section">
            <h4>Views Totais</h4>
            <div class="chart-container" id="chartViewsContainer">
              <canvas id="chartViews"></canvas>
            </div>
          </div>
        ` : `
          <div class="chart-no-data">
            <p>Sem dados históricos. Atualiza o canal regularmente para acumular dados para os gráficos.</p>
          </div>
        `}

        ${comp.recentVideos && comp.recentVideos.length > 0 ? `
          <div class="comp-videos-section">
            <h4>Vídeos Recentes</h4>
            <div class="comp-videos-list">
              ${comp.recentVideos.map((v) => `
                <div class="comp-video-item" data-video-id="${v.videoId}">
                  <img class="comp-video-thumb" src="${v.thumbnail}" alt="" onerror="this.style.display='none'">
                  <div class="comp-video-info">
                    <div class="comp-video-title">${v.title}</div>
                    <div class="comp-video-meta">
                      ${Hub._fmtNum(v.viewCount)} views
                      &middot; ${Hub._fmtNum(v.likeCount)} likes
                      &middot; ${Hub._fmtYtDuration(v.duration)}
                      &middot; ${Hub.fmtDate(v.publishedAt)}
                      <span class="comp-video-transcript-hint">📄 Ver transcrição</span>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="comp-detail-footer">
          <span style="font-size:11px;color:var(--text-dim);">
            Adicionado: ${Hub.fmtDate(comp.addedAt)} &middot; Atualizado: ${Hub.fmtDate(comp.lastUpdated)}
          </span>
        </div>
      </div>
    </div>
  `;

  // Back
  panel.querySelector('#compBackBtn').addEventListener('click', () => {
    Hub.state.viewingCompetitor = null;
    Hub.renderCompetitors();
  });

  // Refresh
  panel.querySelector('#compDetailRefresh').addEventListener('click', async () => {
    Hub.showToast('A atualizar...');
    const result = await window.api.competitorsRefresh(competitorId);
    if (result.success) {
      Hub.showToast('Canal atualizado!');
      Hub._renderCompetitorDetail(panel, competitorId);
    } else {
      Hub.showToast(result.error, 'error');
    }
  });

  // Charts
  if (hasHistory) {
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    let currentRange = '30D';

    const drawCharts = () => {
      const subsData = history.map((h) => ({ date: h.date, value: h.subscriberCount }));
      const viewsData = history.map((h) => ({ date: h.date, value: h.viewCount }));

      Hub.drawLineChart(panel.querySelector('#chartSubs'), [
        { label: 'Subscritores', data: subsData, color: accent },
      ], { timeRange: currentRange, formatValue: Hub._fmtNum });

      Hub.drawLineChart(panel.querySelector('#chartViews'), [
        { label: 'Views', data: viewsData, color: '#3b82f6' },
      ], { timeRange: currentRange, formatValue: Hub._fmtNum });
    };

    panel.querySelectorAll('.chart-range-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.chart-range-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = btn.dataset.range;
        drawCharts();
      });
    });

    drawCharts();

    const ro = new ResizeObserver(() => drawCharts());
    ro.observe(panel.querySelector('#chartSubsContainer'));
  }

  // ── Video transcript on click ──
  panel.querySelectorAll('.comp-video-item').forEach((item) => {
    item.addEventListener('click', () => {
      Hub._toggleVideoTranscript(panel, item);
    });
  });
};

// ── Toggle video transcript panel ──
Hub._toggleVideoTranscript = async function (panel, videoItem) {
  const videoId = videoItem.dataset.videoId;

  // If this item already has a transcript panel open, close it
  const existing = videoItem.nextElementSibling;
  if (existing && existing.classList.contains('comp-transcript-panel')) {
    existing.remove();
    videoItem.classList.remove('active');
    return;
  }

  // Close any other open transcript panels
  panel.querySelectorAll('.comp-transcript-panel').forEach((p) => p.remove());
  panel.querySelectorAll('.comp-video-item.active').forEach((v) => v.classList.remove('active'));

  // Mark this item as active
  videoItem.classList.add('active');

  // Insert loading state
  const transcriptPanel = document.createElement('div');
  transcriptPanel.className = 'comp-transcript-panel';
  transcriptPanel.innerHTML = `
    <div class="comp-transcript-loading">
      <span class="spinner"></span> A carregar transcrição...
    </div>
  `;
  videoItem.insertAdjacentElement('afterend', transcriptPanel);

  // Fetch transcript
  const result = await window.api.competitorsGetTranscript(videoId);

  if (!result.success) {
    transcriptPanel.innerHTML = `
      <div class="comp-transcript-error">
        ${result.error}
        <button class="btn btn-secondary btn-small comp-transcript-retry" style="margin-left:8px;">Tentar novamente</button>
      </div>
    `;
    transcriptPanel.querySelector('.comp-transcript-retry')?.addEventListener('click', () => {
      transcriptPanel.remove();
      videoItem.classList.remove('active');
      Hub._toggleVideoTranscript(panel, videoItem);
    });
    return;
  }

  const { fullText, wordCount, language } = result.transcript;
  const langLabel = language === 'en' ? 'Inglês'
    : (language === 'pt' || language === 'pt-BR') ? 'Português'
    : language === 'de' || language === 'de-DE' ? 'Alemão'
    : language === 'es' || language === 'es-419' ? 'Espanhol'
    : language === 'ja' ? 'Japonês'
    : language || 'Auto';

  transcriptPanel.innerHTML = `
    <div class="comp-transcript-header">
      <span class="comp-transcript-meta">
        ${wordCount.toLocaleString()} palavras &middot; Idioma: ${langLabel}
      </span>
      <div class="comp-transcript-actions">
        <button class="btn btn-secondary btn-small comp-transcript-copy">Copiar Transcrição</button>
        <button class="btn-icon comp-transcript-close" title="Fechar">${Hub.icons.x}</button>
      </div>
    </div>
    <div class="comp-transcript-body">${Hub._formatTranscriptText(fullText)}</div>
  `;

  // Copy handler
  transcriptPanel.querySelector('.comp-transcript-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(fullText).then(() => {
      Hub.showToast('Transcrição copiada!');
    }).catch(() => {
      Hub.showToast('Erro ao copiar', 'error');
    });
  });

  // Close handler
  transcriptPanel.querySelector('.comp-transcript-close').addEventListener('click', () => {
    transcriptPanel.remove();
    videoItem.classList.remove('active');
  });
};

// Format transcript text into paragraphs for readability
Hub._formatTranscriptText = function (text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const paragraphs = [];
  let current = [];
  sentences.forEach((s, i) => {
    current.push(s.trim());
    if (current.length >= 4 || i === sentences.length - 1) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  });
  return paragraphs.map((p) => `<p>${p}</p>`).join('');
};
