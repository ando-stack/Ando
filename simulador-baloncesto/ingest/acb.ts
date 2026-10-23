/**
 * Ingesta de la Liga Endesa (ACB) desde las páginas públicas de acb.com y live.acb.com.
 * robots.txt de ambos dominios permite el acceso (Allow: /). El aviso legal de ACEB, S.A.U.
 * autoriza la descarga y almacenamiento para uso personal citando la fuente; su redistribución
 * o comunicación pública requiere consentimiento previo de la ACB.
 *
 * No se usa la API privada api2.acb.com (requiere una clave que no se nos ha concedido).
 */
import { fetchText, dropCache } from './lib/http';
import type { GameRecord, PlayerInfo, PlayerLine, RosterFile, SeasonGamesFile, TeamInfo } from '../engine/datatypes';
import { log, normPosition, writeJson, readJson } from './lib/util';

export const ACB_SOURCE = 'ACB – acb.com / live.acb.com (páginas públicas de equipos y estadísticas de partido)';
const LIGA_COMPETITION_ID = 1;

/** Edición de la ACB (editionId) por temporada, tal y como la usa acb.com. */
export const ACB_EDITION: Record<string, number> = { '2024-25': 89, '2025-26': 90, '2026-27': 91 };

/** Extrae y decodifica el flujo de datos de React Server Components de una página Next.js. */
export function parseFlight(html: string): any[] {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)<\/script>/g;
  let s = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) s += JSON.parse('"' + m[1] + '"');
  const out: any[] = [];
  for (const line of s.split('\n')) {
    const mm = /^([0-9a-f]+):(.*)$/.exec(line);
    if (!mm) continue;
    const body = mm[2];
    if (!body || !'[{"'.includes(body[0])) continue;
    try {
      out.push(JSON.parse(body));
    } catch {
      /* línea de texto u otro formato: se ignora */
    }
  }
  return out;
}

export function findObjects(root: any, pred: (o: any) => boolean, acc: any[] = []): any[] {
  if (Array.isArray(root)) for (const v of root) findObjects(v, pred, acc);
  else if (root && typeof root === 'object') {
    if (pred(root)) acc.push(root);
    for (const v of Object.values(root)) findObjects(v, pred, acc);
  }
  return acc;
}

function playTime(s: string | null | undefined): number {
  const m = /^(\d+):(\d+)$/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export interface AcbMatchParsed {
  matchId: number;
  competitionId: number;
  editionId: number | null;
  start: string;
  status: string;
  home: { team: any; score: number; periods: number[]; boxscore: any | null };
  away: { team: any; score: number; periods: number[]; boxscore: any | null };
}

export function parseAcbMatch(html: string): AcbMatchParsed | null {
  const objs = parseFlight(html);
  const header = findObjects(objs, (o) => o.initialMatchHeader && typeof o.initialMatchHeader === 'object')[0]
    ?.initialMatchHeader;
  if (!header) return null;
  const boxes = findObjects(objs, (o) => Array.isArray(o.teamBoxscores))[0]?.teamBoxscores ?? [];
  const qs: { quarter: number; home: number; away: number }[] = (header.quarterScores ?? []).sort(
    (a: any, b: any) => a.quarter - b.quarter,
  );
  const findBox = (teamId: number) => boxes.find((b: any) => b.team?.id === teamId) ?? null;
  return {
    matchId: header.matchId,
    competitionId: header.competitionId,
    editionId: header.teams?.home?.editionId ?? null,
    start: header.start,
    status: header.status,
    home: {
      team: header.teams.home,
      score: header.currentHomeScore,
      periods: qs.map((q) => q.home),
      boxscore: findBox(header.teams.home.id),
    },
    away: {
      team: header.teams.away,
      score: header.currentAwayScore,
      periods: qs.map((q) => q.away),
      boxscore: findBox(header.teams.away.id),
    },
  };
}

export async function fetchAcbMatch(id: number, finishedCache = true): Promise<AcbMatchParsed | null> {
  // acb.com/partido/estadisticas/id/{id} redirige a la página de estadísticas de live.acb.com
  const url = `https://acb.com/partido/estadisticas/id/${id}`;
  const html = await fetchText(url, { maxAgeHours: finishedCache ? Infinity : 3, allow404: true });
  if (!html) return null;
  const m = parseAcbMatch(html);
  // Solo los partidos terminados se quedan en caché de forma indefinida.
  if (!m || m.status !== 'FINALIZED') dropCache(url);
  return m;
}

function clubKey(team: any): string {
  return String(team.clubId); // el clubId es estable entre temporadas
}

function toLines(box: any, players: Record<string, PlayerInfo>, teamId: string): PlayerLine[] {
  const periods: any[] = box.statsByPeriods ?? [];
  const full = periods.find((p) => p.quarter === 0);
  if (!full) return [];
  const byQ = new Map<number, Map<number, number>>();
  for (const p of periods) {
    if (p.quarter === 0) continue;
    const m = new Map<number, number>();
    for (const l of p.stats.players ?? []) m.set(l.player.id, playTime(l.playTime));
    byQ.set(p.quarter, m);
  }
  const lines: PlayerLine[] = [];
  for (const l of full.stats.players ?? []) {
    const pl = l.player;
    const pid = String(pl.id);
    if (!players[pid]) {
      players[pid] = {
        id: pid,
        name: `${pl.firstName ?? ''} ${pl.lastName ?? ''}`.trim() || pl.firstInitialAndLastName,
        teamId,
        position: normPosition(pl.gameRole),
        positionRaw: pl.gameRole ?? null,
        jersey: pl.shirtNumber ?? null,
      };
    }
    players[pid].teamId = teamId;
    const sec = playTime(l.playTime);
    const q = [1, 2, 3, 4].map((k) => byQ.get(k)?.get(pl.id) ?? 0);
    let ot = 0;
    for (const [k, m] of byQ) if (k > 4) ot += m.get(pl.id) ?? 0;
    const qsum = q.reduce((a, b) => a + b, 0) + ot;
    const qOk = byQ.size >= 4 && Math.abs(qsum - sec) <= 60;
    lines.push([
      pid,
      l.isStarted ? 1 : 0,
      sec,
      l.points ?? 0,
      l.twoPointersMade ?? 0,
      l.twoPointersAttempted ?? 0,
      l.threePointersMade ?? 0,
      l.threePointersAttempted ?? 0,
      l.freeThrowsMade ?? 0,
      l.freeThrowsAttempted ?? 0,
      l.offRebounds ?? 0,
      l.defRebounds ?? 0,
      l.assists ?? 0,
      l.steals ?? 0,
      l.blocks ?? 0,
      l.turnovers ?? 0,
      l.personalFouls ?? 0,
      l.foulsDrawn ?? 0,
      ...(qOk ? [...q, ot] : [-1, -1, -1, -1, -1]),
    ]);
  }
  return lines;
}

/**
 * Recorre los identificadores de partido (son correlativos) dentro de un rango y guarda los
 * partidos de Liga Endesa terminados de la temporada indicada.
 */
export async function ingestAcbSeason(season: string, ranges: [number, number][], stopAfterMisses = 0) {
  const edition = ACB_EDITION[season];
  const teams: Record<string, TeamInfo> = {};
  const players: Record<string, PlayerInfo> = {};
  const games: GameRecord[] = [];
  const notes: string[] = [];
  let checked = 0;
  let misses = 0;
  const ids = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k));
  for (const id of ids) {
    if (stopAfterMisses && misses >= stopAfterMisses) break;
    checked++;
    if (checked % 25 === 0) log(`  ACB ${season}: id ${id} (${games.length} partidos)`);
    let m: AcbMatchParsed | null = null;
    try {
      m = await fetchAcbMatch(id, true);
    } catch (e) {
      notes.push(`Error en partido ${id}: ${(e as Error).message}`);
      continue;
    }
    if (!m || m.competitionId !== LIGA_COMPETITION_ID || m.editionId !== edition) {
      misses++;
      continue;
    }
    if (m.status !== 'FINALIZED') {
      misses++;
      // No terminado: se vuelve a pedir la próxima vez (borrar de la caché no es necesario,
      // la lectura con caché corta se hace en la actualización diaria).
      continue;
    }
    if (!m.home.boxscore || !m.away.boxscore) {
      notes.push(`Partido ${id} sin box score`);
      continue;
    }
    misses = 0;
    const side = (s: AcbMatchParsed['home']) => {
      const t = s.team;
      const tid = clubKey(t);
      teams[tid] = { id: tid, name: t.fullName, short: t.abbreviatedName ?? t.shortName, logo: t.logo ?? null };
      const lines = toLines(s.boxscore, players, tid);
      const full = s.boxscore.statsByPeriods.find((p: any) => p.quarter === 0);
      return {
        teamId: tid,
        score: s.score,
        periods: s.periods,
        players: lines,
        teamReb: full?.stats?.team?.totalRebounds ?? 0,
      };
    };
    const rec: GameRecord = { id: `ACB_${m.matchId}`, date: m.start, home: side(m.home), away: side(m.away) };
    for (const s of [rec.home, rec.away]) {
      const sum = s.players.reduce((a, p) => a + (p[3] as number), 0);
      if (sum !== s.score) notes.push(`Aviso ${rec.id}: suma de puntos ${sum} ≠ marcador ${s.score}`);
      const per = s.periods.reduce((a, b) => a + b, 0);
      if (per !== s.score) notes.push(`Aviso ${rec.id}: suma de cuartos ${per} ≠ marcador ${s.score}`);
    }
    games.push(rec);
  }
  games.sort((a, b) => a.date.localeCompare(b.date));
  const file: SeasonGamesFile = {
    comp: 'acb',
    season,
    fetchedAt: new Date().toISOString(),
    source: ACB_SOURCE,
    teams,
    players,
    games,
    notes,
  };
  writeJson(`data/games/acb/${season}.json`, file);
  log(`ACB ${season}: ${games.length} partidos guardados`);
  return file;
}

/** Plantillas actuales desde acb.com/es/liga/equipos/{slug}/plantilla */
export async function ingestAcbRoster(season: string): Promise<RosterFile> {
  const listHtml = await fetchText('https://acb.com/es/liga/equipos', { maxAgeHours: 12 });
  const slugs = [...new Set([...listHtml!.matchAll(/href="\/es\/liga\/equipos\/([a-z0-9\-]+-\d+)"/g)].map((m) => m[1]))];
  const teams: TeamInfo[] = [];
  const players: PlayerInfo[] = [];
  const notes: string[] = [];
  for (const slug of slugs) {
    const clubId = slug.split('-').pop()!;
    const html = await fetchText(`https://acb.com/es/liga/equipos/${slug}/plantilla`, { maxAgeHours: 12 });
    const objs = parseFlight(html!);
    const teamObj = findObjects(objs, (o) => o.clubId === Number(clubId) && typeof o.fullName === 'string')[0];
    teams.push({
      id: clubId,
      name: teamObj?.fullName ?? slug,
      short: teamObj?.abbreviatedName ?? slug,
      logo: teamObj?.logo ?? null,
    });
    // Jugadores de la plantilla: objetos {player:{...}, licensing, height, nationalityCountry,...}
    const rows = findObjects(
      objs,
      (o) => o.player && typeof o.player === 'object' && typeof o.player.id === 'number' && 'licensing' in o,
    );
    const seen = new Set<string>();
    for (const r of rows) {
      const p = r.player;
      const pid = String(p.id);
      if (seen.has(pid)) continue;
      if (r.isLicenseActive === false) continue;
      if (p.editionId && p.editionId !== ACB_EDITION[season]) continue;
      seen.add(pid);
      players.push({
        id: pid,
        name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
        teamId: clubId,
        position: normPosition(p.gameRole),
        positionRaw: p.gameRole ?? null,
        height: r.height ?? null,
        nationality: r.nationalityCountry ?? null,
        jersey: p.shirtNumber ?? null,
        birthDate: null,
        extra: { licencia: r.licensing ?? null, edad: r.age ?? null },
      });
    }
    if (seen.size < 8) notes.push(`Plantilla corta (${seen.size}) en ${slug}`);
  }
  const file: RosterFile = {
    comp: 'acb',
    season,
    fetchedAt: new Date().toISOString(),
    source: ACB_SOURCE,
    teams,
    players,
    notes,
  };
  writeJson(`data/games/acb/roster-${season}.json`, file);
  log(`ACB plantillas ${season}: ${teams.length} equipos, ${players.length} jugadores`);
  return file;
}

export function loadAcbSeason(season: string) {
  return readJson<SeasonGamesFile>(`data/games/acb/${season}.json`);
}
