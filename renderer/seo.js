window.Hub = window.Hub || {};

Hub.renderSeo = async function () {
  const panel = document.getElementById('panel-seo');
  const channel = Hub.state.activeChannel;

  const series = await window.api.seriesGetAll();
  const history = await window.api.seoGetHistory(channel);

  const languages = [
    'English', 'Portuguese', 'Spanish', 'French', 'German',
    'Italian', 'Dutch', 'Japanese', 'Korean', 'Chinese',
    'Russian', 'Arabic', 'Hindi', 'Turkish', 'Polish',
  ];

  panel.innerHTML = `
    <div class="section-header">
      <h2>SEO Generator</h2>
      <span class="section-channel-badge">${Hub.channelName(channel)}</span>
    </div>
    <div class="seo-content">
      <!-- Generate form -->
      <div class="seo-config">
        <div class="form-group">
          <label class="form-label">Video Title</label>
          <input type="text" class="input" id="seoTitle" placeholder="Enter your video title or topic..." />
        </div>

        <div class="seo-row">
          <div class="form-group">
            <label class="form-label">Series (optional)</label>
            <select class="input" id="seoSeries">
              <option value="">No series</option>
              ${series.map((s) => `<option value="${Hub._escHtml(s.name)}">${Hub._escHtml(s.name)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Language</label>
            <select class="input" id="seoLanguage">
              ${languages.map((l) => `<option value="${l}" ${l === 'English' ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Format / Style (optional)</label>
          <input type="text" class="input" id="seoFormat" placeholder="e.g. essay, ranking, iceberg, theory, review..." />
        </div>

        <button class="btn btn-primary" id="seoGenerateBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Generate SEO
        </button>
      </div>

      <!-- Results area (filled after generation) -->
      <div class="seo-results" id="seoResults" style="display:none;"></div>

      <!-- History -->
      <div class="seo-history" id="seoHistory">
        ${history.length > 0 ? `
          <div class="seo-history-header">
            <h3>History</h3>
          </div>
          ${history.map((item) => Hub._renderSeoBatch(item)).join('')}
        ` : `
          <div class="seo-empty-history">
            No SEO generations yet for this channel.
          </div>
        `}
      </div>
    </div>
  `;

  // Generate button
  panel.querySelector('#seoGenerateBtn')?.addEventListener('click', () => Hub._seoGenerate(panel));

  // Bind history events
  Hub._bindSeoHistoryEvents(panel);
};

Hub._renderSeoBatch = function (item) {
  const date = new Date(item.date);
  const dateStr = date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="seo-batch" data-batch-id="${item.id}">
      <div class="seo-batch-header">
        <div class="seo-batch-info">
          <span class="seo-batch-title">${Hub._escHtml(item.originalTitle)}</span>
          <span class="seo-batch-date">${dateStr} ${timeStr}</span>
          ${item.seriesName ? `<span class="seo-batch-series">${Hub._escHtml(item.seriesName)}</span>` : ''}
          ${item.language && item.language !== 'English' ? `<span class="seo-batch-lang">${Hub._escHtml(item.language)}</span>` : ''}
        </div>
        <div class="seo-batch-actions">
          <button class="btn-icon seo-toggle-btn" data-batch-id="${item.id}" title="Expand/Collapse">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button class="btn-icon seo-delete-btn" data-batch-id="${item.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="seo-batch-content" id="seo-batch-${item.id}" style="display:none;">
        ${Hub._renderSeoResultContent(item)}
      </div>
    </div>
  `;
};

Hub._renderSeoResultContent = function (item) {
  return `
    <div class="seo-result-section">
      <div class="seo-result-section-header">
        <h4>Title Suggestions</h4>
        <button class="btn-sm seo-copy-all-titles" title="Copy all titles">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy All
        </button>
      </div>
      <div class="seo-titles-list">
        ${item.titles.map((t, i) => `
          <div class="seo-title-item" data-title="${Hub._escHtml(t)}">
            <span class="seo-title-num">${i + 1}</span>
            <span class="seo-title-text">${Hub._escHtml(t)}</span>
            <span class="seo-title-chars">${t.length} chars</span>
            <button class="btn-icon seo-copy-title-btn" title="Copy title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="seo-result-section">
      <div class="seo-result-section-header">
        <h4>Description</h4>
        <button class="btn-sm seo-copy-desc" title="Copy description">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy
        </button>
      </div>
      <pre class="seo-description-block">${Hub._escHtml(item.description)}</pre>
    </div>

    <div class="seo-result-section">
      <div class="seo-result-section-header">
        <h4>Tags (${item.tags.length})</h4>
        <button class="btn-sm seo-copy-tags" title="Copy all tags (comma-separated)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy All
        </button>
      </div>
      <div class="seo-tags-container">
        ${item.tags.map((tag) => `<span class="seo-tag-pill">${Hub._escHtml(tag)}</span>`).join('')}
      </div>
    </div>
  `;
};

Hub._bindSeoResultEvents = function (container) {
  // Copy individual title
  container.querySelectorAll('.seo-copy-title-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.seo-title-item');
      const text = item?.dataset.title || '';
      navigator.clipboard.writeText(text);
      Hub.showToast('Title copied!');
    });
  });

  // Click title row to copy
  container.querySelectorAll('.seo-title-item').forEach((item) => {
    item.addEventListener('click', () => {
      const text = item.dataset.title || '';
      navigator.clipboard.writeText(text);
      Hub.showToast('Title copied!');
    });
  });

  // Copy all titles
  container.querySelectorAll('.seo-copy-all-titles').forEach((btn) => {
    btn.addEventListener('click', () => {
      const titles = Array.from(container.querySelectorAll('.seo-title-item'))
        .map((el) => el.dataset.title)
        .join('\n');
      navigator.clipboard.writeText(titles);
      Hub.showToast('All titles copied!');
    });
  });

  // Copy description
  container.querySelectorAll('.seo-copy-desc').forEach((btn) => {
    btn.addEventListener('click', () => {
      const desc = container.querySelector('.seo-description-block');
      if (desc) {
        navigator.clipboard.writeText(desc.textContent);
        Hub.showToast('Description copied!');
      }
    });
  });

  // Copy tags
  container.querySelectorAll('.seo-copy-tags').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tags = Array.from(container.querySelectorAll('.seo-tag-pill'))
        .map((el) => el.textContent);
      navigator.clipboard.writeText(tags.join(', '));
      Hub.showToast('Tags copied!');
    });
  });
};

Hub._bindSeoHistoryEvents = function (panel) {
  // Toggle expand/collapse
  panel.querySelectorAll('.seo-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const batchId = btn.dataset.batchId;
      const content = panel.querySelector(`#seo-batch-${batchId}`);
      if (!content) return;
      const isOpen = content.style.display !== 'none';
      content.style.display = isOpen ? 'none' : 'block';
      btn.classList.toggle('rotated', !isOpen);

      // Bind copy events when opening
      if (!isOpen) {
        Hub._bindSeoResultEvents(content);
      }
    });
  });

  // Delete
  panel.querySelectorAll('.seo-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const batchId = btn.dataset.batchId;
      if (!confirm('Delete this SEO generation?')) return;
      const channel = Hub.state.activeChannel;
      await window.api.seoDelete({ channel, id: batchId });
      const batchEl = panel.querySelector(`.seo-batch[data-batch-id="${batchId}"]`);
      if (batchEl) batchEl.remove();
      const remaining = panel.querySelectorAll('.seo-batch');
      if (remaining.length === 0) {
        panel.querySelector('#seoHistory').innerHTML = `
          <div class="seo-empty-history">
            No SEO generations yet for this channel.
          </div>
        `;
      }
    });
  });
};

Hub._seoGenerate = async function (panel) {
  const title = panel.querySelector('#seoTitle').value.trim();
  if (!title) {
    Hub.showToast('Enter a video title first', 'error');
    return;
  }

  const seriesName = panel.querySelector('#seoSeries').value;
  const language = panel.querySelector('#seoLanguage').value;
  const format = panel.querySelector('#seoFormat').value.trim();

  const btn = panel.querySelector('#seoGenerateBtn');
  const resultsEl = panel.querySelector('#seoResults');
  const historyEl = panel.querySelector('#seoHistory');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';

  // Show loading
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '<div class="seo-loading"><span class="spinner"></span> Generating optimized titles, description, and tags...</div>';

  try {
    const channel = Hub.state.activeChannel;
    const res = await window.api.seoGenerate({ title, channel, seriesName, format, language });

    if (!res.success) {
      resultsEl.innerHTML = `<div class="seo-error">${Hub._escHtml(res.error)}</div>`;
      Hub.showToast(res.error, 'error');
      return;
    }

    // Show results
    resultsEl.innerHTML = `
      <div class="seo-results-header">
        <h3>Results for: "${Hub._escHtml(title)}"</h3>
      </div>
      ${Hub._renderSeoResultContent(res)}
    `;
    Hub._bindSeoResultEvents(resultsEl);

    // Update history
    const history = await window.api.seoGetHistory(channel);
    const newBatch = history[0];

    if (newBatch) {
      const emptyState = historyEl.querySelector('.seo-empty-history');
      if (emptyState) emptyState.remove();

      if (!historyEl.querySelector('.seo-history-header')) {
        historyEl.insertAdjacentHTML('afterbegin', '<div class="seo-history-header"><h3>History</h3></div>');
      }
      const header = historyEl.querySelector('.seo-history-header');
      header.insertAdjacentHTML('afterend', Hub._renderSeoBatch(newBatch));

      Hub._bindSeoHistoryEvents(panel);
    }

    Hub.showToast('SEO content generated!');
  } catch (err) {
    resultsEl.innerHTML = `<div class="seo-error">${Hub._escHtml(err.message)}</div>`;
    Hub.showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Generate SEO
    `;
  }
};
