window.Hub = window.Hub || {};

const PRESET_COLORS = [
  '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#3b82f6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

const DEFAULT_FORMATS = [
  { id: 'fall-asleep-to', name: 'Fall Asleep To', targetWords: 20000, chapters: 14 },
  { id: 'deep-analysis', name: 'Deep Analysis', targetWords: 10000, chapters: 7 },
  { id: 'lore-breakdown', name: 'Lore Breakdown', targetWords: 5000, chapters: 4 },
  { id: 'youtube-short', name: 'YouTube Short', targetWords: 200, chapters: 1 },
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hexToGlow(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.10)`;
}

function darkenHex(hex, amount = 20) {
  let r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  let g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  let b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

Hub.renderSettings = async function () {
  const panel = document.getElementById('panel-settings');
  const settings = await window.api.getSettings();
  const channels = settings.channels || {};

  function renderChannelCards() {
    const entries = Object.entries(channels);
    if (entries.length === 0) {
      return `<div class="settings-empty">Nenhum canal configurado. Adiciona o teu primeiro canal para começar.</div>`;
    }
    return entries.map(([id, ch]) => `
      <div class="channel-card" data-channel-id="${id}">
        <div class="channel-card-header">
          <span class="channel-dot-lg" style="background:${ch.accent || '#8b5cf6'}"></span>
          <div class="channel-card-info">
            <strong>${Hub._escHtml(ch.name)}</strong>
            <span class="channel-card-shows">${Hub._escHtml(ch.shows || '')}</span>
          </div>
          <div class="channel-card-actions">
            <button class="btn btn-small btn-secondary ch-edit-btn" data-id="${id}" title="Editar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-small btn-danger ch-delete-btn" data-id="${id}" title="Eliminar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="channel-card-formats">
          ${(ch.formats || []).map(f => `<span class="format-pill">${Hub._escHtml(f.name)}</span>`).join('')}
        </div>
        <div class="channel-share-section" data-channel-id="${id}">
          ${ch.shared ? `
            <div class="share-active">
              <span class="share-badge">Partilhado</span>
              <span class="share-code-display">${Hub._escHtml(ch.shareCode || '')}</span>
              <button class="btn btn-small btn-secondary share-copy-btn" data-code="${Hub._escHtml(ch.shareCode || '')}" title="Copiar código">Copiar</button>
              <button class="btn btn-small btn-danger share-unshare-btn" data-id="${id}" title="Deixar de partilhar">Desligar</button>
            </div>
          ` : `
            <div class="share-inactive">
              <button class="btn btn-small btn-secondary share-enable-btn" data-id="${id}">Partilhar este canal</button>
              <span class="share-separator">ou</span>
              <div class="share-join-row">
                <input class="input share-join-input" data-id="${id}" placeholder="Código de equipa" style="max-width:160px;font-size:12px;">
                <button class="btn btn-small btn-primary share-join-btn" data-id="${id}">Juntar</button>
              </div>
            </div>
          `}
        </div>
      </div>
    `).join('');
  }

  panel.innerHTML = `
    <div class="section-header">
      <h2>Definições</h2>
    </div>
    <div class="settings-content">

      <div class="settings-group">
        <div class="settings-group-title">Canais</div>
        <div class="hint" style="margin-bottom:12px;">Configura os teus canais YouTube. Cada utilizador configura os seus.</div>
        <div id="channelCards">${renderChannelCards()}</div>
        <button class="btn btn-secondary" id="addChannelBtn" style="margin-top:12px;">+ Adicionar Canal</button>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Elevate Labs API</div>
        <div class="settings-field">
          <label>API Key</label>
          <div class="api-key-input">
            <input class="input" type="password" id="settingsApiKey" value="${settings.elevateLabsApiKey || ''}" placeholder="sk_mdl...">
            <button class="toggle-vis" id="toggleApiKeyVis" title="Mostrar/ocultar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
          <div class="hint">Usada para IA (scripts, ideias, SEO) e TTS. Fica guardada localmente.</div>
        </div>
        <div class="settings-field">
          <label>Modelo IA</label>
          <select class="input" id="settingsModel" style="max-width:300px;">
            <option value="claude-sonnet-4.5" ${settings.model === 'claude-sonnet-4.5' ? 'selected' : ''}>Claude Sonnet 4.5</option>
            <option value="gpt-5" ${settings.model === 'gpt-5' ? 'selected' : ''}>GPT-5</option>
            <option value="gemini-2.5-pro" ${settings.model === 'gemini-2.5-pro' ? 'selected' : ''}>Gemini 2.5 Pro</option>
            <option value="deepseek-v3.2" ${settings.model === 'deepseek-v3.2' ? 'selected' : ''}>DeepSeek v3.2</option>
            <option value="grok-4" ${settings.model === 'grok-4' ? 'selected' : ''}>Grok 4</option>
          </select>
          <div class="hint">Claude Sonnet 4.5 recomendado para melhor qualidade.</div>
        </div>
        <div class="settings-field">
          <label>TTS Voice ID</label>
          <input class="input" id="settingsTtsVoiceId" value="${settings.ttsVoiceId || ''}" placeholder="Ex: zNsotODqUhvbJ5wMG7Ei" style="max-width:400px;">
          <div class="hint">ID da voz do ElevenLabs. Encontra em elevenlabs.io/voice-library</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">YouTube Data API</div>
        <div class="settings-field">
          <label>API Key</label>
          <div class="api-key-input">
            <input class="input" type="password" id="settingsYtKey" value="${settings.youtubeApiKey || ''}" placeholder="AIza...">
            <button class="toggle-vis" id="toggleYtKeyVis" title="Mostrar/ocultar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
          <div class="hint">Necessária para a secção Competidores. Cria em console.cloud.google.com &gt; YouTube Data API v3.</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Transcrição (Whisper)</div>
        <div class="settings-field">
          <label>Modo</label>
          <div class="whisper-mode-toggle">
            <button class="whisper-mode-btn${settings.whisperMode === 'api' ? ' active' : ''}" data-mode="api">API OpenAI</button>
            <button class="whisper-mode-btn${settings.whisperMode === 'local' ? ' active' : ''}" data-mode="local">Local (Grátis)</button>
          </div>
        </div>
        <div id="whisperApiSection" style="display:${settings.whisperMode === 'api' ? 'block' : 'none'}">
          <div class="settings-field">
            <label>API Key</label>
            <div class="api-key-input">
              <input class="input" type="password" id="settingsOpenaiKey" value="${settings.openaiApiKey || ''}" placeholder="sk-...">
              <button class="toggle-vis" id="toggleOpenaiKeyVis" title="Mostrar/ocultar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <div class="hint">Necessária para transcrição de voiceover no Editor. Cria em platform.openai.com</div>
          </div>
        </div>
        <div id="whisperLocalSection" style="display:${settings.whisperMode === 'local' ? 'block' : 'none'}">
          <div class="settings-field">
            <label>Tamanho do Modelo</label>
            <select class="input" id="settingsWhisperModel" style="max-width:300px;">
              <option value="base" ${settings.whisperModelSize === 'base' ? 'selected' : ''}>Base (148 MB) — Rápido</option>
              <option value="small" ${settings.whisperModelSize === 'small' ? 'selected' : ''}>Small (466 MB) — Equilibrado</option>
              <option value="medium" ${settings.whisperModelSize === 'medium' ? 'selected' : ''}>Medium (1.5 GB) — Melhor qualidade</option>
            </select>
            <div class="hint">Modelos maiores são mais precisos mas mais lentos. "Base" é suficiente para a maioria dos casos.</div>
          </div>
          <div class="settings-field">
            <div class="whisper-download-row">
              <button class="btn btn-secondary" id="whisperDownloadBtn">Descarregar Modelo</button>
              <span class="whisper-status" id="whisperStatus"></span>
            </div>
            <div class="whisper-progress" id="whisperProgress" style="display:none;">
              <div class="whisper-progress-bar"><div class="whisper-progress-fill" id="whisperProgressFill"></div></div>
              <span class="whisper-progress-text" id="whisperProgressText"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Text-to-Speech (Edge TTS)</div>
        <div class="settings-field">
          <label>Default Voice</label>
          <select class="input" id="settingsTtsVoice" style="max-width:400px;"></select>
          <div class="hint">Voz usada por defeito ao gerar voiceover a partir de scripts.</div>
        </div>
        <div class="settings-field">
          <label>Default Speed</label>
          <div style="display:flex;align-items:center;gap:12px;max-width:300px;">
            <input type="range" class="input-range" id="settingsTtsSpeed"
              min="0.5" max="1.0" step="0.05" value="${settings.ttsSpeed || 0.85}">
            <span id="settingsTtsSpeedVal" style="font-size:13px;font-weight:600;color:var(--accent);min-width:36px;">${((settings.ttsSpeed || 0.85) * 100).toFixed(0)}%</span>
          </div>
          <div class="hint">Velocidades mais lentas funcionam melhor para sleep content. 85% recomendado.</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Atualizações</div>
        <div class="settings-field">
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="btn btn-secondary" id="checkUpdateBtn">Verificar Atualizações</button>
            <span id="updateStatus" style="font-size:12px;color:var(--text-dim);"></span>
          </div>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <button class="btn btn-primary" id="settingsSaveBtn">Guardar Definições</button>
      </div>
    </div>

    <!-- Channel Modal -->
    <div class="channel-modal-overlay" id="channelModalOverlay" style="display:none;">
      <div class="channel-modal">
        <h3 id="channelModalTitle">Novo Canal</h3>
        <div class="settings-field">
          <label>Nome do Canal</label>
          <input class="input" id="chName" placeholder="Ex: Pine Hat">
        </div>
        <div class="settings-field">
          <label>Shows / Tópico</label>
          <input class="input" id="chShows" placeholder="Ex: Gravity Falls, South Park">
        </div>
        <div class="settings-field">
          <label>Cor</label>
          <div class="color-picker-row">
            ${PRESET_COLORS.map(c => `<button class="color-swatch" data-color="${c}" style="background:${c}"></button>`).join('')}
            <input type="color" id="chColorCustom" value="#8b5cf6" class="color-custom-input" title="Cor personalizada">
          </div>
          <input type="hidden" id="chColor" value="#8b5cf6">
        </div>
        <div class="settings-field">
          <label>Prompt personalizado <span style="color:var(--text-dim);font-weight:400;">(opcional)</span></label>
          <textarea class="textarea" id="chPrompt" rows="3" placeholder="Instruções extra para o Claude ao gerar scripts para este canal..."></textarea>
        </div>
        <div class="settings-field">
          <label>Formatos de Script</label>
          <div id="chFormats"></div>
          <button class="btn btn-small btn-secondary" id="chAddFormat" style="margin-top:8px;">+ Formato</button>
        </div>
        <div class="channel-modal-actions">
          <button class="btn btn-secondary" id="chCancelBtn">Cancelar</button>
          <button class="btn btn-primary" id="chSaveBtn">Guardar Canal</button>
        </div>
        <input type="hidden" id="chEditId" value="">
      </div>
    </div>
  `;

  // ── Channel management ──
  let editingFormats = [...DEFAULT_FORMATS];

  function renderFormatRows() {
    const container = panel.querySelector('#chFormats');
    container.innerHTML = editingFormats.map((f, i) => `
      <div class="format-row" data-idx="${i}">
        <input class="input format-name" value="${Hub._escHtml(f.name)}" placeholder="Nome" style="flex:2;">
        <input class="input format-words" type="number" value="${f.targetWords}" placeholder="Palavras" style="flex:1;" min="100">
        <input class="input format-chapters" type="number" value="${f.chapters}" placeholder="Cap." style="flex:0.5;" min="1">
        <button class="btn btn-small btn-danger format-remove" data-idx="${i}" title="Remover">&times;</button>
      </div>
    `).join('');
    container.querySelectorAll('.format-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        editingFormats.splice(parseInt(btn.dataset.idx), 1);
        renderFormatRows();
      });
    });
  }

  function openChannelModal(id = null) {
    const overlay = panel.querySelector('#channelModalOverlay');
    const ch = id ? channels[id] : null;
    panel.querySelector('#channelModalTitle').textContent = ch ? 'Editar Canal' : 'Novo Canal';
    panel.querySelector('#chEditId').value = id || '';
    panel.querySelector('#chName').value = ch ? ch.name : '';
    panel.querySelector('#chShows').value = ch ? (ch.shows || '') : '';
    panel.querySelector('#chPrompt').value = ch ? (ch.prompt || settings.channelPrompts?.[id] || '') : '';
    const color = ch ? (ch.accent || '#8b5cf6') : PRESET_COLORS[Object.keys(channels).length % PRESET_COLORS.length];
    panel.querySelector('#chColor').value = color;
    panel.querySelector('#chColorCustom').value = color;
    panel.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
    editingFormats = ch ? (ch.formats || []).map(f => ({ ...f })) : [...DEFAULT_FORMATS];
    renderFormatRows();
    overlay.style.display = 'flex';
  }

  // Color swatches
  panel.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      panel.querySelector('#chColor').value = sw.dataset.color;
      panel.querySelector('#chColorCustom').value = sw.dataset.color;
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
  });
  panel.querySelector('#chColorCustom').addEventListener('input', (e) => {
    panel.querySelector('#chColor').value = e.target.value;
    panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  });

  // Add format row
  panel.querySelector('#chAddFormat').addEventListener('click', () => {
    editingFormats.push({ id: '', name: '', targetWords: 5000, chapters: 4 });
    renderFormatRows();
  });

  // Add channel button
  panel.querySelector('#addChannelBtn').addEventListener('click', () => openChannelModal());

  // Edit/Delete channel buttons
  panel.querySelectorAll('.ch-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openChannelModal(btn.dataset.id));
  });
  panel.querySelectorAll('.ch-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const name = channels[id]?.name || id;
      if (!confirm(`Eliminar o canal "${name}"?`)) return;
      delete channels[id];
      await window.api.saveSettings({ channels });
      Hub.state.settings = await window.api.getSettings();
      Hub.state.channels = Hub.state.settings.channels || {};
      // If deleted active channel, switch
      if (Hub.state.activeChannel === id) {
        const ids = Object.keys(Hub.state.channels);
        Hub.state.activeChannel = ids[0] || '';
        window.api.saveSetting('activeChannel', Hub.state.activeChannel);
      }
      Hub.renderSidebar();
      Hub.renderSettings();
    });
  });

  // ── Channel Sharing buttons ──
  panel.querySelectorAll('.share-enable-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'A partilhar...';
      const result = await window.api.shareChannel(btn.dataset.id);
      if (result.success) {
        Hub.showToast(`Canal partilhado! Código: ${result.code}`);
        Hub.state.settings = await window.api.getSettings();
        Hub.state.channels = Hub.state.settings.channels || {};
        Hub.renderSettings();
      } else {
        Hub.showToast(result.error || 'Erro ao partilhar', 'error');
        btn.disabled = false;
        btn.textContent = 'Partilhar este canal';
      }
    });
  });

  panel.querySelectorAll('.share-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.code);
      Hub.showToast('Código copiado!');
    });
  });

  panel.querySelectorAll('.share-unshare-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Deixar de partilhar este canal? Os dados na cloud ficam intactos.')) return;
      const result = await window.api.unshareChannel(btn.dataset.id);
      if (result.success) {
        Hub.showToast('Canal desligado da partilha.');
        Hub.state.settings = await window.api.getSettings();
        Hub.state.channels = Hub.state.settings.channels || {};
        Hub.renderSettings();
      }
    });
  });

  panel.querySelectorAll('.share-join-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const input = panel.querySelector(`.share-join-input[data-id="${btn.dataset.id}"]`);
      const code = input?.value?.trim();
      if (!code) { Hub.showToast('Insere o código de equipa.', 'error'); return; }
      btn.disabled = true;
      btn.textContent = 'A juntar...';
      const result = await window.api.joinChannel(btn.dataset.id, code);
      if (result.success) {
        Hub.showToast(`Ligado ao canal "${result.name}"!`);
        Hub.state.settings = await window.api.getSettings();
        Hub.state.channels = Hub.state.settings.channels || {};
        Hub.renderSettings();
      } else {
        Hub.showToast(result.error || 'Código inválido', 'error');
        btn.disabled = false;
        btn.textContent = 'Juntar';
      }
    });
  });

  // Cancel modal
  panel.querySelector('#chCancelBtn').addEventListener('click', () => {
    panel.querySelector('#channelModalOverlay').style.display = 'none';
  });
  panel.querySelector('#channelModalOverlay').addEventListener('click', (e) => {
    if (e.target === panel.querySelector('#channelModalOverlay')) {
      panel.querySelector('#channelModalOverlay').style.display = 'none';
    }
  });

  // Save channel
  panel.querySelector('#chSaveBtn').addEventListener('click', async () => {
    const name = panel.querySelector('#chName').value.trim();
    if (!name) { Hub.showToast('Preenche o nome do canal.', 'error'); return; }
    const shows = panel.querySelector('#chShows').value.trim();
    const accent = panel.querySelector('#chColor').value;
    const prompt = panel.querySelector('#chPrompt').value.trim();
    const editId = panel.querySelector('#chEditId').value;

    // Collect formats from rows
    const formatRows = panel.querySelectorAll('.format-row');
    const formats = [];
    formatRows.forEach(row => {
      const fname = row.querySelector('.format-name').value.trim();
      const words = parseInt(row.querySelector('.format-words').value) || 5000;
      const chaps = parseInt(row.querySelector('.format-chapters').value) || 4;
      if (fname) {
        formats.push({
          id: slugify(fname),
          name: fname,
          targetWords: words,
          chapters: chaps,
        });
      }
    });

    const id = editId || slugify(name);
    if (!editId && channels[id]) {
      Hub.showToast('Já existe um canal com este nome.', 'error');
      return;
    }

    const existing = channels[id] || {};
    channels[id] = {
      ...existing,
      name,
      accent,
      accentHover: darkenHex(accent),
      accentGlow: hexToGlow(accent),
      shows,
      prompt,
      formats,
    };

    await window.api.saveSettings({ channels });
    Hub.state.settings = await window.api.getSettings();
    Hub.state.channels = Hub.state.settings.channels || {};

    // If first channel, set as active
    if (Object.keys(Hub.state.channels).length === 1 || !Hub.state.activeChannel) {
      Hub.state.activeChannel = id;
      window.api.saveSetting('activeChannel', id);
    }

    Hub.renderSidebar();
    Hub.renderSettings();
    Hub.showToast(`Canal "${name}" guardado!`);
  });

  // ── Rest of settings UI bindings ──

  // Toggle visibility — Anthropic key
  panel.querySelector('#toggleApiKeyVis').addEventListener('click', () => {
    const input = panel.querySelector('#settingsApiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Toggle visibility — YouTube key
  panel.querySelector('#toggleYtKeyVis').addEventListener('click', () => {
    const input = panel.querySelector('#settingsYtKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Toggle visibility — OpenAI key
  const openaiToggle = panel.querySelector('#toggleOpenaiKeyVis');
  if (openaiToggle) {
    openaiToggle.addEventListener('click', () => {
      const input = panel.querySelector('#settingsOpenaiKey');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  // Whisper mode toggle
  let currentWhisperMode = settings.whisperMode || 'api';
  panel.querySelectorAll('.whisper-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentWhisperMode = btn.dataset.mode;
      panel.querySelectorAll('.whisper-mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      panel.querySelector('#whisperApiSection').style.display = currentWhisperMode === 'api' ? 'block' : 'none';
      panel.querySelector('#whisperLocalSection').style.display = currentWhisperMode === 'local' ? 'block' : 'none';
    });
  });

  // Whisper local — check status
  async function updateWhisperStatus() {
    const status = await window.api.whisperLocalStatus();
    const statusEl = panel.querySelector('#whisperStatus');
    const modelSelect = panel.querySelector('#settingsWhisperModel');
    if (!statusEl || !modelSelect) return;
    const selectedSize = modelSelect.value;
    const modelReady = status.models[selectedSize];
    if (status.binReady && modelReady) {
      statusEl.textContent = 'Pronto';
      statusEl.className = 'whisper-status ready';
    } else {
      statusEl.textContent = 'Não instalado';
      statusEl.className = 'whisper-status not-ready';
    }
  }
  updateWhisperStatus();

  const modelSelect = panel.querySelector('#settingsWhisperModel');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => updateWhisperStatus());
  }

  // Whisper download button
  const dlBtn = panel.querySelector('#whisperDownloadBtn');
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      const modelSize = panel.querySelector('#settingsWhisperModel').value;
      const progressDiv = panel.querySelector('#whisperProgress');
      const progressFill = panel.querySelector('#whisperProgressFill');
      const progressText = panel.querySelector('#whisperProgressText');
      progressDiv.style.display = 'flex';
      dlBtn.disabled = true;

      window.api.onWhisperDownloadProgress((data) => {
        progressFill.style.width = `${data.percent}%`;
        progressText.textContent = data.message;
      });

      const result = await window.api.whisperDownloadModel(modelSize);
      dlBtn.disabled = false;

      if (result.success) {
        progressText.textContent = 'Instalado com sucesso!';
        progressFill.style.width = '100%';
        updateWhisperStatus();
        setTimeout(() => { progressDiv.style.display = 'none'; }, 3000);
      } else {
        progressText.textContent = `Erro: ${result.error}`;
        progressFill.style.width = '0%';
      }
    });
  }

  // TTS voice select
  const ttsVoiceSelect = panel.querySelector('#settingsTtsVoice');
  if (ttsVoiceSelect) {
    const voices = await window.api.editorTtsVoices();
    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.gender}, ${v.lang}) — ${v.desc}`;
      opt.selected = v.id === (settings.ttsVoice || 'en-US-AndrewMultilingualNeural');
      ttsVoiceSelect.appendChild(opt);
    });
  }

  // TTS speed slider
  const ttsSpeedSlider = panel.querySelector('#settingsTtsSpeed');
  const ttsSpeedVal = panel.querySelector('#settingsTtsSpeedVal');
  if (ttsSpeedSlider) {
    ttsSpeedSlider.addEventListener('input', () => {
      ttsSpeedVal.textContent = `${(parseFloat(ttsSpeedSlider.value) * 100).toFixed(0)}%`;
    });
  }

  // Check for updates
  panel.querySelector('#checkUpdateBtn').addEventListener('click', async () => {
    const status = panel.querySelector('#updateStatus');
    const btn = panel.querySelector('#checkUpdateBtn');
    btn.disabled = true;
    status.textContent = 'A verificar...';
    try {
      const result = await window.api.checkForUpdates();
      if (result && result.updateInfo) {
        status.textContent = `Nova versão v${result.updateInfo.version} disponível! A descarregar...`;
        status.style.color = 'var(--accent)';
      } else {
        status.textContent = 'Estás na versão mais recente.';
        status.style.color = 'var(--green, #22c55e)';
      }
    } catch {
      status.textContent = 'Não foi possível verificar.';
    }
    btn.disabled = false;
  });

  // Save general settings
  panel.querySelector('#settingsSaveBtn').addEventListener('click', async () => {
    const elevateLabsApiKey = panel.querySelector('#settingsApiKey').value.trim();
    const model = panel.querySelector('#settingsModel').value;
    const youtubeApiKey = panel.querySelector('#settingsYtKey').value.trim();
    const openaiApiKey = (panel.querySelector('#settingsOpenaiKey')?.value || '').trim();
    const whisperMode = currentWhisperMode;
    const whisperModelSize = panel.querySelector('#settingsWhisperModel')?.value || 'base';
    const ttsVoice = panel.querySelector('#settingsTtsVoice')?.value;
    const ttsSpeed = parseFloat(panel.querySelector('#settingsTtsSpeed')?.value || '0.85');
    const ttsVoiceId = (panel.querySelector('#settingsTtsVoiceId')?.value || '').trim();
    await window.api.saveSettings({ elevateLabsApiKey, model, youtubeApiKey, openaiApiKey, whisperMode, whisperModelSize, ttsVoice, ttsSpeed, ttsVoiceId });
    Hub.state.settings = await window.api.getSettings();
    Hub.showToast('Definições guardadas!');
  });
};
