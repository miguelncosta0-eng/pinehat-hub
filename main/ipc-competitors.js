const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');

const COMPETITORS_PATH = path.join(DATA_DIR, 'competitors.json');

// In-memory transcript cache (cleared on app restart)
const transcriptCache = new Map();

function getCompetitors() {
  ensureDataDir();
  const data = readJson(COMPETITORS_PATH);
  return (data && data.channels) || [];
}

function saveCompetitors(channels) {
  writeJson(COMPETITORS_PATH, { channels });
}

async function ytApiFetch(endpoint, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  params.key = apiKey;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    let msg = `YouTube API ${res.status}`;
    try {
      const body = await res.json();
      const reason = body?.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded') msg = 'Quota diária da YouTube API excedida. Tenta amanhã.';
      else if (reason === 'forbidden') msg = 'API key sem permissão para este recurso.';
      else msg = body?.error?.message || msg;
    } catch (_) { /* raw text fallback */ }
    throw new Error(msg);
  }
  return await res.json();
}

// Extract channel ID from various URL formats
function extractChannelId(input) {
  input = input.trim();
  // Direct channel ID (UC...)
  if (/^UC[\w-]{22}$/.test(input)) return { type: 'id', value: input };
  // @handle
  if (input.startsWith('@')) return { type: 'handle', value: input };
  // URL patterns
  const urlMatch = input.match(/youtube\.com\/(channel|c|user|@)(\/?)([^/?&]+)/i);
  if (urlMatch) {
    if (urlMatch[1] === 'channel') return { type: 'id', value: urlMatch[3] };
    if (urlMatch[1] === '@') return { type: 'handle', value: '@' + urlMatch[3] };
    return { type: 'username', value: urlMatch[3] };
  }
  // Handle format in URL
  const handleMatch = input.match(/youtube\.com\/(@[^/?&]+)/i);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };
  // Assume it's a handle or search term
  return { type: 'handle', value: input.startsWith('@') ? input : '@' + input };
}

async function resolveChannelId(input, apiKey) {
  const parsed = extractChannelId(input);

  if (parsed.type === 'id') return parsed.value;

  if (parsed.type === 'handle') {
    const data = await ytApiFetch('channels', {
      part: 'id',
      forHandle: parsed.value.replace('@', ''),
    }, apiKey);
    if (data.items && data.items.length > 0) return data.items[0].id;
    // Fallback: search
    const search = await ytApiFetch('search', {
      part: 'snippet',
      q: parsed.value,
      type: 'channel',
      maxResults: 1,
    }, apiKey);
    if (search.items && search.items.length > 0) return search.items[0].snippet.channelId;
    throw new Error(`Canal não encontrado: ${input}`);
  }

  if (parsed.type === 'username') {
    const data = await ytApiFetch('channels', {
      part: 'id',
      forUsername: parsed.value,
    }, apiKey);
    if (data.items && data.items.length > 0) return data.items[0].id;
    throw new Error(`Canal não encontrado: ${input}`);
  }

  throw new Error(`Formato não reconhecido: ${input}`);
}

async function fetchChannelData(channelId, apiKey) {
  const data = await ytApiFetch('channels', {
    part: 'snippet,statistics,brandingSettings',
    id: channelId,
  }, apiKey);

  if (!data.items || data.items.length === 0) throw new Error('Canal não encontrado.');

  const ch = data.items[0];
  return {
    channelId: ch.id,
    title: ch.snippet.title,
    description: ch.snippet.description?.slice(0, 200) || '',
    thumbnail: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || '',
    customUrl: ch.snippet.customUrl || '',
    subscriberCount: parseInt(ch.statistics.subscriberCount) || 0,
    viewCount: parseInt(ch.statistics.viewCount) || 0,
    videoCount: parseInt(ch.statistics.videoCount) || 0,
    hiddenSubscribers: ch.statistics.hiddenSubscriberCount || false,
  };
}

async function fetchRecentVideos(channelId, apiKey, maxResults = 6) {
  // Use playlistItems (1 quota unit) instead of search (100 units)
  const uploadsPlaylistId = 'UU' + channelId.slice(2);
  const playlist = await ytApiFetch('playlistItems', {
    part: 'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults),
  }, apiKey);

  if (!playlist.items || playlist.items.length === 0) return [];

  // Get video statistics
  const videoIds = playlist.items.map((v) => v.snippet.resourceId.videoId).join(',');
  const stats = await ytApiFetch('videos', {
    part: 'statistics,contentDetails',
    id: videoIds,
  }, apiKey);

  const statsMap = {};
  (stats.items || []).forEach((v) => { statsMap[v.id] = v; });

  return playlist.items.map((v) => {
    const vid = v.snippet.resourceId.videoId;
    const s = statsMap[vid];
    return {
      videoId: vid,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
      viewCount: parseInt(s?.statistics?.viewCount) || 0,
      likeCount: parseInt(s?.statistics?.likeCount) || 0,
      commentCount: parseInt(s?.statistics?.commentCount) || 0,
      duration: s?.contentDetails?.duration || '',
    };
  });
}

function register() {
  ipcMain.handle('competitors-get', () => {
    return getCompetitors();
  });

  ipcMain.handle('competitors-add', async (_event, input) => {
    const settings = getSettings();
    if (!settings.youtubeApiKey) {
      return { success: false, error: 'Configura a YouTube API Key nas Definições.' };
    }

    try {
      const channelId = await resolveChannelId(input, settings.youtubeApiKey);

      // Check duplicate
      const existing = getCompetitors();
      if (existing.find((c) => c.channelId === channelId)) {
        return { success: false, error: 'Este canal já está na lista.' };
      }

      const channelData = await fetchChannelData(channelId, settings.youtubeApiKey);
      const videos = await fetchRecentVideos(channelId, settings.youtubeApiKey);

      const today = new Date().toISOString().slice(0, 10);
      const competitor = {
        id: uuid(),
        ...channelData,
        recentVideos: videos,
        history: [{
          date: today,
          subscriberCount: channelData.subscriberCount,
          viewCount: channelData.viewCount,
          videoCount: channelData.videoCount,
        }],
        addedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };

      existing.push(competitor);
      saveCompetitors(existing);
      return { success: true, competitor };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('competitors-refresh', async (_event, competitorId) => {
    const settings = getSettings();
    if (!settings.youtubeApiKey) {
      return { success: false, error: 'Configura a YouTube API Key nas Definições.' };
    }

    const channels = getCompetitors();
    const idx = channels.findIndex((c) => c.id === competitorId);
    if (idx === -1) return { success: false, error: 'Competidor não encontrado.' };

    try {
      const channelData = await fetchChannelData(channels[idx].channelId, settings.youtubeApiKey);
      const videos = await fetchRecentVideos(channels[idx].channelId, settings.youtubeApiKey);

      // Track history (one snapshot per day)
      const today = new Date().toISOString().slice(0, 10);
      if (!channels[idx].history) channels[idx].history = [];
      const lastEntry = channels[idx].history[channels[idx].history.length - 1];
      if (!lastEntry || lastEntry.date !== today) {
        channels[idx].history.push({
          date: today,
          subscriberCount: channelData.subscriberCount,
          viewCount: channelData.viewCount,
          videoCount: channelData.videoCount,
        });
      }

      channels[idx] = {
        ...channels[idx],
        ...channelData,
        recentVideos: videos,
        lastUpdated: new Date().toISOString(),
      };

      saveCompetitors(channels);
      return { success: true, competitor: channels[idx] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('competitors-refresh-all', async () => {
    const settings = getSettings();
    if (!settings.youtubeApiKey) {
      return { success: false, error: 'Configura a YouTube API Key nas Definições.' };
    }

    const channels = getCompetitors();
    const errors = [];

    for (let i = 0; i < channels.length; i++) {
      try {
        const channelData = await fetchChannelData(channels[i].channelId, settings.youtubeApiKey);
        const videos = await fetchRecentVideos(channels[i].channelId, settings.youtubeApiKey);

        const today = new Date().toISOString().slice(0, 10);
        if (!channels[i].history) channels[i].history = [];
        const lastEntry = channels[i].history[channels[i].history.length - 1];
        if (!lastEntry || lastEntry.date !== today) {
          channels[i].history.push({
            date: today,
            subscriberCount: channelData.subscriberCount,
            viewCount: channelData.viewCount,
            videoCount: channelData.videoCount,
          });
        }

        channels[i] = {
          ...channels[i],
          ...channelData,
          recentVideos: videos,
          lastUpdated: new Date().toISOString(),
        };
      } catch (err) {
        console.error(`[Competitors] Refresh failed for ${channels[i].title}:`, err.message);
        errors.push(`${channels[i].title}: ${err.message}`);
      }
    }

    saveCompetitors(channels);
    return { success: true, errors, total: channels.length };
  });

  ipcMain.handle('competitors-remove', (_event, competitorId) => {
    let channels = getCompetitors();
    channels = channels.filter((c) => c.id !== competitorId);
    saveCompetitors(channels);
    return { success: true };
  });

  // ── Video transcript ──

  ipcMain.handle('competitors-get-transcript', async (_event, videoId) => {
    // Check cache first
    if (transcriptCache.has(videoId)) {
      return { success: true, transcript: transcriptCache.get(videoId) };
    }

    try {
      const { YouTubeTranscriptApi } = await import('yt-transcript-api');
      const api = new YouTubeTranscriptApi();

      // List available transcripts for the video
      const transcriptList = await api.list(videoId);

      // Try to find manual transcript first, then auto-generated
      let transcriptObj = null;
      let usedLang = '';

      // Prefer: en manual → pt manual → any manual → en auto → pt auto → any auto
      try {
        transcriptObj = transcriptList.findManuallyCreatedTranscript(['en', 'pt', 'pt-BR']);
      } catch (_) { /* not found */ }

      if (!transcriptObj) {
        try {
          transcriptObj = transcriptList.findTranscript(['en', 'pt', 'pt-BR']);
        } catch (_) { /* not found */ }
      }

      if (!transcriptObj) {
        try {
          transcriptObj = transcriptList.findGeneratedTranscript(['en', 'pt', 'pt-BR']);
        } catch (_) { /* not found */ }
      }

      if (!transcriptObj) {
        return { success: false, error: 'Transcrição não disponível para este vídeo.' };
      }

      usedLang = transcriptObj.languageCode || 'auto';

      // Fetch the actual transcript data
      const segments = await transcriptObj.fetch();

      if (!segments || segments.length === 0) {
        return { success: false, error: 'Transcrição não disponível para este vídeo.' };
      }

      // Join all segments into clean readable text
      const fullText = segments
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
        .trim();

      const transcript = {
        fullText,
        wordCount: fullText.split(/\s+/).filter(Boolean).length,
        language: usedLang,
      };

      // Cache it
      transcriptCache.set(videoId, transcript);

      return { success: true, transcript };
    } catch (err) {
      return { success: false, error: `Erro ao obter transcrição: ${err.message}` };
    }
  });
}

module.exports = { register };
