import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from '../tests/fixture';
import { buildGameInput, defaultTeamSetup } from './prepare';
import { runSimulations } from './run';
import { mergeAggregate, MARGIN_OFFSET } from './aggregate';
import { DEFAULT_PARAMS } from './types';
import { exactScores, handicaps, histTotal, marginBuckets, overUnder, playerLines, quarterSummary } from './markets';

const snap = fixtureSnapshot();
const inp = buildGameInput(snap, defaultTeamSetup(snap, 'A'), defaultTeamSetup(snap, 'B'), DEFAULT_PARAMS);

describe('agregación', () => {
  const agg = runSimulations(inp, 1500, 3);
  it('cuenta todas las simulaciones en cada histograma', () => {
    expect(agg.n).toBe(1500);
    expect(agg.homeWins + agg.awayWins).toBe(1500);
    expect(histTotal(agg.totalPts)).toBe(1500);
    expect(histTotal(agg.margin)).toBe(1500);
    for (const q of agg.quarters) expect(histTotal(q.total)).toBe(1500);
    for (const p of agg.players) expect(histTotal(p.hist.pts)).toBe(1500);
    expect(Object.values(agg.scores).reduce((a, b) => a + b, 0)).toBe(1500);
  });
  it('las sumas de jugadores coinciden con las de equipo', () => {
    for (const [side, key] of [
      [0, 'home'],
      [1, 'away'],
    ] as const) {
      for (const k of ['pts', 'ast', 'stl', 'blk', 'tov', 'pf', 'fg3m', 'fta'] as const) {
        const s = agg.players.filter((p) => p.side === side).reduce((a, p) => a + p.sum[k], 0);
        expect(s).toBe(agg[key].sum[k]);
      }
      const reb = agg.players.filter((p) => p.side === side).reduce((a, p) => a + p.sum.reb, 0);
      expect(reb).toBe(agg[key].sum.reb);
    }
  });
  it('los líderes reparten exactamente una unidad por simulación', () => {
    const s = agg.players.reduce((a, p) => a + p.topScorer, 0);
    expect(s).toBeCloseTo(1500, 6);
  });
  it('combinar dos ejecuciones equivale a sumar sus histogramas', () => {
    const a = runSimulations(inp, 300, 10);
    const b = runSimulations(inp, 200, 20);
    const ha = [...a.totalPts];
    const hb = [...b.totalPts];
    const m = mergeAggregate(a, b);
    expect(m.n).toBe(500);
    for (let i = 0; i < Math.max(ha.length, hb.length); i++) expect(m.totalPts[i] ?? 0).toBe((ha[i] ?? 0) + (hb[i] ?? 0));
  });
  it('misma semilla, mismo resultado', () => {
    const a = runSimulations(inp, 200, 77);
    const b = runSimulations(inp, 200, 77);
    expect(a.scores).toEqual(b.scores);
  });
});

describe('mercados', () => {
  const agg = runSimulations(inp, 1000, 8);
  it('over + under + push = n', () => {
    for (const r of overUnder(agg.totalPts)) expect(r.over + r.under + r.push).toBe(agg.n);
    for (const r of overUnder(agg.totalPts, { step: 0.5, range: 10, minP: 0 })) expect(r.over + r.under + r.push).toBe(agg.n);
  });
  it('resultados exactos ordenados de mayor a menor', () => {
    const rows = exactScores(agg);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].count).toBeGreaterThanOrEqual(rows[i].count);
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(agg.n);
  });
  it('tramos de margen suman n', () => {
    expect(marginBuckets(agg, 'A', 'B').reduce((a, r) => a + r.count, 0)).toBe(agg.n);
  });
  it('hándicaps complementarios entre equipos', () => {
    const h = handicaps(agg, 0);
    const a = handicaps(agg, 1);
    for (const r of h) {
      const opp = a.find((x) => x.line === -r.line);
      if (opp) expect(r.win).toBe(opp.lose);
    }
  });
  it('líneas de jugador decrecientes', () => {
    const rows = playerLines(agg.players[0].hist.pts);
    for (let i = 1; i < rows.length; i++) expect(rows[i].pOver).toBeLessThanOrEqual(rows[i - 1].pOver);
  });
  it('cuartos: local + visitante + empate = 1', () => {
    for (const q of quarterSummary(agg)) expect(q.homeWin + q.awayWin + q.tie).toBeCloseTo(1, 9);
  });
  it('margen centrado razonablemente', () => {
    let s = 0;
    agg.margin.forEach((c, i) => (s += (i - MARGIN_OFFSET) * c));
    expect(Math.abs(s / agg.n)).toBeLessThan(15);
  });
});
