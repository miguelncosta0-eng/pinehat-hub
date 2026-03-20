const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { SCRIPTS_DIR, readJson, writeJson, uuid, ensureDataDir } = require('./ipc-data');
const { getChannels, buildPrompt, getSystemPrompt } = require('./prompt-templates');
const { getSettings } = require('./ipc-settings');
const { callAI, CHAT_BASE } = require('./elevate-api');

let currentAbort = null;

function getAllScripts() {
  ensureDataDir();
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  const files = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => {
      const data = readJson(path.join(SCRIPTS_DIR, f));
      if (!data) return null;
      // Return metadata only (not full content) for list view
      return {
        id: data.id,
        title: data.title,
        channel: data.channel,
        format: data.format,
        state: data.state,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        wordCount: data.wordCount || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function register() {
  ipcMain.handle('get-scripts', (_event, filters) => {
    let scripts = getAllScripts();
    if (filters && filters.channel) {
      scripts = scripts.filter((s) => s.channel === filters.channel);
    }
    return scripts;
  });

  ipcMain.handle('get-script', (_event, id) => {
    const data = readJson(path.join(SCRIPTS_DIR, `${id}.json`));
    return data || null;
  });

  ipcMain.handle('create-script', (_event, data) => {
    const script = {
      id: uuid(),
      title: data.title || 'Sem título',
      channel: data.channel || 'pinehat',
      format: data.format || null,
      state: 'rascunho',
      content: data.content || '',
      wordCount: countWords(data.content || ''),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generationMeta: null,
    };
    writeJson(path.join(SCRIPTS_DIR, `${script.id}.json`), script);
    return script;
  });

  ipcMain.handle('update-script', (_event, id, updates) => {
    const filePath = path.join(SCRIPTS_DIR, `${id}.json`);
    const script = readJson(filePath);
    if (!script) return { success: false, error: 'Script não encontrado.' };
    const updated = { ...script, ...updates, updatedAt: new Date().toISOString() };
    if (updates.content !== undefined) {
      updated.wordCount = countWords(updates.content);
    }
    writeJson(filePath, updated);
    return { success: true, script: updated };
  });

  ipcMain.handle('delete-script', (_event, id) => {
    const filePath = path.join(SCRIPTS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  });

  // ── Claude API: Generate script ──

  ipcMain.handle('generate-script', async (event, options) => {
    const settings = getSettings();
    if (!settings.elevateLabsApiKey) {
      return { success: false, error: 'Chave API da Elevate Labs não configurada. Vai a Definições.' };
    }

    const { title, channel, format, extraNotes, tone, focus, episodes, targetWords: customTargetWords } = options;
    const channelConfig = getChannels()[channel];
    if (!channelConfig) return { success: false, error: 'Canal inválido.' };

    const formatConfig = channelConfig.formats.find((f) => f.id === format);
    if (!formatConfig) return { success: false, error: 'Formato inválido.' };

    const model = settings.model || 'claude-sonnet-4-5';
    const targetWords = customTargetWords || formatConfig.targetWords;
    const totalChapters = Math.max(1, Math.round((targetWords / formatConfig.targetWords) * formatConfig.chapters));

    // For YouTube Shorts, single call
    if (format === 'youtube-short') {
      return await generateSingleCall(event, { title, channel, format, extraNotes, tone, focus, episodes, model, settings });
    }

    // Multi-call for long scripts
    const wordsPerCall = 6000;
    const totalCalls = Math.max(1, Math.ceil(targetWords / wordsPerCall));
    const chaptersPerCall = Math.ceil(totalChapters / totalCalls);

    let allText = '';
    let continuationContext = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const startTime = Date.now();

    currentAbort = new AbortController();

    // Initial 0% progress
    event.sender.send('script-generation-progress', {
      phase: 'generating',
      callNumber: 0,
      totalCalls,
      chaptersCompleted: 0,
      totalChapters,
      wordsGenerated: 0,
      targetWords,
    });

    try {
      for (let callNum = 0; callNum < totalCalls; callNum++) {
        if (currentAbort.signal.aborted) {
          return { success: false, error: 'Geração cancelada.' };
        }

        const chapterStart = callNum * chaptersPerCall + 1;
        const chapterEnd = Math.min((callNum + 1) * chaptersPerCall, totalChapters);

        const prompt = buildPrompt(channel, format, {
          title,
          extraNotes,
          tone,
          focus,
          episodes,
          targetWords,
          continuationContext,
          chapterRange: { start: chapterStart, end: chapterEnd },
        });

        // Streaming: send live text to renderer (throttled to every 150ms)
        let lastLiveTime = 0;
        const onDelta = (_delta, fullText) => {
          const now = Date.now();
          if (now - lastLiveTime > 150) {
            lastLiveTime = now;
            event.sender.send('script-generation-live', {
              text: fullText.slice(-600),
              totalLength: fullText.length,
              callNumber: callNum + 1,
              totalCalls,
            });
          }
        };

        const result = await callStreamingAI(
          settings.elevateLabsApiKey,
          model,
          getSystemPrompt(channel),
          prompt,
          8192,
          currentAbort.signal,
          onDelta,
        );

        // Send final state of this call's text
        event.sender.send('script-generation-live', { text: '', done: true });

        totalInputTokens += result.usage?.input_tokens || 0;
        totalOutputTokens += result.usage?.output_tokens || 0;

        const text = result.content[0].text.trim();

        // Append text (plain prose, no JSON parsing needed)
        if (allText && text) {
          allText += '\n\n---\n\n';
        }
        allText += text;

        // Send progress AFTER call completes
        const wordsNow = countWords(allText);
        const chaptersWritten = (allText.match(/^## /gm) || []).length;
        event.sender.send('script-generation-progress', {
          phase: 'generating',
          callNumber: callNum + 1,
          totalCalls,
          chaptersCompleted: chaptersWritten,
          totalChapters,
          wordsGenerated: wordsNow,
          targetWords,
        });

        // Build continuation context
        continuationContext = {
          chaptersWritten,
          lastText: allText.slice(-200),
          wordsWritten: wordsNow,
        };
      }

      // Save final script
      const scriptId = await saveGeneratedScript({
        title, channel, format, content: allText, model,
        totalCalls, totalInputTokens, totalOutputTokens, startTime,
      });

      event.sender.send('script-generation-progress', { phase: 'done' });

      return { success: true, scriptId };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, error: 'Geração cancelada.' };
      }
      // Save partial if we have text
      if (allText.length > 0) {
        const scriptId = await saveGeneratedScript({
          title, channel, format, content: allText, model,
          totalCalls: 0, totalInputTokens, totalOutputTokens, startTime,
        });
        return { success: false, error: `Erro: ${err.message}. Script parcial guardado.`, scriptId };
      }
      return { success: false, error: err.message };
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('cancel-script-generation', () => {
    if (currentAbort) { currentAbort.abort(); return true; }
    return false;
  });
}

// ── Single call generation (for Shorts) ──

async function generateSingleCall(event, { title, channel, format, extraNotes, tone, focus, episodes, model, settings }) {
  event.sender.send('script-generation-progress', {
    phase: 'generating', callNumber: 1, totalCalls: 1,
    chaptersCompleted: 0, totalChapters: 1, wordsGenerated: 0, targetWords: 200,
  });

  const prompt = buildPrompt(channel, format, { title, extraNotes, tone, focus, episodes });
  const result = await callAI(settings.elevateLabsApiKey, model, getSystemPrompt(channel), prompt, 2048);

  const content = result.content[0].text;
  const script = {
    id: uuid(),
    title,
    channel,
    format,
    state: 'rascunho',
    content,
    wordCount: countWords(content),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generationMeta: {
      model,
      callCount: 1,
      totalInputTokens: result.usage?.input_tokens || 0,
      totalOutputTokens: result.usage?.output_tokens || 0,
    },
  };
  writeJson(path.join(SCRIPTS_DIR, `${script.id}.json`), script);

  event.sender.send('script-generation-progress', { phase: 'done' });
  return { success: true, scriptId: script.id, chaptersCount: 0 };
}

// ── Save generated script (plain text) ──

async function saveGeneratedScript({ title, channel, format, content, model, totalCalls, totalInputTokens, totalOutputTokens, startTime }) {
  const script = {
    id: uuid(),
    title,
    channel,
    format,
    state: 'rascunho',
    content,
    wordCount: countWords(content),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generationMeta: {
      model,
      callCount: totalCalls,
      totalInputTokens,
      totalOutputTokens,
      durationMs: Date.now() - startTime,
    },
  };
  writeJson(path.join(SCRIPTS_DIR, `${script.id}.json`), script);
  return script.id;
}

// ── Elevate Labs streaming call (OpenAI-compatible SSE) ──

async function callStreamingAI(apiKey, model, systemPrompt, userPrompt, maxTokens, signal, onDelta) {
  const response = await fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 300)}`);
  }

  let fullText = '';
  const usage = { input_tokens: 0, output_tokens: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;

      try {
        const evt = JSON.parse(raw);
        // OpenAI format: choices[0].delta.content
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          if (onDelta) onDelta(delta, fullText);
        }
        if (evt.usage) {
          usage.input_tokens = evt.usage.prompt_tokens || 0;
          usage.output_tokens = evt.usage.completion_tokens || 0;
        }
      } catch (_) { /* skip malformed lines */ }
    }
  }

  return { content: [{ text: fullText }], usage };
}

module.exports = { register };
