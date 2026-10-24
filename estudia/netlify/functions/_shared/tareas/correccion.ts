// Corrección de exámenes de práctica (rúbrica visible) y técnica Feynman.

import { ErrorUsuario, supabaseAdmin } from "../base";
import { pedirJSON } from "../claude";
import { esquemaCorreccion, esquemaFeynman } from "../esquemas";
import { SISTEMA_ESTUDIO, TAREA_CORRECCION, TAREA_FEYNMAN, contextoExamen } from "../prompts";
import { buscar, fragmentosDe, prepararFragmentos, type FilaFragmento } from "../fragmentos";
import { mapaReferencias, resolverFuentes, validarCitas } from "../../../../src/lib/citas";
import type { Manejador } from "../trabajos";
import type { Correccion, CorreccionPregunta, Examen, PreguntaSimulacro } from "../../../../src/lib/tipos";

const redondear = (x: number, paso = 0.25) => Math.round(x / paso) * paso;

export const corregirSimulacro: Manejador = async (t, avanzar) => {
  const sb = supabaseAdmin();
  const attemptId = String(t.parametros.attempt_id ?? "");
  const { data: intento } = await sb.from("mock_exam_attempts").select("*, mock_exams(*)").eq("id", attemptId).eq("user_id", t.user_id).single();
  if (!intento) throw new ErrorUsuario("No encontramos ese examen de práctica.");
  const simulacro = intento.mock_exams as { preguntas: PreguntaSimulacro[] };
  const respuestas = (intento.respuestas ?? {}) as Record<string, string | number>;
  const { data: examen } = await sb.from("exams").select("*").eq("id", intento.exam_id).single<Examen>();

  await avanzar(10, "Corrigiendo las preguntas tipo test…");
  const correcciones: CorreccionPregunta[] = [];
  const abiertas = simulacro.preguntas.filter((p) => p.tipo !== "test");
  for (const p of simulacro.preguntas.filter((x) => x.tipo === "test")) {
    const r = respuestas[p.id];
    const bien = typeof r === "number" && r === p.correcta;
    correcciones.push({
      pregunta_id: p.id,
      puntos_obtenidos: bien ? p.puntos : 0,
      puntos_max: p.puntos,
      criterios: [],
      comentario: r === undefined || r === "" ? "Sin responder." : bien ? "¡Correcta!" : `La respuesta correcta era: «${p.opciones?.[p.correcta ?? 0] ?? ""}».`,
      para_subir_nota: bien ? "" : "Repasa este punto en los apuntes citados.",
      fuentes: p.fuentes,
    });
  }

  let resumen = "";
  let consejos: string[] = [];
  if (abiertas.length) {
    await avanzar(30, "La IA está corrigiendo tus respuestas con la rúbrica…");
    // Fragmentos: los citados por las preguntas + búsqueda por enunciado
    const ids = new Set(abiertas.flatMap((p) => p.fuentes.map((f) => f.chunk_id)));
    const { data: citados } = await sb.from("chunks").select("id, topic_id, upload_id, origen, seccion, contenido").in("id", [...ids]).eq("user_id", t.user_id);
    const extra: FilaFragmento[] = [];
    for (const p of abiertas.slice(0, 8)) extra.push(...(await buscar(t.user_id, intento.exam_id, p.enunciado, 4)));
    const unicos = new Map<string, FilaFragmento>();
    for (const f of [...((citados ?? []) as FilaFragmento[]), ...extra]) unicos.set(f.id, f);
    const prep = prepararFragmentos([...unicos.values()], new Map());
    const mapa = mapaReferencias(prep.citables);

    const preguntasTexto = abiertas
      .map((p) => {
        const resp = String(respuestas[p.id] ?? "").trim();
        return `<pregunta id="${p.id}" tipo="${p.tipo}" puntos="${p.puntos}">
<enunciado>${p.enunciado}</enunciado>
<rubrica>${(p.rubrica ?? []).map((c) => `- ${c.criterio} (peso ${c.puntos})`).join("\n")}</rubrica>
<respuesta_modelo>${p.respuesta_modelo ?? ""}</respuesta_modelo>
<respuesta_estudiante>${resp || "(en blanco)"}</respuesta_estudiante>
</pregunta>`;
      })
      .join("\n");

    const r = await pedirJSON({
      userId: t.user_id,
      tipo: "correccion",
      operacion: "corregir_simulacro",
      sistema: SISTEMA_ESTUDIO,
      esquema: esquemaCorreccion,
      esfuerzo: "high",
      maxTokens: 32000,
      contenido: `${examen ? contextoExamen(examen, "corrección de examen de práctica") : ""}\n\n${prep.texto}\n\n<preguntas>\n${preguntasTexto}\n</preguntas>\n\n${TAREA_CORRECCION}\n\nPara cada pregunta, reparte su puntuación entre los criterios de la rúbrica de forma proporcional a su peso (puntos_max de cada criterio = puntos de la pregunta × peso / suma de pesos).`,
    });
    await avanzar(85, "Calculando la nota…");
    for (const p of abiertas) {
      const c = r.correcciones.find((x) => x.pregunta_id === p.id);
      const pesos = (p.rubrica ?? []).reduce((a, x) => a + Math.max(0, x.puntos), 0) || 1;
      const criterios = (c?.criterios ?? []).map((k) => {
        const maxRubrica = p.rubrica?.find((x) => x.criterio === k.criterio);
        const max = maxRubrica ? (p.puntos * Math.max(0, maxRubrica.puntos)) / pesos : Math.max(0, k.puntos_max);
        return { criterio: k.criterio, puntos_max: redondear(max), puntos_obtenidos: redondear(Math.min(max, Math.max(0, k.puntos_obtenidos))), comentario: k.comentario };
      });
      const obtenidos = Math.min(p.puntos, criterios.reduce((a, k) => a + k.puntos_obtenidos, 0));
      correcciones.push({
        pregunta_id: p.id,
        puntos_obtenidos: redondear(obtenidos),
        puntos_max: p.puntos,
        criterios,
        comentario: c?.comentario ?? "No se pudo corregir esta pregunta.",
        para_subir_nota: c?.para_subir_nota ?? "",
        fuentes: c ? resolverFuentes(c.fuentes, mapa) : [],
      });
    }
    resumen = r.resumen;
    consejos = r.para_subir_nota;
  }

  const total = simulacro.preguntas.reduce((a, p) => a + p.puntos, 0) || 10;
  const obtenido = correcciones.reduce((a, c) => a + c.puntos_obtenidos, 0);
  const nota = Math.round((obtenido / total) * 10 * 100) / 100;
  if (!resumen) resumen = nota >= 5 ? "¡Buen trabajo en el examen de práctica!" : "Ya has dado un paso importante: practicar con el formato real. Revisa los fallos y vuelve a intentarlo.";
  const orden = new Map(simulacro.preguntas.map((p, i) => [p.id, i]));
  const correccion: Correccion = {
    preguntas: correcciones.sort((a, b) => (orden.get(a.pregunta_id) ?? 0) - (orden.get(b.pregunta_id) ?? 0)),
    nota,
    resumen,
    para_subir_nota: consejos,
  };
  await sb.from("mock_exam_attempts").update({ estado: "corregido", correccion, nota, fin: intento.fin ?? new Date().toISOString() }).eq("id", attemptId);
  return { nota };
};

export const feynman: Manejador = async (t, avanzar) => {
  const sb = supabaseAdmin();
  const topicId = (t.parametros.topic_id as string | null) ?? null;
  const explicacion = String(t.parametros.explicacion ?? "").trim();
  if (explicacion.length < 40) throw new ErrorUsuario("Escribe una explicación un poco más larga (al menos un par de frases).");
  const { data: examen } = await sb.from("exams").select("*").eq("id", t.exam_id).eq("user_id", t.user_id).single<Examen>();
  if (!examen) throw new ErrorUsuario("No encontramos ese examen.");
  const { data: temas } = await sb.from("exam_topics").select("id, titulo").eq("exam_id", examen.id);
  const titulos = new Map((temas ?? []).map((x) => [x.id, x.titulo]));
  await avanzar(15, "Comparando tu explicación con tus apuntes…");
  const filas = await fragmentosDe(t.user_id, examen.id, topicId, { maxCaracteres: 120_000 });
  if (!filas.length) throw new ErrorUsuario("Este tema todavía no tiene apuntes revisados para comparar.");
  const prep = prepararFragmentos(filas, titulos);
  const mapa = mapaReferencias(prep.citables);
  const r = await pedirJSON({
    userId: t.user_id,
    tipo: "correccion",
    operacion: "feynman",
    sistema: SISTEMA_ESTUDIO,
    esquema: esquemaFeynman,
    esfuerzo: "medium",
    maxTokens: 16000,
    contenido: `${contextoExamen(examen, topicId ? `tema «${titulos.get(topicId)}»` : "todo el examen")}\n\n${prep.texto}\n\n<explicacion_estudiante>\n${explicacion.slice(0, 12000)}\n</explicacion_estudiante>\n\n${TAREA_FEYNMAN}`,
  });
  const analisis = {
    valoracion: r.valoracion,
    bien_explicado: validarCitas(r.bien_explicado, mapa).validos,
    lagunas: validarCitas(r.lagunas, mapa).validos,
    errores: r.errores.map((e) => ({ ...e, fuentes: resolverFuentes(e.fuentes, mapa) })).filter((e) => e.fuentes.length),
    confuso: validarCitas(r.confuso, mapa).validos,
    siguiente_paso: r.siguiente_paso,
  };
  const { data, error } = await sb
    .from("feynman_attempts")
    .insert({ user_id: t.user_id, exam_id: examen.id, topic_id: topicId, explicacion, analisis })
    .select("id")
    .single();
  if (error) throw error;
  return { feynman_id: data.id };
};
