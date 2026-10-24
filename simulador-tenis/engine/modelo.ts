/**
 * Modelo: de los perfiles de dos jugadores a los parámetros punto a punto de un partido.
 * Explicación completa en docs/modelo.md.
 */
import { FORMATOS, type Circuito, type FormatoPartido, type Superficie } from '../config/formatos';
import { probPartidoConVariabilidad } from './analitico';
import { probElo, ratingCombinado, type RatingJugador } from './elo';
import type { ParametrosPartido, ParametrosSaque } from './tipos';

export const CAMPOS = [
  'svpt', // puntos al saque
  'in1', // primeros dentro
  'won1', // ganados con el primero
  'won2', // ganados con el segundo
  'ace',
  'df',
  'svgms', // juegos al saque
  'bpf', // break points afrontados
  'bps', // break points salvados
  'rpt', // puntos al resto
  'rwon', // puntos al resto ganados
  'aceC', // aces recibidos
  'dfC', // dobles faltas del rival
  'rgms', // juegos al resto
  'brk', // breaks conseguidos
  'tbp', // tie-breaks jugados
  'tbw', // tie-breaks ganados
  'm', // partidos (ponderados)
  'exS', // exceso de puntos ganados al saque respecto a lo esperado por el rival
  'exR', // exceso de puntos ganados al resto
] as const;
export type Campo = (typeof CAMPOS)[number];
export const I = Object.fromEntries(CAMPOS.map((c, i) => [c, i])) as Record<Campo, number>;
export type VectorStats = number[];
export const vectorVacio = (): VectorStats => new Array(CAMPOS.length).fill(0);

export type ClaveSuperficie = 'todas' | Superficie;
export type Pool = 'M' | 'F';

export interface PerfilJugador {
  id: string;
  nombre: string;
  pais: string;
  pool: Pool;
  /** Circuito principal en el que ha jugado más en el último año. */
  circuito: Circuito | 'ITF';
  nacimiento?: string | null;
  mano?: string | null;
  reves?: string | null;
  altura?: number | null;
  ranking?: { pos: number; puntos: number | null; fecha: string; fuente: string } | null;
  elo: RatingJugador;
  /** Residuo de forma: victorias por encima de lo esperado por el Elo, con decaimiento rápido. */
  forma: number;
  stats: Record<ClaveSuperficie, VectorStats>;
  /** Partidos reales con estadísticas detalladas usados (sin ponderar). */
  nReal: Record<ClaveSuperficie, number>;
  /** Partidos totales (con o sin estadísticas) en el histórico usado. */
  nPartidos: number;
  ultimoPartido: string | null;
}

/** Lo mínimo que necesita el modelo de un jugador. */
export type PerfilMinimo = Pick<PerfilJugador, 'pool' | 'elo' | 'stats' | 'nReal' | 'forma'>;

export interface MediasSuperficie {
  saque: number; // puntos ganados al saque
  primeros: number; // % primeros dentro
  ganados1: number; // P(ganar | primero dentro)
  ganados2: number; // P(ganar | segundo dentro)
  aces: number; // aces por punto al saque
  dobles: number; // dobles faltas por segundo saque
  acesC: number; // aces recibidos por punto al resto (= aces en el pool)
}

export interface CalibracionGrupo {
  /** Desplazamiento logit del saque de ambos jugadores (juegos, breaks, tie-breaks). */
  saque: number;
  aces: number;
  dobles: number;
  /** Dominancia del día (σ) propia del grupo; si falta, se usa la general. */
  sigma?: number;
  /** Número de partidos usados en la calibración. */
  n?: number;
}

export interface ParamsModelo {
  version: string;
  ajustadoEl: string;
  vidaMediaDias: number;
  pesoSuperficieElo: number;
  /** Peso del Elo en la probabilidad de victoria (en escala logit). */
  pesoElo: number;
  /** Factor que multiplica el logit combinado (corrige un modelo poco o demasiado seguro). */
  escalaVictoria: number;
  gammaForma: number;
  sigma: number;
  sigmaComun: number;
  sigmaAces: number;
  /** P(ace | segundo dentro) = rhoAce2 · P(ace | primero dentro). */
  rhoAce2: number;
  /** Fuerza de los priors, en puntos (o segundos saques, etc.). */
  K: {
    saque: number;
    resto: number;
    primeros: number;
    ganados1: number;
    ganados2: number;
    aces: number;
    dobles: number;
    acesC: number;
    /** Fuerza del prior "todas las superficies" sobre la estimación de una superficie. */
    superficie: number;
  };
  /** Exceso de saque/resto esperado según el Elo: a + b·(Elo − 1500)/100. */
  prior: Record<Pool, { saque: { a: number; b: number }; resto: { a: number; b: number } }>;
  medias: Record<Pool, Record<ClaveSuperficie, MediasSuperficie>>;
  calibracion: Record<string, CalibracionGrupo>;
  /** Por debajo de estos partidos con estadísticas, el perfil se marca como estimado. */
  minPartidosReales: number;
}

const MEDIAS_M: MediasSuperficie = { saque: 0.635, primeros: 0.62, ganados1: 0.73, ganados2: 0.56, aces: 0.075, dobles: 0.085, acesC: 0.075 };
const MEDIAS_F: MediasSuperficie = { saque: 0.565, primeros: 0.63, ganados1: 0.65, ganados2: 0.5, aces: 0.035, dobles: 0.1, acesC: 0.035 };

/** Valores por defecto (los ajustados se cargan de data/modelo.json, generados por la ingesta). */
export const PARAMS_POR_DEFECTO: ParamsModelo = {
  version: 'por-defecto',
  ajustadoEl: '',
  vidaMediaDias: 365,
  pesoSuperficieElo: 0.5,
  pesoElo: 0.75,
  escalaVictoria: 1,
  gammaForma: 0,
  sigma: 0.25,
  sigmaComun: 0,
  sigmaAces: 0.25,
  rhoAce2: 0.15,
  K: { saque: 600, resto: 600, primeros: 300, ganados1: 300, ganados2: 300, aces: 600, dobles: 300, acesC: 800, superficie: 400 },
  prior: {
    M: { saque: { a: 0, b: 0.006 }, resto: { a: 0, b: 0.006 } },
    F: { saque: { a: 0, b: 0.006 }, resto: { a: 0, b: 0.006 } },
  },
  medias: {
    M: { todas: MEDIAS_M, dura: MEDIAS_M, tierra: MEDIAS_M, hierba: MEDIAS_M },
    F: { todas: MEDIAS_F, dura: MEDIAS_F, tierra: MEDIAS_F, hierba: MEDIAS_F },
  },
  calibracion: {},
  minPartidosReales: 10,
};

const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export interface EstimacionJugador {
  /** Exceso (prob. por punto) al saque y al resto respecto a la media del pool en la superficie. */
  exSaque: number;
  exResto: number;
  primeros: number;
  ganados1: number;
  ganados2: number;
  aces: number;
  dobles: number;
  acesC: number;
  eloCombinado: number;
  nReal: number;
  nRealSuperficie: number;
  estimado: boolean;
}

/** Contracción jerárquica: superficie → todas las superficies → prior. */
function contraer(
  numS: number,
  denS: number,
  numT: number,
  denT: number,
  priorT: number,
  difSuperficie: number,
  Kt: number,
  Ks: number,
): number {
  const vT = (numT + Kt * priorT) / (denT + Kt);
  const priorS = vT + difSuperficie;
  return (numS + Ks * priorS) / (denS + Ks);
}

export function estimarJugador(p: PerfilMinimo, sup: Superficie, M: ParamsModelo): EstimacionJugador {
  const s = p.stats[sup];
  const t = p.stats.todas;
  const mS = M.medias[p.pool][sup];
  const mT = M.medias[p.pool].todas;
  const elo = ratingCombinado(p.elo, sup, M.pesoSuperficieElo);
  const z = (elo - 1500) / 100;
  const pr = M.prior[p.pool];
  const Ks = M.K.superficie;
  const segundos = (v: VectorStats) => v[I.svpt] - v[I.in1];
  const segundosDentro = (v: VectorStats) => v[I.svpt] - v[I.in1] - v[I.df];
  const nReal = p.nReal.todas;
  return {
    exSaque: contraer(s[I.exS], s[I.svpt], t[I.exS], t[I.svpt], pr.saque.a + pr.saque.b * z, 0, M.K.saque, Ks),
    exResto: contraer(s[I.exR], s[I.rpt], t[I.exR], t[I.rpt], pr.resto.a + pr.resto.b * z, 0, M.K.resto, Ks),
    primeros: contraer(s[I.in1], s[I.svpt], t[I.in1], t[I.svpt], mT.primeros, mS.primeros - mT.primeros, M.K.primeros, Ks),
    ganados1: contraer(s[I.won1], s[I.in1], t[I.won1], t[I.in1], mT.ganados1, mS.ganados1 - mT.ganados1, M.K.ganados1, Ks),
    ganados2: contraer(s[I.won2], segundosDentro(s), t[I.won2], segundosDentro(t), mT.ganados2, mS.ganados2 - mT.ganados2, M.K.ganados2, Ks),
    aces: Math.max(0, contraer(s[I.ace], s[I.svpt], t[I.ace], t[I.svpt], mT.aces, mS.aces - mT.aces, M.K.aces, Ks)),
    dobles: Math.max(0, contraer(s[I.df], segundos(s), t[I.df], segundos(t), mT.dobles, mS.dobles - mT.dobles, M.K.dobles, Ks)),
    acesC: Math.max(0, contraer(s[I.aceC], s[I.rpt], t[I.aceC], t[I.rpt], mT.acesC, mS.acesC - mT.acesC, M.K.acesC, Ks)),
    eloCombinado: elo,
    nReal,
    nRealSuperficie: p.nReal[sup],
    estimado: nReal < M.minPartidosReales,
  };
}

export interface ContextoPartido {
  superficie: Superficie;
  circuito: Circuito;
  formato: FormatoPartido;
  cubierta?: boolean;
}

export interface DetalleModelo {
  estA: EstimacionJugador;
  estB: EstimacionJugador;
  /** P(A gana) según el Elo de superficie (con forma), al mejor de 3. */
  pElo: number;
  /** P(A gana) según las estadísticas de saque/resto, al mejor de 3. */
  pEstadisticas: number;
  /** P(A gana) combinada al mejor de 3 (objetivo del ajuste). */
  pObjetivoBo3: number;
  /** P(A gana) exacta en el formato real (con variabilidad). */
  pFormato: number;
  /** Probabilidad final de ganar un punto al saque. */
  pSaqueA: number;
  pSaqueB: number;
  calibracion: CalibracionGrupo;
}

/** Raíz de f(δ) = objetivo con f creciente: regula falsi (Illinois), converge en pocas iteraciones. */
function resolver(f: (d: number) => number, objetivo: number, lo = -4, hi = 4): number {
  let flo = f(lo) - objetivo;
  let fhi = f(hi) - objetivo;
  if (flo >= 0) return lo;
  if (fhi <= 0) return hi;
  let lado = 0;
  let x = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    x = (lo * fhi - hi * flo) / (fhi - flo);
    const fx = f(x) - objetivo;
    if (Math.abs(fx) < 1e-7 || hi - lo < 1e-9) break;
    if (fx < 0) {
      lo = x;
      flo = fx;
      if (lado === -1) fhi /= 2;
      lado = -1;
    } else {
      hi = x;
      fhi = fx;
      if (lado === 1) flo /= 2;
      lado = 1;
    }
  }
  return x;
}

/** Componentes del saque coherentes con la probabilidad total de ganar el punto. */
export function componentesSaque(
  pTotal: number,
  primeros: number,
  ganados1: number,
  ganados2: number,
  aces: number,
  dobles: number,
  rhoAce2: number,
): ParametrosSaque {
  const f1 = clamp(primeros, 0.35, 0.9);
  const s2 = clamp(1 - dobles, 0.6, 0.995);
  const objetivo = clamp(pTotal, 0.2, 0.95);
  const l1 = logit(clamp(ganados1, 0.3, 0.97));
  const l2 = logit(clamp(ganados2, 0.2, 0.95));
  const total = (t: number) => f1 * sigm(l1 + t) + (1 - f1) * s2 * sigm(l2 + t);
  const t = resolver(total, objetivo, -6, 6);
  const g1 = sigm(l1 + t);
  const g2 = sigm(l2 + t);
  // Aces: a = f1·pAce1 + (1−f1)·s2·rho·pAce1
  let pAce1 = aces / (f1 + (1 - f1) * s2 * rhoAce2);
  pAce1 = clamp(pAce1, 0, g1 * 0.9);
  const pAce2 = clamp(pAce1 * rhoAce2, 0, g2 * 0.9);
  return { pPrimerDentro: f1, pAce1, pGana1: g1, pSegundoDentro: s2, pAce2, pGana2: g2 };
}

export function claveCalibracion(circuito: Circuito, sup: Superficie): string {
  return `${circuito}_${sup}`;
}

/**
 * Parámetros del partido A vs B.
 * 1) Barnett-Clarke: pA = media_sup + exSaque_A − exResto_B (+ calibración).
 * 2) P(victoria) por estadísticas y por Elo (al mejor de 3), combinadas en escala logit.
 * 3) Se desplaza pA/pB (±δ en logit) hasta que la probabilidad exacta al mejor de 3 coincida
 *    con la combinada; ese δ se aplica en el formato real (el mejor de 5 amplifica la ventaja).
 * 4) Se reparten aces, dobles faltas y primeros/segundos de forma coherente con pA/pB.
 */
export function parametrosPartido(
  A: PerfilMinimo,
  B: PerfilMinimo,
  ctx: ContextoPartido,
  M: ParamsModelo,
): { params: ParametrosPartido; detalle: DetalleModelo } {
  const sup = ctx.superficie;
  const pool = A.pool;
  const medias = M.medias[pool][sup];
  const cal = M.calibracion[claveCalibracion(ctx.circuito, sup)] ?? { saque: 0, aces: 1, dobles: 1 };
  const eA = estimarJugador(A, sup, M);
  const eB = estimarJugador(B, sup, M);
  const base = logit(medias.saque) + cal.saque;
  const media = sigm(base);
  let pA = clamp(media + eA.exSaque - eB.exResto, 0.3, 0.92);
  let pB = clamp(media + eB.exSaque - eA.exResto, 0.3, 0.92);
  const bo3 = FORMATOS.BO3_TB7;
  const sigma = cal.sigma ?? M.sigma;
  const sc = M.sigmaComun ?? 0;
  const pEst = probPartidoConVariabilidad(pA, pB, bo3, sigma, sc);
  const formaDif = M.gammaForma * (A.forma - B.forma);
  const pEloBase = probElo(eA.eloCombinado, eB.eloCombinado);
  const pElo = sigm(logit(clamp(pEloBase, 1e-4, 1 - 1e-4)) + formaDif);
  const objetivo = sigm((M.escalaVictoria ?? 1) * (M.pesoElo * logit(pElo) + (1 - M.pesoElo) * logit(clamp(pEst, 1e-4, 1 - 1e-4))));
  const lA = logit(pA);
  const lB = logit(pB);
  const d = resolver((x) => probPartidoConVariabilidad(sigm(lA + x), sigm(lB - x), bo3, sigma, sc), objetivo, -2, 2);
  pA = sigm(lA + d);
  pB = sigm(lB - d);
  const pFormato = ctx.formato.id === bo3.id ? objetivo : probPartidoConVariabilidad(pA, pB, ctx.formato, sigma, sc);

  const multAcesA = medias.acesC > 0 ? eB.acesC / medias.acesC : 1;
  const multAcesB = medias.acesC > 0 ? eA.acesC / medias.acesC : 1;
  const sa = componentesSaque(pA, eA.primeros, eA.ganados1, eA.ganados2, eA.aces * multAcesA * cal.aces, eA.dobles * cal.dobles, M.rhoAce2);
  const sb = componentesSaque(pB, eB.primeros, eB.ganados1, eB.ganados2, eB.aces * multAcesB * cal.aces, eB.dobles * cal.dobles, M.rhoAce2);
  return {
    params: { a: sa, b: sb, sigma, sigmaComun: sc, sigmaAces: M.sigmaAces },
    detalle: { estA: eA, estB: eB, pElo, pEstadisticas: pEst, pObjetivoBo3: objetivo, pFormato, pSaqueA: pA, pSaqueB: pB, calibracion: cal },
  };
}
