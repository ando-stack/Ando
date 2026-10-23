/**
 * Rating Elo general y por superficie.
 *
 * Método (variante de FiveThirtyEight / Tennis Abstract, documentado en docs/modelo.md):
 *  - Rating inicial 1500.
 *  - K dinámico: K = 250 / (n + 5)^0.4, con n = partidos previos del jugador (en el rating
 *    general) o en esa superficie (en el rating de superficie). Los jugadores nuevos se mueven
 *    rápido y los veteranos se estabilizan.
 *  - Partidos de Grand Slam al mejor de 5: K × 1,1 (más información por partido).
 *  - Se excluyen walkovers y retiradas.
 *  - Probabilidad: 1 / (1 + 10^((Rb − Ra)/400)) con Ra = (1 − w)·general + w·superficie.
 */
import type { Superficie } from '../config/formatos';

export interface RatingJugador {
  g: number;
  n: number;
  s: Record<Superficie, number>;
  ns: Record<Superficie, number>;
  /** Fecha (días desde 1970) del último partido. */
  ultimo: number;
}

export const ELO_INICIAL = 1500;

export function kFactor(n: number): number {
  return 250 / Math.pow(n + 5, 0.4);
}

export function probElo(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function nuevoRating(): RatingJugador {
  return {
    g: ELO_INICIAL,
    n: 0,
    s: { dura: ELO_INICIAL, tierra: ELO_INICIAL, hierba: ELO_INICIAL },
    ns: { dura: 0, tierra: 0, hierba: 0 },
    ultimo: 0,
  };
}

export function ratingCombinado(r: RatingJugador, sup: Superficie, pesoSuperficie: number): number {
  return (1 - pesoSuperficie) * r.g + pesoSuperficie * r.s[sup];
}

export class SistemaElo {
  readonly ratings = new Map<string, RatingJugador>();

  get(id: string): RatingJugador {
    let r = this.ratings.get(id);
    if (!r) {
      r = nuevoRating();
      this.ratings.set(id, r);
    }
    return r;
  }

  prob(a: string, b: string, sup: Superficie, pesoSuperficie: number): number {
    return probElo(ratingCombinado(this.get(a), sup, pesoSuperficie), ratingCombinado(this.get(b), sup, pesoSuperficie));
  }

  actualizar(ganador: string, perdedor: string, sup: Superficie, fecha: number, mejorDe5 = false) {
    const w = this.get(ganador);
    const l = this.get(perdedor);
    const mult = mejorDe5 ? 1.1 : 1;
    const eg = probElo(w.g, l.g);
    const es = probElo(w.s[sup], l.s[sup]);
    const kwg = kFactor(w.n) * mult;
    const klg = kFactor(l.n) * mult;
    const kws = kFactor(w.ns[sup]) * mult;
    const kls = kFactor(l.ns[sup]) * mult;
    w.g += kwg * (1 - eg);
    l.g -= klg * (1 - eg);
    w.s[sup] += kws * (1 - es);
    l.s[sup] -= kls * (1 - es);
    w.n++;
    l.n++;
    w.ns[sup]++;
    l.ns[sup]++;
    w.ultimo = fecha;
    l.ultimo = fecha;
  }
}
