// Composición de un examen de práctica según el formato del examen real.

import type { Distribucion, TipoExamen, TipoPregunta } from "./tipos";

/** Minutos aproximados por pregunta de cada tipo. */
export const MINUTOS_POR_PREGUNTA: Record<TipoPregunta, number> = { test: 1.5, cortas: 5, desarrollo: 20, problemas: 12 };

export interface Composicion {
  tipo: TipoPregunta;
  n: number;
  puntos: number;
}

export function distribucionEfectiva(tipo: TipoExamen, d: Distribucion): Record<TipoPregunta, number> {
  if (tipo !== "mixto") return { test: 0, cortas: 0, desarrollo: 0, problemas: 0, [tipo]: 100 } as Record<TipoPregunta, number>;
  const base = { test: d.test ?? 0, cortas: d.cortas ?? 0, desarrollo: d.desarrollo ?? 0, problemas: d.problemas ?? 0 };
  const suma = Object.values(base).reduce((a, b) => a + b, 0);
  if (suma <= 0) return { test: 40, cortas: 30, desarrollo: 30, problemas: 0 };
  return {
    test: (base.test / suma) * 100,
    cortas: (base.cortas / suma) * 100,
    desarrollo: (base.desarrollo / suma) * 100,
    problemas: (base.problemas / suma) * 100,
  };
}

export function composicionSimulacro(tipo: TipoExamen, d: Distribucion, duracionMin: number): Composicion[] {
  const dist = distribucionEfectiva(tipo, d);
  const out: Composicion[] = [];
  (Object.keys(dist) as TipoPregunta[]).forEach((t) => {
    const pct = dist[t];
    if (pct <= 0) return;
    const minutos = (duracionMin * pct) / 100;
    const n = Math.max(1, Math.min(t === "test" ? 40 : 10, Math.round(minutos / MINUTOS_POR_PREGUNTA[t])));
    out.push({ tipo: t, n, puntos: Math.round(pct) / 10 });
  });
  // Ajustar para que los puntos sumen exactamente 10
  const suma = out.reduce((a, c) => a + c.puntos, 0);
  if (out.length && Math.abs(suma - 10) > 1e-9) out[0].puntos = Math.round((out[0].puntos + 10 - suma) * 10) / 10;
  return out;
}

/** Reparte los puntos de cada tipo entre sus preguntas (redondeo a 0,25). */
export function repartirPuntos<T extends { tipo: TipoPregunta }>(preguntas: T[], composicion: Composicion[]): (T & { puntos: number })[] {
  const porTipo = new Map(composicion.map((c) => [c.tipo, c.puntos]));
  const cuenta = new Map<TipoPregunta, number>();
  preguntas.forEach((p) => cuenta.set(p.tipo, (cuenta.get(p.tipo) ?? 0) + 1));
  const conPuntos = preguntas.map((p) => ({ ...p, puntos: Math.round(((porTipo.get(p.tipo) ?? 0) / (cuenta.get(p.tipo) ?? 1)) * 4) / 4 }));
  const total = conPuntos.reduce((a, p) => a + p.puntos, 0);
  if (total <= 0) {
    const cada = Math.round((10 / Math.max(1, conPuntos.length)) * 4) / 4;
    return conPuntos.map((p) => ({ ...p, puntos: cada }));
  }
  // corregir redondeo para sumar 10
  const dif = Math.round((10 - total) * 4) / 4;
  if (dif !== 0 && conPuntos.length) conPuntos[conPuntos.length - 1].puntos = Math.max(0.25, conPuntos[conPuntos.length - 1].puntos + dif);
  return conPuntos;
}
