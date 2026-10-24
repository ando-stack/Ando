// Tutor IA por examen: responde dudas basándose en los apuntes, paso a paso y por niveles.

import type Anthropic from "@anthropic-ai/sdk";
import { ErrorUsuario, supabaseAdmin } from "../base";
import { pedirJSON } from "../claude";
import { esquemaTutor } from "../esquemas";
import { SISTEMA_ESTUDIO, contextoExamen, tareaTutor } from "../prompts";
import { buscar, fragmentosDe, prepararFragmentos, type FilaFragmento } from "../fragmentos";
import { mapaReferencias, resolverFuentes } from "../../../../src/lib/citas";
import type { Manejador } from "../trabajos";
import type { Examen } from "../../../../src/lib/tipos";

export const tutor: Manejador = async (t, avanzar) => {
  const sb = supabaseAdmin();
  const nivel = ["sencillo", "normal", "avanzado"].includes(String(t.parametros.nivel)) ? String(t.parametros.nivel) : "normal";
  const { data: examen } = await sb.from("exams").select("*").eq("id", t.exam_id).eq("user_id", t.user_id).single<Examen>();
  if (!examen) throw new ErrorUsuario("No encontramos ese examen.");
  const { data: mensajes } = await sb
    .from("tutor_messages")
    .select("rol, contenido, created_at")
    .eq("exam_id", examen.id)
    .eq("user_id", t.user_id)
    .order("created_at", { ascending: false })
    .limit(13);
  const historialDesc = mensajes ?? [];
  const ultima = historialDesc.find((m) => m.rol === "usuario");
  if (!ultima) throw new ErrorUsuario("Escribe tu pregunta.");

  await avanzar(15, "Buscando en tus apuntes…");
  const { data: temas } = await sb.from("exam_topics").select("id, titulo").eq("exam_id", examen.id);
  const titulos = new Map((temas ?? []).map((x) => [x.id, x.titulo]));
  const previa = historialDesc.find((m) => m.rol === "usuario" && m !== ultima)?.contenido ?? "";
  let filas: FilaFragmento[] = await buscar(t.user_id, examen.id, `${ultima.contenido} ${previa}`.slice(0, 2000), 12);
  if (filas.length < 4) {
    // pocos resultados: se añade el principio de los apuntes para dar contexto
    const generales = await fragmentosDe(t.user_id, examen.id, null, { maxCaracteres: 30_000 });
    const vistos = new Set(filas.map((f) => f.id));
    filas = [...filas, ...generales.filter((g) => !vistos.has(g.id))];
  }
  const prep = prepararFragmentos(filas, titulos);
  const mapa = mapaReferencias(prep.citables);

  // Historial (más antiguo primero), sin la última pregunta, que va con los apuntes
  const anteriores = historialDesc.filter((m) => m !== ultima).reverse();
  const historial: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of anteriores) {
    const rol = m.rol === "usuario" ? "user" : "assistant";
    if (!historial.length && rol === "assistant") continue; // debe empezar por el usuario
    const ultimo = historial[historial.length - 1];
    if (ultimo && ultimo.role === rol) ultimo.content = `${ultimo.content}\n\n${m.contenido}`;
    else historial.push({ role: rol, content: m.contenido });
  }
  if (historial.length && historial[historial.length - 1].role === "user") historial.push({ role: "assistant", content: "(Sigo atento a tu siguiente pregunta.)" });

  await avanzar(35, "Pensando la explicación…");
  const r = await pedirJSON({
    userId: t.user_id,
    tipo: "tutor",
    operacion: "tutor",
    sistema: SISTEMA_ESTUDIO,
    esquema: esquemaTutor,
    esfuerzo: "medium",
    maxTokens: 16000,
    historial,
    contenido: `${contextoExamen(examen, "tutoría")}\n\n${prep.texto}\n\n${tareaTutor(nivel)}\n\n<pregunta_estudiante>\n${ultima.contenido}\n</pregunta_estudiante>`,
  });
  const fuentes = resolverFuentes(r.fuentes, mapa);
  let contenido = r.respuesta;
  if (!fuentes.length && !r.hay_ampliacion && !r.sin_informacion) {
    // Respuesta sin citas: se marca entera como ampliación para que el estudiante lo compruebe
    contenido = `> **Ampliación:** esta respuesta no se ha podido relacionar con tus apuntes; conviene comprobarla.\n\n${contenido}`;
  }
  const { error } = await sb.from("tutor_messages").insert({ user_id: t.user_id, exam_id: examen.id, rol: "tutor", contenido, nivel, fuentes });
  if (error) throw error;
  return { fuentes: fuentes.length };
};
