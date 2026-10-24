/**
 * Ajuste de los parámetros del modelo que salen directamente de los datos:
 *  - medias de cada pool (masculino/femenino) y superficie,
 *  - priors de saque/resto en función del Elo (regresión lineal),
 *  - correspondencia ranking → Elo para jugadores sin historial.
 * La calibración fina (σ, peso del Elo, factores por circuito y superficie) la hace calibrar.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPERFICIES } from '../config/formatos';
import { ratingCombinado } from '../engine/elo';
import { I, PARAMS_POR_DEFECTO, type ClaveSuperficie, type MediasSuperficie, type ParamsModelo, type Pool } from '../engine/modelo';
import { AcumuladorPerfiles, type PartidoNormalizado } from '../engine/perfiles';

export const RUTA_CALIBRACION = join(import.meta.dirname, '..', 'engine', 'calibracion.json');

export function mediasDesde(partidos: PartidoNormalizado[], desde: number, hasta: number): ParamsModelo['medias'] {
  const acc: Record<string, number[]> = {};
  for (const m of partidos) {
    if (!m.w || !m.l || m.retirada || m.fecha < desde || m.fecha >= hasta) continue;
    for (const k of ['todas', m.sup]) {
      const c = (acc[`${m.pool}|${k}`] ??= new Array(8).fill(0));
      for (const v of [m.w, m.l]) {
        const [ace, df, svpt, in1, won1, won2] = v;
        c[0] += svpt;
        c[1] += in1;
        c[2] += won1;
        c[3] += won2;
        c[4] += ace;
        c[5] += df;
        c[6] += svpt - in1 - df; // segundos dentro
        c[7] += 1;
      }
    }
  }
  const res = structuredClone(PARAMS_POR_DEFECTO.medias);
  for (const pool of ['M', 'F'] as Pool[]) {
    for (const k of ['todas', ...SUPERFICIES] as ClaveSuperficie[]) {
      const c = acc[`${pool}|${k}`];
      if (!c || c[7] < 200) continue;
      const m: MediasSuperficie = {
        saque: (c[2] + c[3]) / c[0],
        primeros: c[1] / c[0],
        ganados1: c[2] / c[1],
        ganados2: c[3] / c[6],
        aces: c[4] / c[0],
        dobles: c[5] / (c[0] - c[1]),
        acesC: c[4] / c[0],
      };
      res[pool][k] = m;
    }
    // Superficies con pocos datos: heredan de "todas".
    for (const k of SUPERFICIES) if (!acc[`${pool}|${k}`] || acc[`${pool}|${k}`][7] < 200) res[pool][k] = res[pool].todas;
  }
  return res;
}

/** Regresión exceso ~ a + b·(Elo − 1500)/100 en jugadores con muchos puntos. */
export function ajustarPriors(acc: AcumuladorPerfiles, M: ParamsModelo, t: number): ParamsModelo['prior'] {
  const res = structuredClone(M.prior);
  for (const pool of ['M', 'F'] as Pool[]) {
    for (const lado of ['saque', 'resto'] as const) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      let sw = 0;
      for (const [id, a] of acc.datos) {
        if (!id.startsWith(pool.toLowerCase())) continue;
        if (t - a.ultimo > 365) continue;
        const v = a.v.todas;
        const den = lado === 'saque' ? v[I.svpt] : v[I.rpt];
        if (den < 1500) continue;
        const y = (lado === 'saque' ? v[I.exS] : v[I.exR]) / den;
        const x = (ratingCombinado(acc.elo.get(id), 'dura', 0) - 1500) / 100;
        const w = den;
        n++;
        sw += w;
        sx += w * x;
        sy += w * y;
        sxx += w * x * x;
        sxy += w * x * y;
      }
      if (n < 50) continue;
      const mx = sx / sw;
      const my = sy / sw;
      const b = (sxy / sw - mx * my) / (sxx / sw - mx * mx);
      res[pool][lado] = { a: my - b * mx, b };
    }
  }
  return res;
}

/** Elo ≈ a + b·ln(ranking), para estimar el Elo inicial de jugadores con ranking y sin partidos. */
export function ajustarRankingElo(
  rankings: Map<string, number>,
  acc: AcumuladorPerfiles,
  pool: Pool,
): { a: number; b: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [id, pos] of rankings) {
    if (!id.startsWith(pool.toLowerCase())) continue;
    const r = acc.elo.ratings.get(id);
    if (!r || r.n < 30) continue;
    const x = Math.log(pos);
    n++;
    sx += x;
    sy += r.g;
    sxx += x * x;
    sxy += x * r.g;
  }
  if (n < 30) return { a: 2200, b: -110 };
  const b = (sxy - (sx * sy) / n) / (sxx - (sx * sx) / n);
  return { a: (sy - b * sx) / n, b };
}

/** Parámetros calibrados (si existe engine/calibracion.json) sobre los por defecto. */
export function cargarCalibracion(temporada?: number): Partial<ParamsModelo> {
  const ruta = temporada ? RUTA_CALIBRACION.replace('.json', `-${temporada}.json`) : RUTA_CALIBRACION;
  if (!existsSync(ruta)) {
    if (temporada) throw new Error(`Falta ${ruta}: ejecuta antes TEMPORADA_CALIBRACION=${temporada} npm run calibrar`);
    return {};
  }
  return JSON.parse(readFileSync(ruta, 'utf8')) as Partial<ParamsModelo>;
}

export function construirParams(base: Partial<ParamsModelo>, medias: ParamsModelo['medias']): ParamsModelo {
  return {
    ...PARAMS_POR_DEFECTO,
    ...base,
    K: { ...PARAMS_POR_DEFECTO.K, ...(base.K ?? {}) },
    prior: base.prior ?? PARAMS_POR_DEFECTO.prior,
    calibracion: base.calibracion ?? {},
    medias,
  };
}
