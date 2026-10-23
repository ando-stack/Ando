/**
 * Evaluación "walk-forward": se recorre el histórico en orden y, para cada partido de la
 * temporada objetivo, se guardan los perfiles de ambos jugadores con los datos disponibles
 * ANTES del partido. Lo usan la calibración (temporada 2024) y el backtest (temporada 2025).
 */
import { formatoDe, type Circuito, type FormatoPartido, type Superficie } from '../config/formatos';
import { agregar, mediaHist, type Histograma } from '../engine/agregacion';
import { simularLote } from '../engine/motor';
import { parametrosPartido, type ParamsModelo, type PerfilMinimo, type Pool } from '../engine/modelo';
import { AcumuladorPerfiles, tiebreaksDelMarcador, type PartidoNormalizado } from '../engine/perfiles';
import { ajustarPriors, mediasDesde } from './ajuste';
import { dias, hash32 } from './lib/util';

export interface Real {
  ganaA: boolean;
  juegos: number;
  sets: number;
  decisivo: boolean;
  tiebreaks: number;
  aces: number | null;
  dobles: number | null;
  breaks: number | null;
  juegosSaque: number | null;
  acesA: number | null;
}

export interface Caso {
  id: string;
  fecha: number;
  circuito: Circuito;
  sup: Superficie;
  pool: Pool;
  formato: FormatoPartido;
  A: PerfilMinimo;
  B: PerfilMinimo;
  real: Real;
  conStats: boolean;
}

function copiar(p: PerfilMinimo): PerfilMinimo {
  return {
    pool: p.pool,
    elo: structuredClone(p.elo),
    stats: { todas: [...p.stats.todas], dura: [...p.stats.dura], tierra: [...p.stats.tierra], hierba: [...p.stats.hierba] },
    nReal: { ...p.nReal },
    forma: p.forma,
  };
}

/** Juegos, sets y tie-breaks del marcador (sólo partidos completos). */
export function leerMarcador(marcador: string): { juegos: number; sets: number; juegosW: number; setsW: number } | null {
  if (/RET|DEF|W\/O|ABD|unfinished/i.test(marcador)) return null;
  const sets = marcador.trim().split(/\s+/);
  let juegos = 0;
  let juegosW = 0;
  let setsW = 0;
  let n = 0;
  for (const s of sets) {
    const m = s.match(/^(\d+)-(\d+)/);
    if (!m) {
      if (/^\[\d+-\d+\]$/.test(s)) {
        n++;
        setsW++;
        continue;
      }
      return null;
    }
    const a = +m[1];
    const b = +m[2];
    juegos += a + b;
    juegosW += a;
    if (a > b) setsW++;
    n++;
  }
  return n ? { juegos, sets: n, juegosW, setsW } : null;
}

export function recolectar(
  partidos: PartidoNormalizado[],
  base: ParamsModelo,
  temporada: number,
  opciones: { desdeStats: number },
): { casos: Caso[]; M: ParamsModelo } {
  const inicio = dias(`${temporada}-01-01`);
  const fin = dias(`${temporada + 1}-01-01`);
  // Medias del circuito con datos anteriores a la temporada (sin mirar el futuro).
  const M: ParamsModelo = { ...base, medias: mediasDesde(partidos, inicio - 3 * 365, inicio), prior: structuredClone(base.prior) };
  const acc = new AcumuladorPerfiles(M);
  const casos: Caso[] = [];
  let priorsAjustados = false;
  for (const m of partidos) {
    if (m.fecha >= fin) break;
    if (!priorsAjustados && m.fecha >= inicio) {
      const p = ajustarPriors(acc, M, inicio);
      M.prior.M = p.M;
      M.prior.F = p.F;
      priorsAjustados = true;
    }
    if (m.fecha >= inicio && ['ATP', 'WTA', 'CH', 'W125'].includes(m.circuito) && !m.wo && !m.retirada) {
      const mk = leerMarcador(m.marcador);
      if (mk) {
        const aEsGanador = (hash32(m.id) & 1) === 0;
        const idA = aEsGanador ? m.ganador : m.perdedor;
        const idB = aEsGanador ? m.perdedor : m.ganador;
        const circuito = m.circuito as Circuito;
        const formato = formatoDe({
          circuito,
          categoria: m.nivel === 'G' || /grand slam/i.test(m.nivel) ? 'Grand Slam' : m.nivel,
          nombreTorneo: m.torneo,
          esCuadroFinal: !/^Q/.test(m.ronda),
        });
        // El formato real manda sobre el deducido (p. ej. ediciones antiguas).
        const f = m.mejorDe === 5 && formato.mejorDe !== 5 ? formatoDe({ circuito: 'ATP', categoria: 'Grand Slam' }) : formato;
        const [tbW, tbL] = tiebreaksDelMarcador(m.marcador);
        const conStats = Boolean(m.w && m.l);
        const wA = aEsGanador ? m.w : m.l;
        casos.push({
          id: m.id,
          fecha: m.fecha,
          circuito,
          sup: m.sup,
          pool: m.pool,
          formato: f,
          A: copiar(acc.perfil(idA, m.fecha, m.pool)),
          B: copiar(acc.perfil(idB, m.fecha, m.pool)),
          conStats,
          real: {
            ganaA: aEsGanador,
            juegos: mk.juegos,
            sets: mk.sets,
            decisivo: mk.sets === f.mejorDe,
            tiebreaks: tbW + tbL,
            aces: conStats ? m.w![0] + m.l![0] : null,
            dobles: conStats ? m.w![1] + m.l![1] : null,
            breaks: conStats ? m.w![8] - m.w![7] + (m.l![8] - m.l![7]) : null,
            juegosSaque: conStats ? m.w![6] + m.l![6] : null,
            acesA: conStats && wA ? wA[0] : null,
          },
        });
      }
    }
    acc.anadir(m, { stats: m.fecha >= opciones.desdeStats });
  }
  return { casos, M };
}

export interface Simulado {
  pA: number;
  juegos: Histograma;
  mediaJuegos: number;
  pDecisivo: number;
  mediaTb: number;
  aces: Histograma;
  mediaAces: number;
  mediaDobles: number;
  mediaBreaks: number;
  pFormato: number;
  pElo: number;
  pEst: number;
}

export function simularCaso(c: Caso, M: ParamsModelo, nSims: number, semilla: number): Simulado {
  const { params, detalle } = parametrosPartido(c.A, c.B, { superficie: c.sup, circuito: c.circuito, formato: c.formato }, M);
  const o = simularLote(params, c.formato, nSims, semilla);
  const r = agregar([o], c.formato);
  const decisivo = r.numSets.cuentas[c.formato.mejorDe - r.numSets.min] ?? 0;
  return {
    pA: r.victoriasA / r.n,
    juegos: r.juegosTotales,
    mediaJuegos: mediaHist(r.juegosTotales),
    pDecisivo: decisivo / r.n,
    mediaTb: mediaHist(r.tiebreaks),
    aces: r.totales.aces,
    mediaAces: mediaHist(r.totales.aces),
    mediaDobles: mediaHist(r.totales.dobles),
    mediaBreaks: mediaHist(r.totales.breaks),
    pFormato: detalle.pFormato,
    pElo: detalle.pElo,
    pEst: detalle.pEstadisticas,
  };
}

/** Probabilidad (suavizada) de un valor bajo un histograma simulado. */
export function probValor(h: Histograma, x: number, n: number): number {
  const v = h.cuentas[x - h.min] ?? 0;
  return (v + 0.5) / (n + 0.5 * (h.cuentas.length + 10));
}

export function pOver(h: Histograma, linea: number): number {
  let o = 0;
  let t = 0;
  h.cuentas.forEach((v, i) => {
    t += v;
    if (h.min + i > linea) o += v;
  });
  return t ? o / t : 0;
}

/** Muestra hasta `max` casos por grupo (determinista). */
export function muestrear(casos: Caso[], max: number, filtro: (c: Caso) => boolean = () => true): Caso[] {
  const grupos = new Map<string, Caso[]>();
  for (const c of casos) {
    if (!filtro(c)) continue;
    const k = `${c.circuito}_${c.sup}`;
    const l = grupos.get(k) ?? [];
    l.push(c);
    grupos.set(k, l);
  }
  const res: Caso[] = [];
  for (const l of grupos.values()) {
    const orden = [...l].sort((a, b) => hash32(`${a.id}x`) - hash32(`${b.id}x`));
    res.push(...orden.slice(0, max));
  }
  return res;
}
