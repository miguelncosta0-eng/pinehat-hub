window.Hub = window.Hub || {};

Hub.renderIdeation = async function () {
  const panel = document.getElementById('panel-ideation');
  const channel = Hub.state.activeChannel;

  const series = await window.api.seriesGetAll();
  const competitors = await window.api.competitorsGet();
  const history = await window.api.ideationGetHistory(channel);

  panel.innerHTML = `
    <div class="section-header">
      <h2>Ideation</h2>
      <span class="section-channel-badge">${Hub.channelName(channel)}</span>
    </div>
    <div class="ideation-content">
      <!-- Generate new ideas -->
      <div class="ideation-config">
        <div class="ideation-row">
          <div class="form-group">
            <label class="form-label">Series</label>
            <select class="input" id="ideationSeries">
              <option value="">Select a series...</option>
              ${series.map((s) => `<option value="${s.name}">${s.name}</option>`).join('')}
            </select>
          </div>
        </div>

        ${competitors.length > 0 ? `
          <div class="form-group">
            <label class="form-label">Competitors</label>
            <div class="ideation-competitors" id="ideationCompetitors">
              ${competitors.map((c) => `
                <label class="ideation-comp-item">
                  <input type="checkbox" value="${c.id}" checked>
                  <img class="ideation-comp-avatar" src="${c.thumbnail}" alt="" onerror="this.style.display='none'">
                  <span>${c.title}</span>
                  <span class="ideation-comp-videos">${c.recentVideos ? c.recentVideos.length : 0} videos</span>
                </label>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="ideation-empty-comp">
            Add competitors in the "Competitors" section first.
          </div>
        `}

        <button class="btn btn-primary" id="ideationGenerateBtn" ${competitors.length === 0 ? 'disabled' : ''}>
          🧠 Generate Ideas
        </button>
      </div>

      <!-- Saved ideas history -->
      <div class="ideation-history" id="ideationHistory">
        ${history.length > 0 ? `
          <div class="ideation-history-header">
            <h3>Saved Ideas</h3>
          </div>
          ${history.map((batch) => Hub._renderIdeaBatch(batch)).join('')}
        ` : `
          <div class="ideation-empty-history">
            No ideas generated yet for this channel. Generate some above!
          </div>
        `}
      </div>
    </div>
  `;

  // Generate button
  panel.querySelector('#ideationGenerateBtn')?.addEventListener('click', () => Hub._ideationGenerate(panel));

  // Delete buttons
  Hub._bindHistoryEvents(panel);
};

Hub._renderIdeaBatch = function (batch) {
  const date = new Date(batch.date);
  const dateStr = date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="ideation-batch" data-batch-id="${batch.id}">
      <div class="ideation-batch-header">
        <div class="ideation-batch-info">
          <span class="ideation-batch-series">${batch.seriesName}</span>
          <span class="ideation-batch-date">${dateStr} ${timeStr}</span>
          ${batch.competitorNames ? `<span class="ideation-batch-comps">${batch.competitorNames.join(', ')}</span>` : ''}
        </div>
        <div class="ideation-batch-actions">
          <button class="btn-icon ideation-toggle-btn" data-batch-id="${batch.id}" title="Expand/Collapse">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button class="btn-icon ideation-delete-btn" data-batch-id="${batch.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="ideation-batch-ideas" id="batch-${batch.id}" style="display:none;">
        <div class="ideation-ideas-grid">
          ${batch.ideas.map((idea, i) => `
            <div class="ideation-idea-card">
              <div class="idea-number">${i + 1}</div>
              <div class="idea-content">
                <div class="idea-title">${idea.title}</div>
                <div class="idea-hook">${idea.hook}</div>
                <div class="idea-meta">
                  <span class="idea-tag idea-tag-angle">${idea.angle}</span>
                  <span class="idea-tag idea-tag-format">${idea.format}</span>
                </div>
                ${idea.inspiration ? `<div class="idea-inspiration">💡 ${idea.inspiration}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
};

Hub._bindHistoryEvents = function (panel) {
  // Toggle expand/collapse
  panel.querySelectorAll('.ideation-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const batchId = btn.dataset.batchId;
      const ideas = panel.querySelector(`#batch-${batchId}`);
      if (!ideas) return;
      const isOpen = ideas.style.display !== 'none';
      ideas.style.display = isOpen ? 'none' : 'block';
      btn.classList.toggle('rotated', !isOpen);
    });
  });

  // Delete
  panel.querySelectorAll('.ideation-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const batchId = btn.dataset.batchId;
      if (!confirm('Delete these ideas?')) return;
      const channel = Hub.state.activeChannel;
      await window.api.ideationDelete({ channel, id: batchId });
      // Remove from DOM
      const batchEl = panel.querySelector(`.ideation-batch[data-batch-id="${batchId}"]`);
      if (batchEl) batchEl.remove();
      // Check if empty
      const remaining = panel.querySelectorAll('.ideation-batch');
      if (remaining.length === 0) {
        panel.querySelector('#ideationHistory').innerHTML = `
          <div class="ideation-empty-history">
            No ideas generated yet for this channel. Generate some above!
          </div>
        `;
      }
    });
  });
};

Hub._ideationGenerate = async function (panel) {
  const seriesName = panel.querySelector('#ideationSeries').value;
  if (!seriesName) {
    Hub.showToast('Select a series first', 'error');
    return;
  }

  const checkboxes = panel.querySelectorAll('#ideationCompetitors input[type="checkbox"]:checked');
  const competitorIds = Array.from(checkboxes).map((cb) => cb.value);
  if (competitorIds.length === 0) {
    Hub.showToast('Select at least one competitor', 'error');
    return;
  }

  const btn = panel.querySelector('#ideationGenerateBtn');
  const historyEl = panel.querySelector('#ideationHistory');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';

  // Show loading at top of history
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'ideation-loading';
  loadingDiv.innerHTML = '<span class="spinner"></span> Analyzing competitor videos and generating ideas...';
  historyEl.prepend(loadingDiv);

  // Remove empty state if present
  const emptyState = historyEl.querySelector('.ideation-empty-history');
  if (emptyState) emptyState.remove();

  try {
    const channel = Hub.state.activeChannel;
    const res = await window.api.ideationGenerate({ seriesName, competitorIds, channel });

    loadingDiv.remove();

    if (!res.success) {
      Hub.showToast(res.error, 'error');
      return;
    }

    // Reload history to get the saved batch with ID
    const history = await window.api.ideationGetHistory(channel);
    const newBatch = history[0]; // most recent

    if (newBatch) {
      // Remove header if not present
      if (!historyEl.querySelector('.ideation-history-header')) {
        historyEl.insertAdjacentHTML('afterbegin', '<div class="ideation-history-header"><h3>Saved Ideas</h3></div>');
      }
      // Insert after header
      const header = historyEl.querySelector('.ideation-history-header');
      header.insertAdjacentHTML('afterend', Hub._renderIdeaBatch(newBatch));

      // Auto-expand the new one
      const newIdeas = panel.querySelector(`#batch-${newBatch.id}`);
      if (newIdeas) newIdeas.style.display = 'block';
      const toggleBtn = panel.querySelector(`.ideation-toggle-btn[data-batch-id="${newBatch.id}"]`);
      if (toggleBtn) toggleBtn.classList.add('rotated');

      // Bind events for new elements
      Hub._bindHistoryEvents(panel);
    }

    Hub.showToast(`${res.ideas.length} ideas generated!`);
  } catch (err) {
    loadingDiv.remove();
    Hub.showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🧠 Generate Ideas';
  }
};
