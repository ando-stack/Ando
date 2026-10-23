/**
 * Reglas de cada competición que afectan a la simulación.
 *
 * Fuentes verificadas (23/10/2026):
 *  - NBA: NBA Official Rulebook, Regla 12 "Fouls and Penalties", sección V "Free Throw Penalty
 *    Situations" (https://official.nba.com/rule-no-12-fouls-and-penalties/): cuatro faltas de equipo
 *    por periodo sin penalización (tres en la prórroga); si no se ha llegado al cupo antes de los
 *    dos últimos minutos, se permite una falta en los dos últimos minutos; las faltas personales
 *    del equipo atacante no cuentan como falta de equipo. Eliminación con 6 faltas personales.
 *  - FIBA (EuroLiga y Liga Endesa): Reglas Oficiales de Baloncesto FIBA 2024 (en vigor desde el
 *    1/10/2024), art. 40 (eliminación con 5 faltas) y art. 41 (penalización por faltas de equipo:
 *    a partir de 4 faltas de equipo en un cuarto, las faltas personales sobre un jugador que no
 *    está tirando se castigan con 2 tiros libres; las faltas de la prórroga cuentan como del 4.º
 *    cuarto; las faltas del equipo con control de balón cuentan como falta de equipo pero se
 *    castigan con saque).
 */
import type { CompetitionId } from '../engine/datatypes';

export interface CompetitionRules {
  id: CompetitionId;
  nombre: string;
  periodos: number;
  /** Duración de cada cuarto en segundos. */
  duracionPeriodo: number;
  /** Duración de cada prórroga en segundos. */
  duracionProrroga: number;
  /** Faltas personales para la eliminación. */
  faltasEliminacion: number;
  relojPosesion: number;
  /** Reinicio del reloj de posesión tras rebote ofensivo. */
  relojTrasReboteOfensivo: number;
  /** Distancia de la línea de triple (m), solo informativa: el efecto está en los datos de cada liga. */
  lineaTriple: string;
  /** Número de faltas de equipo por periodo sin penalización (la siguiente se castiga con 2 TL). */
  faltasEquipoSinPenalizacion: number;
  /** Igual que el anterior, en la prórroga. */
  faltasEquipoSinPenalizacionProrroga: number;
  /** Las faltas de prórroga se suman a las del 4.º cuarto (FIBA). */
  prorrogaAcumulaCuartoCuarto: boolean;
  /** Regla NBA: una falta permitida en los dos últimos minutos si no se llegó al cupo. */
  faltaPermitidaUltimosDosMinutos: boolean;
  /** Las faltas en ataque cuentan como falta de equipo. */
  faltaAtaqueCuentaEquipo: boolean;
  /** Jugadores máximos convocados (acta). */
  maxConvocados: number;
  /** Ventana final (s) en la que el equipo que pierde hace faltas intencionadas. */
  ventanaFaltasIntencionadas: number;
  notas: string[];
}

export const REGLAS: Record<CompetitionId, CompetitionRules> = {
  nba: {
    id: 'nba',
    nombre: 'NBA',
    periodos: 4,
    duracionPeriodo: 12 * 60,
    duracionProrroga: 5 * 60,
    faltasEliminacion: 6,
    relojPosesion: 24,
    relojTrasReboteOfensivo: 14,
    lineaTriple: '7,24 m (6,71 m en las esquinas)',
    faltasEquipoSinPenalizacion: 4,
    faltasEquipoSinPenalizacionProrroga: 3,
    prorrogaAcumulaCuartoCuarto: false,
    faltaPermitidaUltimosDosMinutos: true,
    faltaAtaqueCuentaEquipo: false,
    maxConvocados: 13,
    ventanaFaltasIntencionadas: 60,
    notas: [
      'Penalización (2 TL) desde la 5.ª falta de equipo del periodo (4.ª en la prórroga).',
      'En los dos últimos minutos de cada periodo, la 2.ª falta del equipo da penalización si no se había llegado al cupo.',
      'Las faltas en ataque no cuentan como falta de equipo.',
      'Hasta 13 jugadores activos por partido.',
    ],
  },
  euroleague: {
    id: 'euroleague',
    nombre: 'EuroLiga',
    periodos: 4,
    duracionPeriodo: 10 * 60,
    duracionProrroga: 5 * 60,
    faltasEliminacion: 5,
    relojPosesion: 24,
    relojTrasReboteOfensivo: 14,
    lineaTriple: '6,75 m (6,60 m en las esquinas)',
    faltasEquipoSinPenalizacion: 4,
    faltasEquipoSinPenalizacionProrroga: 4,
    prorrogaAcumulaCuartoCuarto: true,
    faltaPermitidaUltimosDosMinutos: false,
    faltaAtaqueCuentaEquipo: true,
    maxConvocados: 12,
    ventanaFaltasIntencionadas: 50,
    notas: [
      'Reglas FIBA: penalización (2 TL) desde la 5.ª falta de equipo de cada cuarto.',
      'Las faltas de la prórroga cuentan como del 4.º cuarto.',
      'Hasta 12 jugadores en el acta.',
    ],
  },
  acb: {
    id: 'acb',
    nombre: 'Liga Endesa (ACB)',
    periodos: 4,
    duracionPeriodo: 10 * 60,
    duracionProrroga: 5 * 60,
    faltasEliminacion: 5,
    relojPosesion: 24,
    relojTrasReboteOfensivo: 14,
    lineaTriple: '6,75 m (6,60 m en las esquinas)',
    faltasEquipoSinPenalizacion: 4,
    faltasEquipoSinPenalizacionProrroga: 4,
    prorrogaAcumulaCuartoCuarto: true,
    faltaPermitidaUltimosDosMinutos: false,
    faltaAtaqueCuentaEquipo: true,
    maxConvocados: 12,
    ventanaFaltasIntencionadas: 50,
    notas: [
      'Reglas FIBA: penalización (2 TL) desde la 5.ª falta de equipo de cada cuarto.',
      'Las faltas de la prórroga cuentan como del 4.º cuarto.',
      'Hasta 12 jugadores en el acta. El cupo de jugadores de formación local (licencia JFL) condiciona las plantillas, pero no se simula: se usan las convocatorias reales recientes.',
    ],
  },
};

/** Segundos de juego reglamentario. */
export function regulationSeconds(r: CompetitionRules) {
  return r.periodos * r.duracionPeriodo;
}
