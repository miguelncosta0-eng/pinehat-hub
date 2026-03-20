window.Hub = window.Hub || {};

const PROJECT_STATES = [
  { id: 'ideia', label: 'Ideia', emoji: '💡' },
  { id: 'script', label: 'Script', emoji: '📝' },
  { id: 'edicao', label: 'Edição', emoji: '✂️' },
  { id: 'pronto', label: 'Pronto', emoji: '✅' },
  { id: 'publicado', label: 'Publicado', emoji: '🚀' },
];

const CAL_WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// ── Main renderer (dispatcher) ──
Hub.renderProjects = async function () {
  const panel = document.getElementById('panel-projects');
  const ch = Hub.state.activeChannel;
  const view = Hub.state.projectsView || 'kanban';

  const [projects, allScripts] = await Promise.all([
    window.api.getProjects({ channel: ch }),
    window.api.getScripts({}),
  ]);
  const scriptMap = {};
  allScripts.forEach((s) => { scriptMap[s.id] = s; });

  const isShared = !!(Hub.state.channels[ch]?.shared);

  panel.innerHTML = `
    <div class="section-header">
      <h2>Projetos${isShared ? ' <span class="shared-badge-header">Partilhado</span>' : ''}</h2>
      <div class="view-toggle">
        <button class="view-toggle-btn ${view === 'kanban' ? 'active' : ''}" data-view="kanban">
          ${Hub.icons.kanban} Kanban
        </button>
        <button class="view-toggle-btn ${view === 'calendar' ? 'active' : ''}" data-view="calendar">
          ${Hub.icons.calendar} Calendário
        </button>
      </div>
      <button class="btn btn-primary" id="newProjectBtn">${Hub.icons.plus} Novo Projeto</button>
    </div>
    <div id="projectsViewContainer"></div>
  `;

  // View toggle
  panel.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      Hub.state.projectsView = btn.dataset.view;
      Hub.renderProjects();
    });
  });

  // New project
  panel.querySelector('#newProjectBtn').addEventListener('click', () => Hub.openNewProjectModal());

  // Render active view
  const container = panel.querySelector('#projectsViewContainer');
  if (view === 'calendar') {
    Hub._renderCalendarView(container, projects, scriptMap);
  } else {
    Hub._renderKanbanView(container, projects, scriptMap);
  }
};

// ── Kanban View ──
Hub._renderKanbanView = function (container, projects, scriptMap) {
  container.innerHTML = `
    <div class="kanban">
      ${PROJECT_STATES.map((col) => {
        const items = projects.filter((p) => p.state === col.id);
        return `
          <div class="kanban-column" data-state="${col.id}">
            <div class="kanban-column-header">
              <h4>${col.label}</h4>
              <span class="col-count">${items.length}</span>
            </div>
            <div class="kanban-column-body" data-state="${col.id}">
              ${items.map((p) => Hub._renderProjectCard(p, scriptMap, false)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Click to open detail (but not after a drag)
  let wasDragging = false;
  container.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('mousedown', () => { wasDragging = false; });
    card.addEventListener('mousemove', () => { wasDragging = true; });
    card.addEventListener('click', (e) => {
      if (wasDragging) { e.stopPropagation(); return; }
      Hub._openProjectDetail(card.dataset.id);
    });
  });

  // Drag & Drop
  Hub._initKanbanDragDrop(container);
};

// ── Shared project card ──
Hub._renderProjectCard = function (p, scriptMap, compact) {
  if (compact) {
    return `
      <div class="project-card-compact" data-id="${p.id}">
        ${p.thumbnail ? `<img class="pcc-thumb" src="file://${p.thumbnail.replace(/\\/g, '/')}" alt="">` : `<span class="pc-channel-dot" style="background:${Hub.channelDot(p.channel)}"></span>`}
        <span class="pcc-title">${Hub._escHtml(p.title)}</span>
        ${Hub.stateBadge(p.state)}
      </div>
    `;
  }
  return `
    <div class="project-card" data-id="${p.id}" draggable="true">
      ${p.thumbnail ? `<div class="pc-thumbnail"><img src="file://${p.thumbnail.replace(/\\/g, '/')}" alt="" draggable="false"></div>` : ''}
      <div class="pc-title">${Hub._escHtml(p.title)}</div>
      <div class="pc-meta">
        <span class="pc-channel-dot" style="background:${Hub.channelDot(p.channel)}"></span>
        ${p.format ? `<span class="pc-format">${Hub._projectFormatLabel(p.channel, p.format)}</span>` : ''}
      </div>
      ${p.scriptId && scriptMap[p.scriptId] ? `<div class="pc-script-badge">📝 ${Hub._escHtml(scriptMap[p.scriptId].title)}</div>` : ''}
      ${p.voiceover ? `<div class="pc-vo-badge">🎙️ ${p.voiceover.split(/[\\/]/).pop()}</div>` : ''}
      ${p.publishDate ? `<div class="pc-date-badge">📅 ${Hub.fmtDate(p.publishDate)}</div>` : ''}
      ${p.notes ? `<div class="pc-notes">${Hub._escHtml(p.notes)}</div>` : ''}
    </div>
  `;
};

// ── Calendar View ──
Hub._renderCalendarView = function (container, projects, scriptMap) {
  const month = Hub.state.calendarMonth || new Date();
  const year = month.getFullYear();
  const mon = month.getMonth();

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const monthLabel = new Date(year, mon).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  // Build date map
  const dateMap = {};
  projects.forEach((p) => {
    if (p.publishDate) {
      if (!dateMap[p.publishDate]) dateMap[p.publishDate] = [];
      dateMap[p.publishDate].push(p);
    }
  });

  // Calendar grid dates
  const firstDay = new Date(year, mon, 1);
  const lastDay = new Date(year, mon + 1, 0);
  // Monday-start: (getDay() + 6) % 7
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();

  // How many cells: fill previous month padding + days in month
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;

  let cellsHtml = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    const isCurrentMonth = dayNum >= 1 && dayNum <= totalDays;

    if (!isCurrentMonth) {
      cellsHtml += `<div class="cal-cell cal-cell-other"></div>`;
      continue;
    }

    const dateStr = `${year}-${String(mon + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayProjects = dateMap[dateStr] || [];

    cellsHtml += `
      <div class="cal-cell${isToday ? ' cal-today' : ''}" data-date="${dateStr}">
        <div class="cal-day-num">${dayNum}</div>
        <div class="cal-day-projects">
          ${dayProjects.map((p) => Hub._renderProjectCard(p, scriptMap, true)).join('')}
        </div>
      </div>
    `;
  }

  // Count projects without date
  const noDateCount = projects.filter((p) => !p.publishDate).length;

  container.innerHTML = `
    <div class="cal-nav">
      <button class="btn btn-secondary btn-small" id="calPrev">&larr;</button>
      <span class="cal-month-label">${monthLabel}</span>
      <button class="btn btn-secondary btn-small" id="calNext">&rarr;</button>
      <button class="btn btn-secondary btn-small" id="calToday">Hoje</button>
      ${noDateCount > 0 ? `<span class="cal-no-date-info">${noDateCount} projeto${noDateCount > 1 ? 's' : ''} sem data</span>` : ''}
    </div>
    <div class="cal-header-row">
      ${CAL_WEEKDAYS.map((d) => `<div class="cal-header-cell">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">
      ${cellsHtml}
    </div>
  `;

  // Month navigation
  container.querySelector('#calPrev').addEventListener('click', () => {
    Hub.state.calendarMonth = new Date(year, mon - 1, 1);
    Hub.renderProjects();
  });
  container.querySelector('#calNext').addEventListener('click', () => {
    Hub.state.calendarMonth = new Date(year, mon + 1, 1);
    Hub.renderProjects();
  });
  container.querySelector('#calToday').addEventListener('click', () => {
    Hub.state.calendarMonth = new Date();
    Hub.renderProjects();
  });

  // Click on empty area of a day → new project with that date
  container.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      // If they clicked on a project card, open detail instead
      const card = e.target.closest('.project-card-compact');
      if (card) {
        Hub._openProjectDetail(card.dataset.id);
        return;
      }
      Hub.openNewProjectModal(cell.dataset.date);
    });
  });
};

// Simple HTML escape
Hub._escHtml = function (str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// Format label for projects
Hub._projectFormatLabel = function (channelId, formatId) {
  const ch = Hub.state.channels[channelId];
  if (!ch) return formatId;
  const fmt = ch.formats.find((f) => f.id === formatId);
  return fmt ? fmt.name : formatId;
};

// ── Kanban Drag & Drop ──
// Uses invisible drop-zone overlays that appear on top of columns during drag.
// This avoids all issues with pointer-events, overflow, and nested elements.
Hub._initKanbanDragDrop = function (panel) {
  let draggedId = null;
  const columns = panel.querySelectorAll('.kanban-column');

  // Create invisible drop overlays on top of each column
  columns.forEach((col) => {
    const overlay = document.createElement('div');
    overlay.className = 'kanban-drop-overlay';
    overlay.dataset.state = col.dataset.state;
    overlay.style.cssText = 'display:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:100;';
    col.style.position = 'relative';
    col.appendChild(overlay);

    overlay.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    overlay.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });
    overlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const projectId = e.dataTransfer.getData('text/plain') || draggedId;
      if (!projectId) return;
      await window.api.updateProject(projectId, { state: col.dataset.state });
      Hub.renderProjects();
    });
  });

  function showOverlays() {
    columns.forEach((col) => {
      const ov = col.querySelector('.kanban-drop-overlay');
      if (ov) ov.style.display = 'block';
    });
  }
  function hideOverlays() {
    columns.forEach((col) => {
      const ov = col.querySelector('.kanban-drop-overlay');
      if (ov) ov.style.display = 'none';
      col.classList.remove('drag-over');
    });
  }

  panel.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
      requestAnimationFrame(() => {
        card.classList.add('dragging');
        showOverlays();
      });
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedId = null;
      hideOverlays();
    });
  });
};

// ── New project modal ──
Hub.openNewProjectModal = async function (defaultDate) {
  const ch = Hub.state.activeChannel;
  const channels = Hub.state.channels;
  const formats = channels[ch]?.formats || [];
  const allScripts = await window.api.getScripts({ channel: ch });

  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <h3>Novo Projeto</h3>
    <div class="project-detail">
      <div class="form-group">
        <label class="form-label">Título</label>
        <input class="input" id="npTitle" placeholder="Título do vídeo">
      </div>
      <div class="pd-row">
        <div class="form-group">
          <label class="form-label">Canal</label>
          <select class="input" id="npChannel">
            <option value="pinehat" ${ch === 'pinehat' ? 'selected' : ''}>Pine Hat</option>
            <option value="papertown" ${ch === 'papertown' ? 'selected' : ''}>Paper Town</option>
            <option value="cortoon" ${ch === 'cortoon' ? 'selected' : ''}>Cortoon</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Formato</label>
          <select class="input" id="npFormat">
            <option value="">Nenhum</option>
            ${formats.map((f) => `<option value="${f.id}">${f.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Script</label>
        <select class="input" id="npScript">
          <option value="">Nenhum</option>
          ${allScripts.map((s) => `<option value="${s.id}">${Hub._escHtml(s.title)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Data de Publicação</label>
        <input class="input" type="date" id="npPublishDate" value="${defaultDate || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Thumbnail</label>
        <div class="thumbnail-picker" id="npThumbnailPicker">
          <div class="thumbnail-preview" id="npThumbnailPreview">
            <span class="thumbnail-placeholder">Click to select thumbnail</span>
          </div>
          <input type="hidden" id="npThumbnail" value="">
          <button class="btn btn-small btn-secondary thumbnail-clear" id="npThumbnailClear" style="display:none">✕ Remove</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notas</label>
        <textarea class="textarea" id="npNotes" rows="3" placeholder="Notas opcionais..."></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="npCancel">Cancelar</button>
        <button class="btn btn-primary" id="npCreate">Criar Projeto</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');

  const channelSelect = modal.querySelector('#npChannel');
  const formatSelect = modal.querySelector('#npFormat');
  const scriptSelect = modal.querySelector('#npScript');
  channelSelect.addEventListener('change', async () => {
    const newCh = channelSelect.value;
    const chFormats = channels[newCh]?.formats || [];
    formatSelect.innerHTML = `<option value="">Nenhum</option>` +
      chFormats.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
    const chScripts = await window.api.getScripts({ channel: newCh });
    scriptSelect.innerHTML = `<option value="">Nenhum</option>` +
      chScripts.map((s) => `<option value="${s.id}">${Hub._escHtml(s.title)}</option>`).join('');
  });

  Hub._initThumbnailPicker(modal, 'np');

  modal.querySelector('#npCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  modal.querySelector('#npCreate').addEventListener('click', async () => {
    const title = modal.querySelector('#npTitle').value.trim();
    if (!title) { Hub.showToast('Escreve um título', 'error'); return; }
    await window.api.createProject({
      title,
      channel: channelSelect.value,
      format: formatSelect.value || null,
      scriptId: modal.querySelector('#npScript').value || null,
      publishDate: modal.querySelector('#npPublishDate').value || null,
      notes: modal.querySelector('#npNotes').value,
      thumbnail: modal.querySelector('#npThumbnail').value || null,
    });
    backdrop.classList.remove('visible');
    Hub.showToast('Projeto criado!');
    Hub.renderProjects();
  });
};

// ── Project detail modal ──
Hub._openProjectDetail = async function (projectId) {
  const projects = await window.api.getProjects({ channel: Hub.state.activeChannel });
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;

  const allScripts = await window.api.getScripts({ channel: project.channel });

  const channels = Hub.state.channels;
  const chFormats = channels[project.channel]?.formats || [];

  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <h3>Editar Projeto</h3>
    <div class="project-detail">
      <div class="form-group">
        <label class="form-label">Título</label>
        <input class="input" id="epTitle" value="${Hub._escHtml(project.title)}">
      </div>

      <div class="form-group">
        <label class="form-label">Estado</label>
        <div class="move-btns" id="epStateBtns">
          ${PROJECT_STATES.map((s) => `
            <button class="move-btn${project.state === s.id ? ' current' : ''}" data-state="${s.id}">
              ${s.emoji} ${s.label}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="pd-row">
        <div class="form-group">
          <label class="form-label">Canal</label>
          <select class="input" id="epChannel">
            <option value="pinehat" ${project.channel === 'pinehat' ? 'selected' : ''}>Pine Hat</option>
            <option value="papertown" ${project.channel === 'papertown' ? 'selected' : ''}>Paper Town</option>
            <option value="cortoon" ${project.channel === 'cortoon' ? 'selected' : ''}>Cortoon</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Formato</label>
          <select class="input" id="epFormat">
            <option value="">Nenhum</option>
            ${chFormats.map((f) => `<option value="${f.id}" ${project.format === f.id ? 'selected' : ''}>${f.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Script</label>
        <select class="input" id="epScript">
          <option value="">Nenhum</option>
          ${allScripts.map((s) => `<option value="${s.id}" ${project.scriptId === s.id ? 'selected' : ''}>${Hub._escHtml(s.title)}</option>`).join('')}
        </select>
      </div>

      <div class="pd-row">
        <div class="form-group">
          <label class="form-label">Data de Publicação</label>
          <input class="input" type="date" id="epPublishDate" value="${project.publishDate || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Link YouTube</label>
          <input class="input" id="epYoutube" value="${project.youtubeUrl || ''}" placeholder="https://youtube.com/watch?v=...">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Voiceover</label>
        <div class="vo-file-picker">
          <div class="vo-file-display" id="epVoiceoverDisplay">
            ${project.voiceover ? `
              <span class="vo-file-icon">🎙️</span>
              <span class="vo-file-path">${project.voiceover.split(/[\\/]/).pop()}</span>
              <button class="btn-icon vo-file-remove" id="epVoiceoverRemove" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            ` : `
              <button class="btn btn-small btn-secondary" id="epVoiceoverSelect">🎙️ Select voiceover file</button>
            `}
          </div>
          <input type="hidden" id="epVoiceover" value="${project.voiceover || ''}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Thumbnail</label>
        <div class="thumbnail-picker" id="epThumbnailPicker">
          <div class="thumbnail-preview" id="epThumbnailPreview">
            ${project.thumbnail ? `<img src="file://${project.thumbnail.replace(/\\/g, '/')}" alt="Thumbnail">` : '<span class="thumbnail-placeholder">Click to select thumbnail</span>'}
          </div>
          <input type="hidden" id="epThumbnail" value="${project.thumbnail || ''}">
          <button class="btn btn-small btn-secondary thumbnail-clear" id="epThumbnailClear" style="${project.thumbnail ? '' : 'display:none'}">✕ Remove</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Notas</label>
        <textarea class="textarea" id="epNotes" rows="3">${project.notes || ''}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Upload Checklist</label>
        <div class="upload-checklist" id="epChecklist">
          ${Hub._renderChecklist(project.checklist)}
        </div>
      </div>

      <div class="pd-dates">
        <span>Criado: ${Hub.fmtDate(project.createdAt)}</span>
        <span>Atualizado: ${Hub.fmtDate(project.updatedAt)}</span>
      </div>

      <div class="modal-actions">
        <button class="btn btn-danger btn-small" id="epDelete">Apagar</button>
        <div style="flex:1"></div>
        <button class="btn btn-secondary" id="epCancel">Cancelar</button>
        <button class="btn btn-primary" id="epSave">Guardar</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');

  // State quick-change buttons
  let selectedState = project.state;
  modal.querySelectorAll('#epStateBtns .move-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedState = btn.dataset.state;
      modal.querySelectorAll('#epStateBtns .move-btn').forEach((b) => b.classList.remove('current'));
      btn.classList.add('current');
    });
  });

  // Update formats and scripts when channel changes
  const channelSelect = modal.querySelector('#epChannel');
  const formatSelect = modal.querySelector('#epFormat');
  const scriptSelect = modal.querySelector('#epScript');
  channelSelect.addEventListener('change', async () => {
    const ch = channelSelect.value;
    const newFormats = channels[ch]?.formats || [];
    formatSelect.innerHTML = `<option value="">Nenhum</option>` +
      newFormats.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
    const chScripts = await window.api.getScripts({ channel: ch });
    scriptSelect.innerHTML = `<option value="">Nenhum</option>` +
      chScripts.map((s) => `<option value="${s.id}">${Hub._escHtml(s.title)}</option>`).join('');
  });

  Hub._initThumbnailPicker(modal, 'ep');
  Hub._initVoiceoverPicker(modal);
  Hub._initChecklist(modal);

  modal.querySelector('#epCancel').addEventListener('click', () => backdrop.classList.remove('visible'));

  modal.querySelector('#epSave').addEventListener('click', async () => {
    await window.api.updateProject(projectId, {
      title: modal.querySelector('#epTitle').value.trim(),
      channel: channelSelect.value,
      state: selectedState,
      format: formatSelect.value || null,
      scriptId: modal.querySelector('#epScript').value || null,
      publishDate: modal.querySelector('#epPublishDate').value || null,
      youtubeUrl: modal.querySelector('#epYoutube').value || null,
      notes: modal.querySelector('#epNotes').value,
      thumbnail: modal.querySelector('#epThumbnail').value || null,
      voiceover: modal.querySelector('#epVoiceover').value || null,
      checklist: Hub._getChecklistState(modal),
    });
    backdrop.classList.remove('visible');
    Hub.showToast('Projeto atualizado!');
    Hub.renderProjects();
  });

  modal.querySelector('#epDelete').addEventListener('click', async () => {
    Hub._confirmAction('Tens a certeza que queres apagar este projeto?', async () => {
      await window.api.deleteProject(projectId);
      backdrop.classList.remove('visible');
      Hub.showToast('Projeto apagado');
      Hub.renderProjects();
    });
  });
};

// ── Thumbnail picker helper ──
Hub._initThumbnailPicker = function (modal, prefix) {
  const preview = modal.querySelector(`#${prefix}ThumbnailPreview`);
  const input = modal.querySelector(`#${prefix}Thumbnail`);
  const clearBtn = modal.querySelector(`#${prefix}ThumbnailClear`);

  preview.addEventListener('click', async () => {
    const filePath = await window.api.selectImage();
    if (!filePath) return;
    input.value = filePath;
    preview.innerHTML = `<img src="file://${filePath.replace(/\\/g, '/')}" alt="Thumbnail">`;
    clearBtn.style.display = '';
  });

  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    input.value = '';
    preview.innerHTML = '<span class="thumbnail-placeholder">Click to select thumbnail</span>';
    clearBtn.style.display = 'none';
  });
};

// ── Voiceover picker helper ──
Hub._initVoiceoverPicker = function (modal) {
  const display = modal.querySelector('#epVoiceoverDisplay');
  const input = modal.querySelector('#epVoiceover');
  if (!display || !input) return;

  const selectBtn = modal.querySelector('#epVoiceoverSelect');
  if (selectBtn) {
    selectBtn.addEventListener('click', async () => {
      const files = await window.api.selectFiles();
      if (!files || !files[0]) return;
      const filePath = files[0];
      const ext = filePath.split('.').pop().toLowerCase();
      const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'wma'];
      if (!audioExts.includes(ext)) {
        Hub.showToast('Select an audio file', 'error');
        return;
      }
      input.value = filePath;
      display.innerHTML = `
        <span class="vo-file-icon">🎙️</span>
        <span class="vo-file-path">${filePath.split(/[\\/]/).pop()}</span>
        <button class="btn-icon vo-file-remove" id="epVoiceoverRemove" title="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      Hub._initVoiceoverPicker(modal); // re-bind remove btn
    });
  }

  const removeBtn = modal.querySelector('#epVoiceoverRemove');
  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = '';
      display.innerHTML = `<button class="btn btn-small btn-secondary" id="epVoiceoverSelect">🎙️ Select voiceover file</button>`;
      Hub._initVoiceoverPicker(modal); // re-bind select btn
    });
  }
};

// ── Upload Checklist ──
const CHECKLIST_ITEMS = [
  { id: 'script', label: 'Script done' },
  { id: 'voiceover', label: 'Voiceover recorded' },
  { id: 'editing', label: 'Video edited' },
  { id: 'thumbnail', label: 'Thumbnail created' },
  { id: 'title', label: 'Title optimized' },
  { id: 'description', label: 'Description written' },
  { id: 'tags', label: 'Tags added' },
  { id: 'endscreen', label: 'End screen / Cards' },
  { id: 'review', label: 'Final review' },
];

Hub._renderChecklist = function (checklist) {
  const state = checklist || {};
  return CHECKLIST_ITEMS.map((item) => `
    <label class="checklist-item ${state[item.id] ? 'checked' : ''}">
      <input type="checkbox" data-check="${item.id}" ${state[item.id] ? 'checked' : ''}>
      <span class="checklist-label">${item.label}</span>
    </label>
  `).join('');
};

Hub._getChecklistState = function (modal) {
  const state = {};
  modal.querySelectorAll('#epChecklist input[type="checkbox"]').forEach((cb) => {
    state[cb.dataset.check] = cb.checked;
  });
  return state;
};

Hub._initChecklist = function (modal) {
  modal.querySelectorAll('#epChecklist .checklist-item').forEach((item) => {
    const cb = item.querySelector('input');
    cb.addEventListener('change', () => {
      item.classList.toggle('checked', cb.checked);
    });
  });
};

// ── Real-time refresh listener ──
if (!Hub._projectsRealtimeBound) {
  Hub._projectsRealtimeBound = true;
  window.api.onProjectsChanged(() => {
    if (Hub.state.activeSection === 'projects') {
      Hub.renderProjects();
    }
  });
}
