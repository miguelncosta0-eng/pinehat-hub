window.Hub = window.Hub || {};

const PROJECT_STATES = [
  { id: 'ideia', label: 'Ideia', emoji: '💡' },
  { id: 'script', label: 'Script', emoji: '📝' },
  { id: 'broll', label: 'B-Roll', emoji: '🎬' },
  { id: 'edicao', label: 'Edição', emoji: '✂️' },
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

  panel.innerHTML = `
    <div class="section-header">
      <h2>Projetos</h2>
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

  // Click to open detail
  container.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', () => Hub._openProjectDetail(card.dataset.id));
  });

  // Drag & Drop
  Hub._initKanbanDragDrop(container);
};

// ── Shared project card ──
Hub._renderProjectCard = function (p, scriptMap, compact) {
  if (compact) {
    return `
      <div class="project-card-compact" data-id="${p.id}">
        <span class="pc-channel-dot" style="background:${Hub.channelDot(p.channel)}"></span>
        <span class="pcc-title">${Hub._escHtml(p.title)}</span>
        ${Hub.stateBadge(p.state)}
      </div>
    `;
  }
  return `
    <div class="project-card" data-id="${p.id}" draggable="true">
      <div class="pc-title">${Hub._escHtml(p.title)}</div>
      <div class="pc-meta">
        <span class="pc-channel-dot" style="background:${Hub.channelDot(p.channel)}"></span>
        ${p.format ? `<span class="pc-format">${Hub._projectFormatLabel(p.channel, p.format)}</span>` : ''}
      </div>
      ${p.scriptId && scriptMap[p.scriptId] ? `<div class="pc-script-badge">📝 ${Hub._escHtml(scriptMap[p.scriptId].title)}</div>` : ''}
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
Hub._initKanbanDragDrop = function (panel) {
  let draggedId = null;

  // Drag start on cards
  panel.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedId = null;
      // Remove all drop highlights
      panel.querySelectorAll('.kanban-column-body').forEach((col) => col.classList.remove('drag-over'));
    });
  });

  // Drop targets on column bodies
  panel.querySelectorAll('.kanban-column-body').forEach((colBody) => {
    colBody.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      colBody.classList.add('drag-over');
    });
    colBody.addEventListener('dragleave', (e) => {
      if (!colBody.contains(e.relatedTarget)) {
        colBody.classList.remove('drag-over');
      }
    });
    colBody.addEventListener('drop', async (e) => {
      e.preventDefault();
      colBody.classList.remove('drag-over');
      const projectId = e.dataTransfer.getData('text/plain') || draggedId;
      if (!projectId) return;

      const newState = colBody.dataset.state;
      await window.api.updateProject(projectId, { state: newState });
      Hub.renderProjects();
    });
  });
};

// ── New project modal ──
Hub.openNewProjectModal = async function (defaultDate) {
  const ch = Hub.state.activeChannel;
  const channels = Hub.state.channels;
  const formats = channels[ch]?.formats || [];
  const allScripts = await window.api.getScripts({});

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
  channelSelect.addEventListener('change', () => {
    const chFormats = channels[channelSelect.value]?.formats || [];
    formatSelect.innerHTML = `<option value="">Nenhum</option>` +
      chFormats.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
  });

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
    });
    backdrop.classList.remove('visible');
    Hub.showToast('Projeto criado!');
    Hub.renderProjects();
  });
};

// ── Project detail modal ──
Hub._openProjectDetail = async function (projectId) {
  const [projects, allScripts] = await Promise.all([
    window.api.getProjects({}),
    window.api.getScripts({}),
  ]);
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;

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
        <label class="form-label">Notas</label>
        <textarea class="textarea" id="epNotes" rows="3">${project.notes || ''}</textarea>
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

  // Update formats when channel changes
  const channelSelect = modal.querySelector('#epChannel');
  const formatSelect = modal.querySelector('#epFormat');
  channelSelect.addEventListener('change', () => {
    const newFormats = channels[channelSelect.value]?.formats || [];
    formatSelect.innerHTML = `<option value="">Nenhum</option>` +
      newFormats.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
  });

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
