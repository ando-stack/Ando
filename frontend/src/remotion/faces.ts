// Geometría del pixelado. Debe coincidir con backend/faces.py (box_at, expand, pixelate_region).
import type {FaceSample} from '../types';

export type Box = [number, number, number, number];

export function boxAt(samples: FaceSample[], t: number): Box | null {
  if (!samples.length || t < samples[0].t - 0.05 || t > samples[samples.length - 1].t + 0.05) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return [a.x * (1 - f) + b.x * f, a.y * (1 - f) + b.y * f, a.w * (1 - f) + b.w * f, a.h * (1 - f) + b.h * f];
}

export function expand(b: Box, margin: number): Box {
  const nw = b[2] * (1 + margin);
  const nh = b[3] * (1 + margin);
  return [b[0] - (nw - b[2]) / 2, b[1] - (nh - b[3]) / 2, nw, nh];
}

export const pixelBlocks = (intensity: number) => Math.max(3, Math.round(18 - 14 * intensity));
export const blurRadius = (boxWidthPx: number, intensity: number) => Math.max(1, boxWidthPx * (0.05 + 0.25 * intensity));
