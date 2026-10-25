import {Composition} from 'remotion';
import {Pereira7, TOTAL_FRAMES} from './Pereira7';

export const RemotionRoot: React.FC = () => (
  <Composition id="Pereira7" component={Pereira7} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
);
