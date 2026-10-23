/**
 * Formatos de partido (individual) por circuito, categoría y torneo.
 *
 * Verificado contra los reglamentos oficiales (consultados el 23-10-2026):
 *  - ATP Rulebook 2025, cap. 1, regla 1.03 B.1 (2026: el PDF oficial devuelve 403 al acceso
 *    automatizado; la tabla de contenidos 2026 no anuncia cambios en el número de sets):
 *    "Singles. All matches, including finals, shall be the best of three (3) tie-break sets."
 *    Se aplica a ATP Tour y ATP Challenger Tour.
 *  - WTA Rulebook 2026 (rev. 27-07-2026), sección "Scoring System" (39.a, y apéndice E 40.a
 *    para WTA 125): "All Singles (Main Draw and Qualifying) matches in all WTA Tournaments are
 *    the best of three (3) tie-break sets." El tie-break es a 7 puntos (Rules of Tennis).
 *  - Grand Slam Rule Book 2026, sección "Number of Sets, Tie-break": cuadro final masculino al
 *    mejor de 5; todo lo demás al mejor de 3; tie-break a 10 puntos en el set final (a 6-6).
 *  - Next Gen ATP Finals (reglas 2025, nextgenatpfinals.com): sets a 4 juegos, tie-break a 3-3,
 *    mejor de 5, sin ventaja (punto decisivo).
 *
 * Todo es configurable: si un torneo cambia de reglas basta con editar este archivo.
 */

export type SetDecisivo =
  /** Tie-break a N puntos cuando el set final llega a gamesPorSet-gamesPorSet. */
  | { tipo: 'tiebreak'; puntos: number }
  /** Set final con ventaja (sin tie-break). Hoy no lo usa ningún torneo, se conserva por si acaso. */
  | { tipo: 'ventaja' }
  /** El set final se sustituye por un super tie-break (match tie-break) a N puntos. */
  | { tipo: 'superTiebreak'; puntos: number };

export interface FormatoPartido {
  id: string;
  nombre: string;
  /** 3 o 5 */
  mejorDe: 3 | 5;
  /** Juegos para ganar un set (6 normalmente, 4 en Next Gen). */
  juegosPorSet: number;
  /** El tie-break se juega con este empate (6-6, o 3-3 en Next Gen). */
  tiebreakEn: number;
  /** Puntos del tie-break en los sets no decisivos. */
  puntosTiebreak: number;
  setDecisivo: SetDecisivo;
  /** Punto decisivo en 40-40 (sin ventaja). */
  sinVentaja: boolean;
  fuente: string;
}

export const FORMATOS: Record<string, FormatoPartido> = {
  BO3_TB7: {
    id: 'BO3_TB7',
    nombre: 'Mejor de 3 sets, tie-break a 7 en todos los sets',
    mejorDe: 3,
    juegosPorSet: 6,
    tiebreakEn: 6,
    puntosTiebreak: 7,
    setDecisivo: { tipo: 'tiebreak', puntos: 7 },
    sinVentaja: false,
    fuente: 'ATP Rulebook 1.03 B.1 / WTA Rulebook 2026 §39.a',
  },
  BO3_TB10: {
    id: 'BO3_TB10',
    nombre: 'Mejor de 3 sets, tie-break a 10 en el tercer set (Grand Slam)',
    mejorDe: 3,
    juegosPorSet: 6,
    tiebreakEn: 6,
    puntosTiebreak: 7,
    setDecisivo: { tipo: 'tiebreak', puntos: 10 },
    sinVentaja: false,
    fuente: 'Grand Slam Rule Book 2026, Number of Sets, Tie-break',
  },
  BO5_TB10: {
    id: 'BO5_TB10',
    nombre: 'Mejor de 5 sets, tie-break a 10 en el quinto set (Grand Slam, cuadro final masculino)',
    mejorDe: 5,
    juegosPorSet: 6,
    tiebreakEn: 6,
    puntosTiebreak: 7,
    setDecisivo: { tipo: 'tiebreak', puntos: 10 },
    sinVentaja: false,
    fuente: 'Grand Slam Rule Book 2026, Number of Sets, Tie-break',
  },
  BO5_TB7: {
    id: 'BO5_TB7',
    nombre: 'Mejor de 5 sets, tie-break a 7 en todos los sets',
    mejorDe: 5,
    juegosPorSet: 6,
    tiebreakEn: 6,
    puntosTiebreak: 7,
    setDecisivo: { tipo: 'tiebreak', puntos: 7 },
    sinVentaja: false,
    fuente: 'Modo libre',
  },
  BO3_STB10: {
    id: 'BO3_STB10',
    nombre: 'Dos sets con tie-break y super tie-break a 10 como tercer set',
    mejorDe: 3,
    juegosPorSet: 6,
    tiebreakEn: 6,
    puntosTiebreak: 7,
    setDecisivo: { tipo: 'superTiebreak', puntos: 10 },
    sinVentaja: false,
    fuente: 'Modo libre (formato de exhibiciones / Laver Cup)',
  },
  NEXTGEN: {
    id: 'NEXTGEN',
    nombre: 'Next Gen ATP Finals: mejor de 5 sets a 4 juegos, tie-break a 3-3, sin ventaja',
    mejorDe: 5,
    juegosPorSet: 4,
    tiebreakEn: 3,
    puntosTiebreak: 7,
    setDecisivo: { tipo: 'tiebreak', puntos: 7 },
    sinVentaja: true,
    fuente: 'Next Gen ATP Finals 2025, Rules and Innovations',
  },
};

export type Circuito = 'ATP' | 'WTA' | 'CH' | 'W125';

export const NOMBRE_CIRCUITO: Record<Circuito, string> = {
  ATP: 'ATP',
  WTA: 'WTA',
  CH: 'ATP Challenger',
  W125: 'WTA 125',
};

export type Superficie = 'dura' | 'tierra' | 'hierba';
export const SUPERFICIES: Superficie[] = ['dura', 'tierra', 'hierba'];
export const NOMBRE_SUPERFICIE: Record<Superficie, string> = {
  dura: 'Dura',
  tierra: 'Tierra batida',
  hierba: 'Hierba',
};

/** Torneos con formato propio, identificados por patrones de nombre. */
const ESPECIALES: { patron: RegExp; circuito?: Circuito; formato: string }[] = [
  { patron: /next ?gen/i, circuito: 'ATP', formato: 'NEXTGEN' },
];

const GRAND_SLAMS = /(australian open|roland garros|french open|wimbledon|us open)/i;

/**
 * Formato de un partido según circuito, categoría y fase.
 * @param esCuadroFinal false para la fase previa (qualy), que en los Grand Slams es al mejor de 3.
 */
export function formatoDe(params: {
  circuito: Circuito;
  categoria?: string;
  nombreTorneo?: string;
  esCuadroFinal?: boolean;
}): FormatoPartido {
  const { circuito, categoria = '', nombreTorneo = '', esCuadroFinal = true } = params;
  for (const e of ESPECIALES) {
    if ((!e.circuito || e.circuito === circuito) && e.patron.test(nombreTorneo)) return FORMATOS[e.formato];
  }
  const esGS = /grand ?slam/i.test(categoria) || (GRAND_SLAMS.test(nombreTorneo) && circuito !== 'CH' && circuito !== 'W125');
  if (esGS) {
    if (circuito === 'ATP' && esCuadroFinal) return FORMATOS.BO5_TB10;
    return FORMATOS.BO3_TB10;
  }
  return FORMATOS.BO3_TB7;
}
