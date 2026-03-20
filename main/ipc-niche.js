const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, ensureDataDir, uuid } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');

const SAVED_PATH = path.join(DATA_DIR, 'niche-saved.json');

function getSaved() {
  ensureDataDir();
  const data = readJson(SAVED_PATH);
  return (data && data.channels) || [];
}

function saveSavedChannels(channels) {
  writeJson(SAVED_PATH, { channels });
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
      if (reason === 'quotaExceeded') msg = 'YouTube API daily quota exceeded. Try again tomorrow.';
      else if (reason === 'forbidden') msg = 'API key does not have permission for this resource.';
      else msg = body?.error?.message || msg;
    } catch (_) { /* raw text fallback */ }
    throw new Error(msg);
  }
  return await res.json();
}

function register() {
  // ── Search channels by keyword ──
  ipcMain.handle('niche-search', async (_event, { query, minSubs, maxSubs, sortBy }) => {
    const settings = getSettings();
    if (!settings.youtubeApiKey) {
      return { success: false, error: 'Configure your YouTube API Key in Settings.' };
    }

    const apiKey = settings.youtubeApiKey;

    try {
      // 1. Search for channels
      const searchData = await ytApiFetch('search', {
        part: 'snippet',
        type: 'channel',
        q: query,
        maxResults: '20',
      }, apiKey);

      if (!searchData.items || searchData.items.length === 0) {
        return { success: true, channels: [] };
      }

      const channelIds = searchData.items.map((item) => item.snippet.channelId);

      // 2. Get channel stats
      const channelsData = await ytApiFetch('channels', {
        part: 'statistics,snippet,contentDetails',
        id: channelIds.join(','),
      }, apiKey);

      if (!channelsData.items || channelsData.items.length === 0) {
        return { success: true, channels: [] };
      }

      // 3. For each channel, get recent uploads and compute stats
      const channels = [];

      for (const ch of channelsData.items) {
        const subscriberCount = parseInt(ch.statistics.subscriberCount) || 0;
        const viewCount = parseInt(ch.statistics.viewCount) || 0;
        const videoCount = parseInt(ch.statistics.videoCount) || 0;

        // Apply subscriber filters
        if (minSubs != null && minSubs > 0 && subscriberCount < minSubs) continue;
        if (maxSubs != null && maxSubs > 0 && subscriberCount > maxSubs) continue;

        // Get uploads playlist
        const uploadsPlaylistId = ch.contentDetails?.relatedPlaylists?.uploads;
        let avgViewsPerVideo = 0;
        let outlierScore = 0;

        if (uploadsPlaylistId) {
          try {
            // 3a. Get recent 5 videos from uploads playlist
            const playlistData = await ytApiFetch('playlistItems', {
              part: 'snippet',
              playlistId: uploadsPlaylistId,
              maxResults: '5',
            }, apiKey);

            if (playlistData.items && playlistData.items.length > 0) {
              const videoIds = playlistData.items
                .map((v) => v.snippet.resourceId.videoId)
                .filter(Boolean);

              if (videoIds.length > 0) {
                // 3b. Get video stats
                const videosData = await ytApiFetch('videos', {
                  part: 'statistics',
                  id: videoIds.join(','),
                }, apiKey);

                if (videosData.items && videosData.items.length > 0) {
                  const totalViews = videosData.items.reduce(
                    (sum, v) => sum + (parseInt(v.statistics.viewCount) || 0), 0
                  );
                  avgViewsPerVideo = Math.round(totalViews / videosData.items.length);
                }
              }
            }
          } catch (err) {
            // If we can't get video stats for a channel, continue with 0
            console.warn(`[Niche] Could not get video stats for ${ch.snippet.title}:`, err.message);
          }
        }

        // Calculate outlier score
        if (subscriberCount > 0) {
          outlierScore = avgViewsPerVideo / subscriberCount;
        }

        // Days since channel start
        const publishedAt = ch.snippet.publishedAt ? new Date(ch.snippet.publishedAt) : null;
        const daysSinceStart = publishedAt
          ? Math.floor((Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        channels.push({
          channelId: ch.id,
          title: ch.snippet.title,
          description: ch.snippet.description?.slice(0, 200) || '',
          thumbnail: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || '',
          customUrl: ch.snippet.customUrl || '',
          subscriberCount,
          viewCount,
          videoCount,
          avgViewsPerVideo,
          outlierScore: Math.round(outlierScore * 100) / 100,
          daysSinceStart,
          publishedAt: ch.snippet.publishedAt || '',
        });
      }

      // Sort results
      if (sortBy === 'subs') {
        channels.sort((a, b) => b.subscriberCount - a.subscriberCount);
      } else if (sortBy === 'avgViews') {
        channels.sort((a, b) => b.avgViewsPerVideo - a.avgViewsPerVideo);
      } else {
        // Default: sort by outlier score (highest first)
        channels.sort((a, b) => b.outlierScore - a.outlierScore);
      }

      return { success: true, channels };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Save a channel to favorites ──
  ipcMain.handle('niche-save', (_event, channel) => {
    const saved = getSaved();
    // Check duplicate
    if (saved.find((c) => c.channelId === channel.channelId)) {
      return { success: false, error: 'Channel already saved.' };
    }
    saved.push({
      id: uuid(),
      ...channel,
      savedAt: new Date().toISOString(),
    });
    saveSavedChannels(saved);
    return { success: true };
  });

  // ── Get saved channels ──
  ipcMain.handle('niche-get-saved', () => {
    return getSaved();
  });

  // ── Delete a saved channel ──
  ipcMain.handle('niche-delete-saved', (_event, id) => {
    let saved = getSaved();
    saved = saved.filter((c) => c.id !== id);
    saveSavedChannels(saved);
    return { success: true };
  });
}

module.exports = { register };
