window.Hub = window.Hub || {};

Hub.renderDashboard = async function () {
  const panel = document.getElementById('panel-dashboard');
  const ch = Hub.state.activeChannel;
  const chName = Hub.channelName(ch);

  // Load data
  const [projects, scripts] = await Promise.all([
    window.api.getProjects({ channel: ch }),
    window.api.getScripts({ channel: ch }),
  ]);

  const stateCounts = { ideia: 0, script: 0, broll: 0, edicao: 0, publicado: 0 };
  projects.forEach((p) => { if (stateCounts[p.state] !== undefined) stateCounts[p.state]++; });

  const recentScripts = scripts.slice(0, 5);

  panel.innerHTML = `
    <div class="section-header">
      <h2>Dashboard</h2>
      <div class="quick-actions">
        <button class="btn btn-primary" id="dash-new-script">${Hub.icons.plus} Novo Script</button>
        <button class="btn btn-secondary" id="dash-new-project">${Hub.icons.plus} Novo Projeto</button>
      </div>
    </div>

    <div class="dashboard-content">
      <div class="dashboard-greeting">Bem-vindo ao <span>${chName}</span></div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Projetos</div>
          <div class="stat-value">${projects.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Em Progresso</div>
          <div class="stat-value">${stateCounts.script + stateCounts.broll + stateCounts.edicao}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Scripts</div>
          <div class="stat-value">${scripts.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Publicados</div>
          <div class="stat-value">${stateCounts.publicado}</div>
        </div>
      </div>

      ${recentScripts.length > 0 ? `
        <div class="dashboard-section-title">Scripts Recentes</div>
        <div class="recent-list">
          ${recentScripts.map((s) => `
            <div class="recent-item" data-script-id="${s.id}">
              <div class="ri-title">${s.title}</div>
              ${Hub.stateBadge(s.state)}
              <div class="ri-meta">${Hub.fmtDate(s.createdAt)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${projects.length > 0 ? `
        <div class="dashboard-section-title">Projetos Recentes</div>
        <div class="recent-list">
          ${projects.slice(0, 5).map((p) => `
            <div class="recent-item" data-project-id="${p.id}">
              <span class="pc-channel-dot" style="background:${Hub.channelDot(p.channel)};width:6px;height:6px;border-radius:50%;flex-shrink:0;"></span>
              <div class="ri-title">${p.title}</div>
              ${Hub.stateBadge(p.state)}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;

  // Events
  panel.querySelector('#dash-new-script')?.addEventListener('click', () => {
    Hub.navigateTo('scripts');
    setTimeout(() => Hub.openNewScriptModal && Hub.openNewScriptModal(), 100);
  });
  panel.querySelector('#dash-new-project')?.addEventListener('click', () => {
    Hub.navigateTo('projects');
    setTimeout(() => Hub.openNewProjectModal && Hub.openNewProjectModal(), 100);
  });

  panel.querySelectorAll('[data-script-id]').forEach((el) => {
    el.addEventListener('click', () => {
      Hub.navigateTo('scripts');
      setTimeout(() => Hub.openScriptEditor && Hub.openScriptEditor(el.dataset.scriptId), 100);
    });
  });
};
