/**
 * Simulaciones guardadas en el navegador (localStorage). No se escriben en Supabase porque la
 * base de datos sólo admite escritura desde la ingesta (RLS de sólo lectura).
 */
import type { ResultadosAgregados } from '../../engine/agregacion';
import type { DetalleModelo } from '../../engine/modelo';

export interface SimulacionGuardada {
  id: string;
  fecha: string;
  titulo: string;
  a: { id: string; nombre: string };
  b: { id: string; nombre: string };
  contexto: { superficie: string; cubierta: boolean | null; formatoId: string; circuito: string; torneo?: string };
  n: number;
  semilla: number;
  tiempoMs: number;
  detalle: Pick<DetalleModelo, 'pElo' | 'pEstadisticas' | 'pFormato' | 'pSaqueA' | 'pSaqueB'> & { estimadoA: boolean; estimadoB: boolean; nRealA: number; nRealB: number };
  resultados: ResultadosAgregados;
}

const CLAVE = 'simulador-tenis:guardadas';
const ULTIMA = 'simulador-tenis:ultima';
const MAX = 20;

function leer(clave: string): unknown {
  try {
    const t = localStorage.getItem(clave);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function escribir(clave: string, v: unknown): boolean {
  try {
    localStorage.setItem(clave, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function listarGuardadas(): SimulacionGuardada[] {
  const v = leer(CLAVE);
  return Array.isArray(v) ? (v as SimulacionGuardada[]) : [];
}

export function guardar(s: SimulacionGuardada): boolean {
  const l = [s, ...listarGuardadas().filter((x) => x.id !== s.id)];
  // Si no cabe, se van descartando las más antiguas.
  for (let k = Math.min(l.length, MAX); k > 0; k--) if (escribir(CLAVE, l.slice(0, k))) return true;
  return false;
}

export function borrarGuardada(id: string) {
  escribir(CLAVE, listarGuardadas().filter((x) => x.id !== id));
}

export function obtenerSimulacion(id: string): SimulacionGuardada | null {
  if (id === 'ultima') return (leer(ULTIMA) as SimulacionGuardada) ?? null;
  return listarGuardadas().find((x) => x.id === id) ?? ((leer(ULTIMA) as SimulacionGuardada)?.id === id ? (leer(ULTIMA) as SimulacionGuardada) : null);
}

export function guardarUltima(s: SimulacionGuardada) {
  escribir(ULTIMA, s);
}
