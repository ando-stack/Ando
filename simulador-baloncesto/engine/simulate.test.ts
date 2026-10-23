import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from '../tests/fixture';
import { buildGameInput, defaultTeamSetup, normalizeMinutes } from './prepare';
import { simulateGame } from './simulate';
import { Rng } from './rng';
import { DEFAULT_PARAMS, N_STATS, ST } from './types';
import { REGLAS } from '../config/reglas';

function input(comp: 'nba' | 'euroleague' | 'acb' = 'euroleague') {
  const snap = fixtureSnapshot(comp);
  return buildGameInput(snap, defaultTeamSetup(snap, 'A'), defaultTeamSetup(snap, 'B'), DEFAULT_PARAMS);
}

describe('Rng', () => {
  it('es reproducible con la misma semilla', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('genera uniformes en [0,1) con media ~0,5', () => {
    const r = new Rng(7);
    let s = 0;
    for (let i = 0; i < 20000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      s += x;
    }
    expect(s / 20000).toBeCloseTo(0.5, 1);
  });
});

describe('normalizeMinutes', () => {
  it('reparte exactamente 5 × duración reglamentaria', () => {
    const out = normalizeMinutes(
      [10, 20, 30, 40, 35, 25, 15, 5].map((m, i) => ({ id: String(i), minutes: m, starter: i < 5 })),
      40,
    );
    expect(out.reduce((a, p) => a + p.minutes, 0)).toBeCloseTo(200, 5);
    for (const p of out) expect(p.minutes).toBeLessThanOrEqual(40);
  });
});

for (const comp of ['euroleague', 'nba'] as const) {
  describe(`simulateGame (${comp})`, () => {
    const inp = input(comp);
    const rules = REGLAS[comp];
    it('es coherente en cada simulación', () => {
      const rng = new Rng(99);
      let ot = 0;
      for (let k = 0; k < 400; k++) {
        const r = simulateGame(inp, rng);
        const hs = r.homePeriods.reduce((a, b) => a + b, 0);
        const as = r.awayPeriods.reduce((a, b) => a + b, 0);
        // nunca termina en empate y hay prórrogas solo si hacía falta
        expect(hs).not.toBe(as);
        expect(r.homePeriods.length).toBe(r.awayPeriods.length);
        const nOt = r.homePeriods.length - rules.periodos;
        expect(nOt).toBeGreaterThanOrEqual(0);
        if (nOt > 0) {
          ot++;
          const regH = r.homePeriods.slice(0, 4).reduce((a, b) => a + b, 0);
          const regA = r.awayPeriods.slice(0, 4).reduce((a, b) => a + b, 0);
          expect(regH).toBe(regA);
        }
        const totalSec = rules.periodos * rules.duracionPeriodo + nOt * rules.duracionProrroga;
        for (const [st, periods] of [
          [r.homeStats, r.homePeriods],
          [r.awayStats, r.awayPeriods],
        ] as const) {
          let sec = 0;
          let pts = 0;
          for (let o = 0; o < st.length; o += N_STATS) {
            sec += st[o + ST.SEC];
            pts += st[o + ST.PTS];
            // puntos del jugador = 2·T2 + 3·T3 + TL
            expect(st[o + ST.PTS]).toBe(2 * st[o + ST.FG2M] + 3 * st[o + ST.FG3M] + st[o + ST.FTM]);
            expect(st[o + ST.FG2M]).toBeLessThanOrEqual(st[o + ST.FG2A]);
            expect(st[o + ST.FG3M]).toBeLessThanOrEqual(st[o + ST.FG3A]);
            expect(st[o + ST.FTM]).toBeLessThanOrEqual(st[o + ST.FTA]);
            expect(st[o + ST.PF]).toBeLessThanOrEqual(rules.faltasEliminacion);
          }
          // los cuartos suman el resultado final, y los jugadores suman el equipo
          expect(pts).toBe(periods.reduce((a, b) => a + b, 0));
          // 5 jugadores en pista en todo momento
          expect(sec).toBeCloseTo(5 * totalSec, 4);
        }
      }
      expect(ot).toBeLessThan(400);
    });
    it('produce cifras plausibles', () => {
      const rng = new Rng(5);
      let pts = 0;
      let poss = 0;
      for (let k = 0; k < 300; k++) {
        const r = simulateGame(inp, rng);
        pts += r.homePeriods.reduce((a, b) => a + b, 0);
        poss += r.possessions[0];
      }
      expect(pts / 300).toBeGreaterThan(60);
      expect(pts / 300).toBeLessThan(140);
      expect(poss / 300).toBeGreaterThan(60);
    });
    it('respeta la eliminación por faltas', () => {
      const rng = new Rng(11);
      const foulInp = { ...inp, params: { ...inp.params, nonShootingFoulRate: 0.4 } };
      let fouledOut = 0;
      for (let k = 0; k < 100; k++) {
        const r = simulateGame(foulInp, rng);
        for (const st of [r.homeStats, r.awayStats])
          for (let o = 0; o < st.length; o += N_STATS) {
            expect(st[o + ST.PF]).toBeLessThanOrEqual(rules.faltasEliminacion);
            if (st[o + ST.PF] === rules.faltasEliminacion) fouledOut++;
          }
      }
      expect(fouledOut).toBeGreaterThan(0);
    });
  });
}
