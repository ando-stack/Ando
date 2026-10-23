/** Tipos de entrada y salida del motor de simulación. */
import type { CompetitionId } from './datatypes';
import type { CompetitionRules } from '../config/reglas';

/** Índices de las estadísticas por jugador dentro de los arrays del motor. */
export const ST = {
  SEC: 0,
  PTS: 1,
  FG2M: 2,
  FG2A: 3,
  FG3M: 4,
  FG3A: 5,
  FTM: 6,
  FTA: 7,
  OREB: 8,
  DREB: 9,
  AST: 10,
  STL: 11,
  BLK: 12,
  TOV: 13,
  PF: 14,
  PFD: 15,
} as const;
export const N_STATS = 16;
export const STAT_NAMES = ['sec', 'pts', 'fg2m', 'fg2a', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pfd'] as const;

export interface SimPlayer {
  id: string;
  name: string;
  /** Minutos previstos en el partido (antes de la variabilidad). */
  minutes: number;
  /** Fracción de sus minutos en cada cuarto (suma 1). */
  qShare: [number, number, number, number];
  starter: boolean;
  /** Posesiones usadas por minuto (FGA + viajes a TL + pérdidas). */
  usage: number;
  /** Reparto de sus posesiones usadas: pérdida, viaje a TL (falta en tiro), tiro de 2, tiro de 3. */
  pTov: number;
  pTrip: number;
  p2: number;
  p3: number;
  fg2: number;
  fg3: number;
  ft: number;
  /** Tasas por minuto que se usan como pesos para asignar acciones. */
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  pf: number;
  pfd: number;
}

export interface SimTeam {
  id: string;
  name: string;
  short: string;
  players: SimPlayer[];
  /** Posesiones por partido reglamentario. */
  pace: number;
  orebPct: number;
  drebPct: number;
  astPerFgm: number;
  /** Proporción de canastas de triple entre las canastas (para repartir asistencias 2/3). */
  fg3mShare: number;
  /** Multiplicadores defensivos respecto a la media de la liga (lo que concede al rival). */
  defFg2: number;
  defFg3: number;
  defTov: number;
  defTrip: number;
  defThreeShare: number;
  /** Probabilidad de que una pérdida del rival sea un robo de este equipo. */
  stealShare: number;
  /** Probabilidad de taponar un tiro de 2 fallado del rival. */
  blockPerMiss2: number;
  /** Suma esperada (ponderada por minutos) de pesos en pista, para ajustar por quinteto. */
  avgOnCourt: { oreb: number; dreb: number; ast: number; stl: number; blk: number; pf: number };
}

/** Parámetros calibrables del motor por competición (config/calibracion.json). */
export interface SimParams {
  paceFactor: number;
  fg2Factor: number;
  fg3Factor: number;
  ftFactor: number;
  tovFactor: number;
  tripFactor: number;
  orebFactor: number;
  astFactor: number;
  stlFactor: number;
  blkFactor: number;
  /** Faltas no de tiro por jugada (antes de ajustar por quinteto). */
  nonShootingFoulRate: number;
  /** Fracción de las pérdidas que son faltas en ataque. */
  offensiveFoulShare: number;
  /** Probabilidad de 2+1 / 3+1 en una canasta. */
  andOneRate: number;
  /** Fracción de viajes a TL que son de 3 tiros. */
  threeShotTripShare: number;
  /** Factor de rebote ofensivo tras TL fallado (relativo al rebote de tiro de campo). */
  ftOrebFactor: number;
  /** Ventaja de campo: multiplicador de acierto (+h/2 local, -h/2 visitante). */
  homeShootingEdge: number;
  /** Desviación típica (log) de los minutos de cada jugador por partido. */
  minutesSd: number;
  /** Desviación típica del ritmo por partido. */
  paceSd: number;
  /** Diferencia para considerar el partido decidido ("garbage time") en el último cuarto. */
  garbageMargin: number;
  /** Fracción de fallos que acaban en rebote de equipo (no asignado a ningún jugador). */
  teamReboundShare: number;
  /** Efecto marcador: reducción relativa del acierto del equipo que va por encima de la ventaja
   *  esperada en ese momento, por cada 10 puntos de desviación (y aumento si va por debajo). */
  scoreEffect: number;
  /** Forma del día: desviación típica (log) de un multiplicador de acierto por equipo y partido. */
  gameFormSd: number;
  /** Factor de duración de los ataques del equipo que pierde en el último minuto. */
  lateMinuteHurry: number;
  /** Multiplicador de triples perdiendo de 3 a 6 en el último minuto. */
  lateThreeBoost: number;
  /** Variabilidad (log) del uso de cada jugador en cada partido (noches con más o menos tiros). */
  usageSd: number;
}

export const DEFAULT_PARAMS: SimParams = {
  paceFactor: 1,
  fg2Factor: 1,
  fg3Factor: 1,
  ftFactor: 1,
  tovFactor: 1,
  tripFactor: 1,
  orebFactor: 1,
  astFactor: 1,
  stlFactor: 1,
  blkFactor: 1,
  nonShootingFoulRate: 0.05,
  offensiveFoulShare: 0.12,
  andOneRate: 0.04,
  threeShotTripShare: 0.04,
  ftOrebFactor: 0.45,
  homeShootingEdge: 0.02,
  minutesSd: 0.21,
  paceSd: 0.035,
  garbageMargin: 20,
  teamReboundShare: 0.1,
  scoreEffect: 0.02,
  gameFormSd: 0,
  lateMinuteHurry: 0.4,
  lateThreeBoost: 2.5,
  usageSd: 0.3,
};

export interface SimGameInput {
  comp: CompetitionId;
  rules: CompetitionRules;
  params: SimParams;
  leaguePace: number;
  home: SimTeam;
  away: SimTeam;
  /** Margen final esperado (local - visitante) sin efecto marcador; lo calcula una simulación piloto. */
  expectedMargin?: number;
}

/** Resultado de un partido simulado. */
export interface GameResult {
  homePeriods: number[];
  awayPeriods: number[];
  /** Estadísticas por jugador: nPlayers × N_STATS (segundos en ST.SEC). */
  homeStats: Float64Array;
  awayStats: Float64Array;
  possessions: [number, number];
  /** Margen (local - visitante) al pasar por el último minuto del 4.º cuarto (diagnóstico). */
  marginAt60?: number;
}
