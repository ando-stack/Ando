// Worker de la prueba de rendimiento: registra tsx para poder importar el motor en TypeScript.
import { register } from 'tsx/esm/api';
register();
const { workerData, parentPort } = await import('node:worker_threads');
const { runSimulations } = await import('../engine/run.ts');
runSimulations(workerData.input, workerData.n, workerData.seed);
parentPort.postMessage('ok');
