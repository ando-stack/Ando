/**
 * Rendimiento: tiempo de 5.000 simulaciones en un hilo y estimación con N workers.
 *   npx tsx tests/bench.ts [comp]
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { buildGameInput, defaultTeamSetup } from '../engine/prepare';
import { runSimulations } from '../engine/run';
import { DEFAULT_PARAMS } from '../engine/types';

const results: { comp: string; single: number; parallel: number; workers: number; cores: number }[] = [];
const comps = process.argv[2] ? [process.argv[2]] : ['nba', 'euroleague', 'acb'];
const calib = existsSync('config/calibracion.json') ? JSON.parse(readFileSync('config/calibracion.json', 'utf8')) : {};
for (const comp of comps) {
  const path = `data/snapshot/${comp}.json`;
  if (!existsSync(path)) continue;
  const snap = JSON.parse(readFileSync(path, 'utf8'));
  const params = { ...DEFAULT_PARAMS, ...(calib[comp]?.params ?? {}) };
  const input = buildGameInput(snap, defaultTeamSetup(snap, snap.teams[0].id), defaultTeamSetup(snap, snap.teams[1].id), params);
  const t0 = performance.now();
  runSimulations(input, 5000, 1);
  const ms = performance.now() - t0;
  const cores = os.cpus().length;
  const w = Math.max(1, Math.min(8, cores - 1));
  // Paralelo real con worker_threads
  const t1 = performance.now();
  await Promise.all(
    Array.from({ length: w }, (_, i) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./bench-worker.mjs', import.meta.url), {
          workerData: { input, n: Math.ceil(5000 / w), seed: i + 1 },
        });
        worker.on('message', () => resolve());
        worker.on('error', reject);
      }),
    ),
  );
  const msPar = performance.now() - t1;
  results.push({ comp, single: ms / 1000, parallel: msPar / 1000, workers: w, cores });
  console.log(`${comp}: 5.000 simulaciones en 1 hilo: ${(ms / 1000).toFixed(2)} s · con ${w} workers: ${(msPar / 1000).toFixed(2)} s (${cores} núcleos)`);
}

if (!process.argv[2]) writeFileSync('data/bench.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
