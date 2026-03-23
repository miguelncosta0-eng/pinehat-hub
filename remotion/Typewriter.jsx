import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export const TypewriterEffect = ({ text, accentColor = '#a855f7' }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Characters appear over 70% of the duration
  const typingEnd = durationInFrames * 0.7;
  const charsToShow = Math.floor(
    interpolate(frame, [10, typingEnd], [0, text.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  );

  const visibleText = text.slice(0, charsToShow);
  const isTyping = frame >= 10 && frame <= typingEnd;

  // Cursor blink (visible every other 0.5s)
  const cursorVisible = isTyping || (frame % (fps / 2) < fps / 4);

  // Fade in
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  // Quote marks fade in
  const quoteOpacity = interpolate(frame, [0, 15], [0, 0.3], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0a0a0f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Georgia', 'Times New Roman', serif",
      opacity,
      padding: '0 120px',
    }}>
      {/* Large decorative quote mark */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '10%',
        fontSize: 300,
        color: accentColor,
        opacity: quoteOpacity,
        fontFamily: 'Georgia, serif',
        lineHeight: 1,
      }}>
        &ldquo;
      </div>

      {/* Text container */}
      <div style={{
        fontSize: 52,
        fontWeight: 400,
        color: 'white',
        lineHeight: 1.5,
        textAlign: 'center',
        fontStyle: 'italic',
        maxWidth: 1400,
        position: 'relative',
      }}>
        {visibleText}
        <span style={{
          color: accentColor,
          opacity: cursorVisible ? 1 : 0,
          fontWeight: 300,
          fontStyle: 'normal',
          marginLeft: 2,
        }}>|</span>
      </div>

      {/* Bottom accent line */}
      <div style={{
        width: interpolate(frame, [5, 25], [0, 100], { extrapolateRight: 'clamp' }),
        height: 2,
        backgroundColor: accentColor,
        marginTop: 40,
        opacity: 0.6,
        boxShadow: `0 0 15px ${accentColor}60`,
      }} />
    </div>
  );
};
