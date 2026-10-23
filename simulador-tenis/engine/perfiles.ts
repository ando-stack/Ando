/**
 * Acumulación cronológica de perfiles de jugador (estadísticas con decaimiento exponencial,
 * ajustadas por el rival), Elo y forma. La misma clase se usa:
 *  - en la ingesta, para calcular los perfiles actuales,
 *  - en el backtest, para obtener los perfiles con los datos disponibles ANTES de cada partido.
 */
import type { Circuito, Superficie } from '../config/formatos';
import { SistemaElo, probElo, ratingCombinado } from './elo';
import { CAMPOS, I, estimarJugador, type ClaveSuperficie, type ParamsModelo, type PerfilMinimo, type Pool } from './modelo';

export interface PartidoNormalizado {
  id: string;
  /** Días desde 1970-01-01 (UTC). */
  fecha: number;
  pool: Pool;
  circuito: Circuito | 'ITF' | 'OTRO';
  nivel: string;
  torneo: string;
  sup: Superficie;
  mejorDe: 3 | 5;
  ganador: string;
  perdedor: string;
  marcador: string;
  ronda: string;
  retirada: boolean;
  wo: boolean;
  /** Estadísticas del ganador y del perdedor: [ace, df, svpt, in1, won1, won2, svgms, bpSaved, bpFaced]. */
  w?: number[] | null;
  l?: number[] | null;
  fuente: string;
}

/** Tie-breaks ganados por el ganador y por el perdedor según el marcador ("7-6(4) 6-7(5) 6-3"). */
export function tiebreaksDelMarcador(marcador: string): [number, number] {
  let w = 0;
  let l = 0;
  for (const set of marcador.trim().split(/\s+/)) {
    const m = set.match(/^(\d+)-(\d+)/);
    if (!m) continue;
    const a = +m[1];
    const b = +m[2];
    if ((a === 7 && b === 6) || (a === 4 && b === 3 && /\(/.test(set))) w++;
    else if ((a === 6 && b === 7) || (a === 3 && b === 4 && /\(/.test(set))) l++;
  }
  return [w, l];
}

const CLAVES: ClaveSuperficie[] = ['todas', 'dura', 'tierra', 'hierba'];
const NC = CAMPOS.length;
const VIDA_MEDIA_FORMA = 45; // días

interface Acum {
  t: number;
  v: Record<ClaveSuperficie, Float64Array>;
  nReal: Record<ClaveSuperficie, number>;
  nPartidos: number;
  forma: number;
  tForma: number;
  ultimo: number;
  /** Partidos por circuito en los últimos 365 días (para decidir su circuito principal). */
  circuitos: Map<string, number[]>;
}

export class AcumuladorPerfiles {
  readonly datos = new Map<string, Acum>();
  readonly elo = new SistemaElo();
  private lambda: number;

  constructor(private M: ParamsModelo) {
    this.lambda = Math.log(2) / M.vidaMediaDias;
  }

  private acum(id: string): Acum {
    let a = this.datos.get(id);
    if (!a) {
      a = {
        t: 0,
        v: { todas: new Float64Array(NC), dura: new Float64Array(NC), tierra: new Float64Array(NC), hierba: new Float64Array(NC) },
        nReal: { todas: 0, dura: 0, tierra: 0, hierba: 0 },
        nPartidos: 0,
        forma: 0,
        tForma: 0,
        ultimo: 0,
        circuitos: new Map(),
      };
      this.datos.set(id, a);
    }
    return a;
  }

  private decaer(a: Acum, t: number) {
    if (a.t && t > a.t) {
      const f = Math.exp(-this.lambda * (t - a.t));
      for (const k of CLAVES) {
        const v = a.v[k];
        for (let i = 0; i < NC; i++) v[i] *= f;
      }
    }
    if (t > a.t) a.t = t;
  }

  /** Perfil mínimo (para el modelo) de un jugador en la fecha t. */
  perfil(id: string, t: number, pool: Pool): PerfilMinimo & { nPartidos: number } {
    const a = this.acum(id);
    this.decaer(a, t);
    const formaDecaida = a.tForma ? a.forma * Math.exp((-Math.LN2 * (t - a.tForma)) / VIDA_MEDIA_FORMA) : 0;
    return {
      pool,
      elo: this.elo.get(id),
      stats: { todas: Array.from(a.v.todas), dura: Array.from(a.v.dura), tierra: Array.from(a.v.tierra), hierba: Array.from(a.v.hierba) },
      nReal: { ...a.nReal },
      forma: formaDecaida,
      nPartidos: a.nPartidos,
    };
  }

  /** Vista sin copias (más rápida) para cálculos internos. */
  private vista(id: string, pool: Pool): PerfilMinimo {
    const a = this.acum(id);
    return {
      pool,
      elo: this.elo.get(id),
      stats: a.v as unknown as Record<ClaveSuperficie, number[]>,
      nReal: a.nReal,
      forma: 0,
    };
  }

  circuitoPrincipal(id: string, t: number): string | null {
    const a = this.datos.get(id);
    if (!a) return null;
    let mejor: string | null = null;
    let max = 0;
    for (const [c, fechas] of a.circuitos) {
      const n = fechas.filter((f) => t - f <= 365).length;
      if (n > max) {
        max = n;
        mejor = c;
      }
    }
    return mejor;
  }

  ultimoPartido(id: string): number {
    return this.datos.get(id)?.ultimo ?? 0;
  }

  nPartidos(id: string): number {
    return this.datos.get(id)?.nPartidos ?? 0;
  }

  /** Incorpora un partido (en orden cronológico). */
  anadir(m: PartidoNormalizado, opciones: { stats?: boolean; elo?: boolean } = {}) {
    if (m.wo) return;
    const { stats = true, elo = true } = opciones;
    const t = m.fecha;
    const W = this.acum(m.ganador);
    const L = this.acum(m.perdedor);
    this.decaer(W, t);
    this.decaer(L, t);
    W.nPartidos++;
    L.nPartidos++;
    W.ultimo = Math.max(W.ultimo, t);
    L.ultimo = Math.max(L.ultimo, t);
    for (const [acc, c] of [
      [W, m.circuito],
      [L, m.circuito],
    ] as const) {
      const arr = acc.circuitos.get(c) ?? [];
      arr.push(t);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      acc.circuitos.set(c, arr);
    }

    // Forma: resultado menos lo esperado por el Elo antes del partido.
    const pW = this.elo.prob(m.ganador, m.perdedor, m.sup, this.M.pesoSuperficieElo);
    for (const [acc, res] of [
      [W, 1 - pW],
      [L, -(1 - pW)],
    ] as const) {
      const f = acc.tForma ? Math.exp((-Math.LN2 * (t - acc.tForma)) / VIDA_MEDIA_FORMA) : 0;
      acc.forma = acc.forma * f + res;
      acc.tForma = t;
    }

    if (stats && m.w && m.l && !m.retirada && m.w[2] > 0 && m.l[2] > 0) {
      const medias = this.M.medias[m.pool][m.sup];
      const eW = estimarJugador(this.vista(m.ganador, m.pool), m.sup, this.M);
      const eL = estimarJugador(this.vista(m.perdedor, m.pool), m.sup, this.M);
      const [tbW, tbL] = tiebreaksDelMarcador(m.marcador);
      const sumar = (acc: Acum, yo: number[], rival: number[], eRival: typeof eW, tbG: number, tbP: number) => {
        const [ace, df, svpt, in1, won1, won2, svgms, bps, bpf] = yo;
        const [aceR, dfR, svptR, , won1R, won2R, svgmsR, bpsR, bpfR] = rival;
        const ganadosSaque = won1 + won2;
        const ganadosResto = svptR - won1R - won2R;
        // Lo esperado frente a este rival (con su resto/saque estimados antes del partido).
        const espSaque = medias.saque - eRival.exResto;
        const espResto = 1 - medias.saque - eRival.exSaque;
        const fila = new Float64Array(NC);
        fila[I.svpt] = svpt;
        fila[I.in1] = in1;
        fila[I.won1] = won1;
        fila[I.won2] = won2;
        fila[I.ace] = ace;
        fila[I.df] = df;
        fila[I.svgms] = svgms;
        fila[I.bpf] = bpf;
        fila[I.bps] = bps;
        fila[I.rpt] = svptR;
        fila[I.rwon] = ganadosResto;
        fila[I.aceC] = aceR;
        fila[I.dfC] = dfR;
        fila[I.rgms] = svgmsR;
        fila[I.brk] = bpfR - bpsR;
        fila[I.tbp] = tbG + tbP;
        fila[I.tbw] = tbG;
        fila[I.m] = 1;
        fila[I.exS] = ganadosSaque - svpt * espSaque;
        fila[I.exR] = ganadosResto - svptR * espResto;
        for (const k of ['todas', m.sup] as const) {
          const v = acc.v[k];
          for (let i = 0; i < NC; i++) v[i] += fila[i];
          acc.nReal[k]++;
        }
      };
      sumar(W, m.w, m.l, eL, tbW, tbL);
      sumar(L, m.l, m.w, eW, tbL, tbW);
    }

    if (elo && !m.retirada) this.elo.actualizar(m.ganador, m.perdedor, m.sup, t, m.mejorDe === 5);
  }

  /** P(ganador) según el Elo actual (antes de añadir el partido). */
  probEloAntes(m: PartidoNormalizado): number {
    return probElo(
      ratingCombinado(this.elo.get(m.ganador), m.sup, this.M.pesoSuperficieElo),
      ratingCombinado(this.elo.get(m.perdedor), m.sup, this.M.pesoSuperficieElo),
    );
  }
}
