/** Ejecuta N simulaciones de un partido y devuelve el agregado. */
import { Rng } from './rng';
import { simulateGame } from './simulate';
import { addResult, createAggregate, type Aggregate } from './aggregate';
import type { SimGameInput } from './types';

/**
 * Margen esperado del partido sin efecto marcador, con una simulación piloto de semilla fija
 * (todos los workers obtienen el mismo valor).
 */
export function estimateExpectedMargin(input: SimGameInput, n = 120): number {
  const rng = new Rng(7777);
  const pilot: SimGameInput = { ...input, params: { ...input.params, scoreEffect: 0 }, expectedMargin: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateGame(pilot, rng);
    s += r.homePeriods.reduce((a, b) => a + b, 0) - r.awayPeriods.reduce((a, b) => a + b, 0);
  }
  return s / n;
}

export function runSimulations(
  input: SimGameInput,
  n: number,
  seed: number,
  onProgress?: (done: number) => void,
  progressEvery = 250,
): Aggregate {
  const t0 = Date.now();
  if (input.expectedMargin === undefined && input.params.scoreEffect > 0) input = { ...input, expectedMargin: estimateExpectedMargin(input) };
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
