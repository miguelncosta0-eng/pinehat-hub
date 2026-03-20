/**
 * Elevate Labs API helper
 * Chat API (OpenAI-compatible): https://chat-api.elevate.uno/v1
 * TTS API: https://public-api.elevate.uno/v2/media
 */

const CHAT_BASE = 'https://chat-api.elevate.uno/v1';
const MEDIA_BASE = 'https://public-api.elevate.uno/v2';

/**
 * Call the Elevate Labs Chat API (OpenAI-compatible)
 */
async function callAI(apiKey, model, systemPrompt, userPrompt, maxTokens = 4096) {
  const response = await fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Elevate API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  // Return in a compatible format so existing code works with minimal changes
  return { content: [{ text }] };
}

/**
 * Generate TTS audio via Elevate Labs Media API
 * Returns { success, id, resultUrl } or polls until complete
 */
async function generateTTS(apiKey, text, voiceId, opts = {}) {
  const body = {
    type: 'tts',
    prompt: text,
    voice_id: voiceId,
  };
  if (opts.model) body.model_id = opts.model;
  if (opts.stability !== undefined) body.stability = opts.stability;
  if (opts.similarity_boost !== undefined) body.similarity_boost = opts.similarity_boost;
  if (opts.style !== undefined) body.style = opts.style;
  if (opts.speed !== undefined) body.speed = opts.speed;
  if (opts.speaker_boost !== undefined) body.speaker_boost = opts.speaker_boost;
  if (opts.autoPauseEnabled !== undefined) body.auto_pause_enabled = opts.autoPauseEnabled;
  if (opts.autoPauseDuration !== undefined) body.auto_pause_duration = opts.autoPauseDuration;
  if (opts.autoPauseFrequency !== undefined) body.auto_pause_frequency = opts.autoPauseFrequency;

  const response = await fetch(`${MEDIA_BASE}/media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Elevate TTS error ${response.status}: ${err}`);
  }

  const data = await response.json();
  if (!data.success) {
    const errDetail = typeof data.error === 'string' ? data.error : (data.error?.message || JSON.stringify(data.error));
    throw new Error(errDetail || 'TTS request failed');
  }

  const taskId = data.data?.id;
  if (!taskId) throw new Error('No task ID returned');

  // If already completed
  if (data.data.status === 'completed' && data.data.result_url) {
    return { success: true, id: taskId, resultUrl: data.data.result_url };
  }

  // Poll for completion
  return pollTTSStatus(apiKey, taskId);
}

/**
 * Poll TTS task status until complete
 */
async function pollTTSStatus(apiKey, taskId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const response = await fetch(`${MEDIA_BASE}/media/${taskId}?type=tts`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) continue;

    const data = await response.json();
    if (data.data?.status === 'completed' && data.data?.result_url) {
      return { success: true, id: taskId, resultUrl: data.data.result_url };
    }
    if (data.data?.status === 'failed') {
      throw new Error('TTS generation failed');
    }
  }
  throw new Error('TTS timeout — demorou demasiado.');
}

module.exports = { callAI, generateTTS, CHAT_BASE, MEDIA_BASE };
