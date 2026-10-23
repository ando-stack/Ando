/**
 * Ingesta de la EuroLiga desde la API oficial pública de Euroleague Basketball:
 *  - https://api-live.euroleague.net (clubes, plantillas, calendario, box scores)
 *  - https://live.euroleague.net/api/PlayByPlay (jugada a jugada: minutos por cuarto)
 * Uso personal no comercial, citando a Euroleague Basketball como fuente.
 */
import { fetchJson } from './lib/http';
import type { GameRecord, PlayerInfo, PlayerLine, RosterFile, SeasonGamesFile, TeamInfo } from '../engine/datatypes';
import { log, normPosition, writeJson } from './lib/util';

const API = 'https://api-live.euroleague.net';
const LIVE = 'https://live.euroleague.net/api';
export const EL_SOURCE = 'Euroleague Basketball – API oficial (api-live.euroleague.net, live.euroleague.net)';

export function elSeasonCode(season: string) {
  return 'E' + season.slice(0, 4); // '2026-27' -> E2026
}

const POS: Record<number, string> = { 1: 'G', 2: 'F', 3: 'C' };

function mmss(s: string): number {
  const m = /^(\d+):(\d+)$/.exec((s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

interface PbpEvent {
  PLAYTYPE: string;
  PLAYER_ID: string | null;
  CODETEAM: string;
  MARKERTIME: string;
}

/**
 * Calcula segundos en pista por periodo para cada jugador a partir del jugada a jugada.
 * Devuelve null si el jugada a jugada no es coherente.
 */
export function minutesByPeriodFromPbp(
  pbp: any,
  starters: Record<string, string[]>,
): Map<string, number[]> | null {
  const quarters = ['FirstQuarter', 'SecondQuarter', 'ThirdQuarter', 'ForthQuarter'];
  const out = new Map<string, number[]>(); // pid -> [q1,q2,q3,q4,ot]
  const onCourt = new Map<string, Set<string>>();
  for (const [team, five] of Object.entries(starters)) onCourt.set(team, new Set(five));
  const add = (pid: string, idx: number, s: number) => {
    if (!out.has(pid)) out.set(pid, [0, 0, 0, 0, 0]);
    out.get(pid)![idx] += s;
  };
  const runPeriod = (events: PbpEvent[], idx: number, length: number) => {
    let last = length; // segundos restantes
    const flush = (t: number) => {
      const d = last - t;
      if (d > 0) for (const set of onCourt.values()) for (const pid of set) add(pid, idx, d);
      last = t;
    };
    for (const e of events) {
      if (e.PLAYTYPE !== 'IN' && e.PLAYTYPE !== 'OUT') continue;
      const t = mmss(e.MARKERTIME);
      if (Number.isFinite(t) && t <= last) flush(t);
      const team = (e.CODETEAM || '').trim();
      const pid = (e.PLAYER_ID || '').trim().replace(/^P/, '');
      if (!team || !pid) continue;
      if (!onCourt.has(team)) onCourt.set(team, new Set());
      if (e.PLAYTYPE === 'IN') onCourt.get(team)!.add(pid);
      else onCourt.get(team)!.delete(pid);
    }
    flush(0);
  };
  for (let q = 0; q < 4; q++) runPeriod(pbp[quarters[q]] ?? [], q, 600);
  const ot: PbpEvent[] = pbp.ExtraTime ?? [];
  if (ot.length) {
    // Cada prórroga empieza con un evento BP (Begin Period)
    const periods: PbpEvent[][] = [];
    for (const e of ot) {
      if (e.PLAYTYPE === 'BP' || periods.length === 0) periods.push([]);
      periods[periods.length - 1].push(e);
    }
    for (const p of periods) runPeriod(p, 4, 300);
  }
  for (const set of onCourt.values()) if (set.size !== 5) return null;
  return out;
}

export async function ingestEuroleagueSeason(season: string, opts: { withPbp: boolean; maxAgeHours: number }) {
  const sc = elSeasonCode(season);
  log(`EuroLiga ${season}: clubes y calendario`);
  const clubs = await fetchJson<any>(`${API}/v2/competitions/E/seasons/${sc}/clubs`, { maxAgeHours: opts.maxAgeHours });
  const teams: Record<string, TeamInfo> = {};
  for (const c of clubs.data) {
    teams[c.code] = { id: c.code, name: c.name, short: c.abbreviatedName ?? c.name, logo: c.images?.crest ?? null };
  }
  const gamesJson = await fetchJson<any>(`${API}/v2/competitions/E/seasons/${sc}/games`, { maxAgeHours: opts.maxAgeHours });
  const played = (gamesJson.data as any[]).filter((g) => g.played).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const players: Record<string, PlayerInfo> = {};
  const games: GameRecord[] = [];
  const notes: string[] = [];
  let i = 0;
  for (const g of played) {
    i++;
    if (i % 25 === 0) log(`  partido ${i}/${played.length}`);
    // Partidos terminados: la caché no caduca.
    const box = await fetchJson<any>(`${API}/v2/competitions/E/seasons/${sc}/games/${g.gameCode}/stats`, {
      maxAgeHours: Infinity,
      allow404: true,
    });
    if (!box) {
      notes.push(`Sin box score: ${sc} partido ${g.gameCode}`);
      continue;
    }
    const sideCodes = { local: g.local.club.code as string, road: g.road.club.code as string };
    const starters: Record<string, string[]> = {};
    for (const side of ['local', 'road'] as const) {
      starters[sideCodes[side]] = box[side].players
        .filter((p: any) => p.stats.startFive)
        .map((p: any) => p.player.person.code);
    }
    let qmin: Map<string, number[]> | null = null;
    if (opts.withPbp) {
      const pbp = await fetchJson<any>(`${LIVE}/PlayByPlay?gamecode=${g.gameCode}&seasoncode=${sc}`, {
        maxAgeHours: Infinity,
        allow404: true,
      });
      if (pbp) qmin = minutesByPeriodFromPbp(pbp, starters);
    }
    const mkSide = (side: 'local' | 'road') => {
      const s = g[side];
      const periods = [s.partials.partials1, s.partials.partials2, s.partials.partials3, s.partials.partials4];
      const ex = s.partials.extraPeriods ?? {};
      for (const k of Object.keys(ex).sort((a, b) => Number(a) - Number(b))) periods.push(ex[k]);
      const lines: PlayerLine[] = [];
      for (const p of box[side].players) {
        const st = p.stats;
        const pid: string = p.player.person.code;
        const sec = Math.round(st.timePlayed ?? 0);
        if (!players[pid]) {
          const per = p.player.person;
          players[pid] = {
            id: pid,
            name: per.name,
            teamId: sideCodes[side],
            position: POS[p.player.position] ?? null,
            positionRaw: p.player.positionName ?? null,
            height: per.height || null,
            birthDate: per.birthDate?.slice(0, 10) ?? null,
            nationality: per.country?.code ?? null,
            jersey: p.player.dorsal ?? null,
          };
        }
        players[pid].teamId = sideCodes[side];
        let q = qmin?.get(pid) ?? null;
        // Si el reparto por cuartos no cuadra con los segundos del box score, se descarta para ese jugador.
        if (q && Math.abs(q.reduce((a, b) => a + b, 0) - sec) > 90) q = null;
        lines.push([
          pid,
          st.startFive ? 1 : 0,
          sec,
          st.points,
          st.fieldGoalsMade2,
          st.fieldGoalsAttempted2,
          st.fieldGoalsMade3,
          st.fieldGoalsAttempted3,
          st.freeThrowsMade,
          st.freeThrowsAttempted,
          st.offensiveRebounds,
          st.defensiveRebounds,
          st.assistances,
          st.steals,
          st.blocksFavour,
          st.turnovers,
          st.foulsCommited,
          st.foulsReceived,
          ...(q ? q.map(Math.round) : [-1, -1, -1, -1, -1]),
        ]);
      }
      return {
        teamId: sideCodes[side],
        score: s.score,
        periods,
        players: lines,
        teamReb: box[side].team?.totalRebounds ?? 0,
      };
    };
    const rec: GameRecord = {
      id: `${sc}_${g.gameCode}`,
      date: g.utcDate,
      phase: g.phaseType?.code,
      home: mkSide('local'),
      away: mkSide('road'),
    };
    // Validación: la suma de puntos de jugadores debe coincidir con el marcador
    for (const s of [rec.home, rec.away]) {
      const sum = s.players.reduce((a, p) => a + (p[3] as number), 0);
      if (sum !== s.score) notes.push(`Aviso ${rec.id}: suma de puntos de jugadores ${sum} ≠ marcador ${s.score}`);
    }
    games.push(rec);
  }
  const file: SeasonGamesFile = {
    comp: 'euroleague',
    season,
    fetchedAt: new Date().toISOString(),
    source: EL_SOURCE,
    teams,
    players,
    games,
    notes,
  };
  writeJson(`data/games/euroleague/${season}.json`, file);
  log(`EuroLiga ${season}: ${games.length} partidos guardados`);
  return file;
}

export async function ingestEuroleagueRoster(season: string): Promise<RosterFile> {
  const sc = elSeasonCode(season);
  const clubs = await fetchJson<any>(`${API}/v2/competitions/E/seasons/${sc}/clubs`, { maxAgeHours: 12 });
  const teams: TeamInfo[] = [];
  const players: PlayerInfo[] = [];
  for (const c of clubs.data) {
    teams.push({ id: c.code, name: c.name, short: c.abbreviatedName ?? c.name, logo: c.images?.crest ?? null });
    const people = await fetchJson<any[]>(`${API}/v2/competitions/E/seasons/${sc}/clubs/${c.code}/people`, {
      maxAgeHours: 12,
    });
    for (const p of people ?? []) {
      if (p.type !== 'J' || p.active === false) continue;
      if (p.endDate && new Date(p.endDate) < new Date()) continue;
      const per = p.person;
      players.push({
        id: per.code,
        name: per.name,
        teamId: c.code,
        position: POS[p.position] ?? null,
        positionRaw: p.positionName ?? null,
        height: per.height || null,
        birthDate: per.birthDate?.slice(0, 10) ?? null,
        nationality: per.country?.code ?? null,
        jersey: p.dorsal || null,
        extra: { lastTeam: p.lastTeam || null },
      });
    }
  }
  const file: RosterFile = {
    comp: 'euroleague',
    season,
    fetchedAt: new Date().toISOString(),
    source: EL_SOURCE,
    teams,
    players,
  };
  writeJson(`data/games/euroleague/roster-${season}.json`, file);
  log(`EuroLiga plantillas ${season}: ${teams.length} equipos, ${players.length} jugadores`);
  return file;
}

/** Estadísticas agregadas oficiales (para verificación y como dato previo del backtest). */
export async function fetchEuroleagueAggregates(season: string) {
  const sc = elSeasonCode(season);
  const players = await fetchJson<any>(
    `${API}/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=${sc}&statisticMode=Accumulated&limit=1000`,
    { maxAgeHours: 12 },
  );
  const teams = await fetchJson<any>(
    `${API}/v3/competitions/E/statistics/teams/traditional?seasonMode=Single&seasonCode=${sc}&statisticMode=Accumulated`,
    { maxAgeHours: 12 },
  );
  return { players: players?.players ?? [], teams: teams?.teams ?? [] };
}

export { normPosition };
