/**
 * Agregación de resultados de muchas simulaciones en histogramas (número de veces que sale cada
 * valor). Cada worker agrega sus simulaciones y el hilo principal combina los parciales.
 * A partir de los histogramas se calculan medias, over/under, hándicaps y probabilidades.
 */
import { N_STATS, ST, type GameResult, type SimGameInput } from './types';

export const PLAYER_KEYS = [
  'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg3a', 'ftm', 'fta', 'fg2m', 'fg2a', 'pf', 'pfd', 'min',
  'pra', 'pr', 'pa', 'ra', 'sb',
] as const;
export type PlayerKey = (typeof PLAYER_KEYS)[number];

export const TEAM_KEYS = ['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg3a', 'ftm', 'fta', 'fg2m', 'fg2a', 'pf'] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];

/** Histograma: hist[v] = número de simulaciones con valor v (enteros >= 0). */
export type Hist = number[];

export interface PlayerAgg {
  id: string;
  name: string;
  side: 0 | 1;
  hist: Record<PlayerKey, Hist>;
  sum: Record<PlayerKey, number>;
  doubleDouble: number;
  tripleDouble: number;
  fouledOut: number;
  /** Veces que fue máximo anotador/reboteador/asistente (empates repartidos). */
  topScorer: number;
  topRebounder: number;
  topAssister: number;
  /** Segundos totales (para la media exacta de minutos). */
  secSum: number;
}

export interface SideAgg {
  hist: Record<TeamKey, Hist>;
  sum: Record<TeamKey, number>;
}

export interface QuarterAgg {
  home: Hist;
  away: Hist;
  total: Hist;
  /** margen local - visitante, desplazado por OFFSET */
  margin: Hist;
}

export interface Aggregate {
  n: number;
  homeWins: number;
  awayWins: number;
  overtime: number;
  otCount: Hist;
  scores: Record<string, number>;
  /** Margen final local - visitante, desplazado por MARGIN_OFFSET. */
  margin: Hist;
  totalPts: Hist;
  home: SideAgg;
  away: SideAgg;
  match: SideAgg;
  quarters: QuarterAgg[]; // Q1..Q4
  halves: QuarterAgg[]; // 1.ª y 2.ª parte (tiempo reglamentario)
  /** Mejor cuarto de cada equipo: [equipo][cuarto] (empates repartidos). */
  bestQuarter: [number[], number[]];
  possSum: number;
  players: PlayerAgg[];
  elapsedMs: number;
}

export const MARGIN_OFFSET = 100;
const Q_OFFSET = 60;

function emptyRec<K extends string>(keys: readonly K[]): Record<K, Hist> {
  const o = {} as Record<K, Hist>;
  for (const k of keys) o[k] = [];
  return o;
}
function zeroRec<K extends string>(keys: readonly K[]): Record<K, number> {
  const o = {} as Record<K, number>;
  for (const k of keys) o[k] = 0;
  return o;
}
function emptySide(): SideAgg {
  return { hist: emptyRec(TEAM_KEYS), sum: zeroRec(TEAM_KEYS) };
}
function emptyQ(): QuarterAgg {
  return { home: [], away: [], total: [], margin: [] };
}

export function addToHist(h: Hist, v: number, c = 1) {
  const i = Math.max(0, Math.round(v));
  while (h.length <= i) h.push(0);
  h[i] += c;
}

export function createAggregate(input: SimGameInput): Aggregate {
  const players: PlayerAgg[] = [];
  for (const [side, team] of [
    [0, input.home],
    [1, input.away],
  ] as const) {
    for (const p of team.players) {
      players.push({
        id: p.id,
        name: p.name,
        side,
        hist: emptyRec(PLAYER_KEYS),
        sum: zeroRec(PLAYER_KEYS),
        doubleDouble: 0,
        tripleDouble: 0,
        fouledOut: 0,
        topScorer: 0,
        topRebounder: 0,
        topAssister: 0,
        secSum: 0,
      });
    }
  }
  return {
    n: 0,
    homeWins: 0,
    awayWins: 0,
    overtime: 0,
    otCount: [],
    scores: {},
    margin: [],
    totalPts: [],
    home: emptySide(),
    away: emptySide(),
    match: emptySide(),
    quarters: [emptyQ(), emptyQ(), emptyQ(), emptyQ()],
    halves: [emptyQ(), emptyQ()],
    bestQuarter: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    possSum: 0,
    players,
    elapsedMs: 0,
  };
}

const pv = new Float64Array(PLAYER_KEYS.length);

export function addResult(agg: Aggregate, r: GameResult, input: SimGameInput) {
  agg.n++;
  const hs = r.homePeriods.reduce((a, b) => a + b, 0);
  const as = r.awayPeriods.reduce((a, b) => a + b, 0);
  if (hs > as) agg.homeWins++;
  else agg.awayWins++;
  const nOt = r.homePeriods.length - input.rules.periodos;
  if (nOt > 0) agg.overtime++;
  addToHist(agg.otCount, nOt);
  const key = `${hs}-${as}`;
  agg.scores[key] = (agg.scores[key] ?? 0) + 1;
  addToHist(agg.margin, hs - as + MARGIN_OFFSET);
  addToHist(agg.totalPts, hs + as);
  agg.possSum += (r.possessions[0] + r.possessions[1]) / 2;
  // Cuartos y mitades
  for (let q = 0; q < 4; q++) {
    const h = r.homePeriods[q];
    const a = r.awayPeriods[q];
    const Q = agg.quarters[q];
    addToHist(Q.home, h);
    addToHist(Q.away, a);
    addToHist(Q.total, h + a);
    addToHist(Q.margin, h - a + Q_OFFSET);
  }
  for (let hIdx = 0; hIdx < 2; hIdx++) {
    const h = r.homePeriods[hIdx * 2] + r.homePeriods[hIdx * 2 + 1];
    const a = r.awayPeriods[hIdx * 2] + r.awayPeriods[hIdx * 2 + 1];
    const H = agg.halves[hIdx];
    addToHist(H.home, h);
    addToHist(H.away, a);
    addToHist(H.total, h + a);
    addToHist(H.margin, h - a + Q_OFFSET);
  }
  for (const [t, per] of [
    [0, r.homePeriods],
    [1, r.awayPeriods],
  ] as const) {
    const reg = per.slice(0, 4);
    const mx = Math.max(...reg);
    const ties = reg.filter((x) => x === mx).length;
    for (let q = 0; q < 4; q++) if (reg[q] === mx) agg.bestQuarter[t][q] += 1 / ties;
  }
  // Equipos y jugadores
  const teamTot = [zeroRec(TEAM_KEYS), zeroRec(TEAM_KEYS)];
  let pi = 0;
  let maxPts = -1;
  let maxReb = -1;
  let maxAst = -1;
  const ptsArr: number[] = [];
  const rebArr: number[] = [];
  const astArr: number[] = [];
  const foulLimit = input.rules.faltasEliminacion;
  for (const [t, st, n] of [
    [0, r.homeStats, input.home.players.length],
    [1, r.awayStats, input.away.players.length],
  ] as const) {
    for (let i = 0; i < n; i++, pi++) {
      const o = i * N_STATS;
      const pts = st[o + ST.PTS];
      const oreb = st[o + ST.OREB];
      const dreb = st[o + ST.DREB];
      const reb = oreb + dreb;
      const ast = st[o + ST.AST];
      const stl = st[o + ST.STL];
      const blk = st[o + ST.BLK];
      const sec = st[o + ST.SEC];
      pv[0] = pts;
      pv[1] = reb;
      pv[2] = oreb;
      pv[3] = dreb;
      pv[4] = ast;
      pv[5] = stl;
      pv[6] = blk;
      pv[7] = st[o + ST.TOV];
      pv[8] = st[o + ST.FG3M];
      pv[9] = st[o + ST.FG3A];
      pv[10] = st[o + ST.FTM];
      pv[11] = st[o + ST.FTA];
      pv[12] = st[o + ST.FG2M];
      pv[13] = st[o + ST.FG2A];
      pv[14] = st[o + ST.PF];
      pv[15] = st[o + ST.PFD];
      pv[16] = Math.floor(sec / 60);
      pv[17] = pts + reb + ast;
      pv[18] = pts + reb;
      pv[19] = pts + ast;
      pv[20] = reb + ast;
      pv[21] = stl + blk;
      const P = agg.players[pi];
      for (let k = 0; k < PLAYER_KEYS.length; k++) {
        const key = PLAYER_KEYS[k];
        addToHist(P.hist[key], pv[k]);
        P.sum[key] += pv[k];
      }
      P.secSum += sec;
      const tens = (pts >= 10 ? 1 : 0) + (reb >= 10 ? 1 : 0) + (ast >= 10 ? 1 : 0) + (stl >= 10 ? 1 : 0) + (blk >= 10 ? 1 : 0);
      if (tens >= 2) P.doubleDouble++;
      if (tens >= 3) P.tripleDouble++;
      if (st[o + ST.PF] >= foulLimit) P.fouledOut++;
      const T = teamTot[t];
      T.pts += pts;
      T.reb += reb;
      T.oreb += oreb;
      T.dreb += dreb;
      T.ast += ast;
      T.stl += stl;
      T.blk += blk;
      T.tov += pv[7];
      T.fg3m += pv[8];
      T.fg3a += pv[9];
      T.ftm += pv[10];
      T.fta += pv[11];
      T.fg2m += pv[12];
      T.fg2a += pv[13];
      T.pf += pv[14];
      ptsArr.push(pts);
      rebArr.push(reb);
      astArr.push(ast);
      if (pts > maxPts) maxPts = pts;
      if (reb > maxReb) maxReb = reb;
      if (ast > maxAst) maxAst = ast;
    }
  }
  const credit = (arr: number[], mx: number, field: 'topScorer' | 'topRebounder' | 'topAssister') => {
    let c = 0;
    for (const v of arr) if (v === mx) c++;
    for (let i = 0; i < arr.length; i++) if (arr[i] === mx) agg.players[i][field] += 1 / c;
  };
  credit(ptsArr, maxPts, 'topScorer');
  credit(rebArr, maxReb, 'topRebounder');
  credit(astArr, maxAst, 'topAssister');
  for (const [side, T] of [
    [agg.home, teamTot[0]],
    [agg.away, teamTot[1]],
  ] as const) {
    for (const k of TEAM_KEYS) {
      addToHist(side.hist[k], T[k]);
      side.sum[k] += T[k];
    }
  }
  for (const k of TEAM_KEYS) {
    const v = teamTot[0][k] + teamTot[1][k];
    addToHist(agg.match.hist[k], v);
    agg.match.sum[k] += v;
  }
}

function mergeHist(a: Hist, b: Hist) {
  for (let i = 0; i < b.length; i++) {
    while (a.length <= i) a.push(0);
    a[i] += b[i];
  }
}
function mergeSide(a: SideAgg, b: SideAgg) {
  for (const k of TEAM_KEYS) {
    mergeHist(a.hist[k], b.hist[k]);
    a.sum[k] += b.sum[k];
  }
}
function mergeQ(a: QuarterAgg, b: QuarterAgg) {
  mergeHist(a.home, b.home);
  mergeHist(a.away, b.away);
  mergeHist(a.total, b.total);
  mergeHist(a.margin, b.margin);
}

/** Combina b dentro de a (mismos partidos y jugadores). */
export function mergeAggregate(a: Aggregate, b: Aggregate): Aggregate {
  a.n += b.n;
  a.homeWins += b.homeWins;
  a.awayWins += b.awayWins;
  a.overtime += b.overtime;
  mergeHist(a.otCount, b.otCount);
  for (const [k, v] of Object.entries(b.scores)) a.scores[k] = (a.scores[k] ?? 0) + v;
  mergeHist(a.margin, b.margin);
  mergeHist(a.totalPts, b.totalPts);
  mergeSide(a.home, b.home);
  mergeSide(a.away, b.away);
  mergeSide(a.match, b.match);
  for (let q = 0; q < 4; q++) mergeQ(a.quarters[q], b.quarters[q]);
  for (let h = 0; h < 2; h++) mergeQ(a.halves[h], b.halves[h]);
  for (let t = 0; t < 2; t++) for (let q = 0; q < 4; q++) a.bestQuarter[t][q] += b.bestQuarter[t][q];
  a.possSum += b.possSum;
  a.elapsedMs = Math.max(a.elapsedMs, b.elapsedMs);
  for (let i = 0; i < a.players.length; i++) {
    const A = a.players[i];
    const B = b.players[i];
    for (const k of PLAYER_KEYS) {
      mergeHist(A.hist[k], B.hist[k]);
      A.sum[k] += B.sum[k];
    }
    A.doubleDouble += B.doubleDouble;
    A.tripleDouble += B.tripleDouble;
    A.fouledOut += B.fouledOut;
    A.topScorer += B.topScorer;
    A.topRebounder += B.topRebounder;
    A.topAssister += B.topAssister;
    A.secSum += B.secSum;
  }
  return a;
}

export const QUARTER_MARGIN_OFFSET = Q_OFFSET;
