/**
 * Calibración del motor por competición.
 *   npx tsx engine/calibrate.ts [nba|euroleague|acb|all]
 *
 * Simula todos los cruces posibles entre equipos (con su rotación por defecto) y ajusta los
 * factores globales del motor para que las medias simuladas de ritmo, puntos, porcentajes,
 * rebotes, asistencias, robos, tapones, pérdidas, faltas, tiros libres y ventaja de campo
 * coincidan con las medias reales de la competición. Guarda el resultado en config/calibracion.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { CompetitionSnapshot } from './snapshot';
import type { CompetitionId } from './datatypes';
import { buildGameInput, defaultTeamSetup, type TeamSetup } from './prepare';
import { DEFAULT_PARAMS, N_STATS, ST, type SimParams } from './types';
import { simulateGame } from './simulate';
import { estimateExpectedMargin } from './run';
import { Rng } from './rng';

export interface SimLeagueStats {
  games: number;
  poss: number;
  pts: number;
  fg2a: number;
  fg2m: number;
  fg3a: number;
  fg3m: number;
  fta: number;
  ftm: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  homeMargin: number;
  homeWinPct: number;
  otPct: number;
  marginSd: number;
}

export function simulateLeague(snap: CompetitionSnapshot, params: SimParams, perPair: number, seed: number): SimLeagueStats {
  const rng = new Rng(seed);
  const setups = new Map<string, TeamSetup>();
  for (const t of snap.teams) setups.set(t.id, defaultTeamSetup(snap, t.id));
  const acc: SimLeagueStats = {
    games: 0, poss: 0, pts: 0, fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    homeMargin: 0, homeWinPct: 0, otPct: 0, marginSd: 0,
  };
  let m2 = 0;
  for (const h of snap.teams) {
    for (const a of snap.teams) {
      if (h.id === a.id) continue;
      const base = buildGameInput(snap, setups.get(h.id)!, setups.get(a.id)!, params);
      const input = { ...base, expectedMargin: estimateExpectedMargin(base, 40) };
      for (let k = 0; k < perPair; k++) {
        const r = simulateGame(input, rng);
        acc.games++;
        acc.poss += r.possessions[0] + r.possessions[1];
        for (const st of [r.homeStats, r.awayStats]) {
          for (let o = 0; o < st.length; o += N_STATS) {
            acc.pts += st[o + ST.PTS];
            acc.fg2a += st[o + ST.FG2A];
            acc.fg2m += st[o + ST.FG2M];
            acc.fg3a += st[o + ST.FG3A];
            acc.fg3m += st[o + ST.FG3M];
            acc.fta += st[o + ST.FTA];
            acc.ftm += st[o + ST.FTM];
            acc.oreb += st[o + ST.OREB];
            acc.dreb += st[o + ST.DREB];
            acc.ast += st[o + ST.AST];
            acc.stl += st[o + ST.STL];
            acc.blk += st[o + ST.BLK];
            acc.tov += st[o + ST.TOV];
            acc.pf += st[o + ST.PF];
          }
        }
        const hs = r.homePeriods.reduce((x, y) => x + y, 0);
        const as = r.awayPeriods.reduce((x, y) => x + y, 0);
        acc.homeMargin += hs - as;
        m2 += (hs - as) ** 2;
        if (hs > as) acc.homeWinPct++;
        if (r.homePeriods.length > 4) acc.otPct++;
      }
    }
  }
  const tg = acc.games * 2; // partidos-equipo
  const out = { ...acc };
  for (const k of ['poss', 'pts', 'fg2a', 'fg2m', 'fg3a', 'fg3m', 'fta', 'ftm', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf'] as const)
    out[k] = acc[k] / tg;
  out.homeMargin = acc.homeMargin / acc.games;
  out.homeWinPct = acc.homeWinPct / acc.games;
  out.otPct = acc.otPct / acc.games;
  out.marginSd = Math.sqrt(Math.max(0, m2 / acc.games - out.homeMargin ** 2));
  return out;
}

export function targetsOf(snap: CompetitionSnapshot) {
  const L = snap.league.perTeamGame;
  return {
    poss: L.poss,
    pts: L.pts,
    fg2a: L.fg2a,
    fg2m: L.fg2m,
    fg3a: L.fg3a,
    fg3m: L.fg3m,
    fta: L.fta,
    ftm: L.ftm,
    oreb: L.oreb,
    dreb: L.dreb,
    ast: L.ast,
    stl: L.stl,
    blk: L.blk,
    tov: L.tov,
    pf: L.pf,
    homeMargin: snap.league.homeMargin,
    homeWinPct: snap.league.homeWinPct,
    otPct: snap.league.otPct,
    marginSd: snap.league.marginSd,
  };
}

const odds = (p: number) => p / (1 - p);
const clampF = (x: number, lo = 0.5, hi = 2) => Math.min(hi, Math.max(lo, x));

export function calibrate(
  snap: CompetitionSnapshot,
  iterations = 8,
  perPair?: number,
  opts: { start?: SimParams; quiet?: boolean; skipFinal?: boolean } = {},
) {
  const T = targetsOf(snap);
  const nTeams = snap.teams.length;
  const pp = perPair ?? Math.max(2, Math.round(2500 / (nTeams * (nTeams - 1))));
  let p: SimParams = { ...DEFAULT_PARAMS, ...(opts.start ?? {}) };
  let S = simulateLeague(snap, p, pp, 1);
  for (let it = 0; it < iterations; it++) {
    const damp = it < 2 ? 1 : 0.7;
    const f = (x: number) => Math.pow(x, damp);
    const q = { ...p };
    q.paceFactor *= f(T.poss / S.poss);
    q.fg2Factor *= f(T.fg2m / T.fg2a / (S.fg2m / S.fg2a));
    q.fg3Factor *= f(T.fg3m / T.fg3a / (S.fg3m / S.fg3a));
    q.ftFactor *= f(T.ftm / T.fta / (S.ftm / S.fta));
    q.tovFactor *= f(T.tov / T.poss / (S.tov / S.poss));
    q.tripFactor *= f(T.fta / T.poss / (S.fta / S.poss));
    const tOreb = T.oreb / (T.oreb + T.dreb);
    const sOreb = S.oreb / (S.oreb + S.dreb);
    q.orebFactor *= f(odds(tOreb) / odds(sOreb));
    // Rebotes de jugador: (1 - rebote de equipo) proporcional al total real / simulado
    const keep = (1 - p.teamReboundShare) * f((T.oreb + T.dreb) / (S.oreb + S.dreb));
    q.teamReboundShare = Math.min(0.3, Math.max(0, 1 - keep));
    q.astFactor *= f(T.ast / (T.fg2m + T.fg3m) / (S.ast / (S.fg2m + S.fg3m)));
    q.stlFactor *= f(T.stl / T.tov / (S.stl / S.tov));
    q.blkFactor *= f(T.blk / (T.fg2a - T.fg2m) / (S.blk / (S.fg2a - S.fg2m)));
    q.nonShootingFoulRate *= f(clampF(Math.pow(T.pf / S.pf, 2), 0.3, 3));
    q.homeShootingEdge += (T.homeMargin - S.homeMargin) / Math.max(T.pts, 1) * 0.8;
    // Dispersión del margen: el efecto marcador la reduce
    q.scoreEffect = Math.min(0.15, Math.max(0, p.scoreEffect + 0.08 * (S.marginSd / T.marginSd - 1) * (it < 2 ? 1.5 : 1)));
    // límites razonables
    for (const k of ['paceFactor', 'fg2Factor', 'fg3Factor', 'ftFactor', 'tovFactor', 'tripFactor', 'orebFactor', 'astFactor', 'stlFactor', 'blkFactor'] as const)
      q[k] = clampF(q[k], 0.4, 2.5);
    q.nonShootingFoulRate = Math.min(0.3, Math.max(0.001, q.nonShootingFoulRate));
    q.homeShootingEdge = Math.min(0.12, Math.max(-0.05, q.homeShootingEdge));
    p = q;
    S = simulateLeague(snap, p, pp, 100 + it);
    if (!opts.quiet) console.log(
      `  it ${it + 1}: poss ${S.poss.toFixed(1)}/${T.poss.toFixed(1)} pts ${S.pts.toFixed(1)}/${T.pts.toFixed(1)} pf ${S.pf.toFixed(1)}/${T.pf.toFixed(1)} fta ${S.fta.toFixed(1)}/${T.fta.toFixed(1)} oreb ${S.oreb.toFixed(1)}/${T.oreb.toFixed(1)} margin ${S.homeMargin.toFixed(2)}/${T.homeMargin.toFixed(2)} sd ${S.marginSd.toFixed(2)}/${T.marginSd.toFixed(2)} ot ${S.otPct.toFixed(3)}/${T.otPct.toFixed(3)}`,
    );
  }
  // Verificación final con más partidos
  const final = opts.skipFinal ? S : simulateLeague(snap, p, pp * 2, 999);
  return { params: p, targets: T, simulated: final, perPair: pp };
}

function round(o: Record<string, number>, d = 4) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10 ** d) / 10 ** d]));
}

if (process.argv[1]?.endsWith('calibrate.ts')) {
  const arg = process.argv[2] ?? 'all';
  const comps: CompetitionId[] = arg === 'all' ? ['nba', 'euroleague', 'acb'] : [arg as CompetitionId];
  const path = 'config/calibracion.json';
  const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  for (const c of comps) {
    const f = `data/snapshot/${c}.json`;
    if (!existsSync(f)) {
      console.log(`Sin snapshot de ${c}, se omite`);
      continue;
    }
    const snap: CompetitionSnapshot = JSON.parse(readFileSync(f, 'utf8'));
    console.log(`Calibrando ${c} (${snap.teams.length} equipos)…`);
    const r = calibrate(snap);
    all[c] = {
      calibratedAt: new Date().toISOString(),
      snapshotGeneratedAt: snap.generatedAt,
      params: round(r.params as unknown as Record<string, number>),
      targets: round(r.targets, 3),
      simulated: round(r.simulated as unknown as Record<string, number>, 3),
    };
    writeFileSync(path, JSON.stringify(all, null, 2));
  }
}
