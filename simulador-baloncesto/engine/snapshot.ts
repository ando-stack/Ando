/**
 * Formato del "snapshot" de una competición: datos ya procesados que consumen la interfaz,
 * el motor, la calibración y el backtest. Lo genera ingest/build.ts.
 */
import type { CompetitionId, InjuryEntry } from './datatypes';

/** Totales de conteo (por partido o acumulados). */
export interface Counting {
  min: number; // minutos
  pts: number;
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pfd: number;
}

export const COUNTING_KEYS: (keyof Counting)[] = [
  'min', 'pts', 'fg2m', 'fg2a', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pfd',
];

export function emptyCounting(): Counting {
  return { min: 0, pts: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pfd: 0 };
}

/** Estadísticas de equipo por partido (medias), propias y del rival. */
export interface TeamSeasonStats {
  gp: number;
  w: number;
  l: number;
  poss: number; // posesiones por partido (media equipo/rival)
  own: Counting; // medias por partido
  opp: Counting;
  ortg: number; // puntos por 100 posesiones
  drtg: number;
  /** Tasas derivadas */
  orebPct: number; // OREB / (OREB + DREB rival)
  drebPct: number; // DREB / (DREB + OREB rival)
  tovPct: number; // pérdidas por posesión
  oppTovPct: number;
  astPerFgm: number;
  stlPerOppPoss: number;
  blkPerOppFg2a: number;
  fg2Pct: number;
  fg3Pct: number;
  ftPct: number;
  oppFg2Pct: number;
  oppFg3Pct: number;
  fg3aShare: number; // 3PA / FGA
  oppFg3aShare: number;
  ftaPerFga: number;
  oppFtaPerFga: number;
  pfPerGame: number;
}

export interface TeamSnapshot {
  id: string;
  name: string;
  short: string;
  logo?: string | null;
  current: TeamSeasonStats | null;
  previous: TeamSeasonStats | null;
  /** Mezcla ponderada usada por el modelo. */
  blended: TeamSeasonStats;
  /** Pesos usados en la mezcla (partidos de la temporada actual y peso de la anterior). */
  blendWeights: { gpCurrent: number; previousWeight: number };
  /** Puntos por cuarto a favor y en contra (media, temporada actual + anterior ponderadas). */
  quarters: { for: number[]; against: number[] };
  home: { gp: number; w: number; ptsFor: number; ptsAgainst: number };
  away: { gp: number; w: number; ptsFor: number; ptsAgainst: number };
}

export interface PlayerRates {
  /** Tasas por minuto en pista. */
  perMin: Counting;
  /** Porcentajes regularizados. */
  fg2Pct: number;
  fg3Pct: number;
  ftPct: number;
  /** Porcentaje de uso: posesiones que termina (FGA + 0,44·FTA + TOV) / posesiones del equipo en pista. */
  usage: number;
}

export interface PlayerSnapshot {
  id: string;
  teamId: string;
  name: string;
  position: 'G' | 'F' | 'C' | null;
  positionRaw?: string | null;
  height?: number | null;
  nationality?: string | null;
  jersey?: string | null;
  /** Temporada actual en este equipo/competición. */
  gp: number;
  gs: number;
  mpg: number;
  gpPrev: number;
  mpgPrev: number;
  /** Totales (sin ponderar) de la temporada actual y anterior. */
  totals: Counting;
  totalsPrev: Counting;
  /** Por 36 (NBA) o por 40 minutos (FIBA), con la mezcla ponderada. */
  per36or40: Counting;
  rates: PlayerRates;
  /** Fracción de sus minutos de tiempo reglamentario jugada en cada cuarto. */
  quarterShare: number[];
  quarterShareSource: 'datos' | 'estimado';
  /** Minutos en los últimos partidos del equipo (null = no jugó). */
  recentMinutes: (number | null)[];
  recentStarts: number;
  estimated: boolean;
  estimateNote?: string;
}

export interface LineupSnapshot {
  teamId: string;
  starters: string[];
  status: 'confirmado' | 'probable';
  basis: string;
  source: string;
  updatedAt: string;
  warning?: string;
}

export interface RotationEntry {
  playerId: string;
  minutes: number;
  role: 'titular' | 'rotacion' | 'reserva';
}

export interface RotationSnapshot {
  teamId: string;
  players: RotationEntry[];
  basis: string;
  updatedAt: string;
}

export interface LeagueAverages {
  gamesCurrent: number;
  gamesPrevious: number;
  /** Medias por equipo y partido. */
  perTeamGame: Counting & { poss: number };
  homeMargin: number;
  /** Desviación típica del margen final (local - visitante). */
  marginSd: number;
  homeWinPct: number;
  otPct: number;
  fg2Pct: number;
  fg3Pct: number;
  ftPct: number;
  orebPct: number;
  tovPct: number;
  astPerFgm: number;
  stlPerPoss: number;
  blkPerFg2a: number;
  /** Medias por minuto por posición (para estimar jugadores sin datos). */
  byPosition: Record<'G' | 'F' | 'C' | 'ALL', { perMin: Counting; fg2Pct: number; fg3Pct: number; ftPct: number; usage: number }>;
  /** Reparto medio de minutos por cuarto de titulares y suplentes. */
  quarterShareStarters: number[];
  quarterShareBench: number[];
}

export interface SourceRef {
  name: string;
  url: string;
  fetchedAt: string;
  terms: string;
}

export interface CompetitionSnapshot {
  comp: CompetitionId;
  season: string;
  previousSeason: string;
  generatedAt: string;
  /** Fecha del último partido incluido. */
  lastGameDate: string | null;
  sources: SourceRef[];
  league: LeagueAverages;
  teams: TeamSnapshot[];
  players: PlayerSnapshot[];
  lineups: LineupSnapshot[];
  rotations: RotationSnapshot[];
  injuries: InjuryEntry[];
  notes: string[];
}
