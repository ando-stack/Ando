/**
 * Repetición espaciada con FSRS (Free Spaced Repetition Scheduler), versión 5.
 *
 * Implementado a partir de la documentación pública del algoritmo:
 * https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 * (Ye, Su y Cao, 2022, KDD). Ver docs/pedagogia.md §2.
 *
 * Variables de memoria:
 *  - S (estabilidad): días hasta que la probabilidad de recordar cae al 90 %.
 *  - D (dificultad): 1 (fácil) … 10 (difícil).
 *  - R (recuperabilidad): probabilidad de recordar tras t días.
 *
 * Además adapta la programación a la fecha del examen: ningún repaso queda
 * después del examen y, en los últimos días, se priorizan las tarjetas con
 * menor recuperabilidad prevista el día del examen.
 */

import type { EstadoTarjeta } from "./tipos";

/** 1 = Otra vez · 2 = Difícil · 3 = Bien · 4 = Fácil */
export type Calificacion = 1 | 2 | 3 | 4;

/** Parámetros por defecto de FSRS-5 (19 pesos). */
export const PESOS_FSRS5 = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;

export const DECAY = -0.5;
export const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // = 19/81

const MINUTO = 60_000;
const DIA = 86_400_000;
const INTERVALO_MAX_DIAS = 36_500;

export interface EstadoMemoria {
  estado: EstadoTarjeta;
  estabilidad: number;
  dificultad: number;
  /** ISO */
  vence: string;
  /** ISO o null si nunca se ha repasado */
  ultima_revision: string | null;
  repeticiones: number;
  fallos: number;
}

export interface OpcionesFsrs {
  /** Retención deseada (0,7–0,97). Por defecto 0,9. */
  retencion?: number;
  pesos?: readonly number[];
  /** Fecha del examen (ISO). Si se indica, los repasos se ajustan para caer antes. */
  fechaExamen?: string | null;
}

export interface ResultadoRepaso {
  tarjeta: EstadoMemoria;
  /** Recuperabilidad en el momento del repaso (null si era nueva). */
  recuperabilidad: number | null;
  intervaloDias: number;
}

const limitar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Probabilidad de recordar tras `t` días con estabilidad `s`. */
export function recuperabilidad(tDias: number, s: number): number {
  if (s <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, tDias)) / s, DECAY);
}

/** Intervalo (días) para que R baje justo hasta la retención deseada. */
export function intervaloOptimo(s: number, retencion = 0.9): number {
  return (s / FACTOR) * (Math.pow(retencion, 1 / DECAY) - 1);
}

export function estabilidadInicial(g: Calificacion, w: readonly number[] = PESOS_FSRS5): number {
  return Math.max(0.1, w[g - 1]);
}

export function dificultadInicial(g: Calificacion, w: readonly number[] = PESOS_FSRS5): number {
  return limitar(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10);
}

export function siguienteDificultad(d: number, g: Calificacion, w: readonly number[] = PESOS_FSRS5): number {
  const delta = -w[6] * (g - 3);
  const amortiguada = d + (delta * (10 - d)) / 9; // amortiguación lineal
  const revertida = w[7] * dificultadInicial(4, w) + (1 - w[7]) * amortiguada; // reversión a la media
  return limitar(revertida, 1, 10);
}

export function estabilidadTrasAcierto(
  d: number,
  s: number,
  r: number,
  g: Calificacion,
  w: readonly number[] = PESOS_FSRS5,
): number {
  const penalizacionDificil = g === 2 ? w[15] : 1;
  const bonusFacil = g === 4 ? w[16] : 1;
  return (
    s *
    (Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp(w[10] * (1 - r)) - 1) *
      penalizacionDificil *
      bonusFacil +
      1)
  );
}

export function estabilidadTrasOlvido(d: number, s: number, r: number, w: readonly number[] = PESOS_FSRS5): number {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  return Math.min(sf, s);
}

/** Repaso en el mismo día (FSRS-5). */
export function estabilidadMismoDia(s: number, g: Calificacion, w: readonly number[] = PESOS_FSRS5): number {
  return s * Math.exp(w[17] * (g - 3 + w[18]));
}

export function tarjetaNueva(ahora = new Date()): EstadoMemoria {
  return {
    estado: "nueva",
    estabilidad: 0,
    dificultad: 0,
    vence: ahora.toISOString(),
    ultima_revision: null,
    repeticiones: 0,
    fallos: 0,
  };
}

/**
 * Ajusta un intervalo para que el repaso caiga antes del examen.
 * Devuelve el intervalo en días (puede ser fraccionario si el examen es en menos de 2 días).
 */
export function ajustarAExamen(intervaloDias: number, ahora: Date, fechaExamen?: string | null): number {
  if (!fechaExamen) return intervaloDias;
  const diasHasta = (new Date(fechaExamen).getTime() - ahora.getTime()) / DIA;
  if (diasHasta <= 0) return intervaloDias; // examen pasado: FSRS normal
  if (diasHasta >= 2) {
    // último repaso como tarde la víspera del examen
    return Math.min(intervaloDias, Math.max(1, Math.floor(diasHasta) - 1));
  }
  // examen en menos de 2 días: repasar a mitad de camino (mínimo 10 minutos)
  return Math.min(intervaloDias, Math.max(10 * MINUTO, (diasHasta * DIA) / 2) / DIA);
}

/** Aplica un repaso a una tarjeta y devuelve su nuevo estado. */
export function repasar(
  tarjeta: EstadoMemoria,
  g: Calificacion,
  ahora = new Date(),
  opciones: OpcionesFsrs = {},
): ResultadoRepaso {
  const w = opciones.pesos ?? PESOS_FSRS5;
  const retencion = limitar(opciones.retencion ?? 0.9, 0.7, 0.97);
  const t = tarjeta.ultima_revision ? (ahora.getTime() - new Date(tarjeta.ultima_revision).getTime()) / DIA : 0;

  let s: number;
  let d: number;
  let r: number | null = null;
  let estado: EstadoTarjeta;
  let fallos = tarjeta.fallos;

  if (tarjeta.estado === "nueva" || tarjeta.estabilidad <= 0) {
    s = estabilidadInicial(g, w);
    d = dificultadInicial(g, w);
    estado = g >= 3 ? "repaso" : "aprendiendo";
    if (g === 1) fallos += 1;
  } else {
    d = siguienteDificultad(tarjeta.dificultad, g, w);
    if (t < 1) {
      // repaso en el mismo día (pasos de aprendizaje o repaso adelantado)
      s = estabilidadMismoDia(tarjeta.estabilidad, g, w);
      if (g === 1) {
        fallos += 1;
        estado = tarjeta.estado === "repaso" ? "reaprendiendo" : tarjeta.estado;
      } else {
        estado = g >= 3 ? "repaso" : tarjeta.estado === "repaso" ? "repaso" : tarjeta.estado;
      }
      r = recuperabilidad(t, tarjeta.estabilidad);
    } else {
      r = recuperabilidad(t, tarjeta.estabilidad);
      if (g === 1) {
        s = estabilidadTrasOlvido(tarjeta.dificultad, tarjeta.estabilidad, r, w);
        estado = "reaprendiendo";
        fallos += 1;
      } else {
        s = estabilidadTrasAcierto(tarjeta.dificultad, tarjeta.estabilidad, r, g, w);
        estado = "repaso";
      }
    }
  }
  s = limitar(s, 0.01, INTERVALO_MAX_DIAS);

  // Próximo repaso
  let intervaloDias: number;
  if (estado === "aprendiendo" || estado === "reaprendiendo") {
    // pasos cortos para volver a verla en la misma sesión:
    // "Otra vez" → 1 min (10 min si se acaba de olvidar una tarjeta aprendida) · "Difícil" → 6 min
    const minutos = g === 1 ? (tarjeta.estado === "repaso" ? 10 : 1) : 6;
    intervaloDias = (minutos * MINUTO) / DIA;
  } else {
    intervaloDias = limitar(Math.round(intervaloOptimo(s, retencion)), 1, INTERVALO_MAX_DIAS);
  }
  intervaloDias = ajustarAExamen(intervaloDias, ahora, opciones.fechaExamen);

  return {
    tarjeta: {
      estado,
      estabilidad: s,
      dificultad: d,
      vence: new Date(ahora.getTime() + intervaloDias * DIA).toISOString(),
      ultima_revision: ahora.toISOString(),
      repeticiones: tarjeta.repeticiones + 1,
      fallos,
    },
    recuperabilidad: r,
    intervaloDias,
  };
}

/** Recuperabilidad prevista de una tarjeta en una fecha. Las nuevas cuentan como 0. */
export function recuperabilidadEn(tarjeta: EstadoMemoria, fecha: Date): number {
  if (tarjeta.estado === "nueva" || !tarjeta.ultima_revision) return 0;
  const t = (fecha.getTime() - new Date(tarjeta.ultima_revision).getTime()) / DIA;
  return recuperabilidad(t, tarjeta.estabilidad);
}

/** Vista previa del intervalo de cada botón (para mostrar "1 min", "3 d"…). */
export function previsualizar(
  tarjeta: EstadoMemoria,
  ahora = new Date(),
  opciones: OpcionesFsrs = {},
): Record<Calificacion, number> {
  return {
    1: repasar(tarjeta, 1, ahora, opciones).intervaloDias,
    2: repasar(tarjeta, 2, ahora, opciones).intervaloDias,
    3: repasar(tarjeta, 3, ahora, opciones).intervaloDias,
    4: repasar(tarjeta, 4, ahora, opciones).intervaloDias,
  };
}

export function formatearIntervalo(dias: number): string {
  const minutos = Math.round(dias * 24 * 60);
  if (minutos < 60) return `${Math.max(1, minutos)} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const d = Math.round(dias);
  if (d < 31) return `${d} d`;
  const meses = Math.round(d / 30);
  if (meses < 12) return `${meses} mes${meses > 1 ? "es" : ""}`;
  return `${(d / 365).toFixed(1).replace(".", ",")} años`;
}

export interface TarjetaCola extends EstadoMemoria {
  id: string;
  suspendida?: boolean;
}

/**
 * Cola de repaso del día.
 * - Vencidas primero, de menor a mayor recuperabilidad (lo que más se olvida).
 * - En los 3 días previos al examen se añaden las tarjetas cuya recuperabilidad
 *   prevista el día del examen es menor que la retención deseada.
 * - Se añaden hasta `nuevasMax` tarjetas nuevas, intercaladas.
 */
export function colaDelDia<T extends TarjetaCola>(
  tarjetas: T[],
  ahora = new Date(),
  opciones: { fechaExamen?: string | null; nuevasMax?: number; retencion?: number } = {},
): T[] {
  const activas = tarjetas.filter((t) => !t.suspendida);
  const retencion = opciones.retencion ?? 0.9;
  const examen = opciones.fechaExamen ? new Date(opciones.fechaExamen) : null;
  const diasHasta = examen ? (examen.getTime() - ahora.getTime()) / DIA : Infinity;
  const recta = examen !== null && diasHasta > 0 && diasHasta <= 3;

  const nuevasPorDia = opciones.nuevasMax ?? (examen && diasHasta > 0 ? Math.max(10, Math.ceil(activas.length / Math.max(1, diasHasta - 2))) : 20);

  const repaso = activas
    .filter((t) => t.estado !== "nueva")
    .filter((t) => new Date(t.vence) <= ahora || (recta && examen && recuperabilidadEn(t, examen) < retencion))
    .map((t) => ({ t, r: recuperabilidadEn(t, examen && recta ? examen : ahora) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.t);

  const nuevas = activas.filter((t) => t.estado === "nueva").slice(0, nuevasPorDia);

  // Intercalar: una nueva cada 3 de repaso
  const cola: T[] = [];
  let i = 0;
  let j = 0;
  while (i < repaso.length || j < nuevas.length) {
    for (let k = 0; k < 3 && i < repaso.length; k++) cola.push(repaso[i++]);
    if (j < nuevas.length) cola.push(nuevas[j++]);
  }
  return cola;
}

/** Proporción de tarjetas "dominadas" (estabilidad ≥ 7 días y última respuesta no fallida). */
export function dominadas(tarjetas: EstadoMemoria[]): number {
  return tarjetas.filter((t) => t.estado === "repaso" && t.estabilidad >= 7).length;
}
