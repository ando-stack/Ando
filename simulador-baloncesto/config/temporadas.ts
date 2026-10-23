/** Temporadas usadas por la ingesta y el modelo. */
export const CURRENT_SEASON = '2026-27';
export const PREVIOUS_SEASON = '2025-26';

/**
 * Rangos de identificadores de partido de acb.com que contienen la Liga Endesa de cada temporada.
 * Los identificadores son correlativos y se comparten con otras competiciones (Copa, Supercopa,
 * categorías inferiores), que se descartan por competitionId/editionId.
 * Localizados sondeando los identificadores el 23/10/2026 (ver docs/fuentes.md).
 */
export const ACB_MATCH_RANGES: Record<string, { ranges: [number, number][]; stopAfterMisses: number }> = {
  '2025-26': { ranges: [[104441, 104800], [105321, 105380]], stopAfterMisses: 0 },
  '2026-27': { ranges: [[105361, 106200]], stopAfterMisses: 60 },
};
