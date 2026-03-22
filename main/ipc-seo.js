const { ipcMain } = require('electron');
const path = require('path');
const { DATA_DIR, readJson, writeJson, ensureDataDir, uuid } = require('./ipc-data');
const { getSettings } = require('./ipc-settings');
const { callAI } = require('./elevate-api');

const SEO_PATH = path.join(DATA_DIR, 'seo.json');

function getSeoData() {
  ensureDataDir();
  return readJson(SEO_PATH) || {};
}

function saveSeoData(data) {
  writeJson(SEO_PATH, data);
}

function register() {
  // Get saved SEO generations for a channel
  ipcMain.handle('seo-get-history', async (_event, channel) => {
    const data = getSeoData();
    return (data[channel] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  });

  // Delete a saved SEO generation
  ipcMain.handle('seo-delete', async (_event, { channel, id }) => {
    const data = getSeoData();
    if (!data[channel]) return { success: true };
    data[channel] = data[channel].filter((item) => item.id !== id);
    saveSeoData(data);
    return { success: true };
  });

  // Generate SEO content
  ipcMain.handle('seo-generate', async (_event, options) => {
    const settings = getSettings();
    if (!settings.elevateLabsApiKey) {
      return { success: false, error: 'Configura a Elevate Labs API Key nas Definições.' };
    }

    const { title, channel, seriesName, format, language } = options;
    if (!title || !title.trim()) {
      return { success: false, error: 'Enter a video title.' };
    }

    try {
      const model = settings.model || 'claude-sonnet-4-5';
      const lang = language || 'English';

      const systemPrompt = `You are a YouTube SEO expert specializing in optimizing video metadata for maximum discoverability and click-through rate. You understand YouTube's algorithm, search ranking factors, and audience psychology. Always respond in ${lang} with valid JSON.`;

      const userPrompt = `I'm publishing a YouTube video with the working title: "${title}"
${seriesName ? `This video is part of the series: "${seriesName}"` : ''}
${format ? `Video format/style: ${format}` : ''}

Generate optimized YouTube SEO metadata. Return ONLY valid JSON in this exact format:
{
  "titles": [
    "title suggestion 1 (most click-worthy, under 70 chars)",
    "title suggestion 2 (curiosity-driven)",
    "title suggestion 3 (benefit-focused)",
    "title suggestion 4 (controversial/bold take)",
    "title suggestion 5 (listicle/number-based)"
  ],
  "description": "A full YouTube description with:\\n- An engaging opening hook (first 2 lines visible before 'Show more')\\n- Brief video summary paragraph\\n- Key topics covered section with bullet points\\n- Timestamps placeholder section:\\n0:00 - Introduction\\n0:00 - [Topic 1]\\n0:00 - [Topic 2]\\n0:00 - [Topic 3]\\n0:00 - Conclusion\\n- Call to action (subscribe, like, comment prompt)\\n- Social links placeholder\\n- Related videos mention\\n- 2-3 relevant hashtags at the end",
  "tags": ["tag1", "tag2", "... up to 30 relevant tags, mix of broad and specific, short-tail and long-tail keywords"]
}

Important guidelines:
- Titles should be under 70 characters, use power words, and create curiosity
- Description should be 1500-2500 characters for optimal SEO
- Tags should include a mix of: exact match keywords, broad topic tags, long-tail variations, related/trending terms, and channel-specific tags
- All content must be in ${lang}`;

      const result = await callAI(settings.elevateLabsApiKey, model, systemPrompt, userPrompt, 8192);

      const text = result.content?.[0]?.text || '';

      // Robust JSON extraction: handle markdown code blocks, trailing content, etc.
      let seoResult;
      try {
        // 1) Try extracting from ```json ... ``` markdown code blocks
        const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        if (codeBlockMatch) {
          seoResult = JSON.parse(codeBlockMatch[1].trim());
        }
      } catch (_e) { /* fall through */ }

      if (!seoResult) {
        try {
          // 2) Try regex to find the first JSON object
          const jsonObjMatch = text.match(/\{[\s\S]*\}/);
          if (jsonObjMatch) {
            seoResult = JSON.parse(jsonObjMatch[0]);
          }
        } catch (_e) { /* fall through */ }
      }

      if (!seoResult) {
        try {
          // 3) Try direct parse of the full response
          seoResult = JSON.parse(text.trim());
        } catch (_e) { /* fall through */ }
      }

      if (!seoResult) {
        return { success: false, error: 'Invalid AI response. Please try again.' };
      }

      // Validate the structure
      if (!seoResult.titles || !seoResult.description || !seoResult.tags) {
        return { success: false, error: 'Incomplete AI response. Please try again.' };
      }

      // Save to history
      const data = getSeoData();
      const ch = channel || 'pinehat';
      if (!data[ch]) data[ch] = [];
      data[ch].unshift({
        id: uuid(),
        date: new Date().toISOString(),
        originalTitle: title,
        seriesName: seriesName || null,
        format: format || null,
        language: lang,
        titles: seoResult.titles,
        description: seoResult.description,
        tags: seoResult.tags,
      });
      saveSeoData(data);

      return {
        success: true,
        titles: seoResult.titles,
        description: seoResult.description,
        tags: seoResult.tags,
      };
    } catch (err) {
      return { success: false, error: err.message || 'Error generating SEO content.' };
    }
  });
}

module.exports = { register };
