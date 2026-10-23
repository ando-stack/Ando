/**
 * Acceso a datos desde el navegador.
 * Fuente principal: Supabase (sólo lectura, clave anónima pública protegida por RLS) si está
 * configurado con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Si no lo está o falla, se usa el
 * snapshot JSON publicado con la web (/data), que es la última actualización válida.
 */
import type { PerfilJugador, ParamsModelo } from '../../engine/modelo';
import { PARAMS_POR_DEFECTO } from '../../engine/modelo';
import { fragmentoDe } from './fragmentos';
import { supabase } from './supabase';
import type { DetalleTorneo, EntradaIndice, FichaJugador, MetaDatos, PartidoVivo, TorneoVivo } from './tiposDatos';

const cache = new Map<string, Promise<unknown>>();

function json<T>(ruta: string): Promise<T> {
  let p = cache.get(ruta) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`/data/${ruta}`).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${ruta} (HTTP ${r.status})`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(ruta));
    cache.set(ruta, p);
  }
  return p;
}

export const cargarMeta = () => json<MetaDatos>('meta.json');

export async function cargarModelo(): Promise<ParamsModelo> {
  try {
    return await json<ParamsModelo>('modelo.json');
  } catch {
    return PARAMS_POR_DEFECTO;
  }
}

export async function cargarTorneos(): Promise<{ torneos: TorneoVivo[]; origen: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('tournaments').select('*').gte('end_date', new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
      if (error) throw error;
      if (data?.length) {
        return {
          origen: 'Supabase',
          torneos: data.map(
            (t): TorneoVivo => ({
              id: t.id,
              circuito: t.tour_id,
              categoria: t.category ?? '',
              nombre: t.name,
              ciudad: t.city ?? '',
              pais: t.country ?? '',
              inicio: t.start_date,
              fin: t.end_date,
              superficie: t.surface,
              cubierta: t.indoor,
              formatoId: t.format_id,
              formatoQualyId: t.qualy_format_id,
              estado: t.status,
              fuente: t.source,
              actualizado: t.updated_at,
              nPartidos: 0,
              tieneOrdenDeJuego: t.has_order_of_play,
              avisos: t.notices ?? [],
            }),
          ),
        };
      }
    } catch {
      /* se usa el snapshot */
    }
  }
  return { torneos: await json<TorneoVivo[]>('torneos.json'), origen: 'snapshot' };
}

export async function cargarTorneo(id: string): Promise<DetalleTorneo> {
  const snap = json<DetalleTorneo>(`torneos/${id}.json`);
  if (supabase) {
    try {
      const [{ data: partidos, error: e1 }, { data: oop, error: e2 }] = await Promise.all([
        supabase.from('matches').select('*').eq('tournament_id', id),
        supabase.from('order_of_play').select('*').eq('tournament_id', id),
      ]);
      if (e1 || e2) throw e1 ?? e2;
      if (partidos?.length) {
        const base = await snap.catch(() => null);
        const torneo = base?.torneo ?? (await cargarTorneos()).torneos.find((t) => t.id === id);
        if (torneo) {
          const horas = new Map((oop ?? []).map((o) => [o.match_id, o]));
          return {
            torneo,
            partidos: partidos.map((m): PartidoVivo => {
              const o = horas.get(m.id);
              return {
                id: m.id,
                torneoId: id,
                fase: m.phase,
                ronda: m.round,
                orden: o?.order_num ?? 0,
                a: { id: m.player_a, nombre: m.player_a_name, pais: '' },
                b: { id: m.player_b, nombre: m.player_b_name, pais: '' },
                estado: m.status,
                hora: o?.scheduled_at ?? null,
                noAntesDe: o?.not_before ?? false,
                pista: o?.court ?? null,
                marcador: m.score,
                ganador: m.winner,
              };
            }),
          };
        }
      }
    } catch {
      /* snapshot */
    }
  }
  return snap;
}

export const cargarIndice = () => json<EntradaIndice[]>('jugadores.json');

export async function cargarFicha(id: string): Promise<FichaJugador | null> {
  const frag = await json<Record<string, FichaJugador>>(`jugadores/${fragmentoDe(id)}.json`);
  return frag[id] ?? null;
}

export async function cargarPerfil(id: string): Promise<PerfilJugador | null> {
  return (await cargarFicha(id))?.perfil ?? null;
}
