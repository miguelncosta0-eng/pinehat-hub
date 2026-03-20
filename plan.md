# Plano: Migrar para Elevate Labs API + TTS no Voiceover + Remover Niche Finder

## 1. Remover Niche Finder
- **`renderer/app.js`**: Remover item "Niche Finder" do sidebar
- **`renderer/niche.js`**: Remover referências (o ficheiro pode ficar, mas não é carregado)
- **`main/ipc-niche.js`**: Remover require/register do `main.js`
- **`index.html`**: Remover `<script src="renderer/niche.js">`

## 2. Migrar de Anthropic API → Elevate Labs Chat API

Substituir todas as chamadas `fetch('https://api.anthropic.com/v1/messages')` por chamadas OpenAI-compatible para `https://chat-api.elevate.uno/v1/chat/completions`.

### Criar helper partilhado: `main/elevate-api.js`
```js
async function callAI(apiKey, model, systemPrompt, userPrompt, maxTokens = 4096) {
  const response = await fetch('https://chat-api.elevate.uno/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
    }),
  });
  const data = await response.json();
  // Formato OpenAI: data.choices[0].message.content
  return { content: [{ text: data.choices?.[0]?.message?.content || '' }] };
}
```

### Ficheiros a atualizar:
- **`main/ipc-ideation.js`**: Substituir `callClaude` + `anthropicApiKey` → `callAI` + `elevateLabsApiKey`
- **`main/ipc-scripts.js`**: Substituir chamadas Anthropic → Elevate Labs
- **`main/ipc-editor.js`**: Substituir overlay detection calls → Elevate Labs
- **`main/ipc-seo.js`**: Substituir chamadas Anthropic → Elevate Labs
- **`main/ipc-series.js`**: Substituir chamadas Anthropic → Elevate Labs

### Settings:
- **`main/ipc-settings.js`**: Renomear `anthropicApiKey` → `elevateLabsApiKey` em DEFAULT_SETTINGS
- **`renderer/settings.js`**: Mudar label "Anthropic API Key" → "Elevate Labs API Key"
- Mudar seletor de modelo para: `claude-sonnet-4-5`, `gemini-3-pro`, `gpt-5`, `deepseek-v3.1`

## 3. Adicionar TTS na secção Voiceover

### API Elevate Labs TTS:
- `POST https://public-api.elevate.uno/v2/media`
- Body: `{ type: "tts", prompt: "texto", voice_id: "xxx" }`
- Auth: `Bearer API_KEY`
- Response: `{ success, data: { id, status, result_url } }`
- Poll: `GET /v2/media/{id}?type=tts`

### Main Process: `main/ipc-editor.js` (ou novo handler)
- Novo IPC: `voiceover-generate-tts`
- Recebe texto + voice_id
- Chama Elevate Labs TTS API
- Faz polling até `status === 'completed'`
- Faz download do audio (result_url) para pasta local
- Retorna path do ficheiro

### Renderer: `renderer/voiceover.js`
Adicionar card "Generate Voiceover" (antes do import audio):
- Textarea para texto (com contador de caracteres)
- Campo Voice ID
- Botão "Generate Audio"
- Barra de progresso
- Player de audio com resultado + botão download

### Settings:
- Novo campo: `ttsVoiceId` (Elevate Labs voice ID)

## 4. Ordem de implementação
1. Criar `main/elevate-api.js` (helper partilhado)
2. Migrar ipc-ideation.js
3. Migrar ipc-scripts.js
4. Migrar ipc-editor.js (overlay detection)
5. Migrar ipc-seo.js
6. Migrar ipc-series.js
7. Atualizar settings (UI + backend)
8. Adicionar TTS ao voiceover
9. Remover Niche Finder
10. Testar tudo
