window.Hub = window.Hub || {};

// ── Init app ──
Hub.init = async function () {
  // Load channels config
  Hub.state.channels = await window.api.getChannelsConfig();

  // Load settings
  Hub.state.settings = await window.api.getSettings();
  Hub.state.activeChannel = Hub.state.settings.activeChannel || 'pinehat';
  Hub.state.activeSection = Hub.state.settings.lastSection || 'dashboard';

  // Apply channel theme
  Hub.setChannel(Hub.state.activeChannel, true);

  // Render sidebar
  Hub.renderSidebar();

  // Navigate to last section
  Hub.navigateTo(Hub.state.activeSection, true);

  // Auto-update listeners
  Hub._initAutoUpdate();
};

// ── Channel switching ──
Hub.setChannel = function (channelId, skipSave) {
  Hub.state.activeChannel = channelId;
  document.body.setAttribute('data-channel', channelId);

  // Update channel buttons
  document.querySelectorAll('.channel-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.channel === channelId);
  });

  // Update app title accent
  const titleSpan = document.querySelector('.app-title span');
  if (titleSpan) titleSpan.textContent = Hub.channelName(channelId);

  if (!skipSave) {
    window.api.saveSetting('activeChannel', channelId);
  }

  // Re-render current section
  Hub.renderCurrentSection();
};

// ── Section navigation ──
Hub.navigateTo = function (section, skipSave) {
  Hub.state.activeSection = section;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.section === section);
  });

  // Update panels
  document.querySelectorAll('.section-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${section}`);
  });

  if (!skipSave) {
    window.api.saveSetting('lastSection', section);
  }

  Hub.renderCurrentSection();
};

Hub.renderCurrentSection = function () {
  const section = Hub.state.activeSection;
  if (section === 'dashboard' && Hub.renderDashboard) Hub.renderDashboard();
  else if (section === 'scripts' && Hub.renderScripts) Hub.renderScripts();
  else if (section === 'broll' && Hub.renderBroll) Hub.renderBroll();
  else if (section === 'editor' && Hub.renderEditor) Hub.renderEditor();
  else if (section === 'projects' && Hub.renderProjects) Hub.renderProjects();
  else if (section === 'competitors' && Hub.renderCompetitors) Hub.renderCompetitors();
  else if (section === 'series' && Hub.renderSeries) Hub.renderSeries();
  else if (section === 'settings' && Hub.renderSettings) Hub.renderSettings();
};

// ── Render sidebar ──
Hub.renderSidebar = function () {
  // Nav items
  const nav = document.getElementById('sidebarNav');
  const sections = [
    { id: 'dashboard', label: 'Dashboard', icon: Hub.icons.dashboard },
    { id: 'scripts', label: 'Scripts', icon: Hub.icons.scripts },
    { id: 'broll', label: 'B-Roll', icon: Hub.icons.broll },
    { id: 'editor', label: 'Editor', icon: Hub.icons.editor },
    { id: 'projects', label: 'Projetos', icon: Hub.icons.projects },
    { id: 'competitors', label: 'Competidores', icon: Hub.icons.competitors },
    { id: 'series', label: 'Séries', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
  ];

  nav.innerHTML = sections.map((s) => `
    <button class="nav-item${Hub.state.activeSection === s.id ? ' active' : ''}" data-section="${s.id}">
      ${s.icon} ${s.label}
    </button>
  `).join('');

  nav.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => Hub.navigateTo(item.dataset.section));
  });

  // Settings nav
  const settingsBtn = document.getElementById('settingsNav');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => Hub.navigateTo('settings'));
  }

  // Channel buttons
  const channelSelector = document.getElementById('channelSelector');
  const channels = [
    { id: 'pinehat', name: 'Pine Hat', color: '#8b5cf6' },
    { id: 'papertown', name: 'Paper Town', color: '#f59e0b' },
    { id: 'cortoon', name: 'Cortoon', color: '#22c55e' },
  ];

  channelSelector.innerHTML = `
    <div class="channel-label">Canal</div>
    ${channels.map((ch) => `
      <button class="channel-btn${Hub.state.activeChannel === ch.id ? ' active' : ''}" data-channel="${ch.id}">
        <span class="channel-dot" style="background:${ch.color}"></span>
        ${ch.name}
      </button>
    `).join('')}
  `;

  channelSelector.querySelectorAll('.channel-btn').forEach((btn) => {
    btn.addEventListener('click', () => Hub.setChannel(btn.dataset.channel));
  });
};

// ── Modal close on backdrop click ──
Hub._initModal = function () {
  const backdrop = document.getElementById('modalBackdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('visible');
  });
};

// ── Auto-update ──
Hub._initAutoUpdate = function () {
  window.api.onUpdateAvailable((data) => {
    Hub.showToast(`A descarregar v${data.version}...`, 'info');
  });

  window.api.onUpdateDownloaded((data) => {
    // Remove any existing update banner
    const existing = document.querySelector('.update-banner');
    if (existing) existing.remove();

    const container = document.getElementById('toastContainer');
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span>Nova versão v${data.version} disponível</span>
      <button class="btn btn-primary btn-small" id="installUpdateBtn">Instalar e Reiniciar</button>
    `;
    container.appendChild(banner);

    banner.querySelector('#installUpdateBtn').addEventListener('click', () => {
      window.api.installUpdate();
    });
  });
};

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  Hub._initModal();
  Hub.init();
});
