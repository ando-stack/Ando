/**
 * Cálculo exacto (cadenas de Markov) de probabilidades de juego, tie-break, set y partido a partir
 * de la probabilidad de ganar un punto al saque de cada jugador. Se usa para:
 *  - ajustar las probabilidades de saque al Elo (resolver el desplazamiento δ),
 *  - el backtest de la probabilidad de victoria,
 *  - los tests del motor (la simulación debe converger a estos valores).
 */
import type { FormatoPartido } from '../config/formatos';

/** P(el sacador gana el juego) con probabilidad p de ganar cada punto. */
export function probJuego(p: number, sinVentaja = false): number {
  const q = 1 - p;
  if (sinVentaja) {
    // Primero a 4 puntos (máximo 7 puntos).
    let s = 0;
    const c = [1, 4, 10, 20];
    for (let k = 0; k <= 3; k++) s += c[k] * p ** 4 * q ** k;
    return s;
  }
  const antesDeIguales = p ** 4 * (1 + 4 * q + 10 * q * q);
  const iguales = 20 * p ** 3 * q ** 3;
  return antesDeIguales + (iguales * p * p) / (1 - 2 * p * q);
}

/**
 * P(A gana un tie-break a `objetivo` puntos). pa = P(A gana punto al saque), pb = P(B gana punto
 * al saque). primero: 0 si saca A el primer punto.
 */
export function probTiebreak(pa: number, pb: number, primero: 0 | 1, objetivo: number): number {
  const N = objetivo;
  const prob: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  prob[0][0] = 1;
  let ganaA = 0;
  for (let k = 0; k <= 2 * N - 3; k++) {
    for (let i = Math.max(0, k - (N - 1)); i <= Math.min(N - 1, k); i++) {
      const j = k - i;
      const m = prob[i][j];
      if (!m) continue;
      const s = k === 0 ? primero : ((k - 1) >> 1) % 2 === 0 ? 1 - primero : primero;
      const pA = s === 0 ? pa : 1 - pb;
      // A gana el punto
      if (i + 1 === N) ganaA += m * pA;
      else prob[i + 1][j] += m * pA;
      // B gana el punto
      if (j + 1 < N) prob[i][j + 1] += m * (1 - pA);
    }
  }
  // Empate a N-1: cada par de puntos lo saca uno cada jugador.
  const x = pa * (1 - pb);
  const y = (1 - pa) * pb;
  ganaA += prob[N - 1][N - 1] * (x / (x + y));
  return ganaA;
}

export interface ResultadoSet {
  /** [ganador][siguienteSacador] */
  p: [[number, number], [number, number]];
}

/**
 * Probabilidades de un set, separadas por quién saca primero en el set siguiente.
 * reglaFinal: tipo de set ('tiebreak' con N puntos, o 'ventaja').
 */
export function probSet(
  pa: number,
  pb: number,
  primero: 0 | 1,
  f: FormatoPartido,
  regla: { tipo: 'tiebreak'; puntos: number } | { tipo: 'ventaja' },
): ResultadoSet {
  const G = f.juegosPorSet;
  const T = f.tiebreakEn;
  const hA = probJuego(pa, f.sinVentaja);
  const hB = probJuego(pb, f.sinVentaja);
  const res: ResultadoSet = {
    p: [
      [0, 0],
      [0, 0],
    ],
  };
  const sigue = (k: number): 0 | 1 => (k % 2 === 0 ? primero : ((1 - primero) as 0 | 1));
  const L = G + 2;
  const prob: number[][] = Array.from({ length: L + 1 }, () => new Array(L + 1).fill(0));
  prob[0][0] = 1;
  for (let k = 0; k <= 2 * L; k++) {
    for (let i = Math.max(0, k - L); i <= Math.min(L, k); i++) {
      const j = k - i;
      const m = prob[i][j];
      if (!m) continue;
      prob[i][j] = 0;
      if (i >= G && i - j >= 2) {
        res.p[0][sigue(k)] += m;
        continue;
      }
      if (j >= G && j - i >= 2) {
        res.p[1][sigue(k)] += m;
        continue;
      }
      if (regla.tipo === 'tiebreak' && i === T && j === T) {
        const pt = probTiebreak(pa, pb, sigue(k), regla.puntos);
        res.p[0][sigue(k + 1)] += m * pt;
        res.p[1][sigue(k + 1)] += m * (1 - pt);
        continue;
      }
      if (regla.tipo === 'ventaja' && i === j && i >= G - 1) {
        // Desde el empate, cada par de juegos tiene un saque de cada uno; termina con k par.
        const s = sigue(k);
        const holdS = s === 0 ? hA : hB;
        const holdO = s === 0 ? hB : hA;
        // P(gana A los dos juegos)
        const aDos = s === 0 ? holdS * (1 - holdO) : (1 - holdS) * holdO;
        const bDos = s === 0 ? (1 - holdS) * holdO : holdS * (1 - holdO);
        const pA = aDos / (aDos + bDos);
        res.p[0][s] += m * pA;
        res.p[1][s] += m * (1 - pA);
        continue;
      }
      const s = sigue(k);
      const pAgana = s === 0 ? hA : 1 - hB;
      prob[i + 1][j] += m * pAgana;
      prob[i][j + 1] += m * (1 - pAgana);
    }
  }
  return res;
}

/** P(A gana el partido) dado quién saca primero (o promediando si primero = -1). */
export function probPartido(pa: number, pb: number, f: FormatoPartido, primero: 0 | 1 | -1 = -1): number {
  if (primero === -1) return 0.5 * (probPartido(pa, pb, f, 0) + probPartido(pa, pb, f, 1));
  const n = (f.mejorDe + 1) / 2;
  const cache = new Map<string, ResultadoSet>();
  const set = (s: 0 | 1, decisivo: boolean) => {
    const clave = `${s}${decisivo}`;
    let r = cache.get(clave);
    if (!r) {
      const regla = decisivo
        ? f.setDecisivo.tipo === 'ventaja'
          ? ({ tipo: 'ventaja' } as const)
          : ({ tipo: 'tiebreak', puntos: f.setDecisivo.tipo === 'tiebreak' ? f.setDecisivo.puntos : f.puntosTiebreak } as const)
        : ({ tipo: 'tiebreak', puntos: f.puntosTiebreak } as const);
      r = probSet(pa, pb, s, f, regla);
      cache.set(clave, r);
    }
    return r;
  };
  const memo = new Map<string, number>();
  const rec = (sa: number, sb: number, s: 0 | 1): number => {
    if (sa === n) return 1;
    if (sb === n) return 0;
    const clave = `${sa},${sb},${s}`;
    const m = memo.get(clave);
    if (m !== undefined) return m;
    const decisivo = sa === n - 1 && sb === n - 1;
    let v: number;
    if (decisivo && f.setDecisivo.tipo === 'superTiebreak') {
      v = probTiebreak(pa, pb, s, f.setDecisivo.puntos);
    } else {
      const r = set(s, decisivo);
      v =
        r.p[0][0] * rec(sa + 1, sb, 0) +
        r.p[0][1] * rec(sa + 1, sb, 1) +
        r.p[1][0] * rec(sa, sb + 1, 0) +
        r.p[1][1] * rec(sa, sb + 1, 1);
    }
    memo.set(clave, v);
    return v;
  };
  return rec(0, 0, primero);
}

// Nodos y pesos de Gauss-Hermite (5 puntos) para integrar sobre N(0,1).
const GH_X = [-2.020182870456086, -0.9585724646138185, 0, 0.9585724646138185, 2.020182870456086];
const GH_W = [0.01995324205904591, 0.3936193231522412, 0.9453087204829419, 0.3936193231522412, 0.01995324205904591];
const SQRT2 = Math.SQRT2;

const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * P(A gana) integrando la variabilidad partido a partido: el logit de la probabilidad de saque
 * de cada jugador se desplaza con N(0, sigma²) independientes, igual que en el motor.
 */
export function probPartidoConVariabilidad(pa: number, pb: number, f: FormatoPartido, sigma: number): number {
  if (sigma <= 0) return probPartido(pa, pb, f);
  const la = logit(pa);
  const lb = logit(pb);
  let s = 0;
  let w = 0;
  for (let i = 0; i < GH_X.length; i++) {
    const za = la + sigma * SQRT2 * GH_X[i];
    for (let j = 0; j < GH_X.length; j++) {
      const zb = lb + sigma * SQRT2 * GH_X[j];
      s += GH_W[i] * GH_W[j] * probPartido(sigm(za), sigm(zb), f);
      w += GH_W[i] * GH_W[j];
    }
  }
  return s / w;
}
