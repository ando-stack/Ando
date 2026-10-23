/// <reference lib="webworker" />
/** Web Worker de simulación: ejecuta su parte de las simulaciones y devuelve el agregado. */
import { runSimulations } from '../../engine/run';
import type { SimGameInput } from '../../engine/types';

export interface WorkerRequest {
  input: SimGameInput;
  n: number;
  seed: number;
}
export type WorkerMessage =
  | { type: 'progress'; done: number }
  | { type: 'done'; aggregate: ReturnType<typeof runSimulations> }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { input, n, seed } = e.data;
  try {
    const agg = runSimulations(input, n, seed, (done) => (self as DedicatedWorkerGlobalScope).postMessage({ type: 'progress', done }), 100);
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'done', aggregate: agg } satisfies WorkerMessage);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'error', message: (err as Error).message } satisfies WorkerMessage);
  }
};
