/**
 * Generador del plan de estudio día a día (determinista, sin IA).
 * Fundamentos en docs/pedagogia.md: práctica distribuida (§2), simulacros (§3),
 * intercalado (§4), metas y planificación (§8).
 */

import type { DiaPlan, Disponibilidad, Nivel, TareaPlan, Viabilidad } from "./tipos";
import { diaSemana, diasEntre, formatearMinutos, hoyISO, sumarDias } from "./fechas";

export interface TemaPlan {
  id: string;
  titulo: string;
  /** Número de palabras de apuntes del tema (estimación del contenido). */
  palabras: number;
  /** Dominio actual 0–1 (de tests y flashcards). */
  dominio: number;
}

export interface EntradaPlan {
  hoy?: string; // YYYY-MM-DD
  fechaExamen: string; // ISO (fecha y hora)
  disponibilidad: Disponibilidad;
  notaObjetivo: number;
  nivelActual: Nivel;
  duracionExamenMin: number;
  temas: TemaPlan[];
  /** Progreso ya hecho (para reajustar). */
  minutosEstudiados?: Record<string, number>;
  testsHechos?: Record<string, number>;
  simulacrosHechos?: number;
  /** Ya se ha estudiado hoy: minutos ya usados hoy. */
  minutosUsadosHoy?: number;
}

export interface ResultadoPlan {
  dias: DiaPlan[];
  viabilidad: Viabilidad;
  necesidades: { estudio: number; practica: number; simulacros: number; repaso: number; flashcards: number };
}

const FACTOR_NIVEL: Record<Nivel, number> = { bajo: 1.4, medio: 1, alto: 0.75 };
const PALABRAS_POR_MINUTO = 35; // estudio activo (leer, esquematizar, recordar)

export function factorNota(nota: number): number {
  return 0.6 + 0.08 * Math.min(10, Math.max(0, nota));
}

/** Minutos de primer estudio que necesita un tema. */
export function minutosEstudioTema(t: TemaPlan, nivel: Nivel, nota: number): number {
  const base = Math.min(180, Math.max(20, t.palabras / PALABRAS_POR_MINUTO));
  const m = base * FACTOR_NIVEL[nivel] * factorNota(nota) * (1 - 0.6 * Math.min(1, Math.max(0, t.dominio)));
  return Math.max(10, Math.round(m / 5) * 5);
}

export function testsPorTema(nota: number): number {
  return nota >= 8 ? 3 : nota >= 6 ? 2 : 1;
}

export function simulacrosNecesarios(nota: number): number {
  return nota >= 8.5 ? 3 : nota >= 6.5 ? 2 : 1;
}

const MIN_TEST = 15;
const MIN_FLASH = 15;
const BLOQUE_MAX = 60;

interface TareaPendiente extends TareaPlan {
  /** No colocar antes de esta fecha (espaciado). */
  desde?: string;
}

/** Genera el plan completo. */
export function generarPlan(e: EntradaPlan): ResultadoPlan {
  const hoy = e.hoy ?? hoyISO();
  const diaExamen = hoyISO(new Date(e.fechaExamen));
  const nDias = Math.max(0, diasEntre(hoy, diaExamen)); // días completos antes del examen
  const nota = e.notaObjetivo;
  const hechos = e.minutosEstudiados ?? {};
  const testsHechos = e.testsHechos ?? {};

  // ── Necesidades ─────────────────────────────────────────
  // Los temas se estudian en el orden de los apuntes (suele ser el orden lógico de la asignatura)
  const temas = [...e.temas];

  const estudioRestante = new Map<string, number>();
  for (const t of temas) {
    const total = minutosEstudioTema(t, e.nivelActual, nota);
    estudioRestante.set(t.id, Math.max(0, total - (hechos[t.id] ?? 0)));
  }
  const tpt = testsPorTema(nota);
  const nSimulacros = Math.max(0, simulacrosNecesarios(nota) - (e.simulacrosHechos ?? 0));
  const minSimulacro = e.duracionExamenMin + 15; // examen + revisar la corrección
  const diasRepasoFinal = nDias >= 7 ? 2 : nDias >= 3 ? 1 : 0;

  const necesidades = {
    estudio: [...estudioRestante.values()].reduce((a, b) => a + b, 0),
    practica: temas.reduce((a, t) => a + Math.max(0, tpt - (testsHechos[t.id] ?? 0)) * MIN_TEST, 0),
    simulacros: nSimulacros * minSimulacro,
    repaso: diasRepasoFinal * 45,
    flashcards: Math.max(0, nDias - 1) * 10,
  };
  const minutosNecesarios = Object.values(necesidades).reduce((a, b) => a + b, 0);

  // ── Días disponibles ────────────────────────────────────
  const dias: DiaPlan[] = [];
  let minutosDisponibles = 0;
  for (let i = 0; i < nDias; i++) {
    const fecha = sumarDias(hoy, i);
    let min = Math.max(0, Math.round(Number(e.disponibilidad[String(diaSemana(fecha))] ?? 0)));
    if (i === 0 && e.minutosUsadosHoy) min = Math.max(0, min - e.minutosUsadosHoy);
    minutosDisponibles += min;
    const fase: DiaPlan["fase"] = min === 0 ? "descanso" : i >= nDias - diasRepasoFinal ? "repaso_final" : "aprendizaje";
    dias.push({ fecha, minutos_disponibles: min, tareas: [], fase });
  }

  // Fin de la fase de aprendizaje: ~60 % de los días previos al repaso final
  const diasPrevios = nDias - diasRepasoFinal;
  const finAprendizaje = Math.max(1, Math.ceil(diasPrevios * 0.6));

  // ── Cola de tareas ──────────────────────────────────────
  const estudio: TareaPendiente[] = [];
  for (const t of temas) {
    let restante = estudioRestante.get(t.id)!;
    const partes = Math.max(1, Math.ceil(restante / BLOQUE_MAX));
    let p = 1;
    while (restante > 0) {
      const m = Math.min(BLOQUE_MAX, restante);
      estudio.push({
        id: `estudio:${t.id}:${p}`,
        tipo: "estudio",
        topic_id: t.id,
        titulo: partes > 1 ? `Estudiar «${t.titulo}» (parte ${p} de ${partes})` : `Estudiar «${t.titulo}»`,
        minutos: m,
      });
      restante -= m;
      p++;
    }
  }

  const practica: TareaPendiente[] = []; // tests espaciados que se van liberando
  const libre = (t: TareaPendiente, fecha: string) => !t.desde || t.desde <= fecha;
  const temasEstudiados = new Set(temas.filter((t) => (estudioRestante.get(t.id) ?? 0) === 0).map((t) => t.id));
  for (const t of temas) {
    const pendientes = Math.max(0, tpt - (testsHechos[t.id] ?? 0));
    if (temasEstudiados.has(t.id)) {
      for (let k = 0; k < pendientes; k++) {
        practica.push({ id: `test:${t.id}:${k + 1 + (testsHechos[t.id] ?? 0)}`, tipo: "test", topic_id: t.id, titulo: `Test de «${t.titulo}»`, minutos: MIN_TEST, desde: sumarDias(hoy, k * 2) });
      }
    }
  }

  // Días de simulacro repartidos en la fase de práctica
  const fechasSimulacro = new Set<string>();
  const diasPractica = dias.filter((d, i) => i >= finAprendizaje && d.fase !== "repaso_final" && d.minutos_disponibles >= minSimulacro);
  if (nSimulacros > 0 && diasPractica.length > 0) {
    for (let k = 0; k < nSimulacros; k++) {
      const idx = Math.min(diasPractica.length - 1, Math.floor(((k + 1) * diasPractica.length) / (nSimulacros + 1)));
      fechasSimulacro.add(diasPractica[idx].fecha);
    }
  }
  let simulacrosColocados = 0;
  const simulacrosBase = e.simulacrosHechos ?? 0;

  // ── Colocación día a día ────────────────────────────────
  let algunoEstudiado = temasEstudiados.size > 0;
  for (let i = 0; i < dias.length; i++) {
    const d = dias[i];
    if (d.fase === "descanso") continue;
    let cap = d.minutos_disponibles;
    const poner = (t: TareaPlan) => {
      d.tareas.push({ id: t.id, tipo: t.tipo, topic_id: t.topic_id, titulo: t.titulo, minutos: t.minutos });
      cap -= t.minutos;
    };

    if (d.fase === "repaso_final") {
      // Sin contenido nuevo salvo lo que no haya cabido antes
      if (algunoEstudiado || estudio.length === 0) {
        poner({ id: `flash:${d.fecha}`, tipo: "flashcards", topic_id: null, titulo: "Flashcards: repaso de lo que más se olvida", minutos: Math.min(20, cap) });
      }
      while (estudio.length && cap >= Math.min(20, estudio[0].minutos)) {
        const t = estudio.shift()!;
        poner({ ...t, minutos: Math.min(t.minutos, cap) });
        temasEstudiados.add(t.topic_id!);
      }
      if (cap >= 20) {
        poner({ id: `repaso:${d.fecha}`, tipo: "repaso", topic_id: null, titulo: i === dias.length - 1 ? "Repaso general ligero (descansa bien esta noche)" : "Repaso general con esquemas y resúmenes", minutos: Math.min(i === dias.length - 1 ? 30 : 45, cap) });
      }
      if (cap >= MIN_TEST && i !== dias.length - 1) {
        poner({ id: `test:mixto:${d.fecha}`, tipo: "test", topic_id: null, titulo: "Test mixto de todos los temas", minutos: MIN_TEST });
      }
      continue;
    }

    // Flashcards cada día en cuanto haya algo estudiado
    if (algunoEstudiado && cap >= 25) {
      poner({ id: `flash:${d.fecha}`, tipo: "flashcards", topic_id: null, titulo: "Flashcards del día", minutos: cap >= 60 ? MIN_FLASH : 10 });
    }

    // Simulacro
    if (fechasSimulacro.has(d.fecha) && cap >= minSimulacro && simulacrosColocados < nSimulacros) {
      simulacrosColocados++;
      poner({ id: `simulacro:${simulacrosBase + simulacrosColocados}`, tipo: "simulacro", topic_id: null, titulo: `Examen de práctica ${simulacrosBase + simulacrosColocados} (${formatearMinutos(e.duracionExamenMin)} + revisión)`, minutos: minSimulacro });
    }

    // Tests espaciados ya liberados (máximo 2 al día)
    let tests = 0;
    for (let k = 0; k < practica.length && tests < 2; ) {
      const t = practica[k];
      if (libre(t, d.fecha) && cap >= t.minutos) {
        practica.splice(k, 1);
        poner(t);
        tests++;
      } else k++;
    }

    // Estudio de temas nuevos
    while (estudio.length && cap >= Math.min(20, estudio[0].minutos)) {
      const t = estudio.shift()!;
      const m = Math.min(t.minutos, cap);
      poner({ ...t, minutos: m });
      if (m < t.minutos) {
        estudio.unshift({ ...t, id: `${t.id}b`, minutos: t.minutos - m, titulo: `${t.titulo} · continuación` });
      }
      const quedaDelTema = estudio.some((x) => x.topic_id === t.topic_id);
      if (!quedaDelTema && t.topic_id && !temasEstudiados.has(t.topic_id)) {
        temasEstudiados.add(t.topic_id);
        algunoEstudiado = true;
        const tema = temas.find((x) => x.id === t.topic_id)!;
        const pendientes = Math.max(0, tpt - (testsHechos[tema.id] ?? 0));
        // espaciado: primer test al día siguiente, después cada 2-3 días
        for (let k = 0; k < pendientes; k++) {
          practica.push({ id: `test:${tema.id}:${k + 1 + (testsHechos[tema.id] ?? 0)}`, tipo: "test", topic_id: tema.id, titulo: `Test de «${tema.titulo}»`, minutos: MIN_TEST, desde: sumarDias(d.fecha, 1 + k * 3) });
        }
      }
    }

    // Tiempo sobrante en fase de práctica: test mixto (intercalado)
    if (i >= finAprendizaje && estudio.length === 0 && cap >= MIN_TEST && temasEstudiados.size >= 2 && !d.tareas.some((t) => t.id.startsWith("test:mixto"))) {
      poner({ id: `test:mixto:${d.fecha}`, tipo: "test", topic_id: null, titulo: "Test mixto (temas intercalados)", minutos: MIN_TEST });
    }
    if (d.tareas.length && d.fase === "aprendizaje" && i >= finAprendizaje) d.fase = "practica";
  }

  // ── Viabilidad ──────────────────────────────────────────
  const sinColocar = estudio.reduce((a, t) => a + t.minutos, 0) + (nSimulacros - simulacrosColocados) * minSimulacro;
  const alcanzable = nDias > 0 && minutosNecesarios <= minutosDisponibles && sinColocar === 0;
  const viabilidad = evaluarViabilidad({
    alcanzable,
    minutosNecesarios,
    minutosDisponibles,
    nDias,
    dias,
    nota,
    temas,
    sinColocar,
  });

  return { dias, viabilidad, necesidades };
}

function evaluarViabilidad(x: {
  alcanzable: boolean;
  minutosNecesarios: number;
  minutosDisponibles: number;
  nDias: number;
  dias: DiaPlan[];
  nota: number;
  temas: TemaPlan[];
  sinColocar: number;
}): Viabilidad {
  const base = { minutos_necesarios: x.minutosNecesarios, minutos_disponibles: x.minutosDisponibles };
  if (x.nDias === 0) {
    return {
      ...base,
      alcanzable: false,
      mensaje: "¡El examen es hoy! Céntrate en un repaso tranquilo de las ideas clave y las flashcards que más te cuestan. ¡Mucho ánimo!",
      sugerencias: ["Repasa las ideas clave de cada tema.", "Haz una ronda corta de flashcards.", "Descansa un poco antes del examen."],
    };
  }
  if (x.alcanzable) {
    const holgura = x.minutosDisponibles - x.minutosNecesarios;
    return {
      ...base,
      alcanzable: true,
      mensaje:
        holgura > x.minutosNecesarios * 0.3
          ? `Tienes tiempo de sobra para ir a por tu ${formatearNota(x.nota)}. Siguiendo el plan llegarás con margen para repasar.`
          : `Con el tiempo que tienes, tu ${formatearNota(x.nota)} es alcanzable si sigues el plan con constancia.`,
      sugerencias: [],
    };
  }
  const deficit = Math.max(x.minutosNecesarios - x.minutosDisponibles, x.sinColocar);
  const diasConTiempo = Math.max(1, x.dias.filter((d) => d.minutos_disponibles > 0).length);
  const diasTotales = Math.max(1, x.dias.length);
  const extraPorDia = Math.ceil(deficit / diasConTiempo / 5) * 5;
  const sugerencias: string[] = [];
  sugerencias.push(`Si puedes, añade unos ${extraPorDia} minutos más en los días que ya estudias.`);
  if (diasConTiempo < diasTotales) {
    const libres = diasTotales - diasConTiempo;
    sugerencias.push(`O dedica un rato a ${libres === 1 ? "el día que tienes libre" : `alguno de los ${libres} días que tienes libres`}.`);
  }
  const prioritarios = [...x.temas].sort((a, b) => a.dominio - b.dominio).slice(0, Math.min(3, x.temas.length));
  if (prioritarios.length > 1) {
    sugerencias.push(`Prioriza los temas que menos dominas: ${prioritarios.map((t) => `«${t.titulo}»`).join(", ")}.`);
  }
  // nota que cabe en el tiempo disponible (aprox.)
  const ratio = x.minutosDisponibles / Math.max(1, x.minutosNecesarios);
  const notaPosible = Math.max(5, Math.floor(((factorNota(x.nota) * ratio - 0.6) / 0.08) * 2) / 2);
  if (notaPosible < x.nota) {
    sugerencias.push(`Otra opción es empezar apuntando a un ${formatearNota(Math.min(x.nota - 0.5, notaPosible))} y subir el objetivo si vas bien.`);
  }
  return {
    ...base,
    alcanzable: false,
    mensaje: `Vas un poco justo de tiempo para el ${formatearNota(x.nota)} que quieres: harían falta unos ${formatearMinutos(deficit)} más en total. ¡No pasa nada! Con algún ajuste se puede conseguir.`,
    sugerencias,
  };
}

function formatearNota(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

/**
 * ¿Hay que reajustar el plan? Sí si quedaron tareas sin hacer en días pasados
 * o si hoy ya se ha hecho todo lo previsto (va más rápido).
 */
export function necesitaReajuste(dias: DiaPlan[], hechas: Set<string>, hoy = hoyISO()): "atrasado" | "adelantado" | null {
  const pasados = dias.filter((d) => d.fecha < hoy);
  if (pasados.some((d) => d.tareas.some((t) => !hechas.has(t.id) && t.tipo !== "flashcards" && t.tipo !== "repaso"))) {
    return "atrasado";
  }
  const deHoy = dias.find((d) => d.fecha === hoy);
  const futuras = dias.filter((d) => d.fecha > hoy).flatMap((d) => d.tareas);
  if (deHoy && deHoy.tareas.length > 0 && deHoy.tareas.every((t) => hechas.has(t.id)) && futuras.some((t) => hechas.has(t.id))) {
    return "adelantado";
  }
  return null;
}

/** Mensaje amable al reajustar. Nunca culpabiliza. */
export function mensajeReajuste(motivo: "atrasado" | "adelantado"): string {
  return motivo === "atrasado"
    ? "Hemos reorganizado tu plan para que encaje desde hoy. ¡Retomamos con energía!"
    : "¡Vas por delante del plan! Lo hemos actualizado para aprovechar tu ritmo.";
}
