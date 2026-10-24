// Generación de materiales de estudio: resúmenes, esquemas, flashcards, tests y exámenes de práctica.
// Todo se valida con validarCitas: lo que no cita fragmentos reales se descarta.

import { ErrorUsuario, supabaseAdmin } from "../base";
import { pedirJSON } from "../claude";
import { esquemaFlashcards, esquemaMapa, esquemaResumen, esquemaSimulacro, esquemaTest } from "../esquemas";
import { SISTEMA_ESTUDIO, TAREA_MAPA, TAREA_RESUMEN, contextoExamen, tareaFlashcards, tareaSimulacro, tareaTest } from "../prompts";
import { fragmentosDe, prepararFragmentos } from "../fragmentos";
import { mapaReferencias, resolverFuentes, validarCitas, type FragmentoCitable } from "../../../../src/lib/citas";
import { composicionSimulacro, repartirPuntos } from "../../../../src/lib/simulacro";
import { contarPalabras } from "../../../../src/lib/fragmentar";
import type { Manejador } from "../trabajos";
import type { Examen, NodoMapa, PreguntaSimulacro, PreguntaTest } from "../../../../src/lib/tipos";

const RECORDATORIO = "\n\nRecuerda: solo información de los fragmentos y cada elemento con sus fuentes (F…).";

async function contexto(userId: string, examId: string, topicId: string | null, soloUploads?: string[]) {
  const sb = supabaseAdmin();
  const { data: examen } = await sb.from("exams").select("*").eq("id", examId).eq("user_id", userId).single<Examen>();
  if (!examen) throw new ErrorUsuario("No encontramos ese examen.");
  const { data: temas } = await sb.from("exam_topics").select("id, titulo").eq("exam_id", examId).order("orden");
  const titulos = new Map((temas ?? []).map((t) => [t.id, t.titulo]));
  if (topicId && !titulos.has(topicId)) throw new ErrorUsuario("No encontramos ese tema.");
  const filas = await fragmentosDe(userId, examId, topicId, { soloUploads });
  if (!filas.length) {
    throw new ErrorUsuario(
      topicId
        ? "Este tema todavía no tiene apuntes revisados. Sube y confirma sus apuntes para generar el material."
        : "Todavía no hay apuntes revisados. Sube tus apuntes y confirma el texto para generar el material.",
      400,
      "sin_apuntes",
    );
  }
  const prep = prepararFragmentos(filas, titulos);
  const alcance = topicId ? `tema «${titulos.get(topicId)}»` : "examen completo (todos los temas)";
  const palabras = filas.reduce((a, f) => a + contarPalabras(f.contenido), 0);
  return { examen, temas: temas ?? [], titulos, prep, alcance, palabras };
}

function porcentajeValido(validos: number, descartados: number) {
  return validos + descartados === 0 ? 1 : validos / (validos + descartados);
}

/** Pide a la IA y, si descarta demasiados elementos sin cita, lo intenta una vez más con un aviso. */
async function generarConCitas<T>(
  pedir: (extra: string) => Promise<T>,
  validar: (r: T) => { validos: number; descartados: number },
): Promise<{ r: T; descartados: number }> {
  let r = await pedir("");
  let v = validar(r);
  if (porcentajeValido(v.validos, v.descartados) < 0.7) {
    r = await pedir(
      "\n\nIMPORTANTE: en un intento anterior muchos elementos no citaban fragmentos existentes. Cita SIEMPRE las referencias exactas (F1, F2…) y no incluyas nada que no puedas citar.",
    );
    v = validar(r);
  }
  return { r, descartados: v.descartados };
}

const temaDeFuentes = (refs: string[], temaDe: Map<string, string | null>): string | null => {
  for (const r of refs) {
    const t = temaDe.get(String(r).toUpperCase());
    if (t) return t;
  }
  return null;
};

export const generarMaterial: Manejador = async (t, avanzar) => {
  const sb = supabaseAdmin();
  const examId = t.exam_id!;
  const topicId = (t.parametros.topic_id as string | null) ?? null;
  const soloUploads = t.parametros.solo_uploads as string[] | undefined;
  await avanzar(8, "Reuniendo tus apuntes…");
  const c = await contexto(t.user_id, examId, topicId, soloUploads);
  const mapa = mapaReferencias(c.prep.citables);
  const base = `${contextoExamen(c.examen, c.alcance)}\n\n${c.prep.texto}\n\n`;
  const llamar = <S extends Parameters<typeof pedirJSON>[0]["esquema"]>(esquema: S, operacion: string, tarea: string, maxTokens = 32000) => (extra: string) =>
    pedirJSON({ userId: t.user_id, tipo: "generacion", operacion, sistema: SISTEMA_ESTUDIO, esquema, esfuerzo: "medium", maxTokens, contenido: base + tarea + RECORDATORIO + extra });

  switch (t.tipo) {
    case "resumen": {
      await avanzar(20, "Escribiendo el resumen…");
      const { r, descartados } = await generarConCitas(llamar(esquemaResumen, "resumen", TAREA_RESUMEN, 48000), (x) => {
        const a = validarCitas(x.ideas_clave, mapa);
        const b = validarCitas(x.resumen, mapa);
        const d = validarCitas(x.detallado, mapa);
        return { validos: a.validos.length + b.validos.length + d.validos.length, descartados: a.descartados + b.descartados + d.descartados };
      });
      const fila = {
        user_id: t.user_id,
        exam_id: examId,
        topic_id: topicId,
        ideas_clave: validarCitas(r.ideas_clave, mapa).validos,
        resumen: validarCitas(r.resumen, mapa).validos,
        detallado: validarCitas(r.detallado, mapa).validos,
        desactualizado: false,
        created_at: new Date().toISOString(),
      };
      await borrarAlcance("summaries", t.user_id, examId, topicId);
      const { error } = await sb.from("summaries").insert(fila);
      if (error) throw error;
      return { descartados };
    }

    case "esquema": {
      await avanzar(20, "Dibujando el mapa conceptual…");
      const { r, descartados } = await generarConCitas(llamar(esquemaMapa, "esquema", TAREA_MAPA), (x) => {
        const v = validarCitas(x.nodos, mapa);
        return { validos: v.validos.length, descartados: v.descartados };
      });
      const raiz = construirArbol(r.nodos, mapa, r.titulo || (topicId ? c.titulos.get(topicId)! : c.examen.asignatura));
      await borrarAlcance("mindmaps", t.user_id, examId, topicId);
      const { error } = await sb.from("mindmaps").insert({ user_id: t.user_id, exam_id: examId, topic_id: topicId, titulo: raiz.texto, raiz, desactualizado: false });
      if (error) throw error;
      return { descartados };
    }

    case "flashcards": {
      const n = Math.max(6, Math.min(40, Math.round(c.palabras / 70)));
      await avanzar(20, `Creando ${n} flashcards…`);
      const { data: existentes } = await sb.from("flashcards").select("anverso").eq("exam_id", examId).eq("user_id", t.user_id);
      const yaHay = (existentes ?? []).map((x) => x.anverso).slice(0, 150);
      const evitar = yaHay.length ? `\n\nYa existen estas tarjetas; no las repitas:\n${yaHay.map((a) => `- ${a}`).join("\n")}` : "";
      const { r, descartados } = await generarConCitas(llamar(esquemaFlashcards, "flashcards", tareaFlashcards(n) + evitar), (x) => {
        const v = validarCitas(x.tarjetas, mapa, { permitirAmpliaciones: false });
        return { validos: v.validos.length, descartados: v.descartados };
      });
      const { validos } = validarCitas(r.tarjetas, mapa, { permitirAmpliaciones: false });
      const refsDe = new Map(r.tarjetas.map((x) => [x.anverso, x.fuentes]));
      const filas = validos
        .filter((x) => x.anverso.trim() && x.reverso.trim())
        .map((x) => ({
          user_id: t.user_id,
          exam_id: examId,
          topic_id: topicId ?? temaDeFuentes(refsDe.get(x.anverso) ?? [], c.prep.temaDe),
          tipo: x.tipo,
          anverso: x.anverso.slice(0, 2000),
          reverso: x.reverso.slice(0, 4000),
          fuentes: x.fuentes,
          ampliacion: false,
        }));
      if (filas.length) {
        const { error } = await sb.from("flashcards").insert(filas);
        if (error) throw error;
      }
      return { creadas: filas.length, descartados };
    }

    case "test": {
      const n = Number(t.parametros.n ?? 10);
      await avanzar(20, "Preparando las preguntas…");
      const { r, descartados } = await generarConCitas(llamar(esquemaTest, "test", tareaTest(Math.min(20, Math.max(5, n)), !topicId)), (x) => {
        const v = validarCitas(x.preguntas, mapa);
        return { validos: v.validos.length, descartados: v.descartados };
      });
      const preguntas = normalizarTest(r.preguntas, mapa, c.prep.temaDe, topicId);
      if (preguntas.length < 3) throw new ErrorUsuario("No hemos podido crear suficientes preguntas fiables con estos apuntes. Prueba a añadir más contenido.");
      const titulo = topicId ? `Test · ${c.titulos.get(topicId)}` : `Test mixto · ${c.examen.asignatura}`;
      const { data, error } = await sb.from("quizzes").insert({ user_id: t.user_id, exam_id: examId, topic_id: topicId, titulo, preguntas }).select("id").single();
      if (error) throw error;
      return { quiz_id: data.id, preguntas: preguntas.length, descartados };
    }

    case "simulacro": {
      const comp = composicionSimulacro(c.examen.tipo, c.examen.distribucion, c.examen.duracion_min);
      await avanzar(20, "Montando el examen de práctica…");
      const { r, descartados } = await generarConCitas(llamar(esquemaSimulacro, "simulacro", tareaSimulacro(comp, c.examen.duracion_min), 64000), (x) => {
        const v = validarCitas(x.preguntas, mapa, { permitirAmpliaciones: false });
        return { validos: v.validos.length, descartados: v.descartados };
      });
      const validas = r.preguntas
        .map((p, i) => ({ p, i, fuentes: resolverFuentes(p.fuentes, mapa) }))
        .filter(({ p, fuentes }) => fuentes.length > 0 && esPreguntaSimulacroValida(p));
      const preguntas: PreguntaSimulacro[] = repartirPuntos(
        validas.map(({ p, i, fuentes }) => ({
          id: `q${i + 1}`,
          tipo: p.tipo,
          topic_id: temaDeFuentes(p.fuentes, c.prep.temaDe),
          enunciado: p.enunciado,
          opciones: p.tipo === "test" ? p.opciones : undefined,
          correcta: p.tipo === "test" ? p.correcta : undefined,
          respuesta_modelo: p.tipo !== "test" ? p.respuesta_modelo : undefined,
          rubrica: p.tipo !== "test" ? p.rubrica : undefined,
          fuentes,
        })),
        comp,
      );
      if (preguntas.length < 2) throw new ErrorUsuario("No hemos podido crear un examen fiable con estos apuntes. Prueba a añadir más contenido.");
      const { count } = await sb.from("mock_exams").select("id", { count: "exact", head: true }).eq("exam_id", examId);
      const { data, error } = await sb
        .from("mock_exams")
        .insert({
          user_id: t.user_id,
          exam_id: examId,
          titulo: `Examen de práctica ${(count ?? 0) + 1} · ${c.examen.asignatura}`,
          duracion_min: c.examen.duracion_min,
          distribucion: Object.fromEntries(comp.map((x) => [x.tipo, x.puntos * 10])),
          preguntas,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { mock_exam_id: data.id, preguntas: preguntas.length, descartados };
    }
    default:
      throw new ErrorUsuario("Tipo de material no válido.");
  }
};

async function borrarAlcance(tabla: "summaries" | "mindmaps", userId: string, examId: string, topicId: string | null) {
  const q = supabaseAdmin().from(tabla).delete().eq("user_id", userId).eq("exam_id", examId);
  await (topicId ? q.eq("topic_id", topicId) : q.is("topic_id", null));
}

/** Convierte la lista plana de nodos en árbol, descartando los que no citan fuentes reales. */
export function construirArbol(
  nodos: { id: string; padre: string; texto: string; fuentes: string[]; ampliacion: boolean }[],
  mapa: Map<string, FragmentoCitable>,
  tituloPorDefecto: string,
): NodoMapa {
  const validos = new Map<string, NodoMapa & { padre: string }>();
  for (const n of nodos) {
    const fuentes = resolverFuentes(n.fuentes, mapa);
    const esRaiz = !n.padre;
    if (!fuentes.length && !n.ampliacion && !esRaiz) continue;
    validos.set(n.id, { id: n.id, texto: n.texto, fuentes, ampliacion: !fuentes.length && n.ampliacion, hijos: [], padre: n.padre });
  }
  let raiz = [...validos.values()].find((n) => !n.padre);
  if (!raiz) {
    raiz = { id: "raiz", texto: tituloPorDefecto, fuentes: [], ampliacion: false, hijos: [], padre: "" };
    validos.set("raiz", raiz);
  }
  for (const n of validos.values()) {
    if (n === raiz) continue;
    const padre = validos.get(n.padre) ?? raiz;
    if (padre === n) continue;
    padre.hijos.push(n);
  }
  // quitar el campo auxiliar y ciclos
  const vistos = new Set<string>();
  const limpiar = (n: NodoMapa & { padre?: string }): NodoMapa => {
    vistos.add(n.id);
    return { id: n.id, texto: n.texto, fuentes: n.fuentes, ampliacion: n.ampliacion, hijos: n.hijos.filter((h) => !vistos.has(h.id)).map((h) => limpiar(h)) };
  };
  return limpiar(raiz);
}

type PreguntaIA = (typeof esquemaTest)["_output"]["preguntas"][number];

/** Comprueba la coherencia de cada pregunta y la convierte al formato de la web. */
export function normalizarTest(
  preguntas: PreguntaIA[],
  mapa: Map<string, FragmentoCitable>,
  temaDe: Map<string, string | null>,
  topicId: string | null,
): PreguntaTest[] {
  const out: PreguntaTest[] = [];
  preguntas.forEach((p, i) => {
    const fuentes = resolverFuentes(p.fuentes, mapa);
    if (!fuentes.length && !p.ampliacion) return;
    if (!fuentes.length) return; // en tests no se admiten preguntas sin apuntes
    const base = { id: `p${i + 1}`, tipo: p.tipo, enunciado: p.enunciado, explicacion: p.explicacion, fuentes, ampliacion: false, topic_id: topicId ?? temaDeFuentes(p.fuentes, temaDe) };
    switch (p.tipo) {
      case "opcion_multiple":
        if (p.opciones && p.opciones.length >= 2 && p.correcta !== undefined && p.correcta >= 0 && p.correcta < p.opciones.length) {
          out.push({ ...base, opciones: p.opciones, correcta: p.correcta });
        }
        break;
      case "verdadero_falso":
        if (typeof p.verdadero === "boolean") out.push({ ...base, verdadero: p.verdadero });
        break;
      case "respuesta_corta":
        if (p.respuestas_aceptadas?.length || p.palabras_clave?.length) {
          out.push({ ...base, respuestas_aceptadas: p.respuestas_aceptadas ?? [], palabras_clave: p.palabras_clave ?? [] });
        }
        break;
      case "relacionar":
        if (p.pares && p.pares.length >= 2 && new Set(p.pares.map((x) => x.derecha)).size === p.pares.length) out.push({ ...base, pares: p.pares });
        break;
      case "ordenar":
        if (p.orden_correcto && p.orden_correcto.length >= 3 && new Set(p.orden_correcto).size === p.orden_correcto.length) out.push({ ...base, orden_correcto: p.orden_correcto });
        break;
    }
  });
  return out;
}

function esPreguntaSimulacroValida(p: (typeof esquemaSimulacro)["_output"]["preguntas"][number]): boolean {
  if (!p.enunciado?.trim()) return false;
  if (p.tipo === "test") return Boolean(p.opciones && p.opciones.length >= 2 && p.correcta !== undefined && p.correcta >= 0 && p.correcta < p.opciones.length);
  return Boolean(p.respuesta_modelo?.trim() && p.rubrica?.length);
}
