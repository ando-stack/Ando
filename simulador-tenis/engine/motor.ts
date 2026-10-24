/**
 * Motor de simulación punto a punto.
 *
 * Cada punto: primer saque (dentro/fuera) → ace o punto jugado; si falla, segundo saque
 * (dentro/doble falta) → ace o punto jugado. Juegos con ventaja o punto decisivo, sets con
 * tie-break a tiebreakEn-tiebreakEn, set decisivo según el formato (tie-break a 7/10, ventaja o
 * super tie-break). El saque alterna cada juego; en el tie-break saca primero quien tiene el turno,
 * después se alterna cada dos puntos, y el turno sigue alternando tras el tie-break (por eso el
 * siguiente set lo empieza sacando quien restó el primer punto del tie-break).
 */
import type { FormatoPartido } from '../config/formatos';
import { ANCHO, R, type ParametrosPartido, type ParametrosSaque } from './tipos';
import { Rng } from './rng';

const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Probabilidades efectivas de un sacador en una simulación (con su variación del día). */
interface SaqueEfectivo {
  p1: number; // P(primer dentro)
  a1: number; // P(ace | primer dentro)
  g1: number; // P(ganar | primer dentro y no ace)
  p2: number; // P(segundo dentro)
  a2: number;
  g2: number;
}

function efectivo(s: ParametrosSaque, desplazamiento: number, multAces: number, dst: SaqueEfectivo) {
  const l1 = logit(clamp(s.pGana1, 1e-4, 1 - 1e-4));
  const l2 = logit(clamp(s.pGana2, 1e-4, 1 - 1e-4));
  const w1 = s.pPrimerDentro;
  const w2 = (1 - s.pPrimerDentro) * s.pSegundoDentro;
  // El día del jugador desplaza su probabilidad TOTAL de ganar el punto al saque (igual que el
  // cálculo exacto); se reparte entre primer y segundo saque con un mismo desplazamiento τ.
  let tau = 0;
  if (desplazamiento !== 0) {
    const total = w1 * sigm(l1) + w2 * sigm(l2);
    const objetivo = clamp(sigm(logit(clamp(total, 1e-4, 1 - 1e-4)) + desplazamiento), 1e-4, w1 + w2 - 1e-4);
    tau = desplazamiento;
    for (let i = 0; i < 8; i++) {
      const a = sigm(l1 + tau);
      const b = sigm(l2 + tau);
      const f = w1 * a + w2 * b - objetivo;
      const d = w1 * a * (1 - a) + w2 * b * (1 - b);
      if (d < 1e-9) break;
      tau -= f / d;
      if (Math.abs(f) < 1e-10) break;
    }
  }
  const gana1 = clamp(sigm(l1 + tau), 1e-4, 1 - 1e-4);
  const gana2 = clamp(sigm(l2 + tau), 1e-4, 1 - 1e-4);
  const a1 = clamp(s.pAce1 * multAces, 0, gana1 * 0.95);
  const a2 = clamp(s.pAce2 * multAces, 0, gana2 * 0.95);
  dst.p1 = s.pPrimerDentro;
  dst.a1 = a1;
  dst.g1 = (gana1 - a1) / (1 - a1);
  dst.p2 = s.pSegundoDentro;
  dst.a2 = a2;
  dst.g2 = (gana2 - a2) / (1 - a2);
}

/** Estado reutilizable para evitar asignaciones en el bucle caliente. */
export class Simulador {
  private ef: [SaqueEfectivo, SaqueEfectivo] = [
    { p1: 0, a1: 0, g1: 0, p2: 0, a2: 0, g2: 0 },
    { p1: 0, a1: 0, g1: 0, p2: 0, a2: 0, g2: 0 },
  ];
  private out!: Int32Array;
  private off = 0;

  constructor(
    private params: ParametrosPartido,
    private formato: FormatoPartido,
    private rng: Rng,
  ) {}

  /** Simula un punto con saque de `s`. Devuelve true si lo gana el sacador. */
  private punto(s: number): boolean {
    const e = this.ef[s];
    const rng = this.rng;
    const o = this.out;
    const off = this.off;
    o[off + R.PTS_SAQUE + s]++;
    let gana: boolean;
    if (rng.next() < e.p1) {
      o[off + R.PRIMEROS_DENTRO + s]++;
      if (rng.next() < e.a1) {
        o[off + R.ACES + s]++;
        gana = true;
      } else gana = rng.next() < e.g1;
      if (gana) o[off + R.GANADOS_1 + s]++;
    } else if (rng.next() < e.p2) {
      if (rng.next() < e.a2) {
        o[off + R.ACES + s]++;
        gana = true;
      } else gana = rng.next() < e.g2;
      if (gana) o[off + R.GANADOS_2 + s]++;
    } else {
      o[off + R.DF + s]++;
      gana = false;
    }
    o[off + R.PUNTOS_GANADOS + (gana ? s : 1 - s)]++;
    return gana;
  }

  /** Juego normal. Devuelve el ganador (0/1). */
  private juego(s: number): number {
    const o = this.out;
    const off = this.off;
    const sinVentaja = this.formato.sinVentaja;
    let ps = 0;
    let pr = 0;
    o[off + R.JUEGOS_SAQUE + s]++;
    for (;;) {
      const esBreakPoint = sinVentaja ? pr >= 3 : pr >= 3 && pr > ps;
      if (esBreakPoint) o[off + R.BP_CONCEDIDOS + s]++;
      if (this.punto(s)) {
        ps++;
        if (esBreakPoint) o[off + R.BP_SALVADOS + s]++;
      } else pr++;
      if (sinVentaja) {
        if (ps >= 4) return s;
        if (pr >= 4) {
          o[off + R.BREAKS + (1 - s)]++;
          return 1 - s;
        }
      } else {
        if (ps >= 4 && ps - pr >= 2) return s;
        if (pr >= 4 && pr - ps >= 2) {
          o[off + R.BREAKS + (1 - s)]++;
          return 1 - s;
        }
      }
    }
  }

  /** Tie-break a `objetivo` puntos con diferencia de 2. Devuelve el ganador. */
  private tiebreak(primero: number, objetivo: number): number {
    const pts = [0, 0];
    for (let k = 0; ; k++) {
      // Punto 0: saca `primero`; después, bloques de dos puntos alternos.
      const s = k === 0 ? primero : ((k - 1) >> 1) % 2 === 0 ? 1 - primero : primero;
      const g = this.punto(s) ? s : 1 - s;
      pts[g]++;
      if (pts[g] >= objetivo && pts[g] - pts[1 - g] >= 2) return g;
    }
  }

  /**
   * Simula un partido completo y escribe el registro en out[off .. off+ANCHO).
   * @param primerSacador 0/1, o -1 para sortearlo.
   */
  simular(out: Int32Array, off: number, primerSacador = -1): void {
    this.out = out;
    this.off = off;
    out.fill(0, off, off + ANCHO);
    const p = this.params;
    const rng = this.rng;
    const f = this.formato;
    // Variación del nivel de cada jugador en esta simulación.
    const D = p.sigma > 0 ? p.sigma * rng.normal() : 0;
    const C = p.sigmaComun > 0 ? p.sigmaComun * rng.normal() : 0;
    const despA = D + C;
    const despB = -D + C;
    const sa = p.sigmaAces;
    const multA = sa > 0 ? Math.exp(sa * rng.normal() - (sa * sa) / 2) : 1;
    const multB = sa > 0 ? Math.exp(sa * rng.normal() - (sa * sa) / 2) : 1;
    efectivo(p.a, despA, multA, this.ef[0]);
    efectivo(p.b, despB, multB, this.ef[1]);

    let sacador = primerSacador >= 0 ? primerSacador : rng.next() < 0.5 ? 0 : 1;
    out[off + R.PRIMER_SACADOR] = sacador;
    const setsNecesarios = (f.mejorDe + 1) / 2;
    const sets = [0, 0];
    let nSet = 0;
    while (sets[0] < setsNecesarios && sets[1] < setsNecesarios) {
      const esDecisivo = sets[0] === setsNecesarios - 1 && sets[1] === setsNecesarios - 1;
      const base = off + R.SETS + nSet * 2;
      let ganadorSet: number;
      if (esDecisivo && f.setDecisivo.tipo === 'superTiebreak') {
        const g = this.tiebreak(sacador, f.setDecisivo.puntos);
        sacador = 1 - sacador;
        out[base + g] = 1;
        out[off + R.TB + nSet] = g + 1;
        out[off + R.SUPER_TB] = 1;
        ganadorSet = g;
      } else {
        const juegos = [0, 0];
        const G = f.juegosPorSet;
        const T = f.tiebreakEn;
        const conTiebreak = !esDecisivo || f.setDecisivo.tipo === 'tiebreak';
        const puntosTb = esDecisivo && f.setDecisivo.tipo === 'tiebreak' ? f.setDecisivo.puntos : f.puntosTiebreak;
        for (;;) {
          if (conTiebreak && juegos[0] === T && juegos[1] === T) {
            const g = this.tiebreak(sacador, puntosTb);
            sacador = 1 - sacador;
            juegos[g]++;
            out[off + R.TB + nSet] = g + 1;
            ganadorSet = g;
            break;
          }
          const g = this.juego(sacador);
          sacador = 1 - sacador;
          juegos[g]++;
          if (juegos[g] >= G && juegos[g] - juegos[1 - g] >= 2) {
            ganadorSet = g;
            break;
          }
        }
        out[base] = juegos[0];
        out[base + 1] = juegos[1];
      }
      sets[ganadorSet]++;
      nSet++;
    }
    out[off + R.NSETS] = nSet;
    out[off + R.GANADOR] = sets[0] > sets[1] ? 0 : 1;
  }
}

/** Simula `n` partidos y devuelve los registros en un Int32Array de n*ANCHO. */
export function simularLote(
  params: ParametrosPartido,
  formato: FormatoPartido,
  n: number,
  semilla: number,
  alAvanzar?: (hechos: number) => void,
): Int32Array {
  const out = new Int32Array(n * ANCHO);
  const sim = new Simulador(params, formato, new Rng(semilla));
  for (let i = 0; i < n; i++) {
    sim.simular(out, i * ANCHO);
    if (alAvanzar && (i + 1) % 500 === 0) alAvanzar(i + 1);
  }
  return out;
}
