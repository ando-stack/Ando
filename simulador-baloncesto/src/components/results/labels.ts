import type { PlayerKey, TeamKey } from '../../../engine/aggregate';

export const TEAM_STAT_LABEL: Record<TeamKey, string> = {
  pts: 'Puntos',
  reb: 'Rebotes totales',
  oreb: 'Rebotes ofensivos',
  dreb: 'Rebotes defensivos',
  ast: 'Asistencias',
  stl: 'Robos',
  blk: 'Tapones',
  tov: 'Pérdidas',
  fg3m: 'Triples anotados',
  fg3a: 'Triples intentados',
  ftm: 'Tiros libres anotados',
  fta: 'Tiros libres intentados',
  fg2m: 'Tiros de 2 anotados',
  fg2a: 'Tiros de 2 intentados',
  pf: 'Faltas personales',
};

export const PLAYER_STAT_LABEL: Record<PlayerKey, string> = {
  pts: 'Puntos',
  reb: 'Rebotes',
  oreb: 'Rebotes ofensivos',
  dreb: 'Rebotes defensivos',
  ast: 'Asistencias',
  stl: 'Robos',
  blk: 'Tapones',
  tov: 'Pérdidas',
  fg3m: 'Triples anotados',
  fg3a: 'Triples intentados',
  ftm: 'Tiros libres anotados',
  fta: 'Tiros libres intentados',
  fg2m: 'Tiros de 2 anotados',
  fg2a: 'Tiros de 2 intentados',
  pf: 'Faltas cometidas',
  pfd: 'Faltas recibidas',
  min: 'Minutos',
  pra: 'Puntos + rebotes + asistencias',
  pr: 'Puntos + rebotes',
  pa: 'Puntos + asistencias',
  ra: 'Rebotes + asistencias',
  sb: 'Robos + tapones',
};

export const PLAYER_LINE_KEYS: PlayerKey[] = ['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg3a', 'ftm', 'fg2m', 'pf', 'pfd', 'min', 'pra', 'pr', 'pa', 'ra', 'sb'];
