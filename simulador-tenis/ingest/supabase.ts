/**
 * Sincronización con Supabase (sólo si SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY están en el
 * entorno del proceso de ingesta). La clave service_role nunca llega al navegador: la web sólo
 * usa la clave anónima, y RLS sólo permite leer.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { I, type ClaveSuperficie } from '../engine/modelo';
import type { PartidoNormalizado } from '../engine/perfiles';
import type { DetalleTorneo, FichaJugador, MetaDatos, TorneoVivo } from '../src/lib/tiposDatos';
import { fechaDeDias, hoyDias, log } from './lib/util';

async function upsert(sb: SupabaseClient, tabla: string, filas: Record<string, unknown>[], conflicto: string) {
  for (let i = 0; i < filas.length; i += 1000) {
    const { error } = await sb.from(tabla).upsert(filas.slice(i, i + 1000), { onConflict: conflicto });
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

export async function sincronizarSupabase(p: {
  meta: MetaDatos;
  torneos: TorneoVivo[];
  detalles: DetalleTorneo[];
  fichas: Map<string, FichaJugador>;
  partidos: PartidoNormalizado[];
  rankingActual: Map<string, { pos: number; puntos: number | null; fecha: string; fuente: string }>;
}) {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    log('Supabase: sin credenciales en el entorno; sólo se publica el snapshot JSON.');
    return;
  }
  const sb = createClient(url, clave, { auth: { persistSession: false } });
  const ahora = new Date().toISOString();
  try {
    const jugadores = [...p.fichas.values()].map(({ perfil: j }) => ({
      id: j.id,
      name: j.nombre,
      country: j.pais,
      pool: j.pool,
      main_tour: j.circuito,
      birth_date: j.nacimiento,
      hand: j.mano,
      backhand: j.reves,
      height: j.altura,
      last_match: j.ultimoPartido,
      matches_count: j.nPartidos,
      stats_matches: j.nReal.todas,
      estimated: j.nReal.todas < 10,
      updated_at: ahora,
    }));
    await upsert(sb, 'players', jugadores, 'id');
    const ids = new Set(jugadores.map((j) => j.id));

    await upsert(
      sb,
      'elo_ratings',
      [...p.fichas.values()].map(({ perfil: j }) => ({
        player_id: j.id,
        overall: j.elo.g,
        hard: j.elo.s.dura,
        clay: j.elo.s.tierra,
        grass: j.elo.s.hierba,
        n: j.elo.n,
        n_hard: j.elo.ns.dura,
        n_clay: j.elo.ns.tierra,
        n_grass: j.elo.ns.hierba,
        form: j.forma,
        estimated: Boolean((j as { eloEstimado?: boolean }).eloEstimado),
        updated_at: ahora,
      })),
      'player_id',
    );

    const sup: Record<string, unknown>[] = [];
    for (const { perfil: j } of p.fichas.values()) {
      for (const k of Object.keys(j.stats) as ClaveSuperficie[]) {
        const v = j.stats[k];
        sup.push({
          player_id: j.id,
          surface: k,
          vector: v,
          real_matches: j.nReal[k],
          serve_points: v[I.svpt],
          first_in_pct: pct(v[I.in1], v[I.svpt]),
          first_won_pct: pct(v[I.won1], v[I.in1]),
          second_won_pct: pct(v[I.won2], v[I.svpt] - v[I.in1]),
          aces_pct: pct(v[I.ace], v[I.svpt]),
          df_pct: pct(v[I.df], v[I.svpt]),
          return_won_pct: pct(v[I.rwon], v[I.rpt]),
          tiebreaks_played: v[I.tbp],
          tiebreaks_won: v[I.tbw],
          updated_at: ahora,
        });
      }
    }
    await upsert(sb, 'player_surface_stats', sup, 'player_id,surface');

    const rk = [...p.rankingActual.entries()]
      .filter(([id]) => ids.has(id))
      .map(([id, r]) => ({ player_id: id, ranking_date: r.fecha, rank: r.pos, points: r.puntos, source: r.fuente }));
    await upsert(sb, 'rankings', rk, 'player_id,ranking_date,source');

    await upsert(
      sb,
      'tournaments',
      p.torneos.map((t) => ({
        id: t.id,
        tour_id: t.circuito,
        name: t.nombre,
        category: t.categoria,
        city: t.ciudad,
        country: t.pais,
        start_date: t.inicio,
        end_date: t.fin,
        surface: t.superficie,
        indoor: t.cubierta,
        format_id: t.formatoId,
        qualy_format_id: t.formatoQualyId,
        status: t.estado,
        has_order_of_play: t.tieneOrdenDeJuego,
        source: t.fuente,
        notices: t.avisos,
        updated_at: t.actualizado,
      })),
      'id',
    );
    const draws: Record<string, unknown>[] = [];
    const partidosVivos: Record<string, unknown>[] = [];
    const oop: Record<string, unknown>[] = [];
    for (const d of p.detalles) {
      for (const fase of ['Q', 'M'] as const) {
        const n = d.partidos.filter((x) => x.fase === fase).length;
        if (n) draws.push({ id: `${d.torneo.id}-${fase}`, tournament_id: d.torneo.id, phase: fase, size: n, updated_at: ahora });
      }
      for (const m of d.partidos) {
        partidosVivos.push({
          id: m.id,
          tournament_id: d.torneo.id,
          tour: d.torneo.circuito,
          level: d.torneo.categoria,
          tournament_name: d.torneo.nombre,
          surface: d.torneo.superficie,
          match_date: m.hora ? m.hora.slice(0, 10) : null,
          round: m.ronda,
          phase: m.fase,
          player_a: m.a.id && ids.has(m.a.id) ? m.a.id : null,
          player_b: m.b.id && ids.has(m.b.id) ? m.b.id : null,
          player_a_name: m.a.nombre,
          player_b_name: m.b.nombre,
          winner: m.ganador,
          score: m.marcador,
          status: m.estado,
          retired: /ret/i.test(m.marcador ?? ''),
          best_of: null,
          source: d.torneo.fuente,
          updated_at: ahora,
        });
        if (m.estado !== 'terminado' && (m.hora || m.pista)) {
          oop.push({ match_id: m.id, tournament_id: d.torneo.id, scheduled_at: m.hora, not_before: m.noAntesDe, court: m.pista, order_num: m.orden });
        }
      }
    }
    await upsert(sb, 'draws', draws, 'id');
    await upsert(sb, 'matches', partidosVivos, 'id');
    await upsert(sb, 'order_of_play', oop, 'match_id');

    // Histórico jugado: últimas 3 temporadas, circuitos del simulador.
    const desde = hoyDias() - 3 * 365;
    const hist = p.partidos.filter((m) => m.fecha >= desde && ['ATP', 'WTA', 'CH', 'W125'].includes(m.circuito) && ids.has(m.ganador) && ids.has(m.perdedor));
    await upsert(
      sb,
      'matches',
      hist.map((m) => ({
        id: m.id,
        tournament_id: null,
        tour: m.circuito,
        level: m.nivel,
        tournament_name: m.torneo,
        surface: m.sup,
        match_date: fechaDeDias(Math.floor(m.fecha)),
        round: m.ronda,
        phase: /^Q/.test(m.ronda) ? 'Q' : 'M',
        player_a: m.ganador,
        player_b: m.perdedor,
        winner: 'a',
        score: m.marcador,
        status: 'terminado',
        retired: m.retirada,
        best_of: m.mejorDe,
        source: m.fuente,
        updated_at: ahora,
      })),
      'id',
    );
    const stats: Record<string, unknown>[] = [];
    for (const m of hist) {
      if (!m.w || !m.l) continue;
      for (const [id, v] of [
        [m.ganador, m.w],
        [m.perdedor, m.l],
      ] as const) {
        stats.push({
          match_id: m.id,
          player_id: id,
          aces: v[0],
          double_faults: v[1],
          serve_points: v[2],
          first_in: v[3],
          first_won: v[4],
          second_won: v[5],
          service_games: v[6],
          bp_saved: v[7],
          bp_faced: v[8],
        });
      }
    }
    await upsert(sb, 'match_stats', stats, 'match_id,player_id');

    const { error } = await sb.from('data_updates').insert(
      p.meta.fuentes.map((f) => ({
        source: f.fuente,
        description: f.descripcion,
        ok: f.ok,
        attempted_at: f.ultimoIntento,
        succeeded_at: f.ultimoExito,
        records: f.registros,
        error: f.error ?? null,
      })),
    );
    if (error) throw new Error(`data_updates: ${error.message}`);
    log('Supabase sincronizado:', jugadores.length, 'jugadores,', hist.length, 'partidos históricos,', partidosVivos.length, 'de cuadros');
  } catch (e) {
    // Un fallo de Supabase no invalida el snapshot JSON, que ya está publicado.
    log('Supabase: error en la sincronización:', (e as Error).message);
  }
}
