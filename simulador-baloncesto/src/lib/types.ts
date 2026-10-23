import type { Aggregate } from '../../engine/aggregate';
import type { CompetitionId } from '../../engine/datatypes';
import type { TeamSetup } from '../../engine/prepare';

export type { CompetitionId, Aggregate, TeamSetup };

export interface TeamRef {
  id: string;
  name: string;
  short: string;
}

/** Una ejecución de simulación (lo que se muestra en Resultados y se guarda en el Historial). */
export interface SimRun {
  id: string;
  createdAt: string;
  label: string;
  comp: CompetitionId;
  season: string;
  dataGeneratedAt: string;
  home: TeamRef;
  away: TeamRef;
  n: number;
  seed: number;
  elapsedMs: number;
  workers: number;
  setups: { home: TeamSetup; away: TeamSetup };
  /** Nombres de jugadores marcados como baja en cada equipo. */
  outs: { home: string[]; away: string[] };
  aggregate: Aggregate;
}

export const COMP_LABEL: Record<CompetitionId, string> = {
  nba: 'NBA',
  euroleague: 'EuroLiga',
  acb: 'Liga Endesa (ACB)',
};
