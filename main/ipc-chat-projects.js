const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { CHAT_BASE, callAI } = require('./elevate-api');
const { getSupabase, isChannelShared, getSupabaseChannelId } = require('./supabase');

const PROJECTS_PATH = path.join(DATA_DIR, 'chat-projects.json');

function getLocalProjects() {
  ensureDataDir();
  const data = readJson(PROJECTS_PATH);
  return (data && data.projects) || [];
}

function saveLocalProjects(projects) {
  writeJson(PROJECTS_PATH, { projects });
}

function findLocalProject(id) {
  return getLocalProjects().find(p => p.id === id);
}

function updateLocalProject(id, updates) {
  const projects = getLocalProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return null;
  Object.assign(projects[idx], updates, { updatedAt: Date.now() });
  saveLocalProjects(projects);
  return projects[idx];
}

// Notify all renderer windows
function notifyChatProjectsChanged() {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('chat-projects-changed', {});
  });
}

// ── Supabase helpers for Chat Projects ──

function getActiveChannelId() {
  const settings = getSettings();
  return settings.activeChannel || '';
}

async function getCloudChatProjects(channelId) {
  const supabaseChannelId = getSupabaseChannelId(channelId);
  if (!supabaseChannelId) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shared_chat_projects')
    .select('*')
    .eq('channel_id', supabaseChannelId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ChatProjects] Supabase fetch error:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    instructions: row.instructions || '',
    model: row.model || 'claude-sonnet-4.5',
    files: row.files || [],
    messages: [],  // Messages loaded separately
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _cloud: true,
  }));
}

async function getCloudMessages(projectId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shared_chat_messages')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[ChatProjects] Messages fetch error:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    role: row.role,
    content: row.content,
    senderName: row.sender_name || '',
    timestamp: new Date(row.created_at).getTime(),
  }));
}

async function createCloudChatProject(channelId, data) {
  const supabaseChannelId = getSupabaseChannelId(channelId);
  if (!supabaseChannelId) return null;

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from('shared_chat_projects')
    .insert({
      channel_id: supabaseChannelId,
      name: data.name || 'Novo Projeto',
      instructions: data.instructions || '',
      model: data.model || 'claude-sonnet-4.5',
      files: data.files || [],
    })
    .select()
    .single();

  if (error) {
    console.error('[ChatProjects] Supabase insert error:', error.message);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    model: row.model,
    files: row.files || [],
    messages: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _cloud: true,
  };
}

async function addCloudMessage(projectId, role, content, senderName) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('shared_chat_messages')
    .insert({
      project_id: projectId,
      role,
      content,
      sender_name: senderName,
    });

  if (error) {
    console.error('[ChatProjects] Message insert error:', error.message);
  }
}

// ── Real-time subscriptions ──
const activeChatSubs = new Map();

function subscribeToChatChannel(channelId) {
  if (activeChatSubs.has(channelId)) return;

  const supabaseChannelId = getSupabaseChannelId(channelId);
  if (!supabaseChannelId) return;

  const supabase = getSupabase();

  // Subscribe to project changes
  const sub = supabase
    .channel(`chat-${supabaseChannelId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_chat_projects',
      filter: `channel_id=eq.${supabaseChannelId}`,
    }, () => {
      notifyChatProjectsChanged();
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'shared_chat_messages',
    }, () => {
      notifyChatProjectsChanged();
    })
    .subscribe();

  activeChatSubs.set(channelId, sub);
}

// Build system prompt from project instructions + files
function buildSystemPrompt(project) {
  let prompt = project.instructions || 'You are a helpful assistant.';

  if (project.files && project.files.length > 0) {
    prompt += '\n\n--- Knowledge Base ---\n';
    for (const file of project.files) {
      prompt += `\n### ${file.name}\n${file.content}\n`;
    }
  }

  return prompt;
}

// AI call — tries streaming SSE first, falls back to JSON if API doesn't support it
async function callStreamingChat(apiKey, model, messages, maxTokens, signal, onDelta) {
  const response = await fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4.5',
      max_tokens: maxTokens,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 300)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  console.log(`[ChatProjects] Response content-type: ${contentType}`);

  // If API returned JSON instead of SSE stream, parse it directly
  if (contentType.includes('application/json')) {
    console.log('[ChatProjects] API returned JSON (no streaming). Parsing as single response.');
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (text && onDelta) onDelta(text, text);
    return text;
  }

  // SSE streaming path
  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    chunkCount++;

    if (chunkCount <= 3) {
      console.log(`[ChatProjects] SSE chunk ${chunkCount}:`, chunk.slice(0, 300));
    }

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;

      try {
        const evt = JSON.parse(raw);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          if (onDelta) onDelta(delta, fullText);
        }
      } catch (_) { /* skip */ }
    }
  }

  // If SSE stream returned data but no parsable deltas, try parsing whole body as JSON
  if (!fullText && buffer.trim()) {
    console.log('[ChatProjects] SSE produced no deltas. Trying to parse remaining buffer as JSON...');
    try {
      const data = JSON.parse(buffer.trim());
      const text = data.choices?.[0]?.message?.content || '';
      if (text) {
        fullText = text;
        if (onDelta) onDelta(text, text);
      }
    } catch (_) { /* not JSON */ }
  }

  console.log(`[ChatProjects] Stream ended — chunks: ${chunkCount}, text length: ${fullText.length}`);
  return fullText;
}

// Active abort controllers per project
const activeControllers = new Map();

// Helper to check if a project is cloud-based
async function isCloudProject(projectId) {
  try {
    const channelId = getActiveChannelId();
    if (!channelId || !isChannelShared(channelId)) return false;

    const supabase = getSupabase();
    const { data } = await supabase
      .from('shared_chat_projects')
      .select('id')
      .eq('id', projectId)
      .single();

    return !!data;
  } catch (err) {
    console.error('[ChatProjects] isCloudProject error:', err.message);
    return false;
  }
}

exports.register = function () {

  // Get all projects
  ipcMain.handle('get-chat-projects', async () => {
    const channelId = getActiveChannelId();

    if (channelId && isChannelShared(channelId)) {
      try {
        subscribeToChatChannel(channelId);
        const projects = await getCloudChatProjects(channelId);
        // Load messages for each project
        for (const p of projects) {
          p.messages = await getCloudMessages(p.id);
        }
        // Return cloud + local combined (local projects don't have _cloud flag)
        const localProjects = getLocalProjects();
        return [...projects, ...localProjects];
      } catch (err) {
        console.error('[ChatProjects] Cloud fetch failed, using local:', err.message);
      }
    }

    return getLocalProjects();
  });

  // Create project
  ipcMain.handle('create-chat-project', async (event, data) => {
    const channelId = getActiveChannelId();

    if (channelId && isChannelShared(channelId)) {
      const project = await createCloudChatProject(channelId, data);
      if (project) return project;
    }

    // Local fallback
    const projects = getLocalProjects();
    const project = {
      id: uuid(),
      name: data.name || 'Novo Projeto',
      instructions: data.instructions || '',
      files: [],
      messages: [],
      model: data.model || 'claude-sonnet-4.5',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    projects.push(project);
    saveLocalProjects(projects);
    return project;
  });

  // Update project
  ipcMain.handle('update-chat-project', async (event, id, data) => {
    if (await isCloudProject(id).catch(() => false)) {
      const supabase = getSupabase();
      const mapped = {};
      if (data.name !== undefined) mapped.name = data.name;
      if (data.instructions !== undefined) mapped.instructions = data.instructions;
      if (data.model !== undefined) mapped.model = data.model;
      if (data.files !== undefined) mapped.files = data.files;
      mapped.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('shared_chat_projects')
        .update(mapped)
        .eq('id', id);

      if (error) {
        console.error('[ChatProjects] Update error:', error.message);
        return null;
      }

      return { id, ...data };
    }

    return updateLocalProject(id, data);
  });

  // Delete project
  ipcMain.handle('delete-chat-project', async (event, id) => {
    if (await isCloudProject(id).catch(() => false)) {
      const supabase = getSupabase();

      // Delete messages first
      await supabase
        .from('shared_chat_messages')
        .delete()
        .eq('project_id', id);

      // Delete project
      const { error } = await supabase
        .from('shared_chat_projects')
        .delete()
        .eq('id', id);

      if (error) console.error('[ChatProjects] Delete error:', error.message);
      return { success: !error };
    }

    const projects = getLocalProjects().filter(p => p.id !== id);
    saveLocalProjects(projects);
    return { success: true };
  });

  // Send message (non-streaming, uses the same callAI that works for Scripts/Ideation)
  ipcMain.handle('chat-send-message', async (event, projectId, message) => {
    const settings = getSettings();
    if (!settings.elevateLabsApiKey) {
      return { success: false, error: 'API key not configured. Go to Settings.' };
    }

    let cloud = false;
    try {
      cloud = await isCloudProject(projectId);
    } catch (err) {
      console.error('[ChatProjects] isCloudProject check failed, using local:', err.message);
    }

    let project;
    let allMessages;

    try {
      if (cloud) {
        const supabase = getSupabase();
        const { data: pRow } = await supabase
          .from('shared_chat_projects')
          .select('*')
          .eq('id', projectId)
          .single();

        if (!pRow) return { success: false, error: 'Project not found in cloud.' };

        project = {
          instructions: pRow.instructions,
          files: pRow.files || [],
          model: pRow.model,
        };

        const channelId = getActiveChannelId();
        const userName = settings.channels?.[channelId]?.name || 'User';
        await addCloudMessage(projectId, 'user', message, userName);
        allMessages = await getCloudMessages(projectId);
      } else {
        project = findLocalProject(projectId);
        if (!project) return { success: false, error: 'Project not found.' };

        project.messages.push({
          role: 'user',
          content: message,
          timestamp: Date.now(),
        });
        allMessages = project.messages;
      }
    } catch (err) {
      console.error('[ChatProjects] Error preparing message:', err.message);
      return { success: false, error: err.message };
    }

    // Build system prompt with instructions + files
    const systemPrompt = buildSystemPrompt(project);
    const modelToUse = project.model || settings.model;

    // Build multi-turn messages for the API
    const apiMessages = allMessages.map(m => ({ role: m.role, content: m.content }));

    console.log(`[ChatProjects] Sending to API — model: ${modelToUse}, messages: ${apiMessages.length + 1}`);

    try {
      // Use the same callAI that works for Scripts, Ideation, etc.
      const response = await fetch(`${CHAT_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.elevateLabsApiKey}`,
        },
        body: JSON.stringify({
          model: modelToUse || 'claude-sonnet-4.5',
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            ...apiMessages,
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[ChatProjects] API error:', response.status, errText);
        return { success: false, error: `API error ${response.status}: ${errText.slice(0, 200)}` };
      }

      const data = await response.json();
      const fullText = data.choices?.[0]?.message?.content || '';

      console.log(`[ChatProjects] API response — length: ${fullText.length}`);

      if (!fullText) {
        console.error('[ChatProjects] Empty response. Full API data:', JSON.stringify(data).slice(0, 500));
        return { success: false, error: 'Empty response from API.' };
      }

      // Simulate streaming by sending the full text in word-chunks
      const words = fullText.split(' ');
      let partial = '';
      for (let i = 0; i < words.length; i++) {
        partial += (i > 0 ? ' ' : '') + words[i];
        if (i % 5 === 0 || i === words.length - 1) {
          event.sender.send('chat-stream-delta', { projectId, delta: words[i], fullText: partial });
        }
      }
      event.sender.send('chat-stream-done', { projectId, fullText });

      // Save assistant message
      if (cloud) {
        const channelId = getActiveChannelId();
        const userName = settings.channels?.[channelId]?.name || 'Assistant';
        await addCloudMessage(projectId, 'assistant', fullText, userName);
      } else {
        project.messages.push({
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        });
        updateLocalProject(projectId, { messages: project.messages });
      }

      return { success: true };
    } catch (err) {
      console.error('[ChatProjects] API call error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Stop streaming
  ipcMain.handle('chat-stop-streaming', (event, projectId) => {
    const controller = activeControllers.get(projectId);
    if (controller) {
      controller.abort();
      activeControllers.delete(projectId);
    }
    return { success: true };
  });

  // Clear history
  ipcMain.handle('chat-clear-history', async (event, projectId) => {
    if (await isCloudProject(projectId).catch(() => false)) {
      const supabase = getSupabase();
      await supabase
        .from('shared_chat_messages')
        .delete()
        .eq('project_id', projectId);
      return { success: true };
    }
    return updateLocalProject(projectId, { messages: [] });
  });

  // Add file
  ipcMain.handle('chat-add-file', async (event, projectId) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt', 'md', 'js', 'ts', 'json', 'csv', 'html', 'css', 'py', 'xml', 'yaml', 'yml', 'log'] },
      ],
    });

    if (result.canceled || !result.filePaths[0]) return { success: false };

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.length > 100000) {
        return { success: false, error: 'File too large (max 100KB text).' };
      }

      if (await isCloudProject(projectId).catch(() => false)) {
        const supabase = getSupabase();
        const { data: pRow } = await supabase
          .from('shared_chat_projects')
          .select('files')
          .eq('id', projectId)
          .single();

        const files = pRow?.files || [];
        files.push({ name: fileName, content });

        await supabase
          .from('shared_chat_projects')
          .update({ files, updated_at: new Date().toISOString() })
          .eq('id', projectId);

        return { success: true, fileName };
      }

      const project = findLocalProject(projectId);
      if (!project) return { success: false, error: 'Project not found.' };

      project.files = project.files || [];
      project.files.push({ name: fileName, path: filePath, content });
      updateLocalProject(projectId, { files: project.files });

      return { success: true, fileName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Remove file
  ipcMain.handle('chat-remove-file', async (event, projectId, fileIdx) => {
    if (await isCloudProject(projectId).catch(() => false)) {
      const supabase = getSupabase();
      const { data: pRow } = await supabase
        .from('shared_chat_projects')
        .select('files')
        .eq('id', projectId)
        .single();

      const files = pRow?.files || [];
      files.splice(fileIdx, 1);

      await supabase
        .from('shared_chat_projects')
        .update({ files, updated_at: new Date().toISOString() })
        .eq('id', projectId);

      return { success: true };
    }

    const project = findLocalProject(projectId);
    if (!project) return { success: false };

    project.files.splice(fileIdx, 1);
    updateLocalProject(projectId, { files: project.files });
    return { success: true };
  });
};
