import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const NumberCounter = ({ number, label, accentColor = '#a855f7' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Count up with ease-out (fast start, slow finish)
  const progress = interpolate(frame, [0, durationInFrames * 0.75], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const currentNumber = Math.round(number * progress);
  const displayNumber = currentNumber.toLocaleString();

  // Fade in
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  // Scale bounce
  const scale = interpolate(frame, [0, 8, 15], [0.5, 1.1, 1], { extrapolateRight: 'clamp' });

  // Glow pulse at the end
  const glowOpacity = interpolate(
    frame,
    [durationInFrames * 0.7, durationInFrames * 0.85, durationInFrames],
    [0, 0.6, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0a0a0f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      opacity,
    }}>
      {/* Glow effect */}
      <div style={{
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${accentColor}40, transparent 70%)`,
        opacity: glowOpacity,
        filter: 'blur(40px)',
      }} />

      {/* Number */}
      <div style={{
        fontSize: 180,
        fontWeight: 900,
        color: 'white',
        transform: `scale(${scale})`,
        textShadow: `0 0 60px ${accentColor}80, 0 0 120px ${accentColor}40`,
        letterSpacing: '-4px',
        lineHeight: 1,
      }}>
        {displayNumber}
      </div>

      {/* Label */}
      {label && (
        <div style={{
          fontSize: 36,
          fontWeight: 500,
          color: '#ffffff90',
          marginTop: 20,
          letterSpacing: '4px',
          textTransform: 'uppercase',
        }}>
          {label}
        </div>
      )}

      {/* Decorative line */}
      <div style={{
        width: interpolate(frame, [5, 20], [0, 200], { extrapolateRight: 'clamp' }),
        height: 3,
        backgroundColor: accentColor,
        marginTop: 30,
        borderRadius: 2,
        boxShadow: `0 0 20px ${accentColor}`,
      }} />
    </div>
  );
};
