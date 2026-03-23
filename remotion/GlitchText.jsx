import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, random } from 'remotion';

export const GlitchText = ({ text, accentColor = '#a855f7' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Fade in
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

  // Glitch intensity — peaks in the middle
  const glitchIntensity = interpolate(
    frame,
    [0, durationInFrames * 0.2, durationInFrames * 0.5, durationInFrames * 0.8, durationInFrames],
    [0, 1, 0.3, 1, 0],
    { extrapolateRight: 'clamp' }
  );

  // RGB channel offsets (change every 2-3 frames for jitter)
  const seed = Math.floor(frame / 2);
  const redX = random(`red-x-${seed}`) * 20 * glitchIntensity - 10 * glitchIntensity;
  const redY = random(`red-y-${seed}`) * 10 * glitchIntensity - 5 * glitchIntensity;
  const blueX = random(`blue-x-${seed}`) * 20 * glitchIntensity - 10 * glitchIntensity;
  const blueY = random(`blue-y-${seed}`) * 10 * glitchIntensity - 5 * glitchIntensity;

  // Flicker effect
  const flicker = random(`flicker-${frame}`) > 0.85 ? 0.3 : 1;

  // Scan line position
  const scanY = interpolate(frame, [0, durationInFrames], [0, 1080], {
    extrapolateRight: 'extend',
  }) % 1080;

  // Scale pulse
  const scale = 1 + Math.sin(frame * 0.3) * 0.02 * glitchIntensity;

  // Horizontal slice displacement
  const sliceOffset = random(`slice-${seed}`) > 0.7
    ? (random(`slice-amt-${seed}`) - 0.5) * 40 * glitchIntensity
    : 0;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0a0a0f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      opacity: opacity * flicker,
      overflow: 'hidden',
    }}>
      {/* Scan lines overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0,0,0,0.1) 2px,
          rgba(0,0,0,0.1) 4px
        )`,
        pointerEvents: 'none',
        opacity: 0.5,
      }} />

      {/* Moving scan line */}
      <div style={{
        position: 'absolute',
        top: scanY,
        left: 0,
        width: '100%',
        height: 4,
        backgroundColor: `${accentColor}30`,
        filter: 'blur(2px)',
      }} />

      {/* Red channel */}
      <div style={{
        position: 'absolute',
        fontSize: 140,
        fontWeight: 900,
        color: '#ff000060',
        transform: `translate(${redX}px, ${redY}px) scale(${scale})`,
        letterSpacing: '8px',
        textTransform: 'uppercase',
      }}>
        {text}
      </div>

      {/* Blue channel */}
      <div style={{
        position: 'absolute',
        fontSize: 140,
        fontWeight: 900,
        color: '#0066ff50',
        transform: `translate(${blueX}px, ${blueY}px) scale(${scale})`,
        letterSpacing: '8px',
        textTransform: 'uppercase',
      }}>
        {text}
      </div>

      {/* Main text */}
      <div style={{
        fontSize: 140,
        fontWeight: 900,
        color: 'white',
        transform: `translateX(${sliceOffset}px) scale(${scale})`,
        letterSpacing: '8px',
        textTransform: 'uppercase',
        textShadow: `0 0 30px ${accentColor}60`,
        position: 'relative',
      }}>
        {text}
      </div>

      {/* Noise grain overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: 0.05 * glitchIntensity,
        background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
      }} />
    </div>
  );
};
