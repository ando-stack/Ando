/**
 * Validación (backtest) sobre la temporada pasada de cada competición.
 *   npx tsx engine/backtest.ts [nba|euroleague|acb|all] [--sims 1000]
 *
 * Para cada partido de la temporada 2025-26 se construye un snapshot SOLO con los partidos
 * anteriores a su fecha (estadísticas, minutos, patrón por cuartos) y se simula el partido.
 * Supuestos (documentados en docs/validacion.md):
 *  - Se evalúan los partidos en los que ambos equipos llevan al menos MIN_PRIOR partidos.
 *  - Jugadores disponibles = los que jugaron el partido (aproxima el parte de bajas previo);
 *    titulares = los reales (los quintetos se confirman antes del salto inicial);
 *    minutos = previsión con los partidos anteriores (no los minutos reales).
 *  - Los factores globales de calibración son los de config/calibracion.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { CompetitionId, GameRecord, PlayerInfo, SeasonGamesFile } from './datatypes';
import { PL } from './datatypes';
import { buildCompetitionSnapshot, newTeamAccum, type PreviousAccum } from '../ingest/build';
import { buildGameInput, type TeamSetup } from './prepare';
import { runSimulations } from './run';
import { DEFAULT_PARAMS, type SimParams } from './types';
import { countOver, histMean, histQuantile } from './markets';
import { MARGIN_OFFSET } from './aggregate';
import { calibrate } from './calibrate';
import { PREVIOUS_SEASON, BACKTEST_PRIOR_SEASON } from '../config/temporadas';
import type { CompetitionSnapshot } from './snapshot';

const MIN_PRIOR = 5;

interface Pair {
  p: number;
  y: number;
}

export interface BacktestResult {
  comp: CompetitionId;
  season: string;
  games: number;
  simsPerGame: number;
  winnerAccuracy: number;
  brier: number;
  logLoss: number;
  homeBaselineAccuracy: number;
  recordBaselineAccuracy: number;
  totalMAE: number;
  totalBias: number;
  marginMAE: number;
  marginBias: number;
  /** Cobertura de los intervalos centrales del 50 % y 80 % del total y del margen. */
  totalCoverage50: number;
  totalCoverage80: number;
  marginCoverage50: number;
  marginCoverage80: number;
  otPredicted: number;
  otActual: number;
  playerPtsMAE: number;
  playerRebMAE: number;
  playerAstMAE: number;
  reliability: Record<string, { bins: { lo: number; hi: number; n: number; pred: number; obs: number }[]; ece: number; brier: number; n: number }>;
  elapsedSec: number;
  /** Número de recalibraciones hechas durante el backtest (0 = factores fijos). */
  calibrations: number;
  perGame: { id: string; date: string; home: string; away: string; pHome: number; predTotal: number; predMargin: number; total: number; margin: number }[];
}

/** Temporada previa como totales agregados (data/games/<comp>/totals-<temporada>.json). */
function loadTotalsAccum(comp: CompetitionId): PreviousAccum | undefined {
  const path = `data/games/${comp}/totals-${BACKTEST_PRIOR_SEASON}.json`;
  if (!existsSync(path)) return undefined;
  const f = JSON.parse(readFileSync(path, 'utf8'));
  const teams = new Map<string, ReturnType<typeof newTeamAccum>>();
  for (const t of f.teams) {
    const a = newTeamAccum();
    a.gp = t.gp;
    a.poss = t.poss;
    a.own = t.own;
    teams.set(String(t.id), a);
  }
  for (const o of f.opponents) {
    const a = teams.get(String(o.id));
    if (a) a.opp = o.opp;
  }
  let hm = 0;
  let hm2 = 0;
  let hw = 0;
  for (const g of f.games) {
    const m = g.hs - g.as;
    hm += m;
    hm2 += m * m;
    if (m > 0) hw++;
    const h = teams.get(String(g.home));
    const a = teams.get(String(g.away));
    if (h) {
      if (m > 0) h.w++;
      else h.l++;
      h.home.gp++;
      if (m > 0) h.home.w++;
      h.home.ptsFor += g.hs;
      h.home.ptsAgainst += g.as;
    }
    if (a) {
      if (m < 0) a.w++;
      else a.l++;
      a.away.gp++;
      if (m < 0) a.away.w++;
      a.away.ptsFor += g.as;
      a.away.ptsAgainst += g.hs;
    }
  }
  const players = new Map<string, { gp: number; gs: number; tot: any; q: number[]; qGames: number; teamId: string }>();
  for (const p of f.players) players.set(String(p.id), { gp: p.gp, gs: 0, tot: p.tot, q: [0, 0, 0, 0], qGames: 0, teamId: String(p.teamId) });
  return { teams, players, games: f.games.length, homeMargin: hm, homeMargin2: hm2, homeWins: hw };
}

function reliability(pairs: Pair[]) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sp: 0, sy: 0 }));
  let brier = 0;
  for (const { p, y } of pairs) {
    const b = bins[Math.min(9, Math.floor(p * 10))];
    b.n++;
    b.sp += p;
    b.sy += y;
    brier += (p - y) ** 2;
  }
  const n = pairs.length;
  let ece = 0;
  const out = bins.map((b) => {
    const pred = b.n ? b.sp / b.n : 0;
    const obs = b.n ? b.sy / b.n : 0;
    ece += (b.n / Math.max(n, 1)) * Math.abs(pred - obs);
    return { lo: b.lo, hi: b.hi, n: b.n, pred, obs };
  });
  return { bins: out, ece, brier: n ? brier / n : 0, n };
}

function teamSetupForGame(snap: CompetitionSnapshot, side: GameRecord['home'], regMin: number): TeamSetup {
  const played = side.players.filter((p) => (p[PL.sec] as number) > 0);
  const rot = snap.rotations.find((r) => r.teamId === side.teamId);
  const expected = new Map<string, number>();
  for (const p of snap.players.filter((x) => x.teamId === side.teamId)) {
    // previsión: media reciente ponderada y media de temporada (como en build.ts)
    let num = 0;
    let den = 0;
    p.recentMinutes.forEach((m, i) => {
      const w = 1 - i * 0.12;
      num += (m ?? 0) * w;
      den += w;
    });
    const recent = den ? num / den : 0;
    expected.set(p.id, p.gp > 0 ? 0.7 * recent + 0.3 * p.mpg : recent);
  }
  void rot;
  const players = played.map((p) => {
    const id = p[0] as string;
    const starter = p[PL.starter] === 1;
    let m = expected.get(id) ?? 0;
    if (m <= 0.5) m = starter ? 20 : 8; // jugador sin minutos previos: valor por defecto
    return { id, minutes: m, starter };
  });
  void regMin;
  return { teamId: side.teamId, players };
}

/** Días entre recalibraciones del motor dentro del backtest. */
const RECALIBRATE_DAYS = 28;

export function runBacktest(comp: CompetitionId, sims: number, params: SimParams, log = console.log, rolling = true): BacktestResult {
  const t0 = Date.now();
  const file: SeasonGamesFile = JSON.parse(readFileSync(`data/games/${comp}/${PREVIOUS_SEASON}.json`, 'utf8'));
  const priorPath = `data/games/${comp}/${BACKTEST_PRIOR_SEASON}.json`;
  const priorFile: SeasonGamesFile | null = existsSync(priorPath) ? JSON.parse(readFileSync(priorPath, 'utf8')) : null;
  const previousAccum = priorFile ? undefined : loadTotalsAccum(comp);
  if (!priorFile && !previousAccum) log(`  (sin ${BACKTEST_PRIOR_SEASON}: el backtest de ${comp} no tiene temporada previa)`);
  if (previousAccum) log(`  temporada previa ${BACKTEST_PRIOR_SEASON} a partir de totales agregados`);
  const games = [...file.games].sort((a, b) => a.date.localeCompare(b.date));
  const regMin = comp === 'nba' ? 48 : 40;
  const dayOf = (d: string) => d.slice(0, 10);
  const winPairs: Pair[] = [];
  const totalPairs: Pair[] = [];
  const hcPairs: Pair[] = [];
  const ptsPairs: Pair[] = [];
  const rebPairs: Pair[] = [];
  const astPairs: Pair[] = [];
  const fg3Pairs: Pair[] = [];
  let n = 0;
  let correct = 0;
  let logLoss = 0;
  let homeBase = 0;
  let recordBase = 0;
  let totErr = 0;
  let totBias = 0;
  let marErr = 0;
  let marBias = 0;
  let tc50 = 0;
  let tc80 = 0;
  let mc50 = 0;
  let mc80 = 0;
  let otPred = 0;
  let otAct = 0;
  let pPts = 0;
  let pReb = 0;
  let pAst = 0;
  let pN = 0;
  const perGame: BacktestResult['perGame'] = [];
  let snapDay = '';
  let snap: CompetitionSnapshot | null = null;
  // Recalibración periódica con los datos anteriores a cada fecha (sin información futura)
  let calParams: SimParams | null = null;
  let calDay = '';
  let calibrations = 0;
  const record = new Map<string, { w: number; l: number }>();
  for (let gi = 0; gi < games.length; gi++) {
    const g = games[gi];
    const day = dayOf(g.date);
    const prior = games.filter((x) => dayOf(x.date) < day);
    const cnt = (tid: string) => prior.filter((x) => x.home.teamId === tid || x.away.teamId === tid).length;
    const recH = record.get(g.home.teamId) ?? { w: 0, l: 0 };
    const recA = record.get(g.away.teamId) ?? { w: 0, l: 0 };
    if (cnt(g.home.teamId) >= MIN_PRIOR && cnt(g.away.teamId) >= MIN_PRIOR) {
      if (day !== snapDay) {
        const playerInfo: Record<string, PlayerInfo> = { ...(priorFile?.players ?? {}), ...file.players };
        // Plantilla del día: jugadores que han jugado esta temporada (último equipo) y los
        // participantes de los partidos de hoy (están inscritos antes del partido).
        const rosterMap = new Map<string, PlayerInfo>();
        const addRoster = (gs: GameRecord[]) => {
          for (const x of gs)
            for (const side of [x.home, x.away])
              for (const p of side.players) {
                const id = p[0] as string;
                rosterMap.set(id, { ...(playerInfo[id] ?? { id, name: id }), id, teamId: side.teamId });
              }
        };
        addRoster(prior);
        addRoster(games.filter((x) => dayOf(x.date) === day));
        snap = buildCompetitionSnapshot({
          comp,
          season: PREVIOUS_SEASON,
          previousSeason: BACKTEST_PRIOR_SEASON,
          gamesCurrent: prior,
          gamesPrevious: priorFile?.games ?? [],
          previousAccum,
          teams: file.teams,
          playerInfo,
          roster: [...rosterMap.values()],
          generatedAt: g.date,
        });
        snapDay = day;
        if (rolling && (!calParams || (Date.parse(day) - Date.parse(calDay)) / 86400000 >= RECALIBRATE_DAYS)) {
          calParams = calibrate(snap, calParams ? 4 : 7, undefined, { start: calParams ?? params, quiet: true, skipFinal: true }).params;
          calDay = day;
          calibrations++;
        }
      }
      // Jugadores que debutan en este partido: se añaden con tasas de su posición
      const s = snap!;
      for (const side of [g.home, g.away]) {
        for (const p of side.players) {
          const id = p[0] as string;
          if ((p[PL.sec] as number) > 0 && !s.players.some((x) => x.id === id && x.teamId === side.teamId)) {
            const base = s.players.find((x) => x.id === id);
            const pos = (file.players[id]?.position as 'G' | 'F' | 'C' | null) ?? null;
            const L = s.league.byPosition[pos ?? 'ALL'];
            s.players.push(
              base
                ? { ...base, teamId: side.teamId }
                : {
                    id, teamId: side.teamId, name: file.players[id]?.name ?? id, position: pos, gp: 0, gs: 0, mpg: 0, gpPrev: 0, mpgPrev: 0,
                    totals: { ...L.perMin, min: 0 }, totalsPrev: { ...L.perMin, min: 0 }, per36or40: L.perMin,
                    rates: { perMin: L.perMin, fg2Pct: L.fg2Pct, fg3Pct: L.fg3Pct, ftPct: L.ftPct, usage: L.usage },
                    quarterShare: s.league.quarterShareBench, quarterShareSource: 'estimado', recentMinutes: [], recentStarts: 0, estimated: true,
                  },
            );
          }
        }
      }
      const home = teamSetupForGame(s, g.home, regMin);
      const away = teamSetupForGame(s, g.away, regMin);
      const input = buildGameInput(s, home, away, rolling && calParams ? calParams : params);
      const agg = runSimulations(input, sims, 1000 + gi);
      n++;
      const pH = agg.homeWins / agg.n;
      const y = g.home.score > g.away.score ? 1 : 0;
      winPairs.push({ p: pH, y });
      if ((pH > 0.5 ? 1 : 0) === y) correct++;
      const pc = Math.min(0.999, Math.max(0.001, pH));
      logLoss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
      if (y === 1) homeBase++;
      const wpH = (recH.w + 1) / (recH.w + recH.l + 2);
      const wpA = (recA.w + 1) / (recA.w + recA.l + 2);
      if ((wpH >= wpA ? 1 : 0) === y) recordBase++;
      const total = g.home.score + g.away.score;
      const margin = g.home.score - g.away.score;
      const mT = histMean(agg.totalPts);
      const mM = histMean(agg.margin, MARGIN_OFFSET);
      totErr += Math.abs(mT - total);
      totBias += mT - total;
      marErr += Math.abs(mM - margin);
      marBias += mM - margin;
      const inQ = (h: number[], v: number, lo: number, hi: number, off = 0) => v >= histQuantile(h, lo, off) && v <= histQuantile(h, hi, off);
      if (inQ(agg.totalPts, total, 0.25, 0.75)) tc50++;
      if (inQ(agg.totalPts, total, 0.1, 0.9)) tc80++;
      if (inQ(agg.margin, margin, 0.25, 0.75, MARGIN_OFFSET)) mc50++;
      if (inQ(agg.margin, margin, 0.1, 0.9, MARGIN_OFFSET)) mc80++;
      otPred += agg.overtime / agg.n;
      perGame.push({ id: g.id, date: g.date, home: g.home.teamId, away: g.away.teamId, pHome: pH, predTotal: mT, predMargin: mM, total, margin });
      if (g.home.periods.length > 4) otAct++;
      // Over/under del total y hándicap en varias líneas alrededor de la media simulada
      for (const off of [-15, -10, -6, -3, 0, 3, 6, 10, 15]) {
        const L = Math.floor(mT + off) + 0.5;
        totalPairs.push({ p: countOver(agg.totalPts, L) / agg.n, y: total > L ? 1 : 0 });
      }
      for (const off of [-12, -8, -4, 0, 4, 8, 12]) {
        const L = Math.floor(mM + off) + 0.5;
        hcPairs.push({ p: countOver(agg.margin, L, MARGIN_OFFSET) / agg.n, y: margin > L ? 1 : 0 });
      }
      // Jugadores
      agg.players.forEach((pa, idx) => {
        const side = pa.side === 0 ? g.home : g.away;
        const line = side.players.find((l) => l[0] === pa.id);
        if (!line) return;
        const act = {
          pts: line[PL.pts] as number,
          reb: (line[PL.oreb] as number) + (line[PL.dreb] as number),
          ast: line[PL.ast] as number,
          fg3m: line[PL.fg3m] as number,
        };
        pN++;
        pPts += Math.abs(pa.sum.pts / agg.n - act.pts);
        pReb += Math.abs(pa.sum.reb / agg.n - act.reb);
        pAst += Math.abs(pa.sum.ast / agg.n - act.ast);
        for (const [key, pairs] of [
          ['pts', ptsPairs],
          ['reb', rebPairs],
          ['ast', astPairs],
          ['fg3m', fg3Pairs],
        ] as const) {
          const h = pa.hist[key];
          const mean = pa.sum[key] / agg.n;
          const lines = new Set<number>();
          for (const f of [0.5, 0.8, 1, 1.25, 1.6]) lines.add(Math.max(0, Math.floor(mean * f)) + 0.5);
          for (const L of lines) pairs.push({ p: countOver(h, L) / agg.n, y: act[key] > L ? 1 : 0 });
        }
        void idx;
      });
      if (n % 50 === 0) log(`  ${comp}: ${n} partidos evaluados (${gi + 1}/${games.length})`);
    }
    // actualizar balance (después del partido)
    const hw = g.home.score > g.away.score;
    record.set(g.home.teamId, { w: recH.w + (hw ? 1 : 0), l: recH.l + (hw ? 0 : 1) });
    record.set(g.away.teamId, { w: recA.w + (hw ? 0 : 1), l: recA.l + (hw ? 1 : 0) });
  }
  return {
    comp,
    season: PREVIOUS_SEASON,
    games: n,
    simsPerGame: sims,
    winnerAccuracy: correct / n,
    brier: winPairs.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / n,
    logLoss: logLoss / n,
    homeBaselineAccuracy: homeBase / n,
    recordBaselineAccuracy: recordBase / n,
    totalMAE: totErr / n,
    totalBias: totBias / n,
    marginMAE: marErr / n,
    marginBias: marBias / n,
    totalCoverage50: tc50 / n,
    totalCoverage80: tc80 / n,
    marginCoverage50: mc50 / n,
    marginCoverage80: mc80 / n,
    otPredicted: otPred / n,
    otActual: otAct / n,
    playerPtsMAE: pPts / pN,
    playerRebMAE: pReb / pN,
    playerAstMAE: pAst / pN,
    reliability: {
      ganador: reliability(winPairs),
      total: reliability(totalPairs),
      handicap: reliability(hcPairs),
      puntosJugador: reliability(ptsPairs),
      rebotesJugador: reliability(rebPairs),
      asistenciasJugador: reliability(astPairs),
      triplesJugador: reliability(fg3Pairs),
    },
    elapsedSec: (Date.now() - t0) / 1000,
    calibrations,
    perGame,
  };
}

if (process.argv[1]?.endsWith('backtest.ts')) {
  const arg = process.argv[2] ?? 'all';
  const si = process.argv.indexOf('--sims');
  const sims = si > 0 ? Number(process.argv[si + 1]) : 1000;
  const comps: CompetitionId[] = arg === 'all' ? ['euroleague', 'acb', 'nba'] : [arg as CompetitionId];
  const calib = existsSync('config/calibracion.json') ? JSON.parse(readFileSync('config/calibracion.json', 'utf8')) : {};
  mkdirSync('data/backtest', { recursive: true });
  for (const c of comps) {
    if (!existsSync(`data/games/${c}/${PREVIOUS_SEASON}.json`)) {
      console.log(`Sin partidos de ${c} ${PREVIOUS_SEASON}`);
      continue;
    }
    const params = { ...DEFAULT_PARAMS, ...(calib[c]?.params ?? {}) };
    console.log(`Backtest ${c} (${sims} simulaciones por partido)…`);
    const r = runBacktest(c, sims, params);
    writeFileSync(`data/backtest/${c}.json`, JSON.stringify(r, null, 2));
    console.log(
      `${c}: ${r.games} partidos · acierto ${(r.winnerAccuracy * 100).toFixed(1)} % (local ${(r.homeBaselineAccuracy * 100).toFixed(1)} %, balance ${(r.recordBaselineAccuracy * 100).toFixed(1)} %) · Brier ${r.brier.toFixed(3)} · MAE total ${r.totalMAE.toFixed(1)} · MAE margen ${r.marginMAE.toFixed(1)} · ${r.elapsedSec.toFixed(0)} s`,
    );
  }
}
