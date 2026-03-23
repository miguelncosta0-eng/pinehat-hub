import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { NumberCounter } from './NumberCounter';
import { TypewriterEffect } from './Typewriter';
import { GlitchText } from './GlitchText';
import { AnimatedChart } from './AnimatedChart';

const FPS = 30;

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="NumberCounter"
        component={NumberCounter}
        durationInFrames={FPS * 3}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          number: 2012,
          label: '',
          accentColor: '#a855f7',
        }}
      />
      <Composition
        id="Typewriter"
        component={TypewriterEffect}
        durationInFrames={FPS * 4}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          text: 'The mystery deepens...',
          accentColor: '#a855f7',
        }}
      />
      <Composition
        id="GlitchText"
        component={GlitchText}
        durationInFrames={FPS * 3}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          text: 'MYSTERY',
          accentColor: '#a855f7',
        }}
      />
      <Composition
        id="AnimatedChart"
        component={AnimatedChart}
        durationInFrames={FPS * 4}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          values: [10, 45, 78, 120, 200],
          labels: ['S1', 'S2', 'S3', 'S4', 'S5'],
          title: 'Viewership Growth',
          accentColor: '#a855f7',
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
