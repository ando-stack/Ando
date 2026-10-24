// Indexado de apuntes (fragmentos + embeddings) y recuperación para construir los prompts.

import { supabaseAdmin } from "./base";
import { etiquetaOrigen, fragmentar } from "../../../src/lib/fragmentar";
import type { FragmentoCitable } from "../../../src/lib/citas";

/** Embeddings con Voyage AI (opcional). Sin clave se usa solo búsqueda de texto completo. */
export async function embeddings(textos: string[], tipo: "document" | "query"): Promise<number[][] | null> {
  const clave = process.env.VOYAGE_API_KEY;
  if (!clave || textos.length === 0) return null;
  const salida: number[][] = [];
  for (let i = 0; i < textos.length; i += 64) {
    const lote = textos.slice(i, i + 64);
    const r = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clave}` },
      body: JSON.stringify({ input: lote, model: process.env.VOYAGE_MODEL || "voyage-3.5-lite", input_type: tipo, output_dimension: 1024 }),
    });
    if (!r.ok) {
      console.error("[estudia] embeddings no disponibles:", r.status, await r.text().catch(() => ""));
      return null;
    }
    const j = (await r.json()) as { data: { embedding: number[]; index: number }[] };
    j.data.sort((a, b) => a.index - b.index).forEach((d) => salida.push(d.embedding));
  }
  return salida;
}

const aVector = (v: number[]) => `[${v.join(",")}]`;

/** (Re)indexa una subida confirmada: borra sus fragmentos y crea los nuevos. Devuelve cuántos. */
export async function indexarSubida(userId: string, uploadId: string): Promise<number> {
  const sb = supabaseAdmin();
  const { data: sub } = await sb.from("uploads").select("*").eq("id", uploadId).eq("user_id", userId).single();
  if (!sub) return 0;
  const { data: txt } = await sb.from("extracted_texts").select("contenido, paginas").eq("upload_id", uploadId).single();
  if (!txt?.contenido?.trim()) return 0;
  const frags = fragmentar(txt.contenido, etiquetaOrigen(sub), (txt.paginas ?? 1) > 1 || sub.tipo === "pdf");
  const vecs = await embeddings(
    frags.map((f) => (f.seccion ? `${f.seccion}\n${f.contenido}` : f.contenido)),
    "document",
  );
  await sb.from("chunks").delete().eq("upload_id", uploadId).eq("user_id", userId);
  if (!frags.length) return 0;
  const filas = frags.map((f, i) => ({
    user_id: userId,
    exam_id: sub.exam_id,
    topic_id: sub.topic_id,
    upload_id: uploadId,
    orden: sub.orden * 1000 + f.orden,
    seccion: f.seccion,
    pagina: f.pagina,
    origen: f.origen,
    contenido: f.contenido,
    embedding: vecs?.[i] ? aVector(vecs[i]) : null,
  }));
  const { error } = await sb.from("chunks").insert(filas);
  if (error) throw error;
  return filas.length;
}

export interface FilaFragmento {
  id: string;
  topic_id: string | null;
  upload_id: string;
  origen: string;
  seccion: string | null;
  contenido: string;
}

/** Carga los fragmentos de un tema (o de todo el examen) en orden, con un tope de caracteres. */
export async function fragmentosDe(
  userId: string,
  examId: string,
  topicId: string | null,
  opciones: { maxCaracteres?: number; soloUploads?: string[] } = {},
): Promise<FilaFragmento[]> {
  let q = supabaseAdmin()
    .from("chunks")
    .select("id, topic_id, upload_id, origen, seccion, contenido, orden")
    .eq("user_id", userId)
    .eq("exam_id", examId)
    .order("orden", { ascending: true })
    .limit(2000);
  if (topicId) q = q.eq("topic_id", topicId);
  if (opciones.soloUploads?.length) q = q.in("upload_id", opciones.soloUploads);
  const { data, error } = await q;
  if (error) throw error;
  const filas = (data ?? []) as (FilaFragmento & { orden: number })[];
  const max = opciones.maxCaracteres ?? 180_000;
  const total = filas.reduce((a, f) => a + f.contenido.length, 0);
  if (total <= max) return filas;
  // Demasiado contenido: muestreo uniforme para cubrir todos los temas sin pasarse
  const paso = total / max;
  const out: FilaFragmento[] = [];
  let posicion = 0;
  let siguiente = 0;
  for (const f of filas) {
    if (posicion >= siguiente) {
      out.push(f);
      siguiente = posicion + f.contenido.length * paso;
    }
    posicion += f.contenido.length;
  }
  return out;
}

/** Búsqueda híbrida (texto + vectores) para el tutor y la corrección. */
export async function buscar(userId: string, examId: string, consulta: string, limite = 10, topicId: string | null = null): Promise<FilaFragmento[]> {
  const vec = await embeddings([consulta], "query");
  const { data, error } = await supabaseAdmin().rpc("buscar_fragmentos", {
    p_exam_id: examId,
    p_consulta: consulta,
    p_embedding: vec?.[0] ? aVector(vec[0]) : null,
    p_topic_id: topicId,
    p_limite: limite,
  });
  if (error) throw error;
  // El RPC se llama con service role: se filtra de nuevo por usuario por seguridad
  const ids = (data ?? []).map((d: { id: string }) => d.id);
  if (!ids.length) return [];
  const { data: propias } = await supabaseAdmin().from("chunks").select("id, topic_id, upload_id, origen, seccion, contenido").in("id", ids).eq("user_id", userId);
  const orden = new Map(ids.map((id: string, i: number) => [id, i]));
  return ((propias ?? []) as FilaFragmento[]).sort((a, b) => (orden.get(a.id) as number) - (orden.get(b.id) as number));
}

/** Asigna referencias cortas (F1, F2…) y genera el bloque de texto para el prompt. */
export function prepararFragmentos(filas: FilaFragmento[], titulosTema: Map<string, string>): { texto: string; citables: FragmentoCitable[]; temaDe: Map<string, string | null> } {
  const citables: FragmentoCitable[] = [];
  const temaDe = new Map<string, string | null>();
  const partes = filas.map((f, i) => {
    const ref = `F${i + 1}`;
    citables.push({ ref, chunk_id: f.id, origen: f.origen });
    temaDe.set(ref, f.topic_id);
    const tema = f.topic_id ? titulosTema.get(f.topic_id) ?? "" : "";
    const attrs = [`ref="${ref}"`, `origen="${esc(f.origen)}"`];
    if (tema) attrs.push(`tema="${esc(tema)}"`);
    if (f.seccion) attrs.push(`apartado="${esc(f.seccion)}"`);
    return `<fragmento ${attrs.join(" ")}>\n${f.contenido}\n</fragmento>`;
  });
  return { texto: `<apuntes>\n${partes.join("\n")}\n</apuntes>`, citables, temaDe };
}

function esc(s: string) {
  return s.replace(/"/g, "'").replace(/[<>]/g, "");
}
