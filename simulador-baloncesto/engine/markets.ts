/**
 * Cálculos derivados de los histogramas: medias, over/under, hándicaps, márgenes, cuartos,
 * líneas de jugadores. Todo se ordena de mayor a menor frecuencia cuando es una distribución.
 */
import { MARGIN_OFFSET, QUARTER_MARGIN_OFFSET, type Aggregate, type Hist, type PlayerKey, type TeamKey } from './aggregate';

export interface FreqRow {
  label: string;
  count: number;
  pct: number; // 0..1
}

export const histTotal = (h: Hist) => h.reduce((a, b) => a + b, 0);

export function histMean(h: Hist, offset = 0) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < h.length; i++) {
    s += (i - offset) * h[i];
    n += h[i];
  }
  return n ? s / n : 0;
}

export function histSd(h: Hist, offset = 0) {
  const m = histMean(h, offset);
  let s = 0;
  let n = 0;
  for (let i = 0; i < h.length; i++) {
    s += (i - offset - m) ** 2 * h[i];
    n += h[i];
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** Percentil (0..1) del histograma. */
export function histQuantile(h: Hist, q: number, offset = 0) {
  const n = histTotal(h);
  let c = 0;
  for (let i = 0; i < h.length; i++) {
    c += h[i];
    if (c >= q * n) return i - offset;
  }
  return h.length - 1 - offset;
}

/** Número de simulaciones con valor > line (line con decimales .5 para evitar empates). */
export function countOver(h: Hist, line: number, offset = 0) {
  let c = 0;
  for (let i = 0; i < h.length; i++) if (i - offset > line) c += h[i];
  return c;
}
export function countUnder(h: Hist, line: number, offset = 0) {
  let c = 0;
  for (let i = 0; i < h.length; i++) if (i - offset < line) c += h[i];
  return c;
}

export interface OverUnderRow {
  line: number;
  over: number;
  under: number;
  push: number;
  pOver: number;
  pUnder: number;
}

export interface LineOptions {
  /** Paso entre líneas: 0.5 (todas las .0 y .5) o 1 (solo .5). */
  step: 0.5 | 1;
  /** Rango alrededor de la media (en unidades de la estadística). Si es null, se usan las líneas con probabilidad entre minP y 1-minP. */
  range: number | null;
  minP: number;
}

export const DEFAULT_LINES: LineOptions = { step: 1, range: null, minP: 0.01 };

/** Over/under en todas las líneas relevantes. */
export function overUnder(h: Hist, opts: LineOptions = DEFAULT_LINES, offset = 0): OverUnderRow[] {
  const n = histTotal(h);
  if (!n) return [];
  const mean = histMean(h, offset);
  let lo: number;
  let hi: number;
  if (opts.range != null) {
    lo = Math.floor(mean - opts.range);
    hi = Math.ceil(mean + opts.range);
  } else {
    lo = histQuantile(h, opts.minP, offset) - 1;
    hi = histQuantile(h, 1 - opts.minP, offset) + 1;
  }
  const rows: OverUnderRow[] = [];
  for (let x = lo; x <= hi; x += opts.step) {
    const line = opts.step === 1 ? Math.floor(x) + 0.5 : x;
    if (rows.length && rows[rows.length - 1].line === line) continue;
    const over = countOver(h, line, offset);
    const under = countUnder(h, line, offset);
    const push = n - over - under;
    rows.push({ line, over, under, push, pOver: over / n, pUnder: under / n });
  }
  return rows;
}

/** Líneas de jugador 0,5; 1,5; 2,5… hasta que la probabilidad de superar sea menor que minP. */
export function playerLines(h: Hist, minP = 0.005, maxLines = 60): OverUnderRow[] {
  const n = histTotal(h);
  const rows: OverUnderRow[] = [];
  if (!n) return rows;
  for (let line = 0.5; rows.length < maxLines; line += 1) {
    const over = countOver(h, line);
    rows.push({ line, over, under: n - over, push: 0, pOver: over / n, pUnder: (n - over) / n });
    if (over / n < minP) break;
  }
  return rows;
}

export function freqRows(entries: [string, number][], n: number): FreqRow[] {
  return entries
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: count / n }));
}

/** Resultados exactos ordenados de más a menos frecuentes. */
export function exactScores(a: Aggregate): FreqRow[] {
  return freqRows(Object.entries(a.scores), a.n);
}

/** Distribución punto a punto del margen final. */
export function marginPointByPoint(a: Aggregate, homeName: string, awayName: string): FreqRow[] {
  const e: [string, number][] = [];
  a.margin.forEach((c, i) => {
    const m = i - MARGIN_OFFSET;
    if (!c) return;
    e.push([m > 0 ? `${homeName} gana por ${m}` : `${awayName} gana por ${-m}`, c]);
  });
  return freqRows(e, a.n);
}

/** Margen por tramos (1-5, 6-10, …). */
export function marginBuckets(a: Aggregate, homeName: string, awayName: string, width = 5): FreqRow[] {
  const b = new Map<string, number>();
  a.margin.forEach((c, i) => {
    const m = i - MARGIN_OFFSET;
    if (!c || m === 0) return;
    const abs = Math.abs(m);
    const k = Math.floor((abs - 1) / width);
    const lo = k * width + 1;
    const label = k >= 4 ? `${lo}+` : `${lo}-${lo + width - 1}`;
    const name = `${m > 0 ? homeName : awayName} gana por ${label}`;
    b.set(name, (b.get(name) ?? 0) + c);
  });
  return freqRows([...b.entries()], a.n);
}

export interface HandicapRow {
  line: number; // aplicado al equipo (p. ej. -5.5)
  win: number;
  lose: number;
  push: number;
  pWin: number;
}

/** Hándicap de un equipo: gana el hándicap si (margen del equipo + línea) > 0. */
export function handicaps(a: Aggregate, side: 0 | 1, opts: LineOptions = DEFAULT_LINES): HandicapRow[] {
  // margen del equipo = side 0: m ; side 1: -m
  const teamMargin: Hist = [];
  const OFF = MARGIN_OFFSET;
  a.margin.forEach((c, i) => {
    const m = i - OFF;
    const tm = side === 0 ? m : -m;
    const j = tm + OFF;
    while (teamMargin.length <= j) teamMargin.push(0);
    teamMargin[j] += c;
  });
  const ou = overUnder(teamMargin, opts, OFF);
  // P(margen + L > 0) = P(margen > -L)
  return ou
    .map((r) => {
      const L = -r.line;
      const win = r.over;
      const lose = r.under;
      return { line: L, win, lose, push: r.push, pWin: win / a.n };
    })
    .sort((x, y) => x.line - y.line);
}

export interface QuarterSummary {
  label: string;
  homeWin: number;
  awayWin: number;
  tie: number;
  homeMean: number;
  awayMean: number;
  totalMean: number;
}

export function quarterSummary(a: Aggregate): QuarterSummary[] {
  const rows: QuarterSummary[] = [];
  const mk = (label: string, q: Aggregate['quarters'][number]) => {
    let hw = 0;
    let aw = 0;
    let t = 0;
    q.margin.forEach((c, i) => {
      const m = i - QUARTER_MARGIN_OFFSET;
      if (m > 0) hw += c;
      else if (m < 0) aw += c;
      else t += c;
    });
    rows.push({
      label,
      homeWin: hw / a.n,
      awayWin: aw / a.n,
      tie: t / a.n,
      homeMean: histMean(q.home),
      awayMean: histMean(q.away),
      totalMean: histMean(q.total),
    });
  };
  a.quarters.forEach((q, i) => mk(`${i + 1}.º cuarto`, q));
  a.halves.forEach((h, i) => mk(i === 0 ? '1.ª parte' : '2.ª parte (sin prórroga)', h));
  return rows;
}

export function teamMean(a: Aggregate, side: 'home' | 'away' | 'match', k: TeamKey) {
  return a.n ? a[side].sum[k] / a.n : 0;
}

export function playerMean(a: Aggregate, i: number, k: PlayerKey) {
  const p = a.players[i];
  if (!a.n) return 0;
  if (k === 'min') return p.secSum / 60 / a.n;
  return p.sum[k] / a.n;
}

/** Cuota justa (decimal) = 1 / probabilidad. */
export function fairOdds(p: number) {
  return p > 0 ? 1 / p : Infinity;
}
