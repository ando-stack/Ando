import {Composition} from 'remotion';
import {DuolingoPromo, TOTAL_FRAMES} from './DuolingoPromo';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="DuolingoPromo"
    component={DuolingoPromo}
    durationInFrames={TOTAL_FRAMES}
    fps={30}
    width={1080}
    height={1920}
  />
);
