const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSupabase, isChannelShared, getSupabaseChannelId, uploadThumbnail } = require('./supabase');
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
  // Select image + upload to Supabase Storage, returns public URL
  ipcMain.handle('select-and-upload-thumbnail', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });

    const filePath = result.filePaths?.[0];
    if (!filePath) return { success: false };

    try {
      const url = await uploadThumbnail(filePath);
      if (!url) return { success: false, error: 'Upload falhou.' };
      return { success: true, url, localPath: filePath };
    } catch (err) {
      console.error('[Projects] Thumbnail upload error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-projects', async (_event, filters) => {
    const channelId = filters?.channel;

    // If channel is shared, fetch from Supabase + local fallback
    if (channelId && isChannelShared(channelId)) {
      subscribeToChannel(channelId);
      try {
        const cloudProjects = await getCloudProjects(channelId);
        // Also include any local projects for this channel (fallback)
        const localProjects = getLocalProjects().filter(p => p.channel === channelId);
        // Merge: cloud first, then local (avoid duplicates by ID)
        const cloudIds = new Set(cloudProjects.map(p => p.id));
        const merged = [...cloudProjects, ...localProjects.filter(p => !cloudIds.has(p.id))];
        return merged;
      } catch (err) {
        console.error('[Projects] Cloud fetch failed, using local:', err.message);
        return getLocalProjects().filter(p => p.channel === channelId);
      }
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
      try {
        const project = await createCloudProject(channelId, data);
        if (project) {
          notifyProjectsChanged();
          return project;
        }
      } catch (err) {
        console.error('[Projects] Cloud create failed:', err.message);
      }
    }

    // Local create (for non-shared channels, or cloud fallback)
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
    notifyProjectsChanged();
    return project;
  });

  ipcMain.handle('update-project', async (_event, id, updates) => {
    // Check if this project exists in Supabase first
    const supabase = getSupabase();
    const { data: cloudRow } = await supabase
      .from('shared_projects')
      .select('id')
      .eq('id', id)
      .single();

    if (cloudRow) {
      // Project exists in cloud — update there
      const result = await updateCloudProject(id, updates);
      return result;
    }

    // Local project
    const projects = getLocalProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: 'Projeto não encontrado.' };
    projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
    saveLocalProjects(projects);
    return { success: true, project: projects[idx] };
  });

  ipcMain.handle('delete-project', async (_event, id) => {
    // Check if this project exists in Supabase
    const supabase = getSupabase();
    const { data: cloudRow } = await supabase
      .from('shared_projects')
      .select('id')
      .eq('id', id)
      .single();

    if (cloudRow) {
      return await deleteCloudProject(id);
    }

    // Local project
    let projects = getLocalProjects();
    projects = projects.filter((p) => p.id !== id);
    saveLocalProjects(projects);
    return { success: true };
  });

  // Sync local projects to Supabase for a shared channel
  ipcMain.handle('sync-projects-to-cloud', async (_event, channelId) => {
    if (!isChannelShared(channelId)) {
      return { success: false, error: 'Canal não está partilhado.' };
    }

    const supabaseChannelId = getSupabaseChannelId(channelId);
    if (!supabaseChannelId) return { success: false, error: 'Canal Supabase não encontrado.' };

    // Get local projects for this channel
    const localProjects = getLocalProjects().filter(p => p.channel === channelId);
    if (localProjects.length === 0) return { success: true, synced: 0 };

    // Check which already exist in Supabase (by title to avoid duplicates)
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from('shared_projects')
      .select('title')
      .eq('channel_id', supabaseChannelId);

    const existingTitles = new Set((existing || []).map(r => r.title));

    let synced = 0;
    for (const p of localProjects) {
      if (existingTitles.has(p.title)) continue; // Skip duplicates

      const { error } = await supabase
        .from('shared_projects')
        .insert({
          channel_id: supabaseChannelId,
          title: p.title,
          state: p.state || 'ideia',
          format: p.format || null,
          script_id: p.scriptId || null,
          youtube_url: p.youtubeUrl || null,
          publish_date: p.publishDate || null,
          notes: p.notes || '',
          checklist: p.checklist || {},
          created_by: 'Windows',
        });

      if (!error) synced++;
      else console.error('[Projects] Sync error for', p.title, ':', error.message);
    }

    console.log(`[Projects] Synced ${synced}/${localProjects.length} projects to cloud`);
    return { success: true, synced };
  });
}

module.exports = { register };
