/**
 * Convierte los datos del snapshot y la configuración elegida por el usuario (titulares,
 * minutos, bajas) en la entrada del motor.
 */
import type { CompetitionSnapshot, PlayerSnapshot, TeamSnapshot } from './snapshot';
import type { SimGameInput, SimParams, SimPlayer, SimTeam } from './types';
import { DEFAULT_PARAMS } from './types';
import { REGLAS, regulationSeconds } from '../config/reglas';

export interface TeamSetupPlayer {
  id: string;
  minutes: number;
  starter: boolean;
}

export interface TeamSetup {
  teamId: string;
  players: TeamSetupPlayer[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const div = (a: number, b: number, d = 0) => (b > 0 ? a / b : d);

/** Bajas por defecto: confirmadas o ausencias recientes. */
export function defaultOut(snap: CompetitionSnapshot, teamId: string): Set<string> {
  return new Set(
    snap.injuries
      .filter((i) => i.teamId === teamId && (i.status === 'baja' || i.status === 'ausente-reciente'))
      .map((i) => i.playerId!)
      .filter(Boolean),
  );
}

/** Configuración por defecto: quinteto probable y rotación habitual. */
export function defaultTeamSetup(snap: CompetitionSnapshot, teamId: string): TeamSetup {
  const rot = snap.rotations.find((r) => r.teamId === teamId);
  const lu = snap.lineups.find((l) => l.teamId === teamId);
  const starters = new Set(lu?.starters ?? []);
  return {
    teamId,
    players: (rot?.players ?? []).map((p) => ({ id: p.playerId, minutes: p.minutes, starter: starters.has(p.playerId) })),
  };
}

/** Escala los minutos para que sumen 5 × duración reglamentaria, sin superar el máximo por jugador. */
export function normalizeMinutes(players: TeamSetupPlayer[], regMin: number): TeamSetupPlayer[] {
  const active = players.filter((p) => p.minutes > 0 || p.starter);
  const out = players.map((p) => ({ ...p, minutes: p.starter && p.minutes <= 0 ? 10 : Math.max(0, p.minutes) }));
  const target = 5 * regMin;
  const cap = regMin * 0.98;
  for (let iter = 0; iter < 10; iter++) {
    const free = out.filter((p) => p.minutes > 0 && p.minutes < cap);
    const fixed = out.filter((p) => p.minutes >= cap).reduce((a, p) => a + cap, 0);
    const sumFree = free.reduce((a, p) => a + p.minutes, 0);
    if (sumFree <= 0) break;
    const k = (target - fixed) / sumFree;
    for (const p of free) p.minutes = Math.min(cap, p.minutes * k);
    const total = out.reduce((a, p) => a + Math.min(cap, p.minutes), 0);
    if (Math.abs(total - target) < 0.01) break;
  }
  for (const p of out) p.minutes = Math.min(cap, p.minutes);
  void active;
  return out;
}

export function buildSimPlayer(p: PlayerSnapshot, minutes: number, starter: boolean, params: SimParams): SimPlayer {
  const r = p.rates.perMin;
  const fgm = r.fg2m + r.fg3m;
  const ftPerTrip = 2 + params.threeShotTripShare;
  const trips = Math.max(0, r.fta - params.andOneRate * fgm) / ftPerTrip;
  const used = r.fg2a + r.fg3a + trips + r.tov;
  const u = used > 0 ? used : 1e-6;
  const q = p.quarterShare;
  const qs = q.reduce((a, b) => a + b, 0) || 1;
  return {
    id: p.id,
    name: p.name,
    minutes,
    qShare: [q[0] / qs, q[1] / qs, q[2] / qs, q[3] / qs],
    starter,
    usage: Math.max(used, 0.02),
    pTov: r.tov / u,
    pTrip: trips / u,
    p2: r.fg2a / u,
    p3: r.fg3a / u,
    fg2: clamp(p.rates.fg2Pct, 0.2, 0.8),
    fg3: clamp(p.rates.fg3Pct, 0.05, 0.6),
    ft: clamp(p.rates.ftPct, 0.3, 0.98),
    oreb: Math.max(r.oreb, 0.001),
    dreb: Math.max(r.dreb, 0.001),
    ast: Math.max(r.ast, 0.001),
    stl: Math.max(r.stl, 0.001),
    blk: Math.max(r.blk, 0.0005),
    pf: Math.max(r.pf, 0.005),
    pfd: Math.max(r.pfd, 0.005),
  };
}

export function buildSimTeam(snap: CompetitionSnapshot, setup: TeamSetup, params: SimParams): SimTeam {
  const rules = REGLAS[snap.comp];
  const regMin = regulationSeconds(rules) / 60;
  const team = snap.teams.find((t) => t.id === setup.teamId) as TeamSnapshot;
  if (!team) throw new Error(`Equipo ${setup.teamId} no encontrado`);
  const L = snap.league;
  const b = team.blended;
  const norm = normalizeMinutes(setup.players, regMin);
  const players: SimPlayer[] = [];
  for (const sp of norm) {
    if (sp.minutes <= 0 && !sp.starter) continue;
    const p = snap.players.find((x) => x.id === sp.id);
    if (!p) continue;
    players.push(buildSimPlayer(p, sp.minutes, sp.starter, params));
  }
  const avg = { oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, pf: 0 };
  for (const p of players) {
    const f = p.minutes / regMin;
    avg.oreb += p.oreb * f;
    avg.dreb += p.dreb * f;
    avg.ast += p.ast * f;
    avg.stl += p.stl * f;
    avg.blk += p.blk * f;
    avg.pf += p.pf * f;
  }
  const lgFga = L.perTeamGame.fg2a + L.perTeamGame.fg3a;
  const lgThreeShare = div(L.perTeamGame.fg3a, lgFga, 0.35);
  const lgFtaPerFga = div(L.perTeamGame.fta, lgFga, 0.25);
  // Multiplicadores defensivos (lo que concede respecto a la media), ligeramente regularizados.
  const shrink = (x: number, k = 0.8) => 1 + (x - 1) * k;
  const fgm = b.own.fg2m + b.own.fg3m;
  return {
    id: team.id,
    name: team.name,
    short: team.short,
    players,
    pace: b.poss,
    orebPct: b.orebPct,
    drebPct: b.drebPct,
    astPerFgm: b.astPerFgm || L.astPerFgm,
    fg3mShare: div(b.own.fg3m, fgm, 0.35),
    defFg2: shrink(div(b.oppFg2Pct, L.fg2Pct, 1), 1),
    defFg3: shrink(div(b.oppFg3Pct, L.fg3Pct, 1), 0.6),
    defTov: shrink(div(b.oppTovPct, L.tovPct, 1), 1),
    defTrip: shrink(div(b.oppFtaPerFga, lgFtaPerFga, 1), 1),
    defThreeShare: shrink(div(b.oppFg3aShare, lgThreeShare, 1), 1),
    stealShare: clamp(div(b.own.stl, b.opp.tov, 0.5), 0.2, 0.85),
    blockPerMiss2: clamp(div(b.own.blk, b.opp.fg2a - b.opp.fg2m, 0.08), 0.01, 0.3),
    avgOnCourt: avg,
  };
}

export function buildGameInput(
  snap: CompetitionSnapshot,
  home: TeamSetup,
  away: TeamSetup,
  params: SimParams = DEFAULT_PARAMS,
): SimGameInput {
  return {
    comp: snap.comp,
    rules: REGLAS[snap.comp],
    params,
    leaguePace: snap.league.perTeamGame.poss,
    home: buildSimTeam(snap, home, params),
    away: buildSimTeam(snap, away, params),
  };
}
