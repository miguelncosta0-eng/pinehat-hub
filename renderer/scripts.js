window.Hub = window.Hub || {};

Hub.renderScripts = async function () {
  const panel = document.getElementById('panel-scripts');
  const ch = Hub.state.activeChannel;

  if (Hub.state.editingScript) {
    await Hub._renderScriptEditor(panel, Hub.state.editingScript);
    return;
  }

  const scripts = await window.api.getScripts({ channel: ch });

  panel.innerHTML = `
    <div class="section-header">
      <h2>Scripts</h2>
      <button class="btn btn-primary" id="newScriptBtn">${Hub.icons.plus} Novo Script</button>
    </div>
    <div class="scripts-content">
      ${scripts.length === 0 ? `
        <div class="empty-state">
          ${Hub.icons.scripts}
          <h3>Nenhum script ainda</h3>
          <p>Cria o teu primeiro script para ${Hub.channelName(ch)}</p>
        </div>
      ` : `
        <div class="script-list">
          ${scripts.map((s) => `
            <div class="script-card" data-id="${s.id}">
              <div class="sc-icon">${Hub.icons.scripts}</div>
              <div class="sc-info">
                <div class="sc-title">${s.title}</div>
                <div class="sc-meta">
                  ${Hub.stateBadge(s.state)}
                  ${s.format ? `<span class="sc-format">${Hub._formatLabel(s.channel, s.format)}</span>` : ''}
                  <span>${Hub.fmtDate(s.createdAt)}</span>
                  <span>${(s.wordCount || 0).toLocaleString()} palavras</span>
                </div>
              </div>
              <div class="sc-actions">
                <button class="btn-icon delete-script-btn" data-id="${s.id}" title="Apagar">
                  ${Hub.icons.trash}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  panel.querySelector('#newScriptBtn')?.addEventListener('click', () => Hub.openNewScriptModal());

  panel.querySelectorAll('.script-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-script-btn')) return;
      Hub.openScriptEditor(card.dataset.id);
    });
  });

  panel.querySelectorAll('.delete-script-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if (!confirm('Apagar este script?')) return;
      try {
        await window.api.deleteScript(id);
        Hub.showToast('Script apagado');
        Hub.renderScripts();
      } catch (err) {
        Hub.showToast('Erro ao apagar script', 'error');
      }
    });
  });
};

// Helper to get format label
Hub._formatLabel = function (channelId, formatId) {
  const ch = Hub.state.channels[channelId];
  if (!ch) return formatId;
  const fmt = ch.formats.find((f) => f.id === formatId);
  return fmt ? fmt.name : formatId;
};

// ── Open script editor ──
Hub.openScriptEditor = async function (scriptId) {
  Hub.state.editingScript = scriptId;
  Hub.renderScripts();
};

Hub._renderScriptEditor = async function (panel, scriptId) {
  const script = await window.api.getScript(scriptId);
  if (!script) { Hub.state.editingScript = null; Hub.renderScripts(); return; }

  const states = ['rascunho', 'em-revisao', 'finalizado'];

  panel.innerHTML = `
    <div class="script-editor visible">
      <div class="script-editor-header">
        <button class="btn btn-ghost btn-small back-btn" id="scriptBackBtn">${Hub.icons.back} Voltar</button>
        <input class="se-title-input" id="scriptTitleInput" value="${script.title.replace(/"/g, '&quot;')}" spellcheck="false" />
        <div class="se-meta-info">
          ${script.format ? `<span class="sc-format">${Hub._formatLabel(script.channel, script.format)}</span>` : ''}
          ${script.generationMeta ? `<span class="se-gen-info">${script.generationMeta.model} · ${script.generationMeta.callCount} chamada${script.generationMeta.callCount !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="se-status">
          <select class="input input-small" id="scriptStateSelect" style="width:auto;">
            ${states.map((s) => `<option value="${s}" ${script.state === s ? 'selected' : ''}>${s === 'rascunho' ? 'Rascunho' : s === 'em-revisao' ? 'Em Revisão' : 'Finalizado'}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-small" id="scriptSaveBtn">Guardar</button>
        </div>
      </div>
      <div class="script-editor-body">
        <textarea id="scriptEditorArea">${script.content || ''}</textarea>
      </div>
      <div class="script-editor-footer">
        <div class="word-count" id="scriptWordCount">${(script.wordCount || 0).toLocaleString()} palavras</div>
        <div style="font-size:11px;color:var(--text-dim);">Última edição: ${Hub.fmtDate(script.updatedAt)}</div>
      </div>
    </div>
  `;

  const textarea = panel.querySelector('#scriptEditorArea');
  const wordCount = panel.querySelector('#scriptWordCount');

  textarea.addEventListener('input', () => {
    const words = textarea.value.split(/\s+/).filter(Boolean).length;
    wordCount.textContent = `${words.toLocaleString()} palavras`;
  });

  panel.querySelector('#scriptBackBtn').addEventListener('click', () => {
    Hub.state.editingScript = null;
    Hub.renderScripts();
  });

  panel.querySelector('#scriptSaveBtn').addEventListener('click', async () => {
    const state = panel.querySelector('#scriptStateSelect').value;
    const title = panel.querySelector('#scriptTitleInput').value.trim() || 'Sem título';
    await window.api.updateScript(scriptId, { content: textarea.value, state, title });
    Hub.showToast('Script guardado!');
  });
};

// ── New script modal (simplified — just title + format) ──
Hub.openNewScriptModal = function () {
  const ch = Hub.state.activeChannel;
  const chName = Hub.channelName(ch);
  const chConfig = Hub.state.channels[ch] || {};
  const formats = chConfig.formats || [];
  const defaultFmt = formats[0] || { id: 'default', name: 'Default', targetWords: 5000, chapters: 4 };

  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <h3>Novo Script — ${chName}</h3>
    <div class="script-form">
      <div class="form-group">
        <label class="form-label">Título do vídeo</label>
        <input class="input" id="nsTitle" placeholder="ex: Fall Asleep to Gravity Falls Mysteries Explained" autofocus>
      </div>
      ${formats.length > 1 ? `
      <div class="form-group">
        <label class="form-label">Formato</label>
        <select class="input" id="nsFormat">
          ${formats.map(f => `<option value="${f.id}" data-words="${f.targetWords}" data-chapters="${f.chapters}">${f.name} · ~${Hub._fmtWords(f.targetWords)} · ${f.chapters} cap.</option>`).join('')}
        </select>
      </div>` : `<input type="hidden" id="nsFormat" value="${defaultFmt.id}">`}
      <div class="form-hint" id="nsFormatHint">Formato: ${defaultFmt.name} · ~${Hub._fmtWords(defaultFmt.targetWords)} · ${defaultFmt.chapters} capítulos</div>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="nsCancel">Cancelar</button>
        <button class="btn btn-secondary" id="nsWrite">Escrever</button>
        <button class="btn btn-primary" id="nsGenerate">${Hub.icons.play} Gerar Script</button>
      </div>
    </div>
  `;

  backdrop.classList.add('visible');
  setTimeout(() => modal.querySelector('#nsTitle')?.focus(), 100);

  // Update hint on format change
  const fmtSelect = modal.querySelector('#nsFormat');
  if (fmtSelect && fmtSelect.tagName === 'SELECT') {
    fmtSelect.addEventListener('change', () => {
      const opt = fmtSelect.selectedOptions[0];
      const hint = modal.querySelector('#nsFormatHint');
      if (hint && opt) {
        hint.textContent = `Formato: ${opt.textContent}`;
      }
    });
  }

  modal.querySelector('#nsTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modal.querySelector('#nsGenerate').click();
  });

  modal.querySelector('#nsCancel').addEventListener('click', () => {
    backdrop.classList.remove('visible');
  });

  modal.querySelector('#nsWrite').addEventListener('click', async () => {
    const title = modal.querySelector('#nsTitle').value.trim();
    if (!title) { Hub.showToast('Escreve um título', 'error'); return; }
    const script = await window.api.createScript({ title, channel: ch });
    backdrop.classList.remove('visible');
    Hub.openScriptEditor(script.id);
  });

  modal.querySelector('#nsGenerate').addEventListener('click', async () => {
    const title = modal.querySelector('#nsTitle').value.trim();
    if (!title) { Hub.showToast('Escreve um título', 'error'); return; }

    const settings = await window.api.getSettings();
    if (!settings.anthropicApiKey) {
      Hub.showToast('Configura a API key nas Definições primeiro!', 'error');
      return;
    }

    const selectedFormat = modal.querySelector('#nsFormat').value || defaultFmt.id;
    const fmt = formats.find(f => f.id === selectedFormat) || defaultFmt;
    const channelPrompt = chConfig.prompt || settings.channelPrompts?.[ch] || '';

    backdrop.classList.remove('visible');
    Hub._startScriptGeneration({
      title,
      channel: ch,
      format: selectedFormat,
      targetWords: fmt.targetWords,
      tone: 'default',
      extraNotes: channelPrompt,
    });
  });
};

// Format words display
Hub._fmtWords = function (n) {
  if (n >= 1000) return Math.round(n / 1000) + 'k palavras';
  return n + ' palavras';
};

// ── Script generation with progress (uses bottom gen-bar + live preview) ──
Hub._startScriptGeneration = function (options) {
  const bar = document.getElementById('genBar');
  const barPhase = document.getElementById('genBarPhase');
  const barFill = document.getElementById('genBarFill');
  const barPercent = document.getElementById('genBarPercent');
  const barEta = document.getElementById('genBarEta');
  const barCancel = document.getElementById('genBarCancel');

  // Live preview elements
  const preview = document.getElementById('genPreview');
  const previewText = document.getElementById('genPreviewText');
  const previewToggle = document.getElementById('genPreviewToggle');

  barPhase.textContent = `A gerar script... "${options.title}"`;
  barFill.style.width = '0%';
  barPercent.textContent = '0%';
  bar.classList.remove('done');
  bar.classList.add('visible');

  // Show live preview panel
  previewText.textContent = '';
  previewText.classList.add('typing');
  preview.classList.remove('collapsed');
  preview.classList.add('visible');

  const startTime = Date.now();

  // Initial estimate: ~2min per API call (refined after first call)
  const totalCalls = Math.max(1, Math.ceil((options.targetWords || 20000) / 6000));
  const estMinutes = totalCalls * 2;
  barEta.textContent = `~${estMinutes}min estimado`;

  // Toggle collapse on header click
  const onToggle = () => preview.classList.toggle('collapsed');
  previewToggle.addEventListener('click', onToggle);

  // Cancel button
  const onCancel = async () => {
    await window.api.cancelScriptGeneration();
    bar.classList.remove('visible');
    preview.classList.remove('visible');
    previewToggle.removeEventListener('click', onToggle);
    Hub.showToast('Geração cancelada.', 'error');
    Hub.renderScripts();
  };
  barCancel.addEventListener('click', onCancel, { once: true });

  // Live text listener — shows what Claude is writing in real-time
  window.api.onScriptLive((data) => {
    if (data.done) {
      // Call finished — clear for next call or final
      return;
    }
    previewText.textContent = data.text || '';
    // Auto-scroll to bottom
    const body = document.getElementById('genPreviewBody');
    if (body) body.scrollTop = body.scrollHeight;
  });

  // Progress listener
  window.api.onScriptProgress((data) => {
    if (data.phase === 'generating') {
      const pct = Math.round((data.callNumber / data.totalCalls) * 100);
      barFill.style.width = `${pct}%`;
      barPercent.textContent = `${pct}%`;

      if (data.callNumber === 0) {
        barPhase.textContent = `A gerar script... (chamada 1/${data.totalCalls})`;
      } else {
        barPhase.textContent = `A gerar script... (${data.callNumber}/${data.totalCalls}) · ${data.wordsGenerated?.toLocaleString() || 0} palavras`;
      }

      // ETA: use real data after first call, keep estimate before
      if (data.callNumber > 0) {
        const elapsed = Date.now() - startTime;
        const remaining = (elapsed / pct) * (100 - pct);
        barEta.textContent = Hub._fmtEta(remaining);
      }
    } else if (data.phase === 'done') {
      barFill.style.width = '100%';
      barPercent.textContent = '100%';
      barPhase.textContent = 'Script concluído!';
      barEta.textContent = '';
    }
  });

  // Start generation
  window.api.generateScript(options).then((result) => {
    barCancel.removeEventListener('click', onCancel);
    previewToggle.removeEventListener('click', onToggle);

    // Hide preview
    previewText.classList.remove('typing');
    setTimeout(() => preview.classList.remove('visible'), 2000);

    if (result.success) {
      bar.classList.add('done');
      barPhase.textContent = 'Script gerado!';
      barPercent.textContent = '100%';
      barEta.textContent = '';
      barFill.style.width = '100%';
      Hub.showToast('Script gerado com sucesso!');
      setTimeout(() => bar.classList.remove('visible', 'done'), 4000);
      Hub.openScriptEditor(result.scriptId);
    } else {
      bar.classList.remove('visible');
      preview.classList.remove('visible');
      Hub.showToast(`Erro: ${result.error}`, 'error');
      if (result.scriptId) Hub.openScriptEditor(result.scriptId);
      else Hub.renderScripts();
    }
  });
};
