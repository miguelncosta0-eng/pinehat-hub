const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, ensureDataDir, uuid } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { callAI } = require('./elevate-api');

const COMPETITORS_PATH = path.join(DATA_DIR, 'competitors.json');
const SERIES_PATH = path.join(DATA_DIR, 'series.json');
const IDEATION_PATH = path.join(DATA_DIR, 'ideation.json');

function getCompetitors() {
  ensureDataDir();
  const data = readJson(COMPETITORS_PATH);
  return (data && data.channels) || [];
}

function getSeries() {
  ensureDataDir();
  const data = readJson(SERIES_PATH);
  return (data && data.series) || [];
}

function getIdeationData() {
  ensureDataDir();
  return readJson(IDEATION_PATH) || {};
}

function saveIdeationData(data) {
  writeJson(IDEATION_PATH, data);
}

function register() {
  // Get saved ideas history for a channel
  ipcMain.handle('ideation-get-history', async (_event, channel) => {
    const data = getIdeationData();
    return (data[channel] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  });

  // Delete a saved idea batch
  ipcMain.handle('ideation-delete', async (_event, { channel, id }) => {
    const data = getIdeationData();
    if (!data[channel]) return { success: true };
    data[channel] = data[channel].filter((item) => item.id !== id);
    saveIdeationData(data);
    return { success: true };
  });

  ipcMain.handle('ideation-generate', async (_event, options) => {
    const settings = getSettings();
    if (!settings.elevateLabsApiKey) {
      return { success: false, error: 'Configura a Elevate Labs API Key nas Definições.' };
    }

    const { seriesName, competitorIds, channel } = options;
    if (!seriesName) return { success: false, error: 'Seleciona uma série.' };
    if (!competitorIds || competitorIds.length === 0) {
      return { success: false, error: 'Seleciona pelo menos um competidor.' };
    }

    try {
      const competitors = getCompetitors();
      const selected = competitors.filter((c) => competitorIds.includes(c.id));

      // Collect all recent videos from selected competitors
      const allVideos = [];
      for (const comp of selected) {
        if (comp.recentVideos && comp.recentVideos.length > 0) {
          for (const v of comp.recentVideos) {
            allVideos.push({
              channel: comp.title,
              title: v.title,
              views: v.viewCount,
              likes: v.likeCount,
              published: v.publishedAt,
            });
          }
        }
      }

      if (allVideos.length === 0) {
        return { success: false, error: 'Os competidores selecionados não têm vídeos. Atualiza-os primeiro.' };
      }

      // Sort by views desc, take top 20
      allVideos.sort((a, b) => b.views - a.views);
      const topVideos = allVideos.slice(0, 20);

      const videoList = topVideos
        .map((v, i) => `${i + 1}. "${v.title}" — ${v.channel} (${v.views.toLocaleString()} views)`)
        .join('\n');

      const model = settings.model || 'claude-sonnet-4-5';

      const systemPrompt = `You are a YouTube video strategist. You analyze competitor videos and generate creative video ideas. Always respond in English with valid JSON.`;

      const userPrompt = `I make YouTube videos about the TV series "${seriesName}". Here are the top-performing videos from my competitors:

${videoList}

Based on these successful videos, generate 8 unique video ideas for my channel about "${seriesName}". For each idea, analyze why similar competitor videos performed well and adapt the concept.

Return ONLY a JSON array with exactly 8 objects:
[
  {
    "title": "video title (catchy, YouTube-optimized)",
    "hook": "first 2 sentences to hook the viewer",
    "angle": "what makes this video unique (analysis, ranking, theory, deep-dive, etc.)",
    "format": "video format (iceberg, ranking, essay, theory, comparison, timeline, etc.)",
    "inspiration": "which competitor video inspired this and why it works"
  }
]`;

      const result = await callAI(settings.elevateLabsApiKey, model, systemPrompt, userPrompt, 4096);

      const text = result.content?.[0]?.text || '';

      // Parse JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return { success: false, error: 'Resposta inválida da IA. Tenta novamente.' };
      }

      const ideas = JSON.parse(jsonMatch[0]);

      // Save to history
      const data = getIdeationData();
      const ch = channel || 'pinehat';
      if (!data[ch]) data[ch] = [];
      data[ch].unshift({
        id: uuid(),
        date: new Date().toISOString(),
        seriesName,
        competitorNames: selected.map((c) => c.title),
        ideas,
      });
      saveIdeationData(data);

      return { success: true, ideas };
    } catch (err) {
      return { success: false, error: err.message || 'Erro ao gerar ideias.' };
    }
  });
}

module.exports = { register };
