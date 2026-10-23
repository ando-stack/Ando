/** Snapshot sintético mínimo para los tests (no son datos reales: solo sirven para probar el motor). */
import type { CompetitionSnapshot, Counting, PlayerSnapshot, TeamSeasonStats } from '../engine/snapshot';
import type { CompetitionId } from '../engine/datatypes';

const c = (o: Partial<Counting>): Counting => ({
  min: 1, pts: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pfd: 0, ...o,
});

function team(id: string): TeamSeasonStats {
  const own = c({ min: 200, pts: 85, fg2m: 21, fg2a: 38, fg3m: 9.5, fg3a: 27, ftm: 15, fta: 20, oreb: 9.5, dreb: 22, ast: 19, stl: 6.5, blk: 2.6, tov: 12, pf: 21, pfd: 21 });
  return {
    gp: 10, w: 5, l: 5, poss: 76, own, opp: { ...own }, ortg: 112, drtg: 112, orebPct: 0.3, drebPct: 0.7, tovPct: 0.157, oppTovPct: 0.157,
    astPerFgm: 0.62, stlPerOppPoss: 0.085, blkPerOppFg2a: 0.07, fg2Pct: 0.55, fg3Pct: 0.35, ftPct: 0.77, oppFg2Pct: 0.55, oppFg3Pct: 0.35,
    fg3aShare: 0.41, oppFg3aShare: 0.41, ftaPerFga: 0.31, oppFtaPerFga: 0.31, pfPerGame: 21,
  };
  void id;
}

function player(id: string, teamId: string, k: number): PlayerSnapshot {
  const scale = 1 - k * 0.05;
  const perMin = c({ pts: 0.4 * scale, fg2m: 0.1, fg2a: 0.18 * scale, fg3m: 0.045, fg3a: 0.13 * scale, ftm: 0.07, fta: 0.1, oreb: 0.045 + (k % 3) * 0.01, dreb: 0.1, ast: 0.09, stl: 0.03, blk: 0.012, tov: 0.06, pf: 0.1, pfd: 0.1 });
  return {
    id, teamId, name: `Jugador ${id}`, position: k % 3 === 0 ? 'C' : k % 3 === 1 ? 'G' : 'F', gp: 10, gs: k < 5 ? 10 : 0, mpg: 30 - k * 2, gpPrev: 0, mpgPrev: 0,
    totals: c({}), totalsPrev: c({}), per36or40: perMin,
    rates: { perMin, fg2Pct: 0.55, fg3Pct: 0.35, ftPct: 0.77, usage: 0.2 },
    quarterShare: k < 5 ? [0.27, 0.23, 0.27, 0.23] : [0.22, 0.28, 0.22, 0.28], quarterShareSource: 'estimado',
    recentMinutes: [], recentStarts: k < 5 ? 5 : 0, estimated: true,
  };
}

export function fixtureSnapshot(comp: CompetitionId = 'euroleague'): CompetitionSnapshot {
  const reg = comp === 'nba' ? 240 : 200;
  const teams = ['A', 'B'].map((id) => ({
    id, name: `Equipo ${id}`, short: id, current: team(id), previous: null, blended: team(id),
    blendWeights: { gpCurrent: 10, previousWeight: 0.4 }, quarters: { for: [21, 21, 21, 22], against: [21, 21, 21, 22] },
    home: { gp: 5, w: 3, ptsFor: 86, ptsAgainst: 83 }, away: { gp: 5, w: 2, ptsFor: 83, ptsAgainst: 86 },
  }));
  const players: PlayerSnapshot[] = [];
  for (const t of teams) for (let k = 0; k < 11; k++) players.push(player(`${t.id}${k}`, t.id, k));
  const mins = [30, 29, 28, 27, 26, 18, 16, 14, 8, 4, 0];
  const sum = mins.reduce((a, b) => a + b, 0);
  return {
    comp, season: '2026-27', previousSeason: '2025-26', generatedAt: '2026-10-23T00:00:00Z', lastGameDate: null, sources: [],
    league: {
      gamesCurrent: 10, gamesPrevious: 0,
      perTeamGame: { ...team('L').own, poss: 76 },
      homeMargin: 3, marginSd: 12, homeWinPct: 0.6, otPct: 0.04, fg2Pct: 0.55, fg3Pct: 0.35, ftPct: 0.77, orebPct: 0.3, tovPct: 0.157,
      astPerFgm: 0.62, stlPerPoss: 0.085, blkPerFg2a: 0.07,
      byPosition: Object.fromEntries(['G', 'F', 'C', 'ALL'].map((k) => [k, { perMin: player('x', 'A', 3).rates.perMin, fg2Pct: 0.55, fg3Pct: 0.35, ftPct: 0.77, usage: 0.2 }])) as any,
      quarterShareStarters: [0.27, 0.23, 0.27, 0.23], quarterShareBench: [0.22, 0.28, 0.22, 0.28],
    },
    teams, players,
    lineups: teams.map((t) => ({ teamId: t.id, starters: [0, 1, 2, 3, 4].map((k) => `${t.id}${k}`), status: 'probable' as const, basis: 'test', source: 'test', updatedAt: '' })),
    rotations: teams.map((t) => ({
      teamId: t.id, basis: 'test', updatedAt: '',
      players: mins.map((m, k) => ({ playerId: `${t.id}${k}`, minutes: (m * reg) / sum * 5 / 1, role: (k < 5 ? 'titular' : 'rotacion') as 'titular' | 'rotacion' })),
    })),
    injuries: [], notes: [],
  };
}
