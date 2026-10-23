/** Tipos de los datos publicados (snapshot JSON y tablas de Supabase). Compartidos con la ingesta. */
import type { Circuito, Superficie } from '../../config/formatos';
import type { PerfilJugador } from '../../engine/modelo';

export interface TorneoVivo {
  id: string;
  circuito: Circuito;
  categoria: string;
  nombre: string;
  ciudad: string;
  pais: string;
  inicio: string;
  fin: string;
  superficie: Superficie | null;
  cubierta: boolean | null;
  formatoId: string;
  formatoQualyId: string;
  estado: 'en curso' | 'próximo' | 'terminado';
  fuente: string;
  actualizado: string;
  nPartidos: number;
  tieneOrdenDeJuego: boolean;
  avisos: string[];
}

export interface LadoPartido {
  id: string | null;
  nombre: string;
  pais: string;
  semilla?: string;
  entrada?: string;
}

export interface PartidoVivo {
  id: string;
  torneoId: string;
  fase: 'Q' | 'M';
  ronda: string;
  orden: number;
  a: LadoPartido;
  b: LadoPartido;
  estado: 'programado' | 'en juego' | 'terminado';
  /** Hora de inicio prevista (ISO, UTC). */
  hora: string | null;
  /** "Not before" / "No antes de". */
  noAntesDe: boolean;
  pista: string | null;
  marcador: string | null;
  ganador: 'a' | 'b' | null;
}

export interface DetalleTorneo {
  torneo: TorneoVivo;
  partidos: PartidoVivo[];
}

export interface EntradaIndice {
  id: string;
  nombre: string;
  pais: string;
  pool: 'M' | 'F';
  circuito: string;
  rank: number | null;
  elo: number;
  nReal: number;
  activo: string | null;
}

export interface PartidoHistorial {
  f: string; // fecha
  t: string; // torneo
  c: string; // circuito
  s: Superficie;
  r: string; // ronda
  o: string; // id rival
  on: string; // nombre rival
  g: 0 | 1; // 1 = ganó
  m: string; // marcador
}

export interface FichaJugador {
  perfil: PerfilJugador;
  partidos: PartidoHistorial[];
  rankings: [string, number][];
  eloHistorico: [string, number][];
}

export interface EstadoFuente {
  fuente: string;
  descripcion: string;
  ok: boolean;
  ultimoIntento: string;
  ultimoExito: string | null;
  registros: number;
  error?: string;
}

export interface MetaDatos {
  generado: string;
  fuentes: EstadoFuente[];
  historico: { desde: string; hasta: Record<string, string>; partidos: number; conEstadisticas: number };
  avisos: string[];
}
