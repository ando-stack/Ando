// POST /api/trabajos → crea una tarea de IA (lectura, generación, corrección, tutor) y la lanza en segundo plano.
// GET  /api/trabajos → uso de IA de hoy y límites.

import type { Config } from "@netlify/functions";
import { ErrorUsuario, exigirConsentimiento, exigirExamen, json, leerJSON, respuestaError, supabaseAdmin, usuarioDesdePeticion } from "./_shared/base";
import { comprobarLimite, usoDeHoy, type TipoUso } from "./_shared/limites";
import { CONFIG_TRABAJOS, encolarTrabajo } from "./_shared/trabajos";
import type { TipoTrabajo } from "../../src/lib/tipos";

interface Cuerpo {
  tipo: TipoTrabajo;
  exam_id: string;
  parametros?: Record<string, unknown>;
}

const esUUID = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export default async (req: Request) => {
  try {
    const u = await usuarioDesdePeticion(req);
    if (req.method === "GET") {
      const tipos: TipoUso[] = ["lectura", "generacion", "correccion", "tutor"];
      const usos = await Promise.all(tipos.map((t) => usoDeHoy(u.id, t)));
      return json({ uso: Object.fromEntries(usos.map((x) => [x.tipo, { usados: x.usados, limite: x.limite }])), tokens: usos[0].tokens, limite_tokens: usos[0].limiteTokens });
    }
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    const cuerpo = await leerJSON<Cuerpo>(req);
    const cfg = CONFIG_TRABAJOS[cuerpo.tipo];
    if (!cfg) throw new ErrorUsuario("Tipo de tarea no válido.");
    exigirConsentimiento(u);
    if (!esUUID(cuerpo.exam_id)) throw new ErrorUsuario("Falta el examen.");
    await exigirExamen(u.id, cuerpo.exam_id);
    if (cfg.cuenta) await comprobarLimite(u.id, cfg.uso);

    const sb = supabaseAdmin();
    const p = cuerpo.parametros ?? {};
    const params: Record<string, unknown> = {};
    const temaValido = async (topicId: unknown) => {
      if (topicId === null || topicId === undefined || topicId === "") return null;
      if (!esUUID(topicId)) throw new ErrorUsuario("Tema no válido.");
      const { data } = await sb.from("exam_topics").select("id").eq("id", topicId).eq("exam_id", cuerpo.exam_id).eq("user_id", u.id).maybeSingle();
      if (!data) throw new ErrorUsuario("No encontramos ese tema.");
      return topicId as string;
    };

    switch (cuerpo.tipo) {
      case "leer_apuntes": {
        if (!esUUID(p.upload_id)) throw new ErrorUsuario("Falta el archivo.");
        const { data } = await sb.from("uploads").update({ estado: "leyendo", error: null }).eq("id", p.upload_id).eq("user_id", u.id).eq("exam_id", cuerpo.exam_id).select("id").maybeSingle();
        if (!data) throw new ErrorUsuario("No encontramos ese archivo.");
        params.upload_id = p.upload_id;
        break;
      }
      case "organizar_temas": {
        const ids = Array.isArray(p.upload_ids) ? p.upload_ids.filter(esUUID).slice(0, 100) : [];
        if (!ids.length) throw new ErrorUsuario("No hay apuntes que organizar.");
        params.upload_ids = ids;
        params._origen = new URL(req.url).origin;
        break;
      }
      case "resumen":
      case "esquema":
      case "flashcards":
        params.topic_id = await temaValido(p.topic_id);
        break;
      case "test":
        params.topic_id = await temaValido(p.topic_id);
        params.n = Math.min(20, Math.max(5, Number(p.n) || 10));
        break;
      case "simulacro":
        break;
      case "corregir_simulacro": {
        if (!esUUID(p.attempt_id)) throw new ErrorUsuario("Falta el intento.");
        const { data } = await sb
          .from("mock_exam_attempts")
          .update({ estado: "corrigiendo", fin: new Date().toISOString() })
          .eq("id", p.attempt_id)
          .eq("user_id", u.id)
          .in("estado", ["en_curso", "error"])
          .select("id")
          .maybeSingle();
        if (!data) throw new ErrorUsuario("Este examen ya se está corrigiendo o no existe.");
        params.attempt_id = p.attempt_id;
        break;
      }
      case "feynman": {
        const explicacion = String(p.explicacion ?? "").trim();
        if (explicacion.length < 40) throw new ErrorUsuario("Escribe una explicación un poco más larga (al menos un par de frases).");
        if (explicacion.length > 12000) throw new ErrorUsuario("La explicación es demasiado larga (máximo 12.000 caracteres).");
        params.topic_id = await temaValido(p.topic_id);
        params.explicacion = explicacion;
        break;
      }
      case "tutor": {
        const mensaje = String(p.mensaje ?? "").trim();
        if (!mensaje) throw new ErrorUsuario("Escribe tu pregunta.");
        if (mensaje.length > 4000) throw new ErrorUsuario("La pregunta es demasiado larga.");
        const nivel = ["sencillo", "normal", "avanzado"].includes(String(p.nivel)) ? String(p.nivel) : "normal";
        await sb.from("tutor_messages").insert({ user_id: u.id, exam_id: cuerpo.exam_id, rol: "usuario", contenido: mensaje, nivel });
        params.nivel = nivel;
        break;
      }
    }

    const id = await encolarTrabajo(new URL(req.url).origin, u.id, cuerpo.exam_id, cuerpo.tipo, params);
    return json({ job_id: id }, 202);
  } catch (e) {
    return respuestaError(e);
  }
};

export const config: Config = { path: "/api/trabajos" };
