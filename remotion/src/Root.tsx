import React from 'react';
import {Composition} from 'remotion';
import {Clip} from './Clip';

// Vertical 9:16, igual que los clips de AutoClips.
export const RemotionRoot: React.FC = () => (
  <Composition
    id="Clip"
    component={Clip}
    durationInFrames={90}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{titulo: 'AutoClips'}}
  />
);
