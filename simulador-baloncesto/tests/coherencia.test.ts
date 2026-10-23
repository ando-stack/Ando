/**
 * Coherencia en cada simulación con los datos reales (si existen los snapshots):
 * suma de jugadores = equipo, cuartos = resultado final, minutos = 5 × duración total,
 * puntos = 2·T2 + 3·T3 + TL, faltas ≤ límite de eliminación, sin empates.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { CompetitionSnapshot } from '../engine/snapshot';
import { buildGameInput, defaultTeamSetup } from '../engine/prepare';
import { simulateGame } from '../engine/simulate';
import { estimateExpectedMargin } from '../engine/run';
import { addResult, createAggregate } from '../engine/aggregate';
import { Rng } from '../engine/rng';
import { DEFAULT_PARAMS, N_STATS, ST } from '../engine/types';
import { REGLAS } from '../config/reglas';

const calib = existsSync('config/calibracion.json') ? JSON.parse(readFileSync('config/calibracion.json', 'utf8')) : {};

for (const comp of ['nba', 'euroleague', 'acb'] as const) {
  const path = `data/snapshot/${comp}.json`;
  describe.skipIf(!existsSync(path))(`coherencia con datos reales (${comp})`, () => {
    it('cumple los invariantes en cada simulación', () => {
      const snap: CompetitionSnapshot = JSON.parse(readFileSync(path, 'utf8'));
      const rules = REGLAS[comp];
      const params = { ...DEFAULT_PARAMS, ...(calib[comp]?.params ?? {}) };
      const rng = new Rng(2026);
      const teams = snap.teams;
      for (let k = 0; k < 4; k++) {
        const h = teams[(k * 7) % teams.length];
        const a = teams[(k * 7 + 3) % teams.length];
        if (h.id === a.id) continue;
        const base = buildGameInput(snap, defaultTeamSetup(snap, h.id), defaultTeamSetup(snap, a.id), params);
        const input = { ...base, expectedMargin: estimateExpectedMargin(base, 30) };
        const agg = createAggregate(input);
        for (let s = 0; s < 150; s++) {
          const r = simulateGame(input, rng);
          addResult(agg, r, input);
          const nOt = r.homePeriods.length - rules.periodos;
          const totalSec = rules.periodos * rules.duracionPeriodo + nOt * rules.duracionProrroga;
          const hs = r.homePeriods.reduce((x, y) => x + y, 0);
          const as = r.awayPeriods.reduce((x, y) => x + y, 0);
          expect(hs).not.toBe(as);
          for (const [st, per] of [
            [r.homeStats, r.homePeriods],
            [r.awayStats, r.awayPeriods],
          ] as const) {
            let pts = 0;
            let sec = 0;
            for (let o = 0; o < st.length; o += N_STATS) {
              pts += st[o + ST.PTS];
              sec += st[o + ST.SEC];
              expect(st[o + ST.PTS]).toBe(2 * st[o + ST.FG2M] + 3 * st[o + ST.FG3M] + st[o + ST.FTM]);
              expect(st[o + ST.PF]).toBeLessThanOrEqual(rules.faltasEliminacion);
            }
            expect(pts).toBe(per.reduce((x, y) => x + y, 0));
            expect(sec).toBeCloseTo(5 * totalSec, 4);
          }
        }
        // Agregado: jugadores = equipo en todas las estadísticas acumuladas
        for (const [side, key] of [
          [0, 'home'],
          [1, 'away'],
        ] as const) {
          const ps = agg.players.filter((p) => p.side === side);
          for (const st of ['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg3a', 'ftm', 'fta', 'fg2m', 'fg2a', 'pf'] as const)
            expect(ps.reduce((x, p) => x + p.sum[st], 0)).toBe(agg[key].sum[st]);
        }
      }
    });
  });
}
