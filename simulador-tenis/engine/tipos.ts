/** Parámetros del saque de un jugador en un partido concreto (ya combinados con el rival). */
export interface ParametrosSaque {
  /** P(primer saque dentro). */
  pPrimerDentro: number;
  /** P(ace | primer saque dentro). */
  pAce1: number;
  /** P(ganar el punto | primer saque dentro), aces incluidos. */
  pGana1: number;
  /** P(segundo saque dentro) = 1 − P(doble falta | segundo saque). */
  pSegundoDentro: number;
  /** P(ace | segundo saque dentro). */
  pAce2: number;
  /** P(ganar el punto | segundo saque dentro), aces incluidos. */
  pGana2: number;
}

export interface ParametrosPartido {
  a: ParametrosSaque;
  b: ParametrosSaque;
  /** Desviación típica (en escala logit) del nivel de cada jugador en cada simulación. */
  sigma: number;
  /** Desviación típica (log) del ritmo de aces de cada jugador en cada simulación. */
  sigmaAces: number;
}

/**
 * Registro de una simulación: Int32Array de ANCHO posiciones.
 * Todas las cifras van desde la perspectiva de cada jugador (A = 0, B = 1).
 */
export const R = {
  GANADOR: 0, // 0 = A, 1 = B
  NSETS: 1,
  SETS: 2, // 2..11: juegos A, juegos B de cada set (5 sets máx.)
  TB: 12, // 12..16: 0 sin tie-break, 1 lo gana A, 2 lo gana B
  ACES: 17, // 17 A, 18 B
  DF: 19, // 19 A, 20 B
  PTS_SAQUE: 21, // 21 A, 22 B
  PRIMEROS_DENTRO: 23,
  GANADOS_1: 25,
  GANADOS_2: 27,
  JUEGOS_SAQUE: 29,
  BREAKS: 31, // breaks conseguidos por A (31) y por B (32)
  BP_CONCEDIDOS: 33, // puntos de break afrontados al saque por A (33) y por B (34)
  BP_SALVADOS: 35,
  PRIMER_SACADOR: 37,
  PUNTOS_GANADOS: 38, // 38 A, 39 B
  SUPER_TB: 40, // 1 si el último set fue un super tie-break
} as const;

export const ANCHO = 41;
