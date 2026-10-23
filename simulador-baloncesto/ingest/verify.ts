/**
 * Verificación de datos contra la fuente.
 *   npx tsx ingest/verify.ts
 * Compara valores calculados a partir de nuestros box scores (data/games) con las estadísticas
 * agregadas que publica cada fuente por otra vía (endpoint o página distinta), y escribe el
 * resultado en data/verificacion.json (se resume en docs/validacion.md).
 */
import { fetchJson, fetchText } from './lib/http';
import { readJson, writeJson, normName } from './lib/util';
import { parseFlight, findObjects } from './acb';
import type { SeasonGamesFile } from '../engine/datatypes';
import { PL } from '../engine/datatypes';
import { CURRENT_SEASON } from '../config/temporadas';

interface Check {
  comp: string;
  what: string;
  ours: number | string;
  source: number | string;
  sourceRef: string;
  ok: boolean;
}

function sumPlayer(file: SeasonGamesFile, pid: string) {
  const t = { gp: 0, pts: 0, ast: 0, reb: 0, fg3m: 0, min: 0 };
  for (const g of file.games)
    for (const s of [g.home, g.away])
      for (const p of s.players)
        if (p[0] === pid && (p[PL.sec] as number) > 0) {
          t.gp++;
          t.pts += p[PL.pts] as number;
          t.ast += p[PL.ast] as number;
          t.reb += (p[PL.oreb] as number) + (p[PL.dreb] as number);
          t.fg3m += p[PL.fg3m] as number;
          t.min += (p[PL.sec] as number) / 60;
        }
  return t;
}

const checks: Check[] = [];
const add = (c: Omit<Check, 'ok'>, tol = 0) =>
  checks.push({ ...c, ok: typeof c.ours === 'number' && typeof c.source === 'number' ? Math.abs(c.ours - c.source) <= tol : c.ours === c.source });

// ---------------- EuroLiga: estadísticas acumuladas oficiales (v3) frente a la suma de box scores
{
  const file = readJson<SeasonGamesFile>(`data/games/euroleague/${CURRENT_SEASON}.json`)!;
  const url = `https://api-live.euroleague.net/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=E${CURRENT_SEASON.slice(0, 4)}&statisticMode=Accumulated&limit=1000`;
  const off = await fetchJson<any>(url, { maxAgeHours: 1 });
  const players = (off.players as any[]).sort((a, b) => b.pointsScored - a.pointsScored);
  for (const row of players.slice(0, 3)) {
    const pid = row.player.code;
    const s = sumPlayer(file, pid);
    add({ comp: 'EuroLiga', what: `Puntos totales ${CURRENT_SEASON} de ${row.player.name}`, ours: s.pts, source: row.pointsScored, sourceRef: url });
    add({ comp: 'EuroLiga', what: `Partidos jugados ${CURRENT_SEASON} de ${row.player.name}`, ours: s.gp, source: row.gamesPlayed, sourceRef: url });
  }
  const tUrl = `https://api-live.euroleague.net/v3/competitions/E/statistics/teams/traditional?seasonMode=Single&seasonCode=E${CURRENT_SEASON.slice(0, 4)}&statisticMode=Accumulated`;
  const teams = await fetchJson<any>(tUrl, { maxAgeHours: 1 });
  const t0 = teams.teams[0];
  let ast = 0;
  for (const g of file.games) for (const s of [g.home, g.away]) if (s.teamId === t0.team.code) for (const p of s.players) ast += p[PL.ast] as number;
  add({ comp: 'EuroLiga', what: `Asistencias totales de ${t0.team.name}`, ours: ast, source: t0.assists, sourceRef: tUrl });
}

// ---------------- ACB: página de estadísticas de un equipo frente a la suma de box scores
{
  const file = readJson<SeasonGamesFile>(`data/games/acb/${CURRENT_SEASON}.json`)!;
  for (const slug of ['real-madrid-9', 'valencia-basket-13']) {
    const url = `https://acb.com/es/liga/equipos/${slug}/estadisticas`;
    const html = await fetchText(url, { maxAgeHours: 1 });
    const objs = parseFlight(html!);
    const rows = findObjects(objs, (o) => o.player && typeof o.player.id === 'number' && o.totals && typeof o.totals.points === 'number');
    const best = rows.sort((a, b) => b.totals.points - a.totals.points)[0];
    const pid = String(best.player.id);
    const s = sumPlayer(file, pid);
    const name = `${best.player.firstName} ${best.player.lastName}`;
    add({ comp: 'ACB', what: `Puntos totales ${CURRENT_SEASON} de ${name}`, ours: s.pts, source: best.totals.points, sourceRef: url });
    add({ comp: 'ACB', what: `Asistencias totales ${CURRENT_SEASON} de ${name}`, ours: s.ast, source: best.totals.assists, sourceRef: url });
  }
}

// ---------------- NBA: totales de pbpstats (get-totals) frente a la suma de box scores por partido
{
  const file = readJson<SeasonGamesFile>(`data/games/nba/${CURRENT_SEASON}.json`)!;
  const url = `https://api.pbpstats.com/get-totals/nba?Season=${CURRENT_SEASON}&SeasonType=Regular%2BSeason&Type=Player`;
  const tot = await fetchJson<any>(url, { maxAgeHours: 1 });
  const rows = (tot.multi_row_table_data as any[]).sort((a, b) => b.Points - a.Points);
  for (const r of rows.slice(0, 2)) {
    const s = sumPlayer(file, r.EntityId);
    add({ comp: 'NBA', what: `Puntos totales ${CURRENT_SEASON} de ${r.Name}`, ours: s.pts, source: r.Points, sourceRef: url });
    add({ comp: 'NBA', what: `Rebotes totales ${CURRENT_SEASON} de ${r.Name}`, ours: s.reb, source: r.Rebounds ?? (r.OffRebounds ?? 0) + (r.DefRebounds ?? 0), sourceRef: url });
  }
  const g = file.games[0];
  const gl = await fetchJson<any>(`https://api.pbpstats.com/get-games/nba?Season=${CURRENT_SEASON}&SeasonType=Regular%2BSeason`, { maxAgeHours: 1 });
  const og = (gl.results as any[]).find((x) => x.GameId === g.id);
  add({ comp: 'NBA', what: `Resultado del partido ${g.id} (${g.date})`, ours: `${g.home.score}-${g.away.score}`, source: `${og.HomePoints}-${og.AwayPoints}`, sourceRef: 'https://api.pbpstats.com/get-games/nba' });
}

writeJson('data/verificacion.json', { verifiedAt: new Date().toISOString(), checks });
for (const c of checks) console.log(`${c.ok ? 'OK ' : 'MAL'} ${c.comp} · ${c.what}: nuestro ${c.ours} / fuente ${c.source}`);
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} coinciden`);
void normName;
