import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

export const Clip: React.FC<{titulo: string}> = ({titulo}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: '#111', justifyContent: 'center', alignItems: 'center'}}>
      <h1 style={{color: 'white', fontSize: 120, fontFamily: 'sans-serif', opacity}}>{titulo}</h1>
    </AbsoluteFill>
  );
};
