/**
 * Remotion Render Bridge
 * Renders motion graphic compositions as MP4 files
 */

const path = require('path');
const fs = require('fs');

let bundled = null;

async function ensureBundle() {
  if (bundled) return bundled;

  const { bundle } = require('@remotion/bundler');
  const entryPoint = path.resolve(__dirname, '..', 'remotion', 'index.jsx');

  console.log('[Remotion] Bundling compositions...');
  bundled = await bundle({
    entryPoint,
    onProgress: (pct) => {
      if (pct % 25 === 0) console.log(`[Remotion] Bundle progress: ${pct}%`);
    },
  });
  console.log('[Remotion] Bundle ready.');
  return bundled;
}

/**
 * Render a motion graphic to an MP4 file
 * @param {string} type - 'NumberCounter' | 'Typewriter' | 'GlitchText' | 'AnimatedChart'
 * @param {object} props - Component props
 * @param {number} durationSec - Duration in seconds
 * @param {string} outputPath - Output MP4 path
 * @param {function} onProgress - Progress callback (0-100)
 */
async function renderMotionGraphic(type, props, durationSec, outputPath, onProgress) {
  const { renderMedia, selectComposition } = require('@remotion/renderer');

  const bundleLocation = await ensureBundle();

  const FPS = 30;
  const durationInFrames = Math.round(durationSec * FPS);

  // Select the composition
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: type,
    inputProps: props,
  });

  // Override duration
  composition.durationInFrames = durationInFrames;

  console.log(`[Remotion] Rendering ${type} (${durationSec}s, ${durationInFrames} frames)...`);

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: props,
    onProgress: ({ progress }) => {
      if (onProgress) onProgress(Math.round(progress * 100));
    },
  });

  console.log(`[Remotion] Rendered: ${outputPath}`);
  return outputPath;
}

/**
 * Clear the bundle cache (call when compositions change)
 */
function clearBundleCache() {
  bundled = null;
}

module.exports = { renderMotionGraphic, clearBundleCache };
