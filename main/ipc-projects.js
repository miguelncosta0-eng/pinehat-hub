const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSupabase, isChannelShared, getSupabaseChannelId } = require('./supabase');
const { getSettings } = require('./ipc-settings');

const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');

function getLocalProjects() {
  ensureDataDir();
  const data = readJson(PROJECTS_PATH);
  return (data && data.projects) || [];
}

function saveLocalProjects(projects) {
  writeJson(PROJECTS_PATH, { projects });
}

// Notify all renderer windows
function notifyProjectsChanged() {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('projects-changed', {});
  });
}

// ── Supabase helpers ──

async function getCloudProjects(channelId) {
  const supabaseChannelId = getSupabaseChannelId(channelId);
  if (!supabaseChannelId) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shared_projects')
    .select('*')
    .eq('channel_id', supabaseChannelId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Projects] Supabase fetch error:', error.message);
    return [];
  }

  // Map Supabase rows to local format
  return (data || []).map(row => ({
    id: row.id,
    title: row.title,
    channel: channelId,
    state: row.state || 'ideia',
    format: row.format || null,
    scriptId: row.script_id || null,
    youtubeUrl: row.youtube_url || null,
    publishDate: row.publish_date || null,
    notes: row.notes || '',
    checklist: row.checklist || {},
    thumbnail: row.thumbnail || null,
    voiceover: row.voiceover || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _cloud: true,
  }));
}

async function createCloudProject(channelId, data) {
  const supabaseChannelId = getSupabaseChannelId(channelId);
  if (!supabaseChannelId) return null;

  const settings = getSettings();
  const channelName = settings.channels?.[channelId]?.name || 'Unknown';

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from('shared_projects')
    .insert({
      channel_id: supabaseChannelId,
      title: data.title || 'Sem título',
      state: data.state || 'ideia',
      format: data.format || null,
      script_id: data.scriptId || null,
      youtube_url: data.youtubeUrl || null,
      publish_date: data.publishDate || null,
      notes: data.notes || '',
      checklist: data.checklist || {},
      created_by: channelName,
    })
    .select()
    .single();

  if (error) {
    console.error('[Projects] Supabase insert error:', error.message);
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    channel: channelId,
    state: row.state,
    format: row.format,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _cloud: true,
  };
}

async function updateCloudProject(id, updates) {
  const supabase = getSupabase();

  const mapped = {};
  if (updates.title !== undefined) mapped.title = updates.title;
  if (updates.state !== undefined) mapped.state = updates.state;
  if (updates.format !== undefined) mapped.format = updates.format;
  if (updates.scriptId !== undefined) mapped.script_id = updates.scriptId;
  if (updates.youtubeUrl !== undefined) mapped.youtube_url = updates.youtubeUrl;
  if (updates.publishDate !== undefined) mapped.publish_date = updates.publishDate;
  if (updates.notes !== undefined) mapped.notes = updates.notes;
  if (updates.checklist !== undefined) mapped.checklist = updates.checklist;
  if (updates.thumbnail !== undefined) mapped.thumbnail = updates.thumbnail;
  if (updates.voiceover !== undefined) mapped.voiceover = updates.voiceover;
  mapped.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('shared_projects')
    .update(mapped)
    .eq('id', id);

  if (error) {
    console.error('[Projects] Supabase update error:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

async function deleteCloudProject(id) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('shared_projects')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Projects] Supabase delete error:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ── Real-time subscriptions ──
const activeSubscriptions = new Map();

function subscribeToChannel(channelId) {
  if (activeSubscriptions.has(channelId)) return;

  const supabaseChannelId = getSupabaseChannelId(channelId);
  if (!supabaseChannelId) return;

  const supabase = getSupabase();
  const subscription = supabase
    .channel(`projects-${supabaseChannelId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_projects',
      filter: `channel_id=eq.${supabaseChannelId}`,
    }, () => {
      notifyProjectsChanged();
    })
    .subscribe();

  activeSubscriptions.set(channelId, subscription);
}

function unsubscribeFromChannel(channelId) {
  const sub = activeSubscriptions.get(channelId);
  if (sub) {
    sub.unsubscribe();
    activeSubscriptions.delete(channelId);
  }
}

function register() {
  ipcMain.handle('get-projects', async (_event, filters) => {
    const channelId = filters?.channel;

    // If channel is shared, fetch from Supabase
    if (channelId && isChannelShared(channelId)) {
      subscribeToChannel(channelId);
      return getCloudProjects(channelId);
    }

    // Otherwise, local
    let projects = getLocalProjects();
    if (channelId) {
      projects = projects.filter((p) => p.channel === channelId);
    }
    return projects;
  });

  ipcMain.handle('create-project', async (_event, data) => {
    const channelId = data.channel || 'pinehat';

    if (isChannelShared(channelId)) {
      const project = await createCloudProject(channelId, data);
      if (project) return project;
      // Fallback to local if cloud fails
    }

    const projects = getLocalProjects();
    const project = {
      id: uuid(),
      title: data.title || 'Sem título',
      channel: channelId,
      format: data.format || null,
      state: data.state || 'ideia',
      scriptId: data.scriptId || null,
      youtubeUrl: data.youtubeUrl || null,
      publishDate: data.publishDate || null,
      notes: data.notes || '',
      thumbnail: data.thumbnail || null,
      voiceover: data.voiceover || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.push(project);
    saveLocalProjects(projects);
    return project;
  });

  ipcMain.handle('update-project', async (_event, id, updates) => {
    // Try cloud first — UUIDs from Supabase will match
    // Check if any shared channel could own this project
    const settings = getSettings();
    const channels = settings.channels || {};
    for (const [chId, ch] of Object.entries(channels)) {
      if (ch.shared && ch.supabaseChannelId) {
        const result = await updateCloudProject(id, updates);
        if (result.success) return result;
      }
    }

    // Local fallback
    const projects = getLocalProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: 'Projeto não encontrado.' };
    projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
    saveLocalProjects(projects);
    return { success: true, project: projects[idx] };
  });

  ipcMain.handle('delete-project', async (_event, id) => {
    // Try cloud first
    const settings = getSettings();
    const channels = settings.channels || {};
    for (const [chId, ch] of Object.entries(channels)) {
      if (ch.shared && ch.supabaseChannelId) {
        const result = await deleteCloudProject(id);
        if (result.success) return result;
      }
    }

    // Local fallback
    let projects = getLocalProjects();
    projects = projects.filter((p) => p.id !== id);
    saveLocalProjects(projects);
    return { success: true };
  });
}

module.exports = { register };
