import {Composition} from 'remotion';
import {Videoclip, TOTAL_FRAMES} from './Videoclip';

export const RemotionRoot: React.FC = () => (
  <Composition id="Videoclip" component={Videoclip} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
);
