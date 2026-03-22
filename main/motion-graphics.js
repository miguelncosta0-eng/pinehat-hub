/**
 * Motion Graphics Effects for Smart Editor
 * Generates FFmpeg filter strings for overlay effects on video segments.
 *
 * Effects:
 *   1. Number Counter — numbers counting up (dates, stats)
 *   2. Typewriter — text appearing letter by letter
 *   3. Glitch Text — distorted RGB text (mystery/suspense)
 *   4. Animated Line Chart — line drawing progressively
 */
const path = require('path');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

// ── Shared helpers ──

function escapeDrawtext(text) {
  let s = text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\\/g, '\\\\');
  s = s.replace(/'/g, '\u2019');
  s = s.replace(/:/g, '\\:');
  s = s.replace(/;/g, '\\;');
  s = s.replace(/%/g, '%%');
  s = s.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return s;
}

function getDrawtextFonts() {
  if (IS_WIN) {
    const fontsDir = 'C:\\Windows\\Fonts';
    const findFont = (candidates, fallback) => {
      for (const f of candidates) {
        if (fs.existsSync(path.join(fontsDir, f))) return `C\\:/Windows/Fonts/${f}`;
      }
      return `C\\:/Windows/Fonts/${fallback}`;
    };
    return {
      bold: findFont(['arialbd.ttf', 'segoeui.ttf'], 'arialbd.ttf'),
      regular: findFont(['arial.ttf', 'segoeui.ttf', 'tahoma.ttf'], 'arial.ttf'),
    };
  }
  const macBold = ['/Library/Fonts/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'];
  const macReg = ['/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'];
  const findMac = (candidates) => {
    for (const p of candidates) {
      if (fs.existsSync(p)) return p.replace(/:/g, '\\:');
    }
    return '/System/Library/Fonts/Helvetica.ttc';
  };
  return { bold: findMac(macBold), regular: findMac(macReg) };
}

// ═══════════════════════════════════════════════════════════
// 1. NUMBER COUNTER
// Numbers count up from 0 to target over duration
// ═══════════════════════════════════════════════════════════

function buildNumberCounter(opts) {
  const { number, label, duration = 3, startTime = 0 } = opts;
  const fonts = getDrawtextFonts();
  const steps = 20;
  const stepDur = duration / steps;
  let filter = '';

  for (let i = 0; i <= steps; i++) {
    // Ease-out: fast start, slow end
    const progress = 1 - Math.pow(1 - (i / steps), 3);
    const currentNum = Math.round(number * progress);
    const displayNum = currentNum.toLocaleString();
    const escaped = escapeDrawtext(displayNum);

    const t0 = startTime + i * stepDur;
    const t1 = i < steps ? startTime + (i + 1) * stepDur : startTime + duration;

    // Big number in center
    filter += `,drawtext=fontfile='${fonts.bold}':text='${escaped}':fontsize=96:fontcolor=white:fontcolor_expr='ffffff':x=(w-tw)/2:y=(h-th)/2-30:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
  }

  // Label below the number (static)
  if (label) {
    const escapedLabel = escapeDrawtext(label);
    filter += `,drawtext=fontfile='${fonts.regular}':text='${escapedLabel}':fontsize=28:fontcolor=white@0.7:x=(w-tw)/2:y=(h/2)+50:enable='between(t,${startTime.toFixed(3)},${(startTime + duration).toFixed(3)})'`;
  }

  // Semi-transparent background
  filter = `,drawbox=x=0:y=ih/2-80:w=iw:h=160:color=black@0.6:t=fill:enable='between(t,${startTime.toFixed(3)},${(startTime + duration).toFixed(3)})'` + filter;

  return filter;
}

// ═══════════════════════════════════════════════════════════
// 2. TYPEWRITER
// Text appears letter by letter with blinking cursor
// ═══════════════════════════════════════════════════════════

function buildTypewriter(opts) {
  const { text, duration = 4, startTime = 0, fontSize = 36, position = 'center' } = opts;
  const fonts = getDrawtextFonts();
  const chars = text.split('');
  const charDur = Math.min(duration * 0.8 / chars.length, 0.08); // Max 80ms per char
  const holdTime = duration - (chars.length * charDur); // Time to hold complete text
  let filter = '';

  // Semi-transparent background bar
  const yPos = position === 'bottom' ? 'ih-120' : position === 'top' ? '20' : 'ih/2-40';
  const yText = position === 'bottom' ? 'ih-100' : position === 'top' ? '40' : 'ih/2-20';

  filter += `,drawbox=x=0:y=${yPos}:w=iw:h=80:color=black@0.7:t=fill:enable='between(t,${startTime.toFixed(3)},${(startTime + duration).toFixed(3)})'`;

  // Each step reveals one more character
  for (let i = 1; i <= chars.length; i++) {
    const partialText = escapeDrawtext(text.slice(0, i));
    const t0 = startTime + (i - 1) * charDur;
    const t1 = i < chars.length ? startTime + i * charDur : startTime + duration;

    // Text with cursor
    const cursorChar = i < chars.length ? '|' : '';
    filter += `,drawtext=fontfile='${fonts.regular}':text='${partialText}${cursorChar}':fontsize=${fontSize}:fontcolor=white:x=(w-tw)/2:y=${yText}:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
  }

  // Blinking cursor at end (after text complete)
  const completeTime = startTime + chars.length * charDur;
  if (holdTime > 0.5) {
    const escapedFull = escapeDrawtext(text);
    // Cursor blinks every 0.5s
    for (let blink = 0; blink < Math.floor(holdTime / 0.5); blink++) {
      const bt0 = completeTime + blink * 0.5;
      const bt1 = bt0 + 0.25;
      if (blink % 2 === 0) {
        filter += `,drawtext=fontfile='${fonts.regular}':text='${escapedFull}|':fontsize=${fontSize}:fontcolor=white:x=(w-tw)/2:y=${yText}:enable='between(t,${bt0.toFixed(3)},${bt1.toFixed(3)})'`;
      }
    }
  }

  return filter;
}

// ═══════════════════════════════════════════════════════════
// 3. GLITCH TEXT
// RGB split text with random flicker for mystery/suspense
// ═══════════════════════════════════════════════════════════

function buildGlitchText(opts) {
  const { text, duration = 3, startTime = 0, fontSize = 48, intensity = 'medium' } = opts;
  const fonts = getDrawtextFonts();
  const escaped = escapeDrawtext(text.toUpperCase());
  let filter = '';

  const offsets = intensity === 'high' ? { r: 6, g: -4, b: 3 }
    : intensity === 'low' ? { r: 2, g: -1, b: 1 }
    : { r: 4, g: -3, b: 2 }; // medium

  // Semi-transparent dark background
  filter += `,drawbox=x=0:y=ih/2-60:w=iw:h=120:color=black@0.5:t=fill:enable='between(t,${startTime.toFixed(3)},${(startTime + duration).toFixed(3)})'`;

  // Create glitch flicker phases (8 phases)
  const phaseDur = duration / 8;

  for (let phase = 0; phase < 8; phase++) {
    const t0 = startTime + phase * phaseDur;
    const t1 = t0 + phaseDur;

    // Vary offsets per phase for animation effect
    const phaseMultiplier = phase % 3 === 0 ? 2.0 : phase % 3 === 1 ? 0.5 : 1.0;
    const rOff = Math.round(offsets.r * phaseMultiplier);
    const gOff = Math.round(offsets.g * phaseMultiplier);
    const bOff = Math.round(offsets.b * phaseMultiplier);

    // Red channel (offset left/up)
    filter += `,drawtext=fontfile='${fonts.bold}':text='${escaped}':fontsize=${fontSize}:fontcolor=red@0.5:x=(w-tw)/2+${rOff}:y=(h-th)/2+${-rOff}:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;

    // Green channel (offset right/down) — skip on some phases for flicker
    if (phase % 4 !== 2) {
      filter += `,drawtext=fontfile='${fonts.bold}':text='${escaped}':fontsize=${fontSize}:fontcolor=green@0.4:x=(w-tw)/2+${gOff}:y=(h-th)/2+${-gOff}:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
    }

    // Blue channel (offset differently)
    filter += `,drawtext=fontfile='${fonts.bold}':text='${escaped}':fontsize=${fontSize}:fontcolor=blue@0.4:x=(w-tw)/2+${bOff}:y=(h-th)/2+${bOff}:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;

    // Main white text on top
    filter += `,drawtext=fontfile='${fonts.bold}':text='${escaped}':fontsize=${fontSize}:fontcolor=white@0.9:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
  }

  // Add scan line effect with thin horizontal lines
  for (let line = 0; line < 3; line++) {
    const lineY = `ih/2-40+${line * 30}`;
    const t0 = startTime + line * 0.3;
    const t1 = Math.min(t0 + 0.15, startTime + duration);
    filter += `,drawbox=x=0:y=${lineY}:w=iw:h=2:color=white@0.3:t=fill:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
  }

  return filter;
}

// ═══════════════════════════════════════════════════════════
// 4. ANIMATED LINE CHART (simplified — drawbox based)
// Draws a bar/line chart progressively
// ═══════════════════════════════════════════════════════════

function buildAnimatedChart(opts) {
  const { values, labels, title, duration = 4, startTime = 0 } = opts;
  const fonts = getDrawtextFonts();
  if (!values || values.length === 0) return '';

  let filter = '';
  const maxVal = Math.max(...values);
  const barCount = values.length;
  const chartW = 800;
  const chartH = 300;
  const chartX = '(iw-800)/2';
  const chartY = '(ih-300)/2';
  const barW = Math.floor(chartW / barCount) - 10;
  const animDur = duration * 0.7; // 70% for animation, 30% hold

  // Dark background for chart
  filter += `,drawbox=x=${chartX}:y=${chartY}:w=${chartW}:h=${chartH}:color=black@0.7:t=fill:enable='between(t,${startTime.toFixed(3)},${(startTime + duration).toFixed(3)})'`;

  // Title
  if (title) {
    const escapedTitle = escapeDrawtext(title);
    filter += `,drawtext=fontfile='${fonts.bold}':text='${escapedTitle}':fontsize=24:fontcolor=white:x=(w-tw)/2:y=${chartY}-30:enable='between(t,${startTime.toFixed(3)},${(startTime + duration).toFixed(3)})'`;
  }

  // Animate each bar growing up
  const steps = 10;
  const stepDur = animDur / steps;

  for (let step = 0; step <= steps; step++) {
    const progress = 1 - Math.pow(1 - (step / steps), 2); // ease-out
    const t0 = startTime + step * stepDur;
    const t1 = step < steps ? t0 + stepDur : startTime + duration;

    for (let i = 0; i < barCount; i++) {
      const barH = Math.round((values[i] / maxVal) * (chartH - 40) * progress);
      if (barH < 2) continue;

      const bx = `${chartX}+${10 + i * (barW + 10)}`;
      const by = `${chartY}+${chartH - barH - 10}`;

      // Alternate colors: purple, blue, teal
      const colors = ['0x8B5CF6@0.8', '0x3B82F6@0.8', '0x14B8A6@0.8'];
      const color = colors[i % 3];

      filter += `,drawbox=x=${bx}:y=${by}:w=${barW}:h=${barH}:color=${color}:t=fill:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
    }
  }

  // Labels below bars (static, after animation)
  if (labels) {
    for (let i = 0; i < Math.min(labels.length, barCount); i++) {
      const escapedLabel = escapeDrawtext(labels[i]);
      const lx = `${chartX}+${10 + i * (barW + 10) + barW / 2}`;
      const ly = `${chartY}+${chartH}+5`;
      filter += `,drawtext=fontfile='${fonts.regular}':text='${escapedLabel}':fontsize=14:fontcolor=white@0.7:x=${lx}-(tw/2):y=${ly}:enable='between(t,${(startTime + animDur * 0.5).toFixed(3)},${(startTime + duration).toFixed(3)})'`;
    }
  }

  return filter;
}

// ═══════════════════════════════════════════════════════════
// DETECTION — auto-detect which effect to use based on text
// ═══════════════════════════════════════════════════════════

function detectEffect(voText) {
  const low = voText.toLowerCase();

  // Number counter: dates, years, percentages, statistics
  const numberMatch = voText.match(/\b(\d{4})\b/) || voText.match(/(\d+(?:\.\d+)?)\s*(%|percent|million|billion|thousand)/i);
  if (numberMatch) {
    const num = parseFloat(numberMatch[1]);
    const label = numberMatch[2] || '';
    return { type: 'counter', number: num, label };
  }

  // Glitch: mystery, suspense, dark, secret, hidden, cipher, demon
  if (/secret|hidden|mystery|cipher|demon|dark|shadow|evil|strange|supernatural|paranormal|conspiracy|danger|trap|curse|haunted/i.test(low)) {
    // Extract a key phrase (max 4 words) for the glitch text
    const words = voText.split(/\s+/).slice(0, 4).join(' ');
    return { type: 'glitch', text: words };
  }

  // Typewriter: quotes (text between quotes), or long descriptive phrases
  const quoteMatch = voText.match(/"([^"]+)"/);
  if (quoteMatch) {
    return { type: 'typewriter', text: quoteMatch[1] };
  }

  return null; // No effect for this segment
}

module.exports = {
  buildNumberCounter,
  buildTypewriter,
  buildGlitchText,
  buildAnimatedChart,
  detectEffect,
  escapeDrawtext,
  getDrawtextFonts,
};
