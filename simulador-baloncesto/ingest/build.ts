/**
 * Construye el snapshot de una competición a partir de los partidos descargados:
 * estadísticas de equipo y jugador (temporada actual y anterior ponderadas), patrón de minutos
 * por cuarto, quintetos probables, rotaciones, bajas y medias de la liga.
 *
 * La función principal (buildCompetitionSnapshot) es pura: el backtest la reutiliza con los
 * partidos anteriores a cada fecha.
 */
import type { CompetitionId, GameRecord, InjuryEntry, PlayerInfo, RosterFile, SeasonGamesFile } from '../engine/datatypes';
import { PL } from '../engine/datatypes';
import {
  COUNTING_KEYS,
  emptyCounting,
  type CompetitionSnapshot,
  type Counting,
  type LeagueAverages,
  type LineupSnapshot,
  type PlayerSnapshot,
  type RotationSnapshot,
  type TeamSeasonStats,
  type TeamSnapshot,
  type SourceRef,
} from '../engine/snapshot';
import { REGLAS, regulationSeconds } from '../config/reglas';
import { CURRENT_SEASON, PREVIOUS_SEASON } from '../config/temporadas';
import { log, normName, readJson, writeJson, prettyName } from './lib/util';
import { validateSnapshot } from './lib/validate';

/** Constantes del modelo de datos (documentadas en docs/modelo.md). */
export const DATA_PARAMS = {
  /** Peso de la temporada anterior: 1 / (1 + partidos actuales / K). */
  previousSeasonK: Number(process.env.SIM_PREV_K ?? 16),
  /** Minutos de "prior" para regularizar tasas por minuto hacia la media de su posición. */
  priorMinutes: Number(process.env.SIM_PRIOR_MIN ?? 150),
  /** Intentos de "prior" para regularizar porcentajes. */
  priorFg2: 100,
  priorFg3: 120,
  priorFt: 40,
  /** Partidos recientes usados para quinteto probable y rotación. */
  recentGames: 5,
  /** Minutos totales mínimos para no considerar el dato como estimado. */
  minMinutesReal: 100,
  /** Partidos seguidos sin aparecer para marcar ausencia reciente. */
  absentGames: 2,
  /** Coeficiente de tiros libres en la fórmula de posesiones. */
  ftPossCoef: 0.44,
  /**
   * Peso de la temporada anterior en las MEDIAS DE LA LIGA (objetivos de calibración):
   * 1 / (1 + partidos de la temporada actual / K). Decae mucho más rápido que el de equipos y
   * jugadores porque la media de la liga se estabiliza con pocas decenas de partidos y la
   * anotación cambia de una temporada a otra.
   */
  leaguePreviousK: Number(process.env.SIM_LEAGUE_PREV_K ?? 30),
};

const SOURCES: Record<CompetitionId, SourceRef[]> = {
  nba: [
    {
      name: 'PBP Stats API (Darryl Blackport) — datos derivados del jugada a jugada oficial de NBA.com',
      url: 'https://api.pbpstats.com/docs',
      fetchedAt: '',
      terms:
        'API pública y documentada, sin clave ni condiciones publicadas. Las estadísticas NBA son propiedad de NBA.com: uso privado y no comercial con atribución; no pueden usarse en relación con apuestas ni en bases de datos públicas sin consentimiento.',
    },
  ],
  euroleague: [
    {
      name: 'Euroleague Basketball — API oficial (api-live.euroleague.net, live.euroleague.net)',
      url: 'https://api-live.euroleague.net/swagger/index.html',
      fetchedAt: '',
      terms:
        'API pública sin clave. Sus condiciones de uso no se han podido leer (la web bloquea los accesos automatizados con un control de seguridad): uso personal no comercial citando la fuente.',
    },
  ],
  acb: [
    {
      name: 'ACB — acb.com y live.acb.com (páginas públicas)',
      url: 'https://acb.com/es/liga',
      fetchedAt: '',
      terms:
        'robots.txt permite el acceso. El aviso legal autoriza la descarga y almacenamiento para uso personal identificando la fuente; la redistribución o comunicación pública requiere consentimiento previo de ACEB, S.A.U.',
    },
  ],
};

// ---------------------------------------------------------------------------------------------

function lineToCounting(p: (string | number)[]): Counting {
  const n = (i: number) => p[i] as number;
  return {
    min: n(PL.sec) / 60,
    pts: n(PL.pts),
    fg2m: n(PL.fg2m),
    fg2a: n(PL.fg2a),
    fg3m: n(PL.fg3m),
    fg3a: n(PL.fg3a),
    ftm: n(PL.ftm),
    fta: n(PL.fta),
    oreb: n(PL.oreb),
    dreb: n(PL.dreb),
    ast: n(PL.ast),
    stl: n(PL.stl),
    blk: n(PL.blk),
    tov: n(PL.tov),
    pf: n(PL.pf),
    pfd: n(PL.pfd),
  };
}

function addInto(a: Counting, b: Counting, w = 1) {
  for (const k of COUNTING_KEYS) a[k] += b[k] * w;
}
function scaled(a: Counting, w: number): Counting {
  const o = emptyCounting();
  for (const k of COUNTING_KEYS) o[k] = a[k] * w;
  return o;
}
const div = (a: number, b: number, d = 0) => (b > 0 ? a / b : d);

export function possessions(c: Counting, coef = DATA_PARAMS.ftPossCoef) {
  return c.fg2a + c.fg3a - c.oreb + c.tov + coef * c.fta;
}

function sideTotals(side: GameRecord['home']): Counting {
  const t = emptyCounting();
  for (const p of side.players) addInto(t, lineToCounting(p));
  return t;
}

export interface TeamAccum {
  gp: number;
  w: number;
  l: number;
  own: Counting;
  opp: Counting;
  poss: number;
  qFor: number[];
  qAgainst: number[];
  home: { gp: number; w: number; ptsFor: number; ptsAgainst: number };
  away: { gp: number; w: number; ptsFor: number; ptsAgainst: number };
}

export function newTeamAccum(): TeamAccum {
  return {
    gp: 0,
    w: 0,
    l: 0,
    own: emptyCounting(),
    opp: emptyCounting(),
    poss: 0,
    qFor: [0, 0, 0, 0],
    qAgainst: [0, 0, 0, 0],
    home: { gp: 0, w: 0, ptsFor: 0, ptsAgainst: 0 },
    away: { gp: 0, w: 0, ptsFor: 0, ptsAgainst: 0 },
  };
}

function accumulateTeams(games: GameRecord[]) {
  const acc = new Map<string, TeamAccum>();
  for (const g of games) {
    const ht = sideTotals(g.home);
    const at = sideTotals(g.away);
    const poss = (possessions(ht) + possessions(at)) / 2;
    for (const [side, own, opp, isHome] of [
      [g.home, ht, at, true],
      [g.away, at, ht, false],
    ] as const) {
      const other = isHome ? g.away : g.home;
      if (!acc.has(side.teamId)) acc.set(side.teamId, newTeamAccum());
      const a = acc.get(side.teamId)!;
      a.gp++;
      const won = side.score > other.score;
      if (won) a.w++;
      else a.l++;
      addInto(a.own, own);
      addInto(a.opp, opp);
      a.poss += poss;
      for (let q = 0; q < 4; q++) {
        a.qFor[q] += side.periods[q] ?? 0;
        a.qAgainst[q] += other.periods[q] ?? 0;
      }
      const ha = isHome ? a.home : a.away;
      ha.gp++;
      if (won) ha.w++;
      ha.ptsFor += side.score;
      ha.ptsAgainst += other.score;
    }
  }
  return acc;
}

function teamStatsFrom(a: TeamAccum | undefined): TeamSeasonStats | null {
  if (!a || a.gp === 0) return null;
  const own = scaled(a.own, 1 / a.gp);
  const opp = scaled(a.opp, 1 / a.gp);
  const poss = a.poss / a.gp;
  const fga = own.fg2a + own.fg3a;
  const ofga = opp.fg2a + opp.fg3a;
  return {
    gp: a.gp,
    w: a.w,
    l: a.l,
    poss,
    own,
    opp,
    ortg: div(own.pts * 100, poss),
    drtg: div(opp.pts * 100, poss),
    orebPct: div(own.oreb, own.oreb + opp.dreb, 0.28),
    drebPct: div(own.dreb, own.dreb + opp.oreb, 0.72),
    tovPct: div(own.tov, poss),
    oppTovPct: div(opp.tov, poss),
    astPerFgm: div(own.ast, own.fg2m + own.fg3m),
    stlPerOppPoss: div(own.stl, poss),
    blkPerOppFg2a: div(own.blk, opp.fg2a),
    fg2Pct: div(own.fg2m, own.fg2a),
    fg3Pct: div(own.fg3m, own.fg3a),
    ftPct: div(own.ftm, own.fta),
    oppFg2Pct: div(opp.fg2m, opp.fg2a),
    oppFg3Pct: div(opp.fg3m, opp.fg3a),
    fg3aShare: div(own.fg3a, fga),
    oppFg3aShare: div(opp.fg3a, ofga),
    ftaPerFga: div(own.fta, fga),
    oppFtaPerFga: div(opp.fta, ofga),
    pfPerGame: own.pf,
  };
}

/** Mezcla dos acumulados con peso w para el anterior. */
function blendAccum(cur: TeamAccum | undefined, prev: TeamAccum | undefined, w: number): TeamAccum {
  const o = newTeamAccum();
  for (const [a, k] of [
    [cur, 1],
    [prev, w],
  ] as const) {
    if (!a) continue;
    o.gp += a.gp * k;
    o.w += a.w * k;
    o.l += a.l * k;
    addInto(o.own, a.own, k);
    addInto(o.opp, a.opp, k);
    o.poss += a.poss * k;
    for (let q = 0; q < 4; q++) {
      o.qFor[q] += a.qFor[q] * k;
      o.qAgainst[q] += a.qAgainst[q] * k;
    }
  }
  return o;
}

export function previousWeight(gpCurrent: number) {
  return 1 / (1 + gpCurrent / DATA_PARAMS.previousSeasonK);
}

// ---------------------------------------------------------------------------------------------

export interface PlayerAccum {
  gp: number;
  gs: number;
  tot: Counting;
  q: number[]; // segundos por cuarto (solo partidos con dato)
  qGames: number;
  teamId: string;
}

function accumulatePlayers(games: GameRecord[]) {
  const acc = new Map<string, PlayerAccum>();
  for (const g of games) {
    for (const side of [g.home, g.away]) {
      for (const p of side.players) {
        const pid = p[0] as string;
        const sec = p[PL.sec] as number;
        if (!acc.has(pid)) acc.set(pid, { gp: 0, gs: 0, tot: emptyCounting(), q: [0, 0, 0, 0], qGames: 0, teamId: side.teamId });
        const a = acc.get(pid)!;
        a.teamId = side.teamId;
        if (sec <= 0) continue; // convocado sin jugar
        a.gp++;
        if (p[PL.starter] === 1) a.gs++;
        addInto(a.tot, lineToCounting(p));
        if ((p[PL.q1] as number) >= 0) {
          for (let q = 0; q < 4; q++) a.q[q] += p[PL.q1 + q] as number;
          a.qGames++;
        }
      }
    }
  }
  return acc;
}

function usageOf(c: Counting) {
  return c.fg2a + c.fg3a + DATA_PARAMS.ftPossCoef * c.fta + c.tov;
}

function leagueAverages(
  comp: CompetitionId,
  gamesCur: GameRecord[],
  gamesPrev: GameRecord[],
  pCur: Map<string, PlayerAccum>,
  pPrev: Map<string, PlayerAccum>,
  positions: Map<string, 'G' | 'F' | 'C' | null>,
  wPrev: number,
  prevAccum?: PreviousAccum,
): LeagueAverages {
  const rules = REGLAS[comp];
  const regMin = regulationSeconds(rules) / 60;
  const tot = emptyCounting();
  let poss = 0;
  let n = 0;
  let homeMargin = 0;
  let homeMargin2 = 0;
  let homeWins = 0;
  let ot = 0;
  let ng = 0;
  let ngOt = 0;
  if (prevAccum) {
    for (const t of prevAccum.teams.values()) {
      addInto(tot, t.own, wPrev);
      poss += t.poss * wPrev;
      n += t.gp * wPrev;
    }
    ng += prevAccum.games * wPrev;
    homeMargin += prevAccum.homeMargin * wPrev;
    homeMargin2 += prevAccum.homeMargin2 * wPrev;
    homeWins += prevAccum.homeWins * wPrev;
  }
  for (const [games, w] of [
    [gamesCur, 1],
    [prevAccum ? [] : gamesPrev, wPrev],
  ] as const) {
    for (const g of games) {
      const ht = sideTotals(g.home);
      const at = sideTotals(g.away);
      const ps = (possessions(ht) + possessions(at)) / 2;
      addInto(tot, ht, w);
      addInto(tot, at, w);
      poss += 2 * ps * w;
      n += 2 * w;
      ng += w;
      homeMargin += (g.home.score - g.away.score) * w;
      homeMargin2 += (g.home.score - g.away.score) ** 2 * w;
      if (g.home.score > g.away.score) homeWins += w;
      if (g.home.periods.length > 4) ot += w;
      ngOt += w;
    }
  }
  const per = scaled(tot, 1 / Math.max(n, 1));
  const possPer = poss / Math.max(n, 1);
  // Por posición
  const posAcc: Record<string, Counting> = { G: emptyCounting(), F: emptyCounting(), C: emptyCounting(), ALL: emptyCounting() };
  for (const [map, w] of [
    [pCur, 1],
    [pPrev, wPrev],
  ] as const) {
    for (const [pid, a] of map) {
      const pos = positions.get(pid) ?? null;
      addInto(posAcc.ALL, a.tot, w);
      if (pos) addInto(posAcc[pos], a.tot, w);
    }
  }
  const byPosition = {} as LeagueAverages['byPosition'];
  for (const k of ['G', 'F', 'C', 'ALL'] as const) {
    const c = posAcc[k].min > 0 ? posAcc[k] : posAcc.ALL;
    byPosition[k] = {
      perMin: scaled(c, 1 / Math.max(c.min, 1)),
      fg2Pct: div(c.fg2m, c.fg2a, 0.5),
      fg3Pct: div(c.fg3m, c.fg3a, 0.35),
      ftPct: div(c.ftm, c.fta, 0.75),
      usage: 0,
    };
    // uso medio: posesiones usadas por minuto / posesiones del equipo por minuto en pista (per-player)
    const teamPossPerMin = possPer / regMin;
    byPosition[k].usage = div(usageOf(c) / Math.max(c.min, 1), teamPossPerMin);
    byPosition[k].perMin.min = 1;
  }
  // Reparto por cuartos de titulares y suplentes
  const qs = [0, 0, 0, 0];
  const qb = [0, 0, 0, 0];
  for (const games of [gamesCur, gamesPrev]) {
    for (const g of games)
      for (const s of [g.home, g.away])
        for (const p of s.players) {
          if ((p[PL.q1] as number) < 0) continue;
          const tgt = p[PL.starter] === 1 ? qs : qb;
          for (let q = 0; q < 4; q++) tgt[q] += p[PL.q1 + q] as number;
        }
  }
  const norm = (a: number[]) => {
    const s = a.reduce((x, y) => x + y, 0);
    return s > 0 ? a.map((x) => x / s) : [0.25, 0.25, 0.25, 0.25];
  };
  return {
    gamesCurrent: gamesCur.length,
    gamesPrevious: gamesPrev.length,
    perTeamGame: { ...per, poss: possPer },
    homeMargin: homeMargin / Math.max(ng, 1),
    marginSd: Math.sqrt(Math.max(0, homeMargin2 / Math.max(ng, 1) - (homeMargin / Math.max(ng, 1)) ** 2)),
    homeWinPct: homeWins / Math.max(ng, 1),
    otPct: ot / Math.max(ngOt, 1),
    fg2Pct: div(tot.fg2m, tot.fg2a),
    fg3Pct: div(tot.fg3m, tot.fg3a),
    ftPct: div(tot.ftm, tot.fta),
    orebPct: div(tot.oreb, tot.oreb + tot.dreb),
    tovPct: div(per.tov, possPer),
    astPerFgm: div(tot.ast, tot.fg2m + tot.fg3m),
    stlPerPoss: div(per.stl, possPer),
    blkPerFg2a: div(tot.blk, tot.fg2a),
    byPosition,
    quarterShareStarters: norm(qs),
    quarterShareBench: norm(qb),
  };
}

// ---------------------------------------------------------------------------------------------

export interface CrossCompPrior {
  comp: CompetitionId;
  season: string;
  /** Tasas por minuto ya ajustadas al nivel de la liga destino. */
  perMin: Counting;
  fg2Pct: number;
  fg3Pct: number;
  ftPct: number;
  minutes: number;
  position: 'G' | 'F' | 'C' | null;
}

/** Temporada previa dada como totales agregados (cuando no hay partidos individuales). */
export interface PreviousAccum {
  teams: Map<string, TeamAccum>;
  players: Map<string, PlayerAccum>;
  games: number;
  homeMargin: number; // suma de márgenes local - visitante
  homeMargin2: number;
  homeWins: number;
}

export interface BuildInput {
  comp: CompetitionId;
  season: string;
  previousSeason: string;
  gamesCurrent: GameRecord[];
  gamesPrevious: GameRecord[];
  /** Alternativa a gamesPrevious: totales agregados de la temporada previa. */
  previousAccum?: PreviousAccum;
  teams: Record<string, { id: string; name: string; short: string; logo?: string | null }>;
  /** Información de jugadores (nombres, posición...). */
  playerInfo: Record<string, PlayerInfo>;
  /** Plantilla actual. Si es null, se usa la de los partidos. */
  roster: PlayerInfo[] | null;
  /** Bajas manuales con fuente. */
  manualInjuries?: InjuryEntry[];
  /** Datos de jugadores en otra competición (por nombre normalizado). */
  crossComp?: Map<string, CrossCompPrior>;
  generatedAt?: string;
  sources?: SourceRef[];
}

function nameKey(n: string) {
  return normName(prettyName(n)).replace(/,/g, ' ').split(' ').filter(Boolean).sort().join(' ');
}

export function buildCompetitionSnapshot(input: BuildInput): CompetitionSnapshot {
  const { comp } = input;
  const rules = REGLAS[comp];
  const regMin = regulationSeconds(rules) / 60;
  const notes: string[] = [];
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const tCur = accumulateTeams(input.gamesCurrent);
  const tPrev = input.previousAccum?.teams ?? accumulateTeams(input.gamesPrevious);
  const pCur = accumulatePlayers(input.gamesCurrent);
  const pPrev = input.previousAccum?.players ?? accumulatePlayers(input.gamesPrevious);

  const positions = new Map<string, 'G' | 'F' | 'C' | null>();
  for (const [pid, info] of Object.entries(input.playerInfo)) positions.set(pid, (info.position as any) ?? null);
  for (const p of input.roster ?? []) positions.set(p.id, (p.position as any) ?? positions.get(p.id) ?? null);

  const leagueWPrev = 1 / (1 + input.gamesCurrent.length / DATA_PARAMS.leaguePreviousK);
  const league = leagueAverages(comp, input.gamesCurrent, input.gamesPrevious, pCur, pPrev, positions, leagueWPrev, input.previousAccum);

  // ---- Equipos
  const teamIds = new Set<string>(Object.keys(input.teams));
  const teams: TeamSnapshot[] = [];
  for (const id of teamIds) {
    const info = input.teams[id];
    const cur = tCur.get(id);
    const prev = tPrev.get(id);
    const w = previousWeight(cur?.gp ?? 0);
    const bl = blendAccum(cur, prev, w);
    const blended = teamStatsFrom(bl.gp > 0 ? bl : undefined);
    if (!blended) {
      notes.push(`Sin partidos para ${info.name}: se usan las medias de la liga.`);
    }
    const leagueTeam: TeamSeasonStats = {
      gp: 0,
      w: 0,
      l: 0,
      poss: league.perTeamGame.poss,
      own: { ...league.perTeamGame },
      opp: { ...league.perTeamGame },
      ortg: div(league.perTeamGame.pts * 100, league.perTeamGame.poss),
      drtg: div(league.perTeamGame.pts * 100, league.perTeamGame.poss),
      orebPct: league.orebPct,
      drebPct: 1 - league.orebPct,
      tovPct: league.tovPct,
      oppTovPct: league.tovPct,
      astPerFgm: league.astPerFgm,
      stlPerOppPoss: league.stlPerPoss,
      blkPerOppFg2a: league.blkPerFg2a,
      fg2Pct: league.fg2Pct,
      fg3Pct: league.fg3Pct,
      ftPct: league.ftPct,
      oppFg2Pct: league.fg2Pct,
      oppFg3Pct: league.fg3Pct,
      fg3aShare: div(league.perTeamGame.fg3a, league.perTeamGame.fg2a + league.perTeamGame.fg3a),
      oppFg3aShare: div(league.perTeamGame.fg3a, league.perTeamGame.fg2a + league.perTeamGame.fg3a),
      ftaPerFga: div(league.perTeamGame.fta, league.perTeamGame.fg2a + league.perTeamGame.fg3a),
      oppFtaPerFga: div(league.perTeamGame.fta, league.perTeamGame.fg2a + league.perTeamGame.fg3a),
      pfPerGame: league.perTeamGame.pf,
    };
    const ha = (k: 'home' | 'away') => {
      const a = cur?.[k];
      const b = prev?.[k];
      const gp = (a?.gp ?? 0) + (b?.gp ?? 0) * w;
      return {
        gp: Math.round(gp * 10) / 10,
        w: div((a?.w ?? 0) + (b?.w ?? 0) * w, 1),
        ptsFor: div((a?.ptsFor ?? 0) + (b?.ptsFor ?? 0) * w, gp),
        ptsAgainst: div((a?.ptsAgainst ?? 0) + (b?.ptsAgainst ?? 0) * w, gp),
      };
    };
    teams.push({
      id,
      name: info.name,
      short: info.short,
      logo: info.logo ?? null,
      current: teamStatsFrom(cur),
      previous: teamStatsFrom(prev),
      blended: blended ?? leagueTeam,
      blendWeights: { gpCurrent: cur?.gp ?? 0, previousWeight: w },
      quarters: {
        for: bl.gp > 0 ? bl.qFor.map((x) => x / bl.gp) : [0, 0, 0, 0],
        against: bl.gp > 0 ? bl.qAgainst.map((x) => x / bl.gp) : [0, 0, 0, 0],
      },
      home: ha('home'),
      away: ha('away'),
    });
  }
  teams.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  // ---- Plantillas
  const roster: PlayerInfo[] = [];
  if (input.roster) roster.push(...input.roster);
  else {
    // Sin plantilla: jugadores que han jugado con el equipo en la temporada actual (o la anterior si no hay partidos)
    const src = pCur.size ? pCur : pPrev;
    for (const [pid, a] of src) {
      const info = input.playerInfo[pid];
      roster.push({ ...(info ?? { id: pid, name: pid }), id: pid, teamId: a.teamId });
    }
  }
  // Añadir a la plantilla jugadores que han jugado esta temporada con el equipo pero no figuran (altas no reflejadas)
  const inRoster = new Set(roster.map((p) => p.id));
  for (const [pid, a] of pCur) {
    if (!inRoster.has(pid) && a.gp > 0 && input.roster) {
      // Solo si su último partido fue con un equipo de la competición y no está en otra plantilla
      const info = input.playerInfo[pid];
      roster.push({ ...(info ?? { id: pid, name: pid }), id: pid, teamId: a.teamId, extra: { ...(info?.extra ?? {}), fueraDePlantillaOficial: true } });
      notes.push(`${prettyName(info?.name ?? pid)} ha jugado con ${a.teamId} esta temporada pero no figura en la plantilla oficial: se incluye.`);
    }
  }

  // Partidos recientes por equipo (temporada actual, del más reciente al más antiguo)
  const recentByTeam = new Map<string, GameRecord[]>();
  for (const g of [...input.gamesCurrent].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const s of [g.home, g.away]) {
      if (!recentByTeam.has(s.teamId)) recentByTeam.set(s.teamId, []);
      const arr = recentByTeam.get(s.teamId)!;
      if (arr.length < DATA_PARAMS.recentGames) arr.push(g);
    }
  }
  const sideOf = (g: GameRecord, teamId: string) => (g.home.teamId === teamId ? g.home : g.away);

  const players: PlayerSnapshot[] = [];
  for (const r of roster) {
    if (!teamIds.has(r.teamId)) continue;
    const cur = pCur.get(r.id);
    const prev = pPrev.get(r.id);
    const team = teams.find((t) => t.id === r.teamId)!;
    const w = previousWeight(team.blendWeights.gpCurrent);
    const curTot = cur && cur.teamId === r.teamId ? cur.tot : cur?.tot ?? emptyCounting();
    const prevTot = prev?.tot ?? emptyCounting();
    const blendTot = emptyCounting();
    addInto(blendTot, curTot);
    addInto(blendTot, prevTot, w);
    const pos = (positions.get(r.id) ?? null) as 'G' | 'F' | 'C' | null;
    const posAvg = league.byPosition[pos ?? 'ALL'];
    // Prior: media de posición o, si existe, sus datos en otra competición ajustados de nivel
    let priorPerMin: Counting = posAvg.perMin;
    let priorPct = { fg2: posAvg.fg2Pct, fg3: posAvg.fg3Pct, ft: posAvg.ftPct };
    let priorMinutes = DATA_PARAMS.priorMinutes;
    let estimateNote: string | undefined;
    const realMinutes = curTot.min + prevTot.min;
    const cross = input.crossComp?.get(nameKey(r.name));
    if (cross && realMinutes < DATA_PARAMS.minMinutesReal * 3 && cross.minutes >= 60) {
      priorPerMin = cross.perMin;
      priorPct = { fg2: cross.fg2Pct, fg3: cross.fg3Pct, ft: cross.ftPct };
      priorMinutes = Math.min(cross.minutes, 400);
      if (realMinutes < DATA_PARAMS.minMinutesReal)
        estimateNote = `Estimado con sus datos de ${cross.comp === "euroleague" ? "EuroLiga" : cross.comp === "acb" ? "Liga Endesa" : "NBA"} (${cross.season} y anterior, ${Math.round(cross.minutes)} min), ajustados al nivel de esta liga.`;
    } else if (realMinutes < DATA_PARAMS.minMinutesReal) {
      estimateNote = `Pocos minutos o sin datos (${Math.round(realMinutes)} min): tasas regularizadas hacia la media de su posición (${pos ?? 'todas'}) en esta competición.`;
    }
    const perMin = emptyCounting();
    for (const k of COUNTING_KEYS) {
      if (k === 'min') continue;
      perMin[k] = (blendTot[k] + priorPerMin[k] * priorMinutes) / (blendTot.min + priorMinutes);
    }
    perMin.min = 1;
    const fg2Pct = (blendTot.fg2m + priorPct.fg2 * DATA_PARAMS.priorFg2) / (blendTot.fg2a + DATA_PARAMS.priorFg2);
    const fg3Pct = (blendTot.fg3m + priorPct.fg3 * DATA_PARAMS.priorFg3) / (blendTot.fg3a + DATA_PARAMS.priorFg3);
    const ftPct = (blendTot.ftm + priorPct.ft * DATA_PARAMS.priorFt) / (blendTot.fta + DATA_PARAMS.priorFt);
    const teamPossPerMin = team.blended.poss / regMin;
    const usage = div(usageOf(perMin), teamPossPerMin);
    // Patrón por cuartos
    const qSec = [0, 0, 0, 0];
    let qGames = 0;
    for (const [a, k] of [
      [cur, 1],
      [prev, w],
    ] as const) {
      if (!a) continue;
      for (let q = 0; q < 4; q++) qSec[q] += a.q[q] * k;
      qGames += a.qGames * k;
    }
    const starterish = (cur?.gs ?? 0) + (prev?.gs ?? 0) * w > 0.5 * ((cur?.gp ?? 0) + (prev?.gp ?? 0) * w);
    const priorQ = starterish ? league.quarterShareStarters : league.quarterShareBench;
    const qTot = qSec.reduce((a, b) => a + b, 0);
    const priorQSec = 3 * 60 * Math.max(6, div(blendTot.min, (cur?.gp ?? 0) + (prev?.gp ?? 0) * w, 10)); // ~3 partidos de prior
    const quarterShare = qSec.map((s, q) => (s + priorQ[q] * priorQSec) / (qTot + priorQSec));
    // Minutos recientes
    const recent = recentByTeam.get(r.teamId) ?? [];
    const recentMinutes = recent.map((g) => {
      const line = sideOf(g, r.teamId).players.find((p) => p[0] === r.id);
      return line ? Math.round(((line[PL.sec] as number) / 60) * 10) / 10 : null;
    });
    const recentStarts = recent.filter((g) => sideOf(g, r.teamId).players.some((p) => p[0] === r.id && p[PL.starter] === 1)).length;
    const per36or40 = scaled(perMin, comp === 'nba' ? 36 : 40);
    per36or40.min = comp === 'nba' ? 36 : 40;
    const info = input.playerInfo[r.id];
    players.push({
      id: r.id,
      teamId: r.teamId,
      name: prettyName(r.name || info?.name || r.id),
      position: pos,
      positionRaw: r.positionRaw ?? info?.positionRaw ?? null,
      height: r.height ?? info?.height ?? null,
      nationality: r.nationality ?? info?.nationality ?? null,
      jersey: r.jersey ?? info?.jersey ?? null,
      gp: cur?.teamId === r.teamId ? cur.gp : cur?.gp ?? 0,
      gs: cur?.gs ?? 0,
      mpg: div(curTot.min, cur?.gp ?? 0),
      gpPrev: prev?.gp ?? 0,
      mpgPrev: div(prevTot.min, prev?.gp ?? 0),
      totals: curTot,
      totalsPrev: prevTot,
      per36or40,
      rates: { perMin, fg2Pct, fg3Pct, ftPct, usage },
      quarterShare,
      quarterShareSource: qGames >= 3 ? 'datos' : 'estimado',
      recentMinutes,
      recentStarts,
      estimated: !!estimateNote && realMinutes < DATA_PARAMS.minMinutesReal,
      estimateNote,
    });
  }

  // ---- Bajas: ausencias recientes + manuales
  const injuries: InjuryEntry[] = [];
  for (const p of players) {
    const recent = p.recentMinutes;
    const teamGames = recent.length;
    if (teamGames < DATA_PARAMS.absentGames) continue;
    const missedLast = recent.slice(0, DATA_PARAMS.absentGames).every((m) => m === null || m === 0);
    const playedBefore = p.gp > 0 || (p.gpPrev >= 10 && p.mpgPrev >= 10);
    const notInActa = recent.slice(0, DATA_PARAMS.absentGames).every((m) => m === null);
    if (missedLast && playedBefore && (comp === 'nba' || notInActa)) {
      const n = recent.findIndex((m) => m !== null && m > 0);
      const streak = n === -1 ? teamGames : n;
      injuries.push({
        playerId: p.id,
        playerName: p.name,
        teamId: p.teamId,
        status: 'ausente-reciente',
        detail:
          comp === 'nba'
            ? `No ha jugado en los últimos ${streak} partidos de su equipo (posible baja, sin confirmación oficial).`
            : `No ha estado en el acta de los últimos ${streak} partidos de su equipo (posible baja, sin confirmación oficial).`,
        source: 'Inferido de los box scores (' + (SOURCES[comp][0]?.name ?? comp) + ')',
        updatedAt: input.gamesCurrent.length ? [...input.gamesCurrent].sort((a, b) => b.date.localeCompare(a.date))[0].date : generatedAt,
      });
    }
  }
  for (const m of input.manualInjuries ?? []) {
    const p = m.playerId ? players.find((x) => x.id === m.playerId) : players.find((x) => normName(x.name) === normName(m.playerName));
    if (!p) {
      notes.push(`Baja manual de ${m.playerName} ignorada: el jugador no está en la plantilla.`);
      continue;
    }
    const i = injuries.findIndex((x) => x.playerId === p.id);
    const entry = { ...m, playerId: p.id, teamId: p.teamId };
    if (i >= 0) injuries[i] = entry;
    else injuries.push(entry);
  }
  const outIds = new Set(injuries.filter((i) => i.status === 'baja' || i.status === 'ausente-reciente').map((i) => i.playerId));

  // ---- Quintetos probables y rotaciones
  const lineups: LineupSnapshot[] = [];
  const rotations: RotationSnapshot[] = [];
  for (const t of teams) {
    const tp = players.filter((p) => p.teamId === t.id);
    const avail = tp.filter((p) => !outIds.has(p.id));
    const recent = recentByTeam.get(t.id) ?? [];
    // Minutos esperados: media reciente (más peso a los últimos) combinada con la media de temporada
    const expMin = new Map<string, number>();
    for (const p of avail) {
      let num = 0;
      let den = 0;
      p.recentMinutes.forEach((m, i) => {
        const wgt = 1 - i * 0.12;
        num += (m ?? 0) * wgt;
        den += wgt;
      });
      const recentAvg = den > 0 ? num / den : 0;
      const seasonAvg = p.gp > 0 ? p.mpg : p.mpgPrev;
      const e = recent.length >= 2 ? 0.7 * recentAvg + 0.3 * (p.gp > 0 ? p.mpg : recentAvg) : recent.length === 1 ? 0.5 * recentAvg + 0.5 * seasonAvg : seasonAvg;
      expMin.set(p.id, Math.max(0, e));
    }
    const ranked = [...avail].sort((a, b) => (expMin.get(b.id) ?? 0) - (expMin.get(a.id) ?? 0));
    const dressed = ranked.slice(0, rules.maxConvocados);
    const totalTarget = 5 * regMin;
    const sum = dressed.reduce((a, p) => a + (expMin.get(p.id) ?? 0), 0);
    const scale = sum > 0 ? totalTarget / sum : 0;
    // Titulares: más titularidades recientes (ponderadas), desempate por minutos
    const startScore = (p: PlayerSnapshot) => {
      let s = 0;
      recent.forEach((g, i) => {
        if (sideOf(g, t.id).players.some((l) => l[0] === p.id && l[PL.starter] === 1)) s += 1 - i * 0.1;
      });
      if (recent.length === 0) s = p.gpPrev > 0 ? 0 : 0;
      return s * 100 + (expMin.get(p.id) ?? 0) + (recent.length === 0 ? (p.gpPrev ? (p.totalsPrev.min / p.gpPrev) : 0) : 0);
    };
    const starters = [...dressed].sort((a, b) => startScore(b) - startScore(a)).slice(0, 5).map((p) => p.id);
    let warning: string | undefined;
    if (recent.length === 0) warning = 'Sin partidos esta temporada: quinteto según minutos de la temporada anterior.';
    const removedStarters = tp.filter((p) => outIds.has(p.id) && p.recentStarts > 0);
    if (removedStarters.length)
      warning = `${warning ? warning + ' ' : ''}Titulares recientes de baja/ausentes: ${removedStarters.map((p) => p.name).join(', ')}.`;
    lineups.push({
      teamId: t.id,
      starters,
      status: 'probable',
      basis: `Más titularidades en los últimos ${recent.length} partidos (ponderando los más recientes), sin jugadores de baja.`,
      source: SOURCES[comp][0].name,
      updatedAt: recent[0]?.date ?? generatedAt,
      warning,
    });
    rotations.push({
      teamId: t.id,
      players: dressed.map((p) => {
        const m = Math.min(regMin * 0.95, (expMin.get(p.id) ?? 0) * scale);
        return {
          playerId: p.id,
          minutes: Math.round(m * 10) / 10,
          role: starters.includes(p.id) ? 'titular' : m >= 8 ? 'rotacion' : 'reserva',
        };
      }),
      basis: `Media ponderada de minutos de los últimos ${recent.length} partidos y de la temporada, escalada a ${totalTarget} minutos.`,
      updatedAt: recent[0]?.date ?? generatedAt,
    });
  }

  const allDates = input.gamesCurrent.map((g) => g.date).sort();
  const sources = (input.sources ?? SOURCES[comp]).map((s) => ({ ...s, fetchedAt: s.fetchedAt || generatedAt }));
  return {
    comp,
    season: input.season,
    previousSeason: input.previousSeason,
    generatedAt,
    lastGameDate: allDates[allDates.length - 1] ?? null,
    sources,
    league,
    teams,
    players,
    lineups,
    rotations,
    injuries,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------

/** Tasas de cada jugador en una competición, indexadas por nombre, para usarlas como prior en otra. */
export function crossCompPriors(
  from: CompetitionSnapshot,
  toLeague: LeagueAverages,
): Map<string, CrossCompPrior> {
  const m = new Map<string, CrossCompPrior>();
  const fl = from.league.byPosition.ALL;
  const tl = toLeague.byPosition.ALL;
  for (const p of from.players) {
    const minutes = p.totals.min + p.totalsPrev.min;
    if (minutes < 60) continue;
    const perMin = emptyCounting();
    for (const k of COUNTING_KEYS) perMin[k] = p.rates.perMin[k] * div(tl.perMin[k], fl.perMin[k], 1);
    perMin.min = 1;
    m.set(nameKey(p.name), {
      comp: from.comp,
      season: from.season,
      perMin,
      fg2Pct: p.rates.fg2Pct * div(tl.fg2Pct, fl.fg2Pct, 1),
      fg3Pct: p.rates.fg3Pct * div(tl.fg3Pct, fl.fg3Pct, 1),
      ftPct: p.rates.ftPct,
      minutes,
      position: p.position,
    });
  }
  return m;
}

export async function buildSnapshot(comp: CompetitionId) {
  const cur = readJson<SeasonGamesFile>(`data/games/${comp}/${CURRENT_SEASON}.json`);
  const prev = readJson<SeasonGamesFile>(`data/games/${comp}/${PREVIOUS_SEASON}.json`);
  const roster = readJson<RosterFile>(`data/games/${comp}/roster-${CURRENT_SEASON}.json`);
  if (!cur && !prev) throw new Error(`No hay partidos descargados de ${comp}`);
  const manual = (readJson<(InjuryEntry & { comp: CompetitionId })[]>('data/manual/bajas.json') ?? []).filter((x) => x.comp === comp);
  const teams: BuildInput['teams'] = {};
  for (const t of roster?.teams ?? Object.values(cur?.teams ?? prev?.teams ?? {})) teams[t.id] = t;
  const playerInfo: Record<string, PlayerInfo> = { ...(prev?.players ?? {}), ...(cur?.players ?? {}) };
  for (const p of roster?.players ?? []) playerInfo[p.id] = { ...(playerInfo[p.id] ?? {}), ...p };
  const sources = SOURCES[comp].map((s) => ({ ...s, fetchedAt: cur?.fetchedAt ?? prev?.fetchedAt ?? '' }));
  const base: BuildInput = {
    comp,
    season: CURRENT_SEASON,
    previousSeason: PREVIOUS_SEASON,
    gamesCurrent: cur?.games ?? [],
    gamesPrevious: prev?.games ?? [],
    teams,
    playerInfo,
    roster: roster?.players ?? null,
    manualInjuries: manual,
    sources,
  };
  // Prior entre competiciones europeas (EuroLiga <-> ACB) para jugadores con pocos datos
  let crossComp: Map<string, CrossCompPrior> | undefined;
  const other = comp === 'acb' ? 'euroleague' : comp === 'euroleague' ? 'acb' : null;
  if (other) {
    const otherSnap = readJson<CompetitionSnapshot>(`data/snapshot/${other}.json`);
    if (otherSnap) {
      const first = buildCompetitionSnapshot(base);
      crossComp = crossCompPriors(otherSnap, first.league);
    }
  }
  const snap = buildCompetitionSnapshot({ ...base, crossComp });
  if (roster?.notes) snap.notes.push(...roster.notes);
  if (cur?.notes?.length) snap.notes.push(...cur.notes.filter((n) => n.startsWith('Titulares')));
  const problems = validateSnapshot(snap);
  if (problems.errors.length) {
    throw new Error(`Snapshot de ${comp} no válido: ${problems.errors.slice(0, 5).join('; ')}`);
  }
  snap.notes.push(...problems.warnings.slice(0, 30));
  writeJson(`data/snapshot/${comp}.json`, snap);
  log(`Snapshot ${comp}: ${snap.teams.length} equipos, ${snap.players.length} jugadores, ${snap.injuries.length} bajas/ausencias`);
  return snap;
}
