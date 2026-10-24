/**
 * Rendimiento del motor: tiempo de N simulaciones en un solo hilo (el navegador las reparte
 * además entre varios Web Workers). Uso: npm run rendimiento [-- 5000]
 */
import { FORMATOS } from '../config/formatos';
import { agregar } from '../engine/agregacion';
import { errorDeCoherencia } from '../engine/coherencia';
import { simularLote } from '../engine/motor';
import type { ParametrosSaque } from '../engine/tipos';

const n = Number(process.argv[2] ?? 5000);
const s = (p: number): ParametrosSaque => ({ pPrimerDentro: 0.62, pAce1: 0.12, pGana1: p + 0.08, pSegundoDentro: 0.92, pAce2: 0.02, pGana2: p - 0.12 });
for (const f of [FORMATOS.BO3_TB7, FORMATOS.BO5_TB10]) {
  const t0 = performance.now();
  const o = simularLote({ a: s(0.66), b: s(0.63), sigma: 0.15, sigmaComun: 0.1, sigmaAces: 0.3 }, f, n, 1);
  const t1 = performance.now();
  const r = agregar([o], f, (x, off) => errorDeCoherencia(x, off, f));
  const t2 = performance.now();
  console.log(`${f.id}: ${n} simulaciones en ${(t1 - t0).toFixed(0)} ms + agregación y coherencia ${(t2 - t1).toFixed(0)} ms (1 hilo) · incoherentes: ${r.incoherentes}`);
}
