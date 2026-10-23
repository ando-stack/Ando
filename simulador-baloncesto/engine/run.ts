/** Ejecuta N simulaciones de un partido y devuelve el agregado. */
import { Rng } from './rng';
import { simulateGame } from './simulate';
import { addResult, createAggregate, type Aggregate } from './aggregate';
import type { SimGameInput } from './types';

export function runSimulations(
  input: SimGameInput,
  n: number,
  seed: number,
  onProgress?: (done: number) => void,
  progressEvery = 250,
): Aggregate {
  const t0 = Date.now();
  const rng = new Rng(seed);
  const agg = createAggregate(input);
  for (let i = 0; i < n; i++) {
    const r = simulateGame(input, rng);
    addResult(agg, r, input);
    if (onProgress && (i + 1) % progressEvery === 0) onProgress(i + 1);
  }
  agg.elapsedMs = Date.now() - t0;
  return agg;
}
