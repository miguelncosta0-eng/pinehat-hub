window.Hub = window.Hub || {};

Hub.renderSettings = async function () {
  const panel = document.getElementById('panel-settings');
  const settings = await window.api.getSettings();

  panel.innerHTML = `
    <div class="section-header">
      <h2>Definições</h2>
    </div>
    <div class="settings-content">
      <div class="settings-group">
        <div class="settings-group-title">API Anthropic</div>
        <div class="settings-field">
          <label>Chave API</label>
          <div class="api-key-input">
            <input class="input" type="password" id="settingsApiKey" value="${settings.anthropicApiKey || ''}" placeholder="sk-ant-...">
            <button class="toggle-vis" id="toggleApiKeyVis" title="Mostrar/ocultar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
          <div class="hint">A chave fica guardada localmente. Nunca é enviada para lado nenhum excepto a API da Anthropic.</div>
        </div>
        <div class="settings-field">
          <label>Modelo</label>
          <select class="input" id="settingsModel" style="max-width:300px;">
            <option value="claude-opus-4-6" ${settings.model === 'claude-opus-4-6' ? 'selected' : ''}>Claude Opus 4.6</option>
            <option value="claude-sonnet-4-6" ${settings.model === 'claude-sonnet-4-6' ? 'selected' : ''}>Claude Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001" ${settings.model === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku 4.5</option>
          </select>
          <div class="hint">Claude Opus 4.6 recomendado para melhor qualidade de scripts.</div>
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
        <div class="settings-group-title">Prompts dos Canais</div>
        <div class="hint" style="margin-bottom:12px;">Instruções que o Claude recebe ao gerar um script para cada canal. Quanto mais detalhada, melhor o resultado.</div>

        <div class="settings-field">
          <label>Pine Hat <span style="color:var(--text-dim);font-weight:400;">(Gravity Falls)</span></label>
          <textarea class="textarea" id="promptPinehat" rows="5" placeholder="ex: Fala sobre os mistérios de Gravity Falls, easter eggs escondidos, teorias de fãs. Mantém um tom calmo e relaxante para ajudar a adormecer...">${settings.channelPrompts?.pinehat || ''}</textarea>
        </div>

        <div class="settings-field">
          <label>Paper Town <span style="color:var(--text-dim);font-weight:400;">(South Park)</span></label>
          <textarea class="textarea" id="promptPapertown" rows="5" placeholder="ex: Analisa episódios de South Park, referências culturais, evolução das personagens. Tom calmo e narrativo...">${settings.channelPrompts?.papertown || ''}</textarea>
        </div>

        <div class="settings-field">
          <label>Cortoon <span style="color:var(--text-dim);font-weight:400;">(Gumball, Multi-Cartoon)</span></label>
          <textarea class="textarea" id="promptCortoon" rows="5" placeholder="ex: Explora o mundo de Gumball, análise de episódios, lore escondida. Tom envolvente e calmo...">${settings.channelPrompts?.cortoon || ''}</textarea>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <button class="btn btn-primary" id="settingsSaveBtn">Guardar Definições</button>
      </div>
    </div>
  `;

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

  // Whisper local — check status and update UI
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

  // TTS voice select population
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

  // Save
  panel.querySelector('#settingsSaveBtn').addEventListener('click', async () => {
    const apiKey = panel.querySelector('#settingsApiKey').value.trim();
    const model = panel.querySelector('#settingsModel').value;
    const youtubeApiKey = panel.querySelector('#settingsYtKey').value.trim();
    const channelPrompts = {
      pinehat: panel.querySelector('#promptPinehat').value,
      papertown: panel.querySelector('#promptPapertown').value,
      cortoon: panel.querySelector('#promptCortoon').value,
    };
    const openaiApiKey = (panel.querySelector('#settingsOpenaiKey')?.value || '').trim();
    const whisperMode = currentWhisperMode;
    const whisperModelSize = panel.querySelector('#settingsWhisperModel')?.value || 'base';
    const ttsVoice = panel.querySelector('#settingsTtsVoice')?.value;
    const ttsSpeed = parseFloat(panel.querySelector('#settingsTtsSpeed')?.value || '0.85');
    await window.api.saveSettings({ anthropicApiKey: apiKey, model, youtubeApiKey, openaiApiKey, channelPrompts, whisperMode, whisperModelSize, ttsVoice, ttsSpeed });
    Hub.state.settings = await window.api.getSettings();
    Hub.showToast('Definições guardadas!');
  });
};
