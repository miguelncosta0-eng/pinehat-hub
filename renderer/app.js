window.Hub = window.Hub || {};

// ── Init app ──
Hub.init = async function () {
  // Load settings first (channels are now inside settings)
  Hub.state.settings = await window.api.getSettings();
  Hub.state.channels = Hub.state.settings.channels || {};

  const channelIds = Object.keys(Hub.state.channels);

  if (channelIds.length === 0) {
    // No channels configured — show settings for first-time setup
    Hub.state.activeChannel = '';
    Hub.state.activeSection = 'settings';
  } else {
    // Use saved active channel, or fallback to first available
    const saved = Hub.state.settings.activeChannel;
    Hub.state.activeChannel = (saved && Hub.state.channels[saved]) ? saved : channelIds[0];
    Hub.state.activeSection = Hub.state.settings.lastSection || 'dashboard';
  }

  // Apply channel theme
  if (Hub.state.activeChannel) {
    Hub.setChannel(Hub.state.activeChannel, true);
  }

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
  else if (section === 'voiceover' && Hub.renderVoiceover) Hub.renderVoiceover();
  else if (section === 'projects' && Hub.renderProjects) Hub.renderProjects();
  else if (section === 'competitors' && Hub.renderCompetitors) Hub.renderCompetitors();
  else if (section === 'series' && Hub.renderSeries) Hub.renderSeries();
  else if (section === 'ideation' && Hub.renderIdeation) Hub.renderIdeation();

  else if (section === 'seo' && Hub.renderSeo) Hub.renderSeo();
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
    { id: 'voiceover', label: 'Voiceover', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' },
    { id: 'projects', label: 'Projetos', icon: Hub.icons.projects },
    { id: 'competitors', label: 'Competidores', icon: Hub.icons.competitors },
    { id: 'series', label: 'Séries', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
    { id: 'ideation', label: 'Ideation', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>' },
    { id: 'seo', label: 'SEO Generator', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>' },
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

  // Channel buttons — dynamic from settings
  const channelSelector = document.getElementById('channelSelector');
  const channels = Object.entries(Hub.state.channels || {}).map(([id, ch]) => ({
    id, name: ch.name, color: ch.accent || '#8b5cf6',
  }));

  if (channels.length > 0) {
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
  } else {
    channelSelector.innerHTML = `
      <div class="channel-label">Canal</div>
      <div style="padding:8px 12px;color:var(--text-dim);font-size:12px;">Nenhum canal configurado.<br>Vai a Definições.</div>
    `;
  }
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
    Hub._showUpdateBanner(data.version);
  });
};

Hub._showUpdateBanner = function (version) {
  // Remove any existing
  const existing = document.querySelector('.update-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#7c3aed;color:#fff;padding:12px 24px;display:flex;align-items:center;justify-content:center;gap:16px;z-index:99999;font-weight:600;';
  banner.innerHTML = `
    <span>✨ Nova versão v${version} pronta a instalar</span>
    <button id="installUpdateBtn" style="background:#fff;color:#7c3aed;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;">Instalar e Reiniciar</button>
    <button id="dismissUpdateBtn" style="background:transparent;color:#fff;border:1px solid #fff;padding:8px 12px;border-radius:6px;cursor:pointer;">Mais tarde</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#installUpdateBtn').addEventListener('click', () => {
    banner.querySelector('#installUpdateBtn').textContent = 'A instalar...';
    window.api.installUpdate();
  });

  banner.querySelector('#dismissUpdateBtn').addEventListener('click', () => {
    banner.remove();
    Hub.showToast('A atualização será instalada quando fechares a app.', 'info');
  });
};

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  Hub._initModal();
  Hub.init();
});
