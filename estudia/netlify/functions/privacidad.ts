// GET  /api/privacidad → exporta todos los datos del usuario (RGPD art. 15 y 20).
// POST /api/privacidad {confirmacion:"BORRAR"} → borra la cuenta, todos los datos y archivos (RGPD art. 17).

import type { Config } from "@netlify/functions";
import { ErrorUsuario, json, leerJSON, respuestaError, supabaseAdmin, usuarioDesdePeticion } from "./_shared/base";

const TABLAS = [
  "exams", "exam_topics", "uploads", "extracted_texts", "chunks", "summaries", "mindmaps", "flashcards", "reviews",
  "quizzes", "quiz_attempts", "mock_exams", "mock_exam_attempts", "study_plans", "study_sessions", "streaks",
  "achievements", "ai_usage", "tutor_messages", "feynman_attempts",
] as const;

async function archivosDe(userId: string): Promise<string[]> {
  const sb = supabaseAdmin();
  const rutas: string[] = [];
  const { data: carpetas } = await sb.storage.from("apuntes").list(userId, { limit: 1000 });
  for (const c of carpetas ?? []) {
    if (c.id) {
      rutas.push(`${userId}/${c.name}`);
      continue;
    }
    for (let offset = 0; ; offset += 1000) {
      const { data: archivos } = await sb.storage.from("apuntes").list(`${userId}/${c.name}`, { limit: 1000, offset });
      (archivos ?? []).forEach((a) => rutas.push(`${userId}/${c.name}/${a.name}`));
      if (!archivos || archivos.length < 1000) break;
    }
  }
  return rutas;
}

export default async (req: Request) => {
  try {
    const u = await usuarioDesdePeticion(req);
    const sb = supabaseAdmin();

    if (req.method === "GET") {
      const datos: Record<string, unknown> = {};
      const { data: perfil } = await sb
        .from("profiles")
        .select("id, nombre, fecha_nacimiento, consentimiento_estado, consentimiento_ia, consentimiento_fecha, consentimiento_version, consentimiento_otorgado_por, tutor_email, tutor_nombre, tutor_relacion, preferencias, created_at")
        .eq("id", u.id)
        .single();
      datos.perfil = { ...perfil, email: u.email };
      for (const t of TABLAS) {
        const col = t === "streaks" ? "user_id" : "user_id";
        const sel = t === "chunks" ? "id, exam_id, topic_id, upload_id, orden, seccion, pagina, origen, contenido, created_at" : "*";
        const { data } = await sb.from(t).select(sel).eq(col, u.id).limit(20000);
        datos[t] = data ?? [];
      }
      const rutas = await archivosDe(u.id);
      const enlaces: { ruta: string; url: string | null }[] = [];
      for (let i = 0; i < rutas.length; i += 100) {
        const { data } = await sb.storage.from("apuntes").createSignedUrls(rutas.slice(i, i + 100), 3600);
        (data ?? []).forEach((d, j) => enlaces.push({ ruta: rutas[i + j], url: d.signedUrl ?? null }));
      }
      datos.archivos = { nota: "Enlaces de descarga válidos durante 1 hora.", enlaces };
      datos.exportado_en = new Date().toISOString();
      return new Response(JSON.stringify(datos, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="estudia-mis-datos-${new Date().toISOString().slice(0, 10)}.json"`,
          "cache-control": "no-store",
        },
      });
    }

    if (req.method === "POST") {
      const { confirmacion } = await leerJSON<{ confirmacion?: string }>(req);
      if (confirmacion !== "BORRAR") throw new ErrorUsuario('Escribe "BORRAR" para confirmar.');
      const rutas = await archivosDe(u.id);
      for (let i = 0; i < rutas.length; i += 100) {
        const { error } = await sb.storage.from("apuntes").remove(rutas.slice(i, i + 100));
        if (error) throw new ErrorUsuario("No se pudieron borrar todos los archivos. Inténtalo de nuevo.", 500);
      }
      // Borrado en cascada de todas las tablas (ON DELETE CASCADE desde auth.users)
      const { error } = await sb.auth.admin.deleteUser(u.id);
      if (error) throw new ErrorUsuario("No se pudo borrar la cuenta. Inténtalo de nuevo.", 500);
      return json({ ok: true });
    }
    return json({ error: "Método no permitido" }, 405);
  } catch (e) {
    return respuestaError(e);
  }
};

export const config: Config = { path: "/api/privacidad" };
