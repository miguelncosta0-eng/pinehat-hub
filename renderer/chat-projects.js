window.Hub = window.Hub || {};

// Current view state
Hub._cpView = 'list'; // 'list' | 'chat'
Hub._cpActiveProject = null;
Hub._cpStreaming = false;
Hub._cpStreamText = '';

Hub.renderChatProjects = async function () {
  if (Hub._cpView === 'chat' && Hub._cpActiveProject) {
    Hub._cpRenderChat();
  } else {
    Hub._cpRenderList();
  }
};

// ── Project List View ──
Hub._cpRenderList = async function () {
  const panel = document.getElementById('panel-chat-projects');
  const projects = await window.api.getChatProjects();

  panel.innerHTML = `
    <div class="section-header">
      <h2>Claude Projects</h2>
    </div>
    <div class="cp-grid">
      <div class="cp-card cp-card-new" id="cpNewProject">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>Novo Projeto</span>
      </div>
      ${projects.map(p => `
        <div class="cp-card" data-project-id="${p.id}">
          <div class="cp-card-name">${Hub._escHtml(p.name)}</div>
          <div class="cp-card-desc">${Hub._escHtml(p.instructions || 'Sem instruções definidas')}</div>
          <div class="cp-card-meta">
            <span class="cp-card-model">${Hub._cpModelLabel(p.model)}</span>
            <span>${p.messages?.length || 0} mensagens</span>
            <span>${p.files?.length || 0} ficheiros</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // New project
  panel.querySelector('#cpNewProject').addEventListener('click', () => Hub._cpCreateProject());

  // Open project
  panel.querySelectorAll('.cp-card[data-project-id]').forEach(card => {
    card.addEventListener('click', () => {
      Hub._cpActiveProject = card.dataset.projectId;
      Hub._cpView = 'chat';
      Hub.renderChatProjects();
    });
  });
};

// ── Chat View ──
Hub._cpRenderChat = async function () {
  const panel = document.getElementById('panel-chat-projects');
  const projects = await window.api.getChatProjects();
  const project = projects.find(p => p.id === Hub._cpActiveProject);

  if (!project) {
    Hub._cpView = 'list';
    Hub._cpRenderList();
    return;
  }

  panel.innerHTML = `
    <div class="cp-chat">
      <div class="cp-chat-header">
        <button class="cp-back-btn" id="cpBack">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="cp-chat-title">${Hub._escHtml(project.name)}</div>
        <div class="cp-chat-actions">
          <button class="btn-icon" id="cpSettings" title="Definições do projeto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button class="btn-icon" id="cpClearHistory" title="Limpar conversa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      ${project.messages.length === 0 && !Hub._cpStreaming ? `
        <div class="cp-empty-chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <h3>Começa uma conversa</h3>
          <p>Escreve uma mensagem para começar</p>
        </div>
      ` : `
        <div class="cp-messages" id="cpMessages">
          ${project.messages.map(m => Hub._cpRenderMsg(m)).join('')}
          ${Hub._cpStreaming ? `
            <div class="cp-msg cp-msg-assistant cp-msg-streaming" id="cpStreamMsg">
              <div class="cp-msg-bubble">${Hub._cpFormatText(Hub._cpStreamText)}</div>
            </div>
          ` : ''}
        </div>
      `}

      <div class="cp-input-bar">
        <textarea class="cp-input" id="cpInput" placeholder="Escreve uma mensagem..." rows="1"></textarea>
        ${Hub._cpStreaming ? `
          <button class="cp-stop-btn" id="cpStopBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        ` : `
          <button class="cp-send-btn" id="cpSendBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        `}
      </div>
    </div>
  `;

  // Scroll to bottom
  const msgs = panel.querySelector('#cpMessages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;

  // Back button
  panel.querySelector('#cpBack').addEventListener('click', () => {
    Hub._cpView = 'list';
    Hub._cpActiveProject = null;
    Hub._cpStreaming = false;
    Hub._cpStreamText = '';
    Hub.renderChatProjects();
  });

  // Settings
  panel.querySelector('#cpSettings').addEventListener('click', () => Hub._cpShowSettings(project));

  // Clear history
  panel.querySelector('#cpClearHistory').addEventListener('click', async () => {
    if (!confirm('Limpar toda a conversa?')) return;
    await window.api.chatClearHistory(project.id);
    Hub.renderChatProjects();
  });

  // Input auto-resize
  const input = panel.querySelector('#cpInput');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });

  // Enter to send, Shift+Enter for new line
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      Hub._cpSendMessage();
    }
  });

  // Send button
  const sendBtn = panel.querySelector('#cpSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', () => Hub._cpSendMessage());

  // Stop button
  const stopBtn = panel.querySelector('#cpStopBtn');
  if (stopBtn) stopBtn.addEventListener('click', async () => {
    await window.api.chatStopStreaming(Hub._cpActiveProject);
    Hub._cpStreaming = false;
    Hub.renderChatProjects();
  });

  // Focus input
  input.focus();
};

// ── Send Message ──
Hub._cpSendMessage = async function () {
  const input = document.getElementById('cpInput');
  const message = input?.value?.trim();
  if (!message || Hub._cpStreaming) return;

  Hub._cpStreaming = true;
  Hub._cpStreamText = '';

  // Re-render to show user message + streaming state
  Hub.renderChatProjects();

  try {
    const result = await window.api.chatSendMessage(Hub._cpActiveProject, message);

    if (!result.success) {
      Hub.showToast(result.error || 'Erro ao enviar mensagem', 'error');
    }
  } catch (err) {
    console.error('[ChatProjects] Send error:', err);
    Hub.showToast(err.message || 'Erro ao enviar mensagem', 'error');
  }

  Hub._cpStreaming = false;
  Hub._cpStreamText = '';
  Hub.renderChatProjects();
};

// ── Streaming Listeners ──
if (!Hub._cpStreamBound) {
  Hub._cpStreamBound = true;

  window.api.onChatStreamDelta((data) => {
    if (data.projectId !== Hub._cpActiveProject) return;
    Hub._cpStreamText = data.fullText;

    // Update streaming message without full re-render
    const streamMsg = document.getElementById('cpStreamMsg');
    if (streamMsg) {
      const bubble = streamMsg.querySelector('.cp-msg-bubble');
      if (bubble) bubble.innerHTML = Hub._cpFormatText(data.fullText);
      const msgs = document.getElementById('cpMessages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
  });

  window.api.onChatStreamDone((data) => {
    if (data.projectId !== Hub._cpActiveProject) return;
    Hub._cpStreaming = false;
    Hub._cpStreamText = '';
    Hub.renderChatProjects();
  });
}

// ── Settings Modal ──
Hub._cpShowSettings = function (project) {
  // Remove existing modal
  document.querySelector('.cp-modal-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop visible cp-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:560px;">
      <h3>Definições do Projeto</h3>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Nome</label>
        <input class="input" type="text" id="cpSettingsName" value="${Hub._escHtml(project.name)}">
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Instruções (System Prompt)</label>
        <textarea class="textarea" id="cpSettingsInstructions" rows="6" placeholder="Ex: Tu és um especialista em marketing digital...">${Hub._escHtml(project.instructions || '')}</textarea>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Modelo</label>
        <select class="input" id="cpSettingsModel">
          <option value="claude-sonnet-4.5" ${project.model === 'claude-sonnet-4.5' ? 'selected' : ''}>Claude Sonnet 4.5</option>
          <option value="gpt-5" ${project.model === 'gpt-5' ? 'selected' : ''}>GPT-5</option>
          <option value="gemini-2.5-pro" ${project.model === 'gemini-2.5-pro' ? 'selected' : ''}>Gemini 2.5 Pro</option>
          <option value="deepseek-v3.2" ${project.model === 'deepseek-v3.2' ? 'selected' : ''}>DeepSeek v3.2</option>
          <option value="grok-4" ${project.model === 'grok-4' ? 'selected' : ''}>Grok 4</option>
        </select>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Ficheiros de Contexto</label>
        <div class="cp-settings-files" id="cpSettingsFiles">
          ${(project.files || []).map((f, i) => `
            <div class="cp-settings-file">
              <span class="cp-settings-file-name">${Hub._escHtml(f.name)}</span>
              <span class="cp-settings-file-size">${(f.content?.length || 0).toLocaleString()} chars</span>
              <button class="cp-settings-file-remove" data-idx="${i}">&times;</button>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-secondary btn-small" id="cpAddFile" style="margin-top:8px;">+ Adicionar Ficheiro</button>
      </div>

      <div class="modal-actions">
        <button class="btn btn-danger btn-small" id="cpDeleteProject">Apagar Projeto</button>
        <div style="flex:1;"></div>
        <button class="btn btn-secondary" id="cpSettingsCancel">Cancelar</button>
        <button class="btn btn-primary" id="cpSettingsSave">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  // Cancel
  backdrop.querySelector('#cpSettingsCancel').addEventListener('click', () => backdrop.remove());

  // Save
  backdrop.querySelector('#cpSettingsSave').addEventListener('click', async () => {
    const name = backdrop.querySelector('#cpSettingsName').value.trim();
    const instructions = backdrop.querySelector('#cpSettingsInstructions').value;
    const model = backdrop.querySelector('#cpSettingsModel').value;

    if (!name) { Hub.showToast('Nome é obrigatório', 'error'); return; }

    await window.api.updateChatProject(project.id, { name, instructions, model });
    backdrop.remove();
    Hub.renderChatProjects();
  });

  // Delete project
  backdrop.querySelector('#cpDeleteProject').addEventListener('click', async () => {
    if (!confirm('Apagar este projeto e toda a conversa?')) return;
    await window.api.deleteChatProject(project.id);
    backdrop.remove();
    Hub._cpView = 'list';
    Hub._cpActiveProject = null;
    Hub.renderChatProjects();
  });

  // Add file
  backdrop.querySelector('#cpAddFile').addEventListener('click', async () => {
    const result = await window.api.chatAddFile(project.id);
    if (result.success) {
      Hub.showToast(`Ficheiro "${result.fileName}" adicionado`);
      backdrop.remove();
      // Reload project and reopen settings
      const projects = await window.api.getChatProjects();
      const updated = projects.find(p => p.id === project.id);
      if (updated) Hub._cpShowSettings(updated);
    } else if (result.error) {
      Hub.showToast(result.error, 'error');
    }
  });

  // Remove files
  backdrop.querySelectorAll('.cp-settings-file-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      await window.api.chatRemoveFile(project.id, idx);
      backdrop.remove();
      const projects = await window.api.getChatProjects();
      const updated = projects.find(p => p.id === project.id);
      if (updated) Hub._cpShowSettings(updated);
    });
  });
};

// ── Create Project ──
Hub._cpCreateProject = async function () {
  const project = await window.api.createChatProject({
    name: 'Novo Projeto',
    instructions: '',
    model: 'claude-sonnet-4.5',
  });

  // Open settings immediately
  Hub._cpActiveProject = project.id;
  Hub._cpView = 'chat';
  Hub.renderChatProjects();

  // Show settings after render
  setTimeout(() => Hub._cpShowSettings(project), 100);
};

// ── Helpers ──
Hub._cpModelLabel = function (model) {
  const labels = {
    'claude-sonnet-4.5': 'Claude 4.5',
    'gpt-5': 'GPT-5',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'deepseek-v3.2': 'DeepSeek v3.2',
    'grok-4': 'Grok 4',
    'deepseek-v3.1': 'DeepSeek',
  };
  return labels[model] || model;
};

Hub._cpFormatText = function (text) {
  if (!text) return '';
  let html = Hub._escHtml(text);

  // Code blocks: ```...```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *...*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return html;
};

Hub._cpRenderMsg = function (msg) {
  const cls = msg.role === 'user' ? 'cp-msg-user' : 'cp-msg-assistant';
  const time = new Date(msg.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const content = msg.role === 'assistant' ? Hub._cpFormatText(msg.content) : Hub._escHtml(msg.content);
  const sender = msg.senderName ? `<span class="cp-msg-sender">${Hub._escHtml(msg.senderName)}</span>` : '';

  return `
    <div class="cp-msg ${cls}">
      ${sender}
      <div class="cp-msg-bubble">${content}</div>
      <div class="cp-msg-time">${time}</div>
    </div>
  `;
};

// ── Real-time refresh listener ──
if (!Hub._cpRealtimeBound) {
  Hub._cpRealtimeBound = true;
  window.api.onChatProjectsChanged(() => {
    // Only refresh if we're viewing chat projects and not currently streaming
    if (Hub.state.activeSection === 'chat-projects' && !Hub._cpStreaming) {
      Hub.renderChatProjects();
    }
  });
}
