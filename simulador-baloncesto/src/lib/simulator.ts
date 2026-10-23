/** Reparte las simulaciones entre varios Web Workers en paralelo y combina los resultados. */
import { mergeAggregate, type Aggregate } from '../../engine/aggregate';
import { deriveSeed } from '../../engine/rng';
import type { SimGameInput } from '../../engine/types';
import type { WorkerMessage } from '../workers/sim.worker';

export function workerCount() {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(8, hc - 1));
}

export interface RunHandle {
  promise: Promise<Aggregate>;
  cancel: () => void;
}

export function runParallel(input: SimGameInput, n: number, seed: number, onProgress: (done: number) => void): RunHandle {
  const k = Math.min(workerCount(), Math.max(1, Math.floor(n / 500)));
  const workers: Worker[] = [];
  const done = new Array(k).fill(0);
  let cancelled = false;
  let rejectFn: (e: Error) => void = () => {};
  const t0 = performance.now();
  const promise = new Promise<Aggregate>((resolve, reject) => {
    rejectFn = reject;
    const parts: (Aggregate | null)[] = new Array(k).fill(null);
    for (let i = 0; i < k; i++) {
      const share = Math.floor(n / k) + (i < n % k ? 1 : 0);
      const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
      workers.push(w);
      w.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'progress') {
          done[i] = m.done;
          onProgress(done.reduce((a, b) => a + b, 0));
        } else if (m.type === 'done') {
          parts[i] = m.aggregate;
          done[i] = share;
          onProgress(done.reduce((a, b) => a + b, 0));
          w.terminate();
          if (parts.every(Boolean)) {
            const total = parts.slice(1).reduce((acc, p) => mergeAggregate(acc!, p!), parts[0]!)!;
            total.elapsedMs = performance.now() - t0;
            resolve(total);
          }
        } else {
          workers.forEach((x) => x.terminate());
          reject(new Error(m.message));
        }
      };
      w.onerror = (ev) => {
        workers.forEach((x) => x.terminate());
        reject(new Error(ev.message || 'Error en el worker de simulación'));
      };
      w.postMessage({ input, n: share, seed: deriveSeed(seed, i) });
    }
  });
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      workers.forEach((w) => w.terminate());
      rejectFn(new Error('')); // cancelado por el usuario (sin mensaje de error)
    },
  };
}
