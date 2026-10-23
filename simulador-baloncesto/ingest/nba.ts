/**
 * Ingesta de la NBA desde la API pública y documentada de PBP Stats (https://api.pbpstats.com,
 * documentación en https://api.pbpstats.com/docs). Los datos derivan del jugada a jugada oficial
 * de NBA.com: se citan ambas fuentes y se usan solo con fines personales no comerciales.
 *
 * Las APIs oficiales stats.nba.com / cdn.nba.com bloquean el acceso desde redes de centros de
 * datos y sus condiciones restringen el uso de las estadísticas (véase docs/fuentes.md).
 */
import { fetchJson } from './lib/http';
import type { GameRecord, PlayerInfo, PlayerLine, RosterFile, SeasonGamesFile, TeamInfo } from '../engine/datatypes';
import { NBA_TEAMS } from '../config/nba-equipos';
import { log, writeJson } from './lib/util';

const API = 'https://api.pbpstats.com';
export const NBA_SOURCE = 'PBP Stats API (api.pbpstats.com), datos derivados del jugada a jugada oficial de NBA.com';

function minutes(s: string | undefined): number {
  const m = /^(\d+):(\d+)$/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function teamInfo(id: string, abbr: string): TeamInfo {
  const t = NBA_TEAMS[abbr];
  return { id, name: t ? t.name : abbr, short: abbr, logo: null };
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Convierte las filas por periodo de get-game-stats en líneas normalizadas. */
export function nbaLinesFromGameStats(side: any, starters: Set<string> | null): { lines: PlayerLine[]; teamReb: number; names: Record<string, string> } {
  const full: any[] = side.FullGame ?? [];
  const periodKeys = Object.keys(side).filter((k) => k !== 'FullGame').map(Number).sort((a, b) => a - b);
  const secBy = new Map<string, number[]>();
  for (const k of periodKeys) {
    for (const r of side[String(k)] ?? []) {
      if (r.EntityId === '0') continue;
      if (!secBy.has(r.EntityId)) secBy.set(r.EntityId, [0, 0, 0, 0, 0]);
      secBy.get(r.EntityId)![Math.min(k, 5) - 1] += minutes(r.Minutes);
    }
  }
  // Titulares: si no se conocen por otra vía, los 5 con más segundos en el primer cuarto.
  let st = starters;
  if (!st || st.size !== 5) {
    const q1 = [...secBy.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 5).map((e) => e[0]);
    st = new Set(q1);
  }
  const lines: PlayerLine[] = [];
  const names: Record<string, string> = {};
  let teamReb = 0;
  for (const r of full) {
    if (r.EntityId === '0') {
      teamReb = n(r.Rebounds);
      continue;
    }
    names[r.EntityId] = r.Name;
    const sec = minutes(r.Minutes);
    const q = secBy.get(r.EntityId) ?? [0, 0, 0, 0, 0];
    const qOk = Math.abs(q.reduce((a, b) => a + b, 0) - sec) <= 60;
    lines.push([
      r.EntityId,
      st.has(r.EntityId) ? 1 : 0,
      sec,
      n(r.Points),
      n(r.FG2M),
      n(r.FG2A),
      n(r.FG3M),
      n(r.FG3A),
      n(r.FtPoints),
      n(r.FTA),
      n(r.OffRebounds),
      n(r.DefRebounds),
      n(r.Assists),
      n(r.Steals),
      n(r.Blocks),
      n(r.Turnovers),
      n(r.Fouls),
      n(r.FoulsDrawn),
      ...(qOk ? q : [-1, -1, -1, -1, -1]),
    ]);
  }
  return { lines, teamReb, names };
}

/**
 * Titulares reales por partido a partir de la distribución de tiempo en pista de cada jugador
 * (get-playing-time-distribution): titular = en pista en el segundo 0 del partido.
 */
export async function nbaStartersFromDistribution(season: string, teamPlayers: Record<string, string[]>) {
  const starters = new Map<string, Set<string>>(); // gameId -> set(pid)
  for (const [teamId, pids] of Object.entries(teamPlayers)) {
    for (const pid of pids) {
      const d = await fetchJson<any>(
        `${API}/get-playing-time-distribution/nba?Season=${season}&SeasonType=Regular%2BSeason&TeamId=${teamId}&PlayerId=${pid}`,
        { maxAgeHours: 20 },
      );
      for (const g of d?.results ?? []) {
        const poss: any[] = g.Possessions ?? [];
        if (!poss.length) continue;
        const first = Math.min(...poss.map((p) => p.StartTime));
        if (first <= 2) {
          if (!starters.has(g.GameId)) starters.set(g.GameId, new Set());
          starters.get(g.GameId)!.add(pid);
        }
      }
    }
  }
  return starters;
}

export async function ingestNbaSeason(
  season: string,
  opts: { exactStarters: boolean; maxAgeHours: number; seasonType?: 'Regular Season' | 'Playoffs'; cacheOnly?: boolean },
) {
  const st = (opts.seasonType ?? 'Regular Season').replace(' ', '%2B');
  const teamsList = await fetchJson<any>(`${API}/get-teams/nba`, { maxAgeHours: 24 * 7 });
  const teams: Record<string, TeamInfo> = {};
  for (const t of teamsList.teams) teams[t.id] = teamInfo(t.id, t.text);
  const gl = await fetchJson<any>(`${API}/get-games/nba?Season=${season}&SeasonType=${st}`, {
    maxAgeHours: opts.maxAgeHours,
  });
  const list: any[] = (gl?.results ?? []).sort((a: any, b: any) => (a.Date + a.GameId).localeCompare(b.Date + b.GameId));
  log(`NBA ${season}: ${list.length} partidos jugados`);
  let starterMap: Map<string, Set<string>> | null = null;
  if (opts.exactStarters) {
    const teamPlayers: Record<string, string[]> = {};
    for (const id of Object.keys(teams)) {
      const tp = await fetchJson<any>(
        `${API}/get-team-players-for-season?Season=${season}&SeasonType=${st}&TeamId=${id}`,
        { maxAgeHours: 20 },
      );
      teamPlayers[id] = Object.keys(tp?.players ?? {});
    }
    log(`NBA ${season}: titulares exactos (distribución de minutos de ${Object.values(teamPlayers).flat().length} jugadores)`);
    starterMap = await nbaStartersFromDistribution(season, teamPlayers);
  }
  const players: Record<string, PlayerInfo> = {};
  const games: GameRecord[] = [];
  const notes: string[] = [];
  let i = 0;
  for (const g of list) {
    i++;
    if (i % 50 === 0) log(`  NBA ${season}: partido ${i}/${list.length}`);
    let d: any = null;
    try {
      d = await fetchJson<any>(`${API}/get-game-stats?GameId=${g.GameId}&Type=Player`, { maxAgeHours: Infinity, cacheOnly: opts.cacheOnly });
      if (!d && opts.cacheOnly) continue;
    } catch (e) {
      // La fuente falla a veces (502/504): se omite el partido y se anota; la próxima ejecución lo reintenta
      notes.push(`Partido ${g.GameId} omitido por error de la fuente: ${(e as Error).message}`);
      continue;
    }
    if (!d?.stats?.Home || !d?.stats?.Away) {
      notes.push(`Sin estadísticas: ${g.GameId}`);
      continue;
    }
    const mk = (sideKey: 'Home' | 'Away', teamId: string, score: number) => {
      const s = starterMap?.get(g.GameId);
      const startersSide = s ? new Set([...s].filter((pid) => (d.stats[sideKey].FullGame ?? []).some((r: any) => r.EntityId === pid))) : null;
      const { lines, teamReb, names } = nbaLinesFromGameStats(d.stats[sideKey], startersSide);
      for (const [pid, name] of Object.entries(names)) {
        players[pid] = { ...(players[pid] ?? { id: pid, name, position: null }), teamId };
      }
      const tr = d.team_results?.[sideKey] ?? {};
      const periods = Object.keys(tr)
        .filter((k) => k !== 'FullGame')
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => n(tr[String(k)]?.Points));
      return { teamId, score, periods, players: lines, teamReb };
    };
    const rec: GameRecord = {
      id: g.GameId,
      date: g.Date,
      phase: opts.seasonType === 'Playoffs' ? 'PO' : 'RS',
      home: mk('Home', g.HomeTeamId, g.HomePoints),
      away: mk('Away', g.AwayTeamId, g.AwayPoints),
    };
    for (const s of [rec.home, rec.away]) {
      const sum = s.players.reduce((a, p) => a + (p[3] as number), 0);
      if (sum !== s.score) notes.push(`Aviso ${rec.id}: suma de puntos ${sum} ≠ marcador ${s.score}`);
      const per = s.periods.reduce((a, b) => a + b, 0);
      if (per !== s.score) notes.push(`Aviso ${rec.id}: suma de periodos ${per} ≠ marcador ${s.score}`);
    }
    games.push(rec);
  }
  const file: SeasonGamesFile = {
    comp: 'nba',
    season,
    fetchedAt: new Date().toISOString(),
    source: NBA_SOURCE,
    teams,
    players,
    games,
    notes: [
      ...(opts.exactStarters
        ? ['Titulares: exactos, a partir de la distribución de tiempo en pista (en pista en el segundo 0).']
        : ['Titulares: estimados como los 5 jugadores con más minutos en el primer cuarto (la fuente no los marca).']),
      ...notes,
    ],
  };
  writeJson(`data/games/nba/${season}.json`, file);
  log(`NBA ${season}: ${games.length} partidos guardados`);
  return file;
}

/** Plantilla: jugadores que han jugado con cada equipo en la temporada (la fuente no publica plantillas). */
export async function ingestNbaRoster(season: string, gamesFile: SeasonGamesFile): Promise<RosterFile> {
  const teams = Object.values(gamesFile.teams);
  const players: PlayerInfo[] = [];
  for (const t of teams) {
    const tp = await fetchJson<any>(
      `${API}/get-team-players-for-season?Season=${season}&SeasonType=Regular%2BSeason&TeamId=${t.id}`,
      { maxAgeHours: 20 },
    );
    for (const [pid, name] of Object.entries<string>(tp?.players ?? {})) {
      players.push({ id: pid, name, teamId: t.id, position: null });
    }
  }
  // Un jugador traspasado aparece en varios equipos: se queda en el de su último partido.
  const lastTeam = new Map<string, string>();
  for (const g of gamesFile.games) for (const s of [g.home, g.away]) for (const p of s.players) lastTeam.set(p[0] as string, s.teamId);
  const dedup = new Map<string, PlayerInfo>();
  for (const p of players) {
    const lt = lastTeam.get(p.id);
    if (lt && lt !== p.teamId) continue;
    dedup.set(p.id, p);
  }
  const file: RosterFile = {
    comp: 'nba',
    season,
    fetchedAt: new Date().toISOString(),
    source: NBA_SOURCE,
    teams,
    players: [...dedup.values()],
    notes: [
      'La fuente solo incluye jugadores que han disputado algún partido de la temporada con el equipo; los que aún no han debutado (por ejemplo, lesionados desde el inicio) no aparecen.',
    ],
  };
  writeJson(`data/games/nba/roster-${season}.json`, file);
  log(`NBA plantillas ${season}: ${teams.length} equipos, ${file.players.length} jugadores`);
  return file;
}

/**
 * Totales agregados de una temporada (jugadores, equipos y rivales) y resultados, con muy pocas
 * peticiones (get-totals ×3 + get-games). Se usan como temporada previa en el backtest de la NBA.
 */
export async function ingestNbaSeasonTotals(season: string) {
  const q = (type: string) => fetchJson<any>(`${API}/get-totals/nba?Season=${season}&SeasonType=Regular%2BSeason&Type=${type}`, { maxAgeHours: 24 * 30 });
  const players = (await q('Player'))?.multi_row_table_data ?? [];
  const teams = (await q('Team'))?.multi_row_table_data ?? [];
  const opps = (await q('Opponent'))?.multi_row_table_data ?? [];
  const games = (await fetchJson<any>(`${API}/get-games/nba?Season=${season}&SeasonType=Regular%2BSeason`, { maxAgeHours: 24 * 30 }))?.results ?? [];
  const pick = (r: any) => ({
    min: n(r.SecondsPlayed) / 60, pts: n(r.Points), fg2m: n(r.FG2M), fg2a: n(r.FG2A), fg3m: n(r.FG3M), fg3a: n(r.FG3A), ftm: n(r.FtPoints), fta: n(r.FTA),
    oreb: n(r.OffRebounds), dreb: n(r.DefRebounds), ast: n(r.Assists), stl: n(r.Steals), blk: n(r.Blocks), tov: n(r.Turnovers), pf: n(r.Fouls), pfd: n(r.FoulsDrawn),
  });
  const file = {
    comp: 'nba',
    season,
    fetchedAt: new Date().toISOString(),
    source: NBA_SOURCE,
    players: players.map((r: any) => ({ id: r.EntityId, name: r.Name, teamId: r.TeamId, gp: n(r.GamesPlayed), tot: pick(r) })),
    teams: teams.map((r: any) => ({ id: r.EntityId ?? r.TeamId, gp: n(r.GamesPlayed), poss: (n(r.OffPoss) + n(r.DefPoss)) / 2, own: pick(r) })),
    opponents: opps.map((r: any) => ({ id: r.EntityId ?? r.TeamId, opp: pick(r) })),
    games: games.map((g: any) => ({ id: g.GameId, date: g.Date, home: g.HomeTeamId, away: g.AwayTeamId, hs: g.HomePoints, as: g.AwayPoints })),
  };
  writeJson(`data/games/nba/totals-${season}.json`, file);
  log(`NBA totales ${season}: ${file.players.length} jugadores, ${file.teams.length} equipos, ${file.games.length} partidos`);
  return file;
}
