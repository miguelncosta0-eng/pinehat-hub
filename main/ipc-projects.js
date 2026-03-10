const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');

const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');

function getProjects() {
  ensureDataDir();
  const data = readJson(PROJECTS_PATH);
  return (data && data.projects) || [];
}

function saveProjects(projects) {
  writeJson(PROJECTS_PATH, { projects });
}

function register() {
  ipcMain.handle('get-projects', (_event, filters) => {
    let projects = getProjects();
    if (filters && filters.channel) {
      projects = projects.filter((p) => p.channel === filters.channel);
    }
    return projects;
  });

  ipcMain.handle('create-project', (_event, data) => {
    const projects = getProjects();
    const project = {
      id: uuid(),
      title: data.title || 'Sem título',
      channel: data.channel || 'pinehat',
      format: data.format || null,
      state: data.state || 'ideia',
      scriptId: data.scriptId || null,
      youtubeUrl: data.youtubeUrl || null,
      publishDate: data.publishDate || null,
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.push(project);
    saveProjects(projects);
    return project;
  });

  ipcMain.handle('update-project', (_event, id, updates) => {
    const projects = getProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: 'Projeto não encontrado.' };
    projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
    saveProjects(projects);
    return { success: true, project: projects[idx] };
  });

  ipcMain.handle('delete-project', (_event, id) => {
    let projects = getProjects();
    projects = projects.filter((p) => p.id !== id);
    saveProjects(projects);
    return { success: true };
  });
}

module.exports = { register };
