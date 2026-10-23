/**
 * Histórico normalizado: Sackmann (2020 → mediados de 2026) + resultados recientes de las fuentes
 * en vivo. Se valida cada partido antes de usarlo y se guarda en caché para el backtest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartidoNormalizado } from '../engine/perfiles';
import { DIR_CACHE } from './lib/http';

const RUTA = join(DIR_CACHE, 'historico.json');

export interface InformeValidacion {
  total: number;
  descartados: Record<string, number>;
}

/** Descarta partidos imposibles o incompletos y ordena cronológicamente. */
export function validarHistorico(partidos: PartidoNormalizado[]): { partidos: PartidoNormalizado[]; informe: InformeValidacion } {
  const descartados: Record<string, number> = {};
  const malo = (motivo: string) => (descartados[motivo] = (descartados[motivo] ?? 0) + 1);
  const vistos = new Set<string>();
  const ok: PartidoNormalizado[] = [];
  for (const m of partidos) {
    if (!m.ganador || !m.perdedor) {
      malo('sin jugadores');
      continue;
    }
    if (m.ganador === m.perdedor) {
      malo('mismo jugador en ambos lados');
      continue;
    }
    if (!Number.isFinite(m.fecha) || m.fecha < 18000 || m.fecha > 40000) {
      malo('fecha fuera de rango');
      continue;
    }
    if (vistos.has(m.id)) {
      malo('duplicado');
      continue;
    }
    vistos.add(m.id);
    // Marcador: cada set debe tener juegos plausibles (0-7, o más en sets con ventaja).
    if (!m.wo && m.marcador && !/^(\d+-\d+(\(\d+\))?\s*)+(RET|DEF|ABD)?\s*$/i.test(m.marcador.replace(/\[\d+-\d+\]/g, '1-0'))) {
      // Marcadores raros (p. ej. "Played and unfinished") se mantienen para el Elo sólo si no son W/O.
      if (/unfinished|abandoned/i.test(m.marcador)) m.retirada = true;
    }
    if (m.w && m.l) {
      const v = [...m.w, ...m.l];
      if (v.some((x) => !Number.isFinite(x) || x < 0 || x > 400)) {
        m.w = null;
        m.l = null;
        malo('estadísticas fuera de rango (se conserva el partido sin ellas)');
      }
    }
    ok.push(m);
  }
  ok.sort((a, b) => a.fecha - b.fecha || a.id.localeCompare(b.id));
  return { partidos: ok, informe: { total: partidos.length, descartados } };
}

export function guardarHistorico(partidos: PartidoNormalizado[]) {
  mkdirSync(DIR_CACHE, { recursive: true });
  writeFileSync(RUTA, JSON.stringify(partidos));
}

export function cargarHistoricoCache(): PartidoNormalizado[] {
  if (!existsSync(RUTA)) throw new Error('No hay histórico en caché: ejecuta antes `npm run ingesta`.');
  return JSON.parse(readFileSync(RUTA, 'utf8')) as PartidoNormalizado[];
}
