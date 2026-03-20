// Channels are now stored in settings.json — loaded dynamically
function getChannels() {
  const { getChannels: gc } = require('./ipc-settings');
  return gc();
}

// ── Tone presets ──

const TONE_PRESETS = {
  calm: `TONE & STYLE:
- Write in a calm, soothing, documentary-style narration voice
- The viewer is meant to fall asleep to this — avoid sudden shifts, loud exclamations, or jarring transitions
- Use long, flowing sentences with a gentle rhythm
- Maintain a warm, contemplative tone throughout — like a bedtime story for adults
- Avoid rhetorical questions or "call to action" language
- No "but first, let me tell you..." or clickbait phrasing
- Transitions between topics should be seamless and gradual
- Write as continuous narration — no timestamps, no section headers in the voiceover`,
  analytical: `TONE & STYLE:
- Analytical but accessible — like a smart friend explaining psychology
- Reference specific episodes and scenes to support your points
- Use psychological concepts but explain them in plain language
- Balance depth with engagement — insightful but never dry or academic
- Include occasional humor where appropriate
- Build arguments progressively — each point leading to the next`,
  energetic: `TONE & STYLE:
- Energetic, enthusiastic narration — the viewer should feel your excitement
- Use dynamic pacing — short punchy sentences mixed with longer explanations
- Include exclamations and emphasis where natural
- Build hype and anticipation for reveals
- Keep the energy high but still informative`,
  storytelling: `TONE & STYLE:
- Narrative-driven — tell a story, don't just list facts
- Create a journey for the viewer with a beginning, rising action, climax
- Use vivid descriptions and scene-setting language
- Build suspense and curiosity throughout
- Connect events causally — each part flowing naturally into the next
- Use occasional first-person perspective for engagement`,
  documentary: `TONE & STYLE:
- Serious, authoritative documentary tone
- Present information factually and objectively
- Use formal but accessible language
- Include historical context and background when relevant
- Maintain gravitas without being boring
- Structure arguments logically with clear evidence`,
  humorous: `TONE & STYLE:
- Witty, sarcastic narration with sharp observations
- Use irony and understatement for comedy
- Include running jokes and callbacks
- Balance humor with genuine insight — funny but still informative
- Don't force jokes — let the comedy come from the material
- Self-aware meta-commentary is welcome`,
};

// ── Prompt builders ──

function getChannelIdentity(channelId) {
  const ch = getChannels()[channelId];
  if (!ch) return `You are a professional scriptwriter. You write in English.`;
  return `You are a professional scriptwriter for the YouTube channel "${ch.name}". The channel focuses on ${ch.shows} content. You write in English.`;
}

function getToneGuide(channelId, formatId, toneOverride) {
  // If user selected a specific tone, use it
  if (toneOverride && toneOverride !== 'default' && TONE_PRESETS[toneOverride]) {
    return TONE_PRESETS[toneOverride];
  }

  // Default tones per format
  if (formatId === 'fall-asleep-to') return TONE_PRESETS.calm;
  if (formatId === 'deep-analysis' || formatId === 'character-analysis') return TONE_PRESETS.analytical;
  if (formatId === 'lore-breakdown' || formatId === 'lore-theories' || formatId === 'episode-breakdown') {
    return `TONE & STYLE:
- Enthusiastic but informed — like a knowledgeable fan sharing discoveries
- Reference specific episodes, scenes, and details
- Connect dots between different parts of the show
- Build theories logically with evidence
- Maintain a sense of wonder and discovery`;
  }
  if (formatId === 'youtube-short') {
    return `TONE & STYLE:
- all lowercase, no punctuation except commas
- direct, punchy, factual
- style like FactsVerse or similar short-form channels
- hook the viewer in the first 3 words
- max 100-200 words total
- one continuous paragraph, no chapters`;
  }
  return '';
}

function getFormatInstructions(channelId, formatId, customTargetWords) {
  const ch = getChannels()[channelId];
  if (!ch) return '';
  const fmt = ch.formats.find((f) => f.id === formatId);
  if (!fmt) return '';

  if (formatId === 'youtube-short') {
    return `Write a YouTube Short script (100-200 words) about the topic. Output as a single block of text, all lowercase, no punctuation marks except commas. This will be used for a vertical short-form video (~60 seconds).`;
  }

  const targetWords = customTargetWords || fmt.targetWords;
  const chapters = Math.max(1, Math.round((targetWords / fmt.targetWords) * fmt.chapters));

  return `Write a long-form narration script of approximately ${targetWords.toLocaleString()} words, divided into ${chapters} chapters.

STRUCTURE:
- ${chapters} chapters, each with a descriptive title
- Use "## Chapter Title" as the header for each chapter
- Write continuous prose narration under each chapter
- Separate chapters with a line containing only "---"
- Each chapter should be roughly ${Math.round(targetWords / chapters).toLocaleString()} words

OUTPUT FORMAT:
Write in plain prose ONLY. Use "## Chapter Title" for chapter headers and "---" between chapters.
Do NOT use JSON, code blocks, bullet points, or any structured/programmatic format.
Just write the narration text directly as continuous flowing prose.
Start writing immediately — no preamble, no explanation.`;
}

function buildPrompt(channelId, formatId, options) {
  const { title, extraNotes, tone, focus, episodes, continuationContext, chapterRange } = options;
  const parts = [];

  parts.push(getChannelIdentity(channelId));
  parts.push(getToneGuide(channelId, formatId, tone));
  parts.push(getFormatInstructions(channelId, formatId, options.targetWords));

  parts.push(`\nTOPIC / TITLE: "${title}"`);

  if (focus) {
    parts.push(`\nFOCUS: The script should specifically focus on: ${focus}`);
  }

  if (episodes) {
    parts.push(`\nEPISODES TO REFERENCE: Include or focus on these episodes/seasons: ${episodes}`);
  }

  if (extraNotes) {
    parts.push(`\nADDITIONAL NOTES FROM THE CREATOR:\n${extraNotes}`);
  }

  if (chapterRange) {
    parts.push(`\nWrite chapters ${chapterRange.start} through ${chapterRange.end} only.`);
  }

  if (continuationContext) {
    parts.push(`\nCONTINUATION: You already wrote ${continuationContext.chaptersWritten} chapters (${continuationContext.wordsWritten} words so far). Continue from chapter ${continuationContext.chaptersWritten + 1}. The previous text ended with: "${continuationContext.lastText}"\n\nContinue seamlessly in the same style and format (## headers, --- separators, plain prose). Write ONLY the new chapters. Do NOT repeat previous chapters.`);
  }

  return parts.join('\n\n');
}

function getSystemPrompt(channelId) {
  const ch = getChannels()[channelId];
  if (!ch) return `You are a professional YouTube scriptwriter. You write scripts in English that are engaging, well-researched, and perfectly suited for narration. You always write in plain prose — never JSON, never code blocks, never structured data formats.`;
  return `You are a professional YouTube scriptwriter for "${ch.name}", a channel about ${ch.shows}. You write scripts in English that are engaging, well-researched, and perfectly suited for narration. You always write in plain prose — never JSON, never code blocks, never structured data formats.`;
}

module.exports = { getChannels, buildPrompt, getSystemPrompt };
