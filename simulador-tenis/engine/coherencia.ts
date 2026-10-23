/**
 * Comprobaciones de coherencia de cada simulación con las reglas del tenis.
 * Se ejecutan sobre TODAS las simulaciones en el worker; el número de fallos se muestra en la
 * interfaz (debe ser 0).
 */
import type { FormatoPartido } from '../config/formatos';
import { R } from './tipos';

export function errorDeCoherencia(o: Int32Array, off: number, f: FormatoPartido): string | null {
  const nSets = o[off + R.NSETS];
  const necesarios = (f.mejorDe + 1) / 2;
  const sets = [0, 0];
  const juegosTotales = [0, 0];
  const tiebreaks = [0, 0];
  for (let s = 0; s < nSets; s++) {
    const a = o[off + R.SETS + 2 * s];
    const b = o[off + R.SETS + 2 * s + 1];
    const tb = o[off + R.TB + s];
    const esDecisivo = sets[0] === necesarios - 1 && sets[1] === necesarios - 1;
    const esSuper = esDecisivo && f.setDecisivo.tipo === 'superTiebreak';
    const g = a > b ? 0 : 1;
    if (a === b) return `set ${s + 1} empatado ${a}-${b}`;
    if (esSuper) {
      if (!((a === 1 && b === 0) || (a === 0 && b === 1)) || tb !== g + 1) return `super tie-break mal registrado en el set ${s + 1}`;
    } else {
      const G = f.juegosPorSet;
      const T = f.tiebreakEn;
      const max = Math.max(a, b);
      const min = Math.min(a, b);
      const conTb = !esDecisivo || f.setDecisivo.tipo === 'tiebreak';
      if (tb) {
        if (!conTb) return `tie-break no permitido en el set ${s + 1}`;
        if (!(max === T + 1 && min === T)) return `tie-break con marcador imposible ${a}-${b}`;
        if (tb !== g + 1) return `ganador del tie-break incoherente en el set ${s + 1}`;
        tiebreaks[g]++;
      } else {
        // Sin tie-break: G-x con x ≤ G-2, o más allá de G con diferencia de 2 (7-5, 8-6...).
        // Con tie-break a T-T, la segunda opción sólo es posible si el perdedor no llegó a T (7-5).
        const valido =
          max >= G && (max === G ? min <= G - 2 : max - min === 2 && (!conTb || min < T));
        if (!valido) return `marcador de set imposible ${a}-${b}`;
      }
    }
    juegosTotales[0] += a;
    juegosTotales[1] += b;
    sets[g]++;
    if (s < nSets - 1 && (sets[0] === necesarios || sets[1] === necesarios)) return 'el partido continuó tras decidirse';
  }
  if (sets[0] !== necesarios && sets[1] !== necesarios) return 'partido sin terminar';
  const ganador = sets[0] === necesarios ? 0 : 1;
  if (o[off + R.GANADOR] !== ganador) return 'ganador incorrecto';

  // Juegos: los juegos (sin tie-breaks) = juegos al saque de ambos.
  const juegosSinTb = juegosTotales[0] + juegosTotales[1] - tiebreaks[0] - tiebreaks[1] - (o[off + R.SUPER_TB] ? 1 : 0);
  const juegosSaque = o[off + R.JUEGOS_SAQUE] + o[off + R.JUEGOS_SAQUE + 1];
  if (juegosSinTb !== juegosSaque) return `juegos al saque (${juegosSaque}) ≠ juegos jugados (${juegosSinTb})`;
  // Breaks de A = juegos al saque perdidos por B; los juegos ganados por A = sus juegos al saque
  // ganados + sus breaks + sus tie-breaks.
  for (const j of [0, 1]) {
    const otro = 1 - j;
    const ganadosAlSaque = o[off + R.JUEGOS_SAQUE + j] - o[off + R.BREAKS + otro];
    const ganados = ganadosAlSaque + o[off + R.BREAKS + j] + tiebreaks[j] + (o[off + R.SUPER_TB] && ganador === j ? 1 : 0);
    if (ganados !== juegosTotales[j]) return `juegos del jugador ${j} incoherentes con breaks`;
    if (o[off + R.BP_SALVADOS + j] > o[off + R.BP_CONCEDIDOS + j]) return 'más break points salvados que concedidos';
    if (o[off + R.BP_CONCEDIDOS + j] - o[off + R.BP_SALVADOS + j] !== o[off + R.BREAKS + otro]) return 'break points convertidos ≠ breaks';
    const pts = o[off + R.PTS_SAQUE + j];
    if (o[off + R.PRIMEROS_DENTRO + j] > pts) return 'más primeros dentro que puntos';
    if (o[off + R.ACES + j] + o[off + R.DF + j] > pts) return 'aces + dobles faltas > puntos';
    if (o[off + R.GANADOS_1 + j] > o[off + R.PRIMEROS_DENTRO + j]) return 'ganados con el 1.º > primeros dentro';
    if (o[off + R.GANADOS_2 + j] + o[off + R.DF + j] > pts - o[off + R.PRIMEROS_DENTRO + j]) return 'segundos incoherentes';
  }
  const totalPts = o[off + R.PTS_SAQUE] + o[off + R.PTS_SAQUE + 1];
  if (o[off + R.PUNTOS_GANADOS] + o[off + R.PUNTOS_GANADOS + 1] !== totalPts) return 'puntos ganados ≠ puntos jugados';
  return null;
}
