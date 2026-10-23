/**
 * Tipos de datos normalizados compartidos por la ingesta, el motor y la interfaz.
 * Todas las competiciones se reducen al mismo formato de partido (box score por jugador
 * con segundos jugados por cuarto), y a partir de él se calculan todas las estadísticas.
 */
export type CompetitionId = 'nba' | 'euroleague' | 'acb';

/** Índices de la línea compacta de un jugador en un partido. */
export const PL = {
  pid: 0,
  starter: 1,
  sec: 2,
  pts: 3,
  fg2m: 4,
  fg2a: 5,
  fg3m: 6,
  fg3a: 7,
  ftm: 8,
  fta: 9,
  oreb: 10,
  dreb: 11,
  ast: 12,
  stl: 13,
  blk: 14,
  tov: 15,
  pf: 16,
  pfd: 17,
  /** Segundos jugados en Q1..Q4 y en el conjunto de prórrogas (-1 si no se conoce). */
  q1: 18,
  q2: 19,
  q3: 20,
  q4: 21,
  ot: 22,
} as const;

/** [pid, starter(0/1), sec, pts, fg2m, fg2a, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf, pfd, q1s, q2s, q3s, q4s, ots] */
export type PlayerLine = [string, ...number[]];

export interface TeamGameSide {
  teamId: string;
  score: number;
  /** Puntos por periodo: Q1..Q4 y luego cada prórroga. */
  periods: number[];
  players: PlayerLine[];
  /** Rebotes de equipo (no asignados a jugadores), si la fuente los da. */
  teamReb?: number;
}

export interface GameRecord {
  id: string;
  date: string; // ISO (UTC) o YYYY-MM-DD
  phase?: string;
  home: TeamGameSide;
  away: TeamGameSide;
}

export interface TeamInfo {
  id: string;
  name: string;
  short: string;
  logo?: string | null;
}

export interface PlayerInfo {
  id: string;
  name: string;
  teamId: string;
  position?: string | null; // G / F / C (normalizado)
  positionRaw?: string | null;
  height?: number | null;
  birthDate?: string | null;
  nationality?: string | null;
  jersey?: string | null;
  /** Otros identificadores (por ejemplo, el mismo jugador en otra competición). */
  extra?: Record<string, string | number | boolean | null>;
}

export interface SeasonGamesFile {
  comp: CompetitionId;
  season: string; // '2026-27'
  fetchedAt: string;
  source: string;
  teams: Record<string, TeamInfo>;
  players: Record<string, PlayerInfo>;
  games: GameRecord[];
  notes?: string[];
}

export interface RosterFile {
  comp: CompetitionId;
  season: string;
  fetchedAt: string;
  source: string;
  teams: TeamInfo[];
  /** Plantilla actual por equipo. */
  players: PlayerInfo[];
  notes?: string[];
}

export interface InjuryEntry {
  playerId: string | null;
  playerName: string;
  teamId: string;
  status: 'baja' | 'duda' | 'probable' | 'ausente-reciente';
  detail: string;
  source: string;
  sourceUrl?: string;
  updatedAt: string;
}
