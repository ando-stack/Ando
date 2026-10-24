/**
 * Progreso: dominio por tema, nota estimada, recomendaciones y racha.
 * La nota estimada es ORIENTATIVA (se explica así en la interfaz).
 */

import type { EstadoMemoria } from "./fsrs";
import { recuperabilidadEn } from "./fsrs";
import { diasEntre, hoyISO, semanaISO, sumarDias } from "./fechas";

export interface ResultadoPorTema {
  topic_id: string | null;
  correcta: boolean;
  /** Fecha ISO del intento */
  fecha: string;
  /** Peso del resultado (1 = pregunta de test, más para simulacros) */
  peso?: number;
  /** Para recomendaciones: enunciado de la pregunta fallada */
  enunciado?: string;
}

export interface TarjetaProgreso extends EstadoMemoria {
  topic_id: string | null;
}

export interface DominioTema {
  topic_id: string;
  titulo: string;
  /** 0–1 o null si no hay datos todavía */
  dominio: number | null;
  aciertosTests: number | null;
  memoria: number | null;
  preguntas: number;
  tarjetas: number;
}

/** Media ponderada que da más peso a los intentos recientes. */
function mediaReciente(resultados: ResultadoPorTema[], ahora: Date): number | null {
  if (resultados.length === 0) return null;
  let suma = 0;
  let pesos = 0;
  for (const r of resultados) {
    const dias = Math.max(0, (ahora.getTime() - new Date(r.fecha).getTime()) / 86_400_000);
    const w = (r.peso ?? 1) * Math.pow(0.5, dias / 7); // vida media de una semana
    suma += (r.correcta ? 1 : 0) * w;
    pesos += w;
  }
  return pesos > 0 ? suma / pesos : null;
}

export function dominioPorTema(
  temas: { id: string; titulo: string }[],
  resultados: ResultadoPorTema[],
  tarjetas: TarjetaProgreso[],
  ahora = new Date(),
  fechaExamen?: string | null,
): DominioTema[] {
  const enFecha = fechaExamen && new Date(fechaExamen) > ahora ? new Date(fechaExamen) : ahora;
  return temas.map((t) => {
    const res = resultados.filter((r) => r.topic_id === t.id);
    const tar = tarjetas.filter((c) => c.topic_id === t.id);
    const aciertos = mediaReciente(res, ahora);
    // memoria: recuperabilidad media prevista el día del examen (las nuevas cuentan 0)
    const memoria = tar.length ? tar.reduce((a, c) => a + recuperabilidadEn(c, enFecha), 0) / tar.length : null;
    let dominio: number | null;
    if (aciertos !== null && memoria !== null) dominio = 0.6 * aciertos + 0.4 * memoria;
    else dominio = aciertos ?? memoria;
    return {
      topic_id: t.id,
      titulo: t.titulo,
      dominio,
      aciertosTests: aciertos,
      memoria,
      preguntas: res.length,
      tarjetas: tar.length,
    };
  });
}

export interface NotaEstimada {
  /** 0–10, null si no hay datos suficientes */
  nota: number | null;
  /** Margen de incertidumbre ± */
  margen: number;
  confianza: "baja" | "media" | "alta";
  explicacion: string;
}

/**
 * Nota estimada = combinación del dominio por tema (ponderado por cantidad de contenido)
 * y de las notas de los simulacros recientes, que reflejan mejor el formato real.
 */
export function notaEstimada(
  dominios: DominioTema[],
  pesosTema: Record<string, number>,
  notasSimulacros: { nota: number; fecha: string }[],
  ahora = new Date(),
): NotaEstimada {
  const conDatos = dominios.filter((d) => d.dominio !== null);
  const evidencias = dominios.reduce((a, d) => a + d.preguntas + d.tarjetas, 0) + notasSimulacros.length * 15;
  if (conDatos.length === 0 && notasSimulacros.length === 0) {
    return {
      nota: null,
      margen: 0,
      confianza: "baja",
      explicacion: "Aún no hay datos. Haz algún test, repasa flashcards o un examen de práctica para ver tu estimación.",
    };
  }
  let porTemas: number | null = null;
  if (conDatos.length) {
    let suma = 0;
    let total = 0;
    for (const d of dominios) {
      const w = pesosTema[d.topic_id] ?? 1;
      total += w;
      suma += (d.dominio ?? 0) * w; // temas sin datos cuentan como 0: aún no hay pruebas de que se dominen
    }
    porTemas = total ? (suma / total) * 10 : null;
  }
  let porSimulacros: number | null = null;
  if (notasSimulacros.length) {
    const recientes = [...notasSimulacros].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 3);
    let s = 0;
    let w = 0;
    recientes.forEach((n, i) => {
      const peso = Math.pow(0.6, i) * Math.pow(0.5, Math.max(0, (ahora.getTime() - new Date(n.fecha).getTime()) / 86_400_000) / 14);
      s += n.nota * peso;
      w += peso;
    });
    porSimulacros = s / w;
  }
  const nota = porTemas !== null && porSimulacros !== null ? 0.5 * porTemas + 0.5 * porSimulacros : (porTemas ?? porSimulacros)!;
  const confianza: NotaEstimada["confianza"] = evidencias >= 120 && notasSimulacros.length >= 1 ? "alta" : evidencias >= 40 ? "media" : "baja";
  const margen = confianza === "alta" ? 0.75 : confianza === "media" ? 1.25 : 2;
  return {
    nota: Math.round(Math.min(10, Math.max(0, nota)) * 10) / 10,
    margen,
    confianza,
    explicacion:
      "Es una estimación orientativa calculada con tus tests, tus flashcards y tus exámenes de práctica. " +
      (confianza === "baja" ? "Todavía hay pocos datos, así que puede cambiar bastante." : "Cuanto más practiques, más fiable será."),
  };
}

export interface Recomendacion {
  topic_id: string | null;
  texto: string;
  prioridad: number;
}

/** Recomendaciones concretas a partir de los fallos recientes y el dominio. */
export function recomendaciones(
  dominios: DominioTema[],
  fallosRecientes: ResultadoPorTema[],
  tarjetasVencidas: number,
): Recomendacion[] {
  const recs: Recomendacion[] = [];
  const ordenados = [...dominios].sort((a, b) => (a.dominio ?? -1) - (b.dominio ?? -1));
  for (const d of ordenados.slice(0, 3)) {
    if (d.dominio === null) {
      recs.push({ topic_id: d.topic_id, texto: `Empieza a practicar «${d.titulo}»: haz un test corto para ver cómo lo llevas.`, prioridad: 2 });
      continue;
    }
    if (d.dominio >= 0.8) continue;
    const fallos = fallosRecientes.filter((f) => f.topic_id === d.topic_id && !f.correcta && f.enunciado).slice(0, 2);
    const sobre = fallos.length ? ` Fallas en preguntas como: «${recortar(fallos[0].enunciado!, 90)}».` : "";
    recs.push({
      topic_id: d.topic_id,
      texto: `Repasa «${d.titulo}» (dominio ${Math.round(d.dominio * 100)} %).${sobre}`,
      prioridad: d.dominio < 0.5 ? 3 : 2,
    });
  }
  if (tarjetasVencidas > 0) {
    recs.push({ topic_id: null, texto: `Tienes ${tarjetasVencidas} flashcard${tarjetasVencidas === 1 ? "" : "s"} para repasar hoy. ¡10 minutos bastan!`, prioridad: 2 });
  }
  return recs.sort((a, b) => b.prioridad - a.prioridad);
}

function recortar(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export interface Racha {
  actual: number;
  mejor: number;
  ultimo_dia: string | null;
  descansos: string[];
}

/**
 * Racha vigente hoy (la base de datos la actualiza al registrar sesiones; aquí se
 * calcula si sigue viva). Un día sin estudiar por semana no la rompe.
 */
export function rachaVigente(r: Racha, hoy = hoyISO()): { dias: number; enRiesgo: boolean; descansoDisponible: boolean } {
  if (!r.ultimo_dia) return { dias: 0, enRiesgo: false, descansoDisponible: true };
  const hueco = diasEntre(r.ultimo_dia, hoy);
  const semanaAyer = semanaISO(sumarDias(hoy, -1));
  const descansoDisponible = !r.descansos.includes(semanaISO(hoy));
  if (hueco <= 1) return { dias: r.actual, enRiesgo: hueco === 1, descansoDisponible };
  if (hueco === 2 && !r.descansos.includes(semanaAyer)) {
    // ayer fue día de descanso: sigue viva si estudias hoy
    return { dias: r.actual, enRiesgo: true, descansoDisponible: false };
  }
  return { dias: 0, enRiesgo: false, descansoDisponible };
}

/** Mensaje motivador, siempre positivo. */
export function mensajeMotivacion(racha: number, estudioHoy: boolean): string {
  if (estudioHoy) return racha >= 7 ? `¡${racha} días seguidos! La constancia es tu superpoder.` : "¡Hoy ya has estudiado! Cada día suma.";
  if (racha === 0) return "Hoy es un gran día para empezar. Con 15 minutos ya cuenta.";
  return `Llevas ${racha} día${racha === 1 ? "" : "s"}. ¿Un ratito hoy para seguir?`;
}

export const LOGROS: Record<string, { titulo: string; descripcion: string; icono: string }> = {
  primera_sesion: { titulo: "Primer paso", descripcion: "Completaste tu primera sesión de estudio.", icono: "🌱" },
  racha_3: { titulo: "Tres en raya", descripcion: "3 días de estudio seguidos.", icono: "🔥" },
  racha_7: { titulo: "Semana completa", descripcion: "7 días de constancia.", icono: "🏅" },
  racha_14: { titulo: "Imparable", descripcion: "14 días seguidos.", icono: "🚀" },
  racha_30: { titulo: "Hábito de acero", descripcion: "30 días de racha.", icono: "🏆" },
  diez_dias: { titulo: "Diez días", descripcion: "Has estudiado en 10 días distintos.", icono: "📅" },
  primer_test: { titulo: "A prueba", descripcion: "Hiciste tu primer test de práctica.", icono: "✅" },
  primer_simulacro: { titulo: "Ensayo general", descripcion: "Terminaste tu primer examen de práctica.", icono: "🎓" },
  tres_simulacros: { titulo: "Preparado", descripcion: "Tres exámenes de práctica terminados.", icono: "💪" },
  cien_tarjetas: { titulo: "Memoria en forma", descripcion: "100 repasos de flashcards.", icono: "🧠" },
  feynman: { titulo: "Pequeño profe", descripcion: "Explicaste un tema con tus palabras.", icono: "🗣️" },
};
