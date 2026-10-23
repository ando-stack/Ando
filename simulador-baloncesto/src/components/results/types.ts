import type { SimRun } from '../../lib/types';
import type { LineOptions } from '../../../engine/markets';
export interface TabProps {
  run: SimRun;
  showOdds: boolean;
  lines: LineOptions;
}
