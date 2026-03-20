window.Hub = window.Hub || {};

Hub.renderNiche = async function () {
  const panel = document.getElementById('panel-niche');

  // Initialize niche state
  if (!Hub.state.nicheTab) Hub.state.nicheTab = 'search';

  const saved = await window.api.nicheGetSaved();

  panel.innerHTML = `
    <div class="section-header">
      <h2>Niche Finder</h2>
      <div class="section-header-actions">
        <div class="niche-tabs">
          <button class="niche-tab ${Hub.state.nicheTab === 'search' ? 'active' : ''}" data-tab="search">Search</button>
          <button class="niche-tab ${Hub.state.nicheTab === 'saved' ? 'active' : ''}" data-tab="saved">Saved (${saved.length})</button>
        </div>
      </div>
    </div>

    <div class="niche-content">
      ${Hub.state.nicheTab === 'search' ? Hub._renderNicheSearch() : Hub._renderNicheSaved(saved)}
    </div>
  `;

  // Tab switching
  panel.querySelectorAll('.niche-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      Hub.state.nicheTab = tab.dataset.tab;
      Hub.renderNiche();
    });
  });

  if (Hub.state.nicheTab === 'search') {
    Hub._bindNicheSearch(panel);
  } else {
    Hub._bindNicheSaved(panel);
  }
};

Hub._renderNicheSearch = function () {
  const subsOptions = [
    { label: 'Any', value: 0 },
    { label: '100+', value: 100 },
    { label: '1K+', value: 1000 },
    { label: '10K+', value: 10000 },
    { label: '50K+', value: 50000 },
    { label: '100K+', value: 100000 },
    { label: '500K+', value: 500000 },
    { label: '1M+', value: 1000000 },
  ];

  const maxSubsOptions = [
    { label: 'Any', value: 0 },
    { label: '100', value: 100 },
    { label: '1K', value: 1000 },
    { label: '10K', value: 10000 },
    { label: '50K', value: 50000 },
    { label: '100K', value: 100000 },
    { label: '500K', value: 500000 },
    { label: '1M', value: 1000000 },
  ];

  return `
    <div class="niche-search-bar">
      <div class="niche-search-input-wrap">
        <input class="input niche-search-input" id="nicheQuery" placeholder="Search YouTube channels by keyword (e.g. cooking, gaming, tech reviews...)" value="${Hub._escHtml(Hub.state.nicheQuery || '')}">
        <button class="btn btn-primary" id="nicheSearchBtn">Search</button>
      </div>
      <div class="niche-filters">
        <div class="niche-filter">
          <label class="niche-filter-label">Min Subs</label>
          <select class="input niche-filter-select" id="nicheMinSubs">
            ${subsOptions.map((o) => `<option value="${o.value}" ${(Hub.state.nicheMinSubs || 0) == o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="niche-filter">
          <label class="niche-filter-label">Max Subs</label>
          <select class="input niche-filter-select" id="nicheMaxSubs">
            ${maxSubsOptions.map((o) => `<option value="${o.value}" ${(Hub.state.nicheMaxSubs || 0) == o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="niche-filter">
          <label class="niche-filter-label">Sort By</label>
          <select class="input niche-filter-select" id="nicheSortBy">
            <option value="outlier" ${(Hub.state.nicheSortBy || 'outlier') === 'outlier' ? 'selected' : ''}>Outlier Score</option>
            <option value="subs" ${Hub.state.nicheSortBy === 'subs' ? 'selected' : ''}>Subscribers</option>
            <option value="avgViews" ${Hub.state.nicheSortBy === 'avgViews' ? 'selected' : ''}>Avg Views</option>
          </select>
        </div>
      </div>
    </div>

    <div class="niche-results" id="nicheResults">
      ${Hub.state.nicheResults ? Hub._renderNicheResults(Hub.state.nicheResults) : `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <h3>Search for a niche</h3>
          <p>Enter a keyword to discover YouTube channels and find underserved niches</p>
        </div>
      `}
    </div>
  `;
};

Hub._renderNicheResults = function (channels) {
  if (channels.length === 0) {
    return `
      <div class="empty-state">
        <h3>No channels found</h3>
        <p>Try a different keyword or adjust your filters</p>
      </div>
    `;
  }

  return `
    <div class="niche-grid">
      ${channels.map((ch) => `
        <div class="niche-card" data-channel-id="${Hub._escHtml(ch.channelId)}">
          <div class="niche-card-header">
            <img class="niche-card-avatar" src="${Hub._escHtml(ch.thumbnail)}" alt="" onerror="this.style.display='none'">
            <div class="niche-card-info">
              <div class="niche-card-title">${Hub._escHtml(ch.title)}</div>
              <div class="niche-card-url">${Hub._escHtml(ch.customUrl || ch.channelId)}</div>
            </div>
            <button class="btn-icon niche-save-btn" data-channel='${JSON.stringify(ch).replace(/'/g, '&#39;')}' title="Save channel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
            </button>
          </div>

          <div class="niche-card-stats">
            <div class="niche-stat">
              <div class="niche-stat-value">${Hub._fmtNum(ch.subscriberCount)}</div>
              <div class="niche-stat-label">Subs</div>
            </div>
            <div class="niche-stat">
              <div class="niche-stat-value">${Hub._fmtNum(ch.avgViewsPerVideo)}</div>
              <div class="niche-stat-label">Avg Views</div>
            </div>
            <div class="niche-stat">
              <div class="niche-stat-value">${ch.videoCount}</div>
              <div class="niche-stat-label">Videos</div>
            </div>
          </div>

          <div class="niche-card-bottom">
            <div class="niche-outlier ${ch.outlierScore >= 1 ? 'niche-outlier-high' : ''}">
              <span class="niche-outlier-value">${ch.outlierScore.toFixed(2)}x</span>
              <span class="niche-outlier-label">Outlier</span>
            </div>
            <div class="niche-card-meta">
              <span>${Hub._fmtNum(ch.daysSinceStart)} days</span>
              <a class="niche-yt-link" href="https://youtube.com/channel/${Hub._escHtml(ch.channelId)}" target="_blank" title="View on YouTube">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
};

Hub._renderNicheSaved = function (saved) {
  if (saved.length === 0) {
    return `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        <h3>No saved channels</h3>
        <p>Save interesting channels from your search results to compare later</p>
      </div>
    `;
  }

  return `
    <div class="niche-grid">
      ${saved.map((ch) => `
        <div class="niche-card niche-card-saved" data-id="${Hub._escHtml(ch.id)}">
          <div class="niche-card-header">
            <img class="niche-card-avatar" src="${Hub._escHtml(ch.thumbnail)}" alt="" onerror="this.style.display='none'">
            <div class="niche-card-info">
              <div class="niche-card-title">${Hub._escHtml(ch.title)}</div>
              <div class="niche-card-url">${Hub._escHtml(ch.customUrl || ch.channelId)}</div>
            </div>
            <button class="btn-icon niche-delete-btn" data-id="${Hub._escHtml(ch.id)}" title="Remove from saved">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="niche-card-stats">
            <div class="niche-stat">
              <div class="niche-stat-value">${Hub._fmtNum(ch.subscriberCount)}</div>
              <div class="niche-stat-label">Subs</div>
            </div>
            <div class="niche-stat">
              <div class="niche-stat-value">${Hub._fmtNum(ch.avgViewsPerVideo)}</div>
              <div class="niche-stat-label">Avg Views</div>
            </div>
            <div class="niche-stat">
              <div class="niche-stat-value">${ch.videoCount}</div>
              <div class="niche-stat-label">Videos</div>
            </div>
          </div>

          <div class="niche-card-bottom">
            <div class="niche-outlier ${ch.outlierScore >= 1 ? 'niche-outlier-high' : ''}">
              <span class="niche-outlier-value">${ch.outlierScore.toFixed(2)}x</span>
              <span class="niche-outlier-label">Outlier</span>
            </div>
            <div class="niche-card-meta">
              <span>${Hub._fmtNum(ch.daysSinceStart)} days</span>
              <a class="niche-yt-link" href="https://youtube.com/channel/${Hub._escHtml(ch.channelId)}" target="_blank" title="View on YouTube">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
};

Hub._bindNicheSearch = function (panel) {
  const searchBtn = panel.querySelector('#nicheSearchBtn');
  const queryInput = panel.querySelector('#nicheQuery');

  const doSearch = async () => {
    const query = queryInput.value.trim();
    if (!query) { Hub.showToast('Enter a keyword to search', 'error'); return; }

    Hub.state.nicheQuery = query;
    Hub.state.nicheMinSubs = parseInt(panel.querySelector('#nicheMinSubs').value) || 0;
    Hub.state.nicheMaxSubs = parseInt(panel.querySelector('#nicheMaxSubs').value) || 0;
    Hub.state.nicheSortBy = panel.querySelector('#nicheSortBy').value;

    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';

    const resultsEl = panel.querySelector('#nicheResults');
    resultsEl.innerHTML = `
      <div class="niche-loading">
        <span class="spinner"></span> Searching channels and fetching stats...
      </div>
    `;

    const result = await window.api.nicheSearch({
      query: Hub.state.nicheQuery,
      minSubs: Hub.state.nicheMinSubs,
      maxSubs: Hub.state.nicheMaxSubs,
      sortBy: Hub.state.nicheSortBy,
    });

    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';

    if (result.success) {
      Hub.state.nicheResults = result.channels;
      resultsEl.innerHTML = Hub._renderNicheResults(result.channels);
      Hub._bindNicheCardActions(panel);
    } else {
      resultsEl.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${Hub._escHtml(result.error)}</p></div>`;
    }
  };

  searchBtn.addEventListener('click', doSearch);
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // If we already have results, bind card actions
  if (Hub.state.nicheResults) {
    Hub._bindNicheCardActions(panel);
  }
};

Hub._bindNicheCardActions = function (panel) {
  // Save buttons
  panel.querySelectorAll('.niche-save-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const channel = JSON.parse(btn.dataset.channel);
        const result = await window.api.nicheSave(channel);
        if (result.success) {
          Hub.showToast(`"${channel.title}" saved!`);
          btn.classList.add('niche-saved');
          btn.disabled = true;
        } else {
          Hub.showToast(result.error, 'error');
        }
      } catch (err) {
        Hub.showToast('Error saving channel', 'error');
      }
    });
  });

  // YouTube links - prevent card click
  panel.querySelectorAll('.niche-yt-link').forEach((link) => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });
};

Hub._bindNicheSaved = function (panel) {
  panel.querySelectorAll('.niche-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await window.api.nicheDeleteSaved(id);
      Hub.showToast('Channel removed from saved');
      Hub.renderNiche();
    });
  });

  // YouTube links
  panel.querySelectorAll('.niche-yt-link').forEach((link) => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });
};
