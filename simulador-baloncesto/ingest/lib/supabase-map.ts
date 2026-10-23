/**
 * Conversión entre el snapshot de una competición y las filas de las tablas de Supabase.
 * La usan el script de subida (ingesta) y la función de Netlify que sirve los datos.
 */
import type { CompetitionSnapshot, TeamSnapshot, PlayerSnapshot } from '../../engine/snapshot';
import type { CompetitionId } from '../../engine/datatypes';

export type Rows = Record<string, Record<string, unknown>[]>;

export function snapshotToRows(s: CompetitionSnapshot): Rows {
  const c = s.comp;
  const season = s.season;
  const base = { competition_id: c, season };
  return {
    seasons: [
      {
        ...base,
        previous_season: s.previousSeason,
        is_current: true,
        generated_at: s.generatedAt,
        last_game_date: s.lastGameDate,
        league: s.league,
        sources: s.sources,
        notes: s.notes,
      },
    ],
    teams: s.teams.map((t) => ({ ...base, id: t.id, name: t.name, short: t.short, logo: t.logo ?? null, blend_weights: t.blendWeights, home: t.home, away: t.away })),
    team_stats: s.teams.flatMap((t) =>
      (['current', 'previous', 'blended'] as const)
        .filter((k) => t[k])
        .map((k) => ({ ...base, team_id: t.id, scope: k, stats: t[k], updated_at: s.generatedAt })),
    ),
    team_quarter_stats: s.teams.flatMap((t) =>
      [0, 1, 2, 3].map((q) => ({ ...base, team_id: t.id, quarter: q + 1, points_for: t.quarters.for[q], points_against: t.quarters.against[q] })),
    ),
    players: s.players.map((p) => ({
      ...base,
      id: p.id,
      team_id: p.teamId,
      name: p.name,
      position: p.position,
      position_raw: p.positionRaw ?? null,
      height: p.height ?? null,
      nationality: p.nationality ?? null,
      jersey: p.jersey ?? null,
      estimated: p.estimated,
      estimate_note: p.estimateNote ?? null,
    })),
    player_stats: s.players.map((p) => ({
      ...base,
      player_id: p.id,
      gp: p.gp,
      gs: p.gs,
      mpg: p.mpg,
      gp_prev: p.gpPrev,
      mpg_prev: p.mpgPrev,
      totals: p.totals,
      totals_prev: p.totalsPrev,
      per36or40: p.per36or40,
      rates: p.rates,
      updated_at: s.generatedAt,
    })),
    player_minutes_patterns: s.players.map((p) => ({
      ...base,
      player_id: p.id,
      q1: p.quarterShare[0],
      q2: p.quarterShare[1],
      q3: p.quarterShare[2],
      q4: p.quarterShare[3],
      source: p.quarterShareSource,
      recent_minutes: p.recentMinutes,
      recent_starts: p.recentStarts,
    })),
    injuries: s.injuries.map((i) => ({
      ...base,
      team_id: i.teamId,
      player_id: i.playerId,
      player_name: i.playerName,
      status: i.status,
      detail: i.detail,
      source: i.source,
      source_url: i.sourceUrl ?? null,
      updated_at: i.updatedAt,
    })),
    lineups: s.lineups.map((l) => ({ ...base, team_id: l.teamId, starters: l.starters, status: l.status, basis: l.basis, source: l.source, warning: l.warning ?? null, updated_at: l.updatedAt })),
    rotations: s.rotations.flatMap((r) =>
      r.players.map((p) => ({ ...base, team_id: r.teamId, player_id: p.playerId, minutes: p.minutes, role: p.role, basis: r.basis, updated_at: r.updatedAt })),
    ),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function rowsToSnapshot(comp: CompetitionId, rows: Rows): CompetitionSnapshot {
  const se: any = rows.seasons[0];
  const stats = new Map<string, any>();
  for (const r of rows.team_stats as any[]) stats.set(`${r.team_id}|${r.scope}`, r.stats);
  const qs = new Map<string, any[]>();
  for (const r of rows.team_quarter_stats as any[]) {
    if (!qs.has(r.team_id)) qs.set(r.team_id, []);
    qs.get(r.team_id)!.push(r);
  }
  const teams: TeamSnapshot[] = (rows.teams as any[]).map((t) => {
    const q = (qs.get(t.id) ?? []).sort((a, b) => a.quarter - b.quarter);
    return {
      id: t.id,
      name: t.name,
      short: t.short,
      logo: t.logo,
      current: stats.get(`${t.id}|current`) ?? null,
      previous: stats.get(`${t.id}|previous`) ?? null,
      blended: stats.get(`${t.id}|blended`),
      blendWeights: t.blend_weights,
      quarters: { for: q.map((x) => Number(x.points_for)), against: q.map((x) => Number(x.points_against)) },
      home: t.home,
      away: t.away,
    };
  });
  const ps = new Map((rows.player_stats as any[]).map((r) => [r.player_id, r]));
  const pm = new Map((rows.player_minutes_patterns as any[]).map((r) => [r.player_id, r]));
  const players: PlayerSnapshot[] = (rows.players as any[]).map((p) => {
    const st = ps.get(p.id);
    const m = pm.get(p.id);
    return {
      id: p.id,
      teamId: p.team_id,
      name: p.name,
      position: p.position,
      positionRaw: p.position_raw,
      height: p.height == null ? null : Number(p.height),
      nationality: p.nationality,
      jersey: p.jersey,
      gp: st?.gp ?? 0,
      gs: st?.gs ?? 0,
      mpg: Number(st?.mpg ?? 0),
      gpPrev: st?.gp_prev ?? 0,
      mpgPrev: Number(st?.mpg_prev ?? 0),
      totals: st?.totals,
      totalsPrev: st?.totals_prev,
      per36or40: st?.per36or40,
      rates: st?.rates,
      quarterShare: m ? [Number(m.q1), Number(m.q2), Number(m.q3), Number(m.q4)] : [0.25, 0.25, 0.25, 0.25],
      quarterShareSource: m?.source ?? 'estimado',
      recentMinutes: m?.recent_minutes ?? [],
      recentStarts: m?.recent_starts ?? 0,
      estimated: p.estimated,
      estimateNote: p.estimate_note ?? undefined,
    };
  });
  const rot = new Map<string, any[]>();
  for (const r of rows.rotations as any[]) {
    if (!rot.has(r.team_id)) rot.set(r.team_id, []);
    rot.get(r.team_id)!.push(r);
  }
  return {
    comp,
    season: se.season,
    previousSeason: se.previous_season,
    generatedAt: se.generated_at,
    lastGameDate: se.last_game_date,
    sources: se.sources ?? [],
    league: se.league,
    teams,
    players,
    lineups: (rows.lineups as any[]).map((l) => ({ teamId: l.team_id, starters: l.starters, status: l.status, basis: l.basis, source: l.source, warning: l.warning ?? undefined, updatedAt: l.updated_at })),
    rotations: [...rot.entries()].map(([teamId, list]) => ({
      teamId,
      basis: list[0].basis,
      updatedAt: list[0].updated_at,
      players: list.sort((a, b) => Number(b.minutes) - Number(a.minutes)).map((x) => ({ playerId: x.player_id, minutes: Number(x.minutes), role: x.role })),
    })),
    injuries: (rows.injuries as any[]).map((i) => ({ playerId: i.player_id, playerName: i.player_name, teamId: i.team_id, status: i.status, detail: i.detail, source: i.source, sourceUrl: i.source_url ?? undefined, updatedAt: i.updated_at })),
    notes: se.notes ?? [],
  };
}

export const TABLES = ['seasons', 'teams', 'team_stats', 'team_quarter_stats', 'players', 'player_stats', 'player_minutes_patterns', 'injuries', 'lineups', 'rotations'] as const;
