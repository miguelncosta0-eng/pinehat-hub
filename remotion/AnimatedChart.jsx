import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const AnimatedChart = ({ values, labels, title, accentColor = '#a855f7' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const maxValue = Math.max(...values);
  const barCount = values.length;

  // Overall fade in
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  // Title animation
  const titleY = interpolate(frame, [0, 15], [30, 0], { extrapolateRight: 'clamp' });

  const colors = [
    accentColor,
    '#3b82f6', // blue
    '#06b6d4', // cyan
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
  ];

  const chartWidth = 1200;
  const chartHeight = 500;
  const barWidth = Math.min(120, (chartWidth - (barCount + 1) * 20) / barCount);
  const gap = (chartWidth - barCount * barWidth) / (barCount + 1);

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
      {/* Title */}
      {title && (
        <div style={{
          fontSize: 42,
          fontWeight: 700,
          color: 'white',
          marginBottom: 50,
          transform: `translateY(${titleY}px)`,
          letterSpacing: '1px',
        }}>
          {title}
        </div>
      )}

      {/* Chart container */}
      <div style={{
        width: chartWidth,
        height: chartHeight,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: gap,
        paddingBottom: 60,
      }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((pct, i) => (
          <div key={i} style={{
            position: 'absolute',
            bottom: 60 + (chartHeight - 60) * pct,
            left: 0,
            width: '100%',
            height: 1,
            backgroundColor: '#ffffff10',
          }} />
        ))}

        {/* Bars */}
        {values.map((value, i) => {
          const delay = i * 5;
          const barProgress = interpolate(
            frame,
            [10 + delay, durationInFrames * 0.6 + delay],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
          );

          const barHeight = ((value / maxValue) * (chartHeight - 80)) * barProgress;
          const color = colors[i % colors.length];

          // Value label fade in
          const valueFade = interpolate(
            frame,
            [durationInFrames * 0.5 + delay, durationInFrames * 0.65 + delay],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );

          return (
            <div key={i} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
            }}>
              {/* Value on top */}
              <div style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'white',
                marginBottom: 8,
                opacity: valueFade,
              }}>
                {Math.round(value * barProgress).toLocaleString()}
              </div>

              {/* Bar */}
              <div style={{
                width: barWidth,
                height: barHeight,
                borderRadius: '6px 6px 0 0',
                background: `linear-gradient(180deg, ${color}, ${color}90)`,
                boxShadow: `0 0 20px ${color}40`,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Shine effect */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '50%',
                  height: '100%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
                }} />
              </div>

              {/* Label */}
              <div style={{
                fontSize: 18,
                fontWeight: 500,
                color: '#ffffff70',
                marginTop: 12,
                textAlign: 'center',
              }}>
                {labels?.[i] || `${i + 1}`}
              </div>
            </div>
          );
        })}

        {/* Bottom axis line */}
        <div style={{
          position: 'absolute',
          bottom: 58,
          left: 0,
          width: '100%',
          height: 2,
          backgroundColor: '#ffffff20',
        }} />
      </div>
    </div>
  );
};
