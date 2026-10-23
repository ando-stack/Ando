/**
 * Histórico de partidos con estadísticas: conjuntos de datos de Jeff Sackmann (tennis_atp,
 * tennis_wta), licencia CC BY-NC-SA 4.0 (uso NO comercial, atribución, compartir igual).
 * Los repositorios originales de GitHub dejaron de estar disponibles a mediados de 2026; se usa
 * el espejo de archivo publicado en Hugging Face, que conserva los ficheros sin modificar.
 */
import Papa from 'papaparse';
import type { Circuito } from '../../config/formatos';
import type { PartidoNormalizado } from '../../engine/perfiles';
import { descargarTexto } from '../lib/http';
import { Registro } from '../lib/registro';
import { dias, superficie } from '../lib/util';

export const BASE_SACKMANN = 'https://huggingface.co/datasets/Jackk7924/tennis-sackmann/resolve/main';
export const FUENTE_SACKMANN = 'sackmann';

type Fila = Record<string, string>;

async function csv(ruta: string, ttl: number): Promise<Fila[]> {
  const { texto } = await descargarTexto(`${BASE_SACKMANN}/${ruta}`, { ttl });
  if (texto.startsWith('Entry not found') || texto.length < 50) return [];
  const r = Papa.parse<Fila>(texto, { header: true, skipEmptyLines: true });
  return r.data;
}

const ORDEN_RONDA: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, R128: 10, R64: 11, R32: 12, R16: 13, RR: 14, QF: 15, SF: 16, BR: 17, F: 18 };
export const ordenRonda = (r: string) => ORDEN_RONDA[r] ?? 12;

function circuitoAtp(nivel: string, archivo: 'main' | 'qc' | 'fut'): Circuito | 'ITF' | 'OTRO' {
  if (archivo === 'fut') return 'ITF';
  if (nivel === 'C') return 'CH';
  if (nivel === 'D') return 'OTRO';
  if (['G', 'M', 'A', 'F'].includes(nivel)) return 'ATP';
  return 'ITF';
}

function circuitoWta(nivel: string): Circuito | 'ITF' | 'OTRO' {
  if (['G', 'PM', 'P', 'I', 'F', 'T1', 'T2', 'T3', 'T4', 'T5'].includes(nivel)) return 'WTA';
  if (nivel === 'C') return 'W125';
  if (nivel === 'D') return 'OTRO';
  return 'ITF';
}

const num = (s: string | undefined) => (s === undefined || s === '' ? NaN : Number(s));

function stats(f: Fila, p: 'w' | 'l'): number[] | null {
  const v = ['ace', 'df', 'svpt', '1stIn', '1stWon', '2ndWon', 'SvGms', 'bpSaved', 'bpFaced'].map((k) => num(f[`${p}_${k}`]));
  if (v.some((x) => Number.isNaN(x))) return null;
  const [ace, df, svpt, in1, won1, won2, , bps, bpf] = v;
  // Validación de rangos: si algo es imposible, se descartan las estadísticas del partido.
  if (svpt <= 0 || in1 > svpt || won1 > in1 || won2 > svpt - in1 || ace > in1 + (svpt - in1) || df > svpt - in1 || bps > bpf || ace < 0 || df < 0) return null;
  return v;
}

export interface ResultadoSackmann {
  partidos: PartidoNormalizado[];
  rankings: { fecha: string; id: string; pos: number; puntos: number | null }[];
  fechaMaxima: Record<string, string>;
  ficheros: string[];
}

export async function cargarSackmann(
  registro: Registro,
  opciones: { desde: number; hasta: number; desdeFutures: number },
): Promise<ResultadoSackmann> {
  const partidos: PartidoNormalizado[] = [];
  const fechaMaxima: Record<string, string> = {};
  const ficheros: string[] = [];
  const anioActual = new Date().getUTCFullYear();
  const ttlDe = (y: number) => (y >= anioActual ? 86400 : 30 * 86400);

  for (const [pool, pref] of [
    ['M', 'atp'],
    ['F', 'wta'],
  ] as const) {
    const filasJug = await csv(`${pref}/${pref}_players.csv`, 7 * 86400);
    ficheros.push(`${pref}/${pref}_players.csv`);
    for (const f of filasJug) {
      const id = `${pool.toLowerCase()}${f.player_id}`;
      const dob = f.dob && f.dob.length === 8 && !f.dob.startsWith('1900') ? `${f.dob.slice(0, 4)}-${f.dob.slice(4, 6)}-${f.dob.slice(6, 8)}` : null;
      registro.anadir({
        id,
        pool,
        nombre: `${f.name_first} ${f.name_last}`.trim(),
        pais: f.ioc ?? '',
        nacimiento: dob,
        mano: f.hand && f.hand !== 'U' ? f.hand : null,
        altura: f.height ? Number(f.height) || null : null,
        alias: { [FUENTE_SACKMANN]: f.player_id },
      });
    }
  }

  const archivos: { ruta: string; pool: 'M' | 'F'; tipo: 'main' | 'qc' | 'fut'; anio: number }[] = [];
  for (let y = opciones.desde; y <= opciones.hasta; y++) {
    archivos.push({ ruta: `atp/atp_matches_${y}.csv`, pool: 'M', tipo: 'main', anio: y });
    archivos.push({ ruta: `atp/atp_matches_qual_chall_${y}.csv`, pool: 'M', tipo: 'qc', anio: y });
    if (y >= opciones.desdeFutures) archivos.push({ ruta: `atp/atp_matches_futures_${y}.csv`, pool: 'M', tipo: 'fut', anio: y });
    archivos.push({ ruta: `wta/wta_matches_${y}.csv`, pool: 'F', tipo: 'main', anio: y });
    archivos.push({ ruta: `wta/wta_matches_qual_itf_${y}.csv`, pool: 'F', tipo: 'qc', anio: y });
  }

  for (const a of archivos) {
    const filas = await csv(a.ruta, ttlDe(a.anio));
    if (!filas.length) continue;
    ficheros.push(a.ruta);
    for (const f of filas) {
      const sup = superficie(f.surface);
      if (!sup || !f.winner_id || !f.loser_id || !f.tourney_date) continue;
      const score = (f.score ?? '').trim();
      const wo = /W\/O|walkover|^$/i.test(score);
      const ret = /RET|DEF|Def|ABD|unfinished/i.test(score);
      const circuito = a.pool === 'M' ? circuitoAtp(f.tourney_level, a.tipo) : circuitoWta(f.tourney_level);
      const w = stats(f, 'w');
      const l = stats(f, 'l');
      const fecha = dias(f.tourney_date) + ordenRonda(f.round) / 4; // orden dentro de la semana
      partidos.push({
        id: `s:${f.tourney_id}:${f.match_num}:${f.winner_id}`,
        fecha,
        pool: a.pool,
        circuito,
        nivel: f.tourney_level,
        torneo: f.tourney_name,
        sup,
        mejorDe: f.best_of === '5' ? 5 : 3,
        ganador: `${a.pool.toLowerCase()}${f.winner_id}`,
        perdedor: `${a.pool.toLowerCase()}${f.loser_id}`,
        marcador: score,
        ronda: f.round,
        retirada: ret,
        wo,
        w: w && l ? w : null,
        l: w && l ? l : null,
        fuente: FUENTE_SACKMANN,
      });
      const clave = `${a.pool}-${circuito}`;
      if (!fechaMaxima[clave] || f.tourney_date > fechaMaxima[clave]) fechaMaxima[clave] = f.tourney_date;
    }
  }

  // Rankings: 2020-2025 (fichero de la década) y 2026 (actual).
  const rankings: ResultadoSackmann['rankings'] = [];
  for (const [pool, pref] of [
    ['m', 'atp'],
    ['f', 'wta'],
  ] as const) {
    for (const r of [`${pref}/${pref}_rankings_20s.csv`, `${pref}/${pref}_rankings_current.csv`]) {
      const filas = await csv(r, 7 * 86400);
      ficheros.push(r);
      for (const f of filas) {
        if (!f.ranking_date || +f.ranking_date.slice(0, 4) < opciones.hasta - 2) continue;
        const pos = Number(f.rank);
        if (!(pos > 0)) continue;
        rankings.push({
          fecha: `${f.ranking_date.slice(0, 4)}-${f.ranking_date.slice(4, 6)}-${f.ranking_date.slice(6, 8)}`,
          id: `${pool}${f.player}`,
          pos,
          puntos: f.points ? Number(f.points) : null,
        });
      }
    }
  }
  return { partidos, rankings, fechaMaxima, ficheros };
}
