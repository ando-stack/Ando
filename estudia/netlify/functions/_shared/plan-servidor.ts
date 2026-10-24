// Cálculo del plan de estudio con los datos del examen (sin IA).

import { supabaseAdmin } from "./base";
import { generarPlan, type TemaPlan } from "../../../src/lib/plan";
import { dominioPorTema, type ResultadoPorTema, type TarjetaProgreso } from "../../../src/lib/progreso";
import { contarPalabras } from "../../../src/lib/fragmentar";
import { hoyISO } from "../../../src/lib/fechas";
import type { Examen, ResultadoPregunta } from "../../../src/lib/tipos";

function hoyMadrid(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  return hoyISO(d);
}

export async function recalcularPlan(userId: string, examId: string, hoy = hoyMadrid()) {
  const sb = supabaseAdmin();
  const { data: examen } = await sb.from("exams").select("*").eq("id", examId).eq("user_id", userId).single<Examen>();
  if (!examen) return null;
  const [{ data: temas }, { data: chunks }, { data: intentos }, { data: tarjetas }, { data: sesiones }, { count: simulacros }] = await Promise.all([
    sb.from("exam_topics").select("id, titulo, orden").eq("exam_id", examId).order("orden"),
    sb.from("chunks").select("topic_id, contenido").eq("exam_id", examId).eq("user_id", userId),
    sb.from("quiz_attempts").select("resultados, created_at, quiz_id, quizzes(topic_id)").eq("exam_id", examId).eq("user_id", userId),
    sb.from("flashcards").select("topic_id, estado, estabilidad, dificultad, vence, ultima_revision, repeticiones, fallos").eq("exam_id", examId).eq("user_id", userId),
    sb.from("study_sessions").select("tarea_id, tipo, minutos, fecha").eq("exam_id", examId).eq("user_id", userId),
    sb.from("mock_exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", examId).eq("user_id", userId).eq("estado", "corregido"),
  ]);

  const palabras = new Map<string, number>();
  for (const c of chunks ?? []) palabras.set(c.topic_id ?? "general", (palabras.get(c.topic_id ?? "general") ?? 0) + contarPalabras(c.contenido));

  const resultados: ResultadoPorTema[] = (intentos ?? []).flatMap((i) =>
    ((i.resultados as ResultadoPregunta[]) ?? []).map((r) => ({ topic_id: r.topic_id, correcta: r.correcta, fecha: i.created_at })),
  );
  const listaTemas = (temas ?? []).length ? temas! : [{ id: "general", titulo: examen.asignatura, orden: 0 }];
  const dominios = dominioPorTema(listaTemas, resultados, (tarjetas ?? []) as TarjetaProgreso[], new Date(), examen.fecha);

  const temasPlan: TemaPlan[] = listaTemas.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    palabras: palabras.get(t.id) ?? (t.id === "general" ? [...palabras.values()].reduce((a, b) => a + b, 0) || 3000 : 1200),
    dominio: dominios.find((d) => d.topic_id === t.id)?.dominio ?? 0,
  }));

  const minutosEstudiados: Record<string, number> = {};
  const testsHechos: Record<string, number> = {};
  let minutosUsadosHoy = 0;
  for (const s of sesiones ?? []) {
    if (s.fecha === hoy) minutosUsadosHoy += s.minutos ?? 0;
    const partes = String(s.tarea_id ?? "").split(":");
    if (s.tipo === "estudio" && partes[0] === "estudio" && partes[1]) minutosEstudiados[partes[1]] = (minutosEstudiados[partes[1]] ?? 0) + (s.minutos ?? 0);
  }
  for (const i of intentos ?? []) {
    const topic = (i.quizzes as unknown as { topic_id: string | null } | null)?.topic_id;
    if (topic) testsHechos[topic] = (testsHechos[topic] ?? 0) + 1;
  }

  const r = generarPlan({
    hoy,
    fechaExamen: examen.fecha,
    disponibilidad: examen.disponibilidad,
    notaObjetivo: Number(examen.nota_objetivo),
    nivelActual: examen.nivel_actual,
    duracionExamenMin: examen.duracion_min,
    temas: temasPlan,
    minutosEstudiados,
    testsHechos,
    simulacrosHechos: simulacros ?? 0,
    minutosUsadosHoy,
  });

  const { data: previo } = await sb.from("study_plans").select("version").eq("exam_id", examId).maybeSingle();
  const { data: guardado, error } = await sb
    .from("study_plans")
    .upsert(
      {
        user_id: userId,
        exam_id: examId,
        dias: r.dias,
        viabilidad: r.viabilidad,
        parametros: { necesidades: r.necesidades, hoy },
        version: (previo?.version ?? 0) + 1,
        generado_en: new Date().toISOString(),
      },
      { onConflict: "exam_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return guardado;
}
