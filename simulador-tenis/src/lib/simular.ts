import type { FormatoPartido } from '../../config/formatos';
import { fusionar, type ResultadosAgregados } from '../../engine/agregacion';
import { semillaDerivada } from '../../engine/rng';
import type { ParametrosPartido } from '../../engine/tipos';

/** Ejecuta n simulaciones repartidas entre varios Web Workers en paralelo. */
export function simularEnParalelo(
  params: ParametrosPartido,
  formato: FormatoPartido,
  n: number,
  semilla: number,
  alAvanzar: (fraccion: number) => void,
): { promesa: Promise<ResultadosAgregados>; cancelar: () => void } {
  const nucleos = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1, Math.ceil(n / 1000)));
  const workers: Worker[] = [];
  const hechos = new Array(nucleos).fill(0);
  const promesa = new Promise<ResultadosAgregados>((resolve, reject) => {
    const partes: ResultadosAgregados[] = [];
    for (let i = 0; i < nucleos; i++) {
      const cuantos = Math.floor(n / nucleos) + (i < n % nucleos ? 1 : 0);
      const w = new Worker(new URL('../workers/simulacion.worker.ts', import.meta.url), { type: 'module' });
      workers.push(w);
      w.onmessage = (ev) => {
        if (ev.data.tipo === 'progreso') {
          hechos[i] = ev.data.hechos;
          alAvanzar(hechos.reduce((a, b) => a + b, 0) / n);
        } else {
          hechos[i] = cuantos;
          partes.push(ev.data.resultado);
          w.terminate();
          if (partes.length === nucleos) {
            alAvanzar(1);
            resolve(fusionar(partes));
          }
        }
      };
      w.onerror = (e) => {
        workers.forEach((x) => x.terminate());
        reject(new Error(e.message || 'Error en el worker de simulación'));
      };
      w.postMessage({ params, formato, n: cuantos, semilla: semillaDerivada(semilla, i) });
    }
  });
  return { promesa, cancelar: () => workers.forEach((w) => w.terminate()) };
}
