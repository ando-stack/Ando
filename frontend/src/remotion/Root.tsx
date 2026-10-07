import React from 'react';
import {Composition} from 'remotion';
import type {CompositionProps, Project} from '../types';
import {EditorComposition, durationInFrames} from './Editor';

const emptyProject = {
  name: 'vacio',
  canvas: {width: 1920, height: 1080, fps: 30, aspect: '16:9'},
  sources: [],
  segments: [],
} as unknown as Project;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Editor"
    component={EditorComposition}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30}
    defaultProps={{project: emptyProject, media: {baseUrl: '', assetsUrl: '', mode: 'render'}, output: {width: 1920, height: 1080, aspect: '16:9'}} as CompositionProps}
    calculateMetadata={({props}) => {
      const fps = props.project.canvas?.fps || 30;
      return {
        fps,
        width: props.output.width,
        height: props.output.height,
        durationInFrames: durationInFrames(props.project, fps),
      };
    }}
  />
);
