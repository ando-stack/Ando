// Trabajos de IA en segundo plano: se crean con /api/trabajos y los ejecutan funciones "-background"
// (hasta 15 minutos). La web consulta su estado (ai_jobs) para mostrar el progreso.

import { ErrorUsuario, esInterna, json, supabaseAdmin } from "./base";
import type { TipoUso } from "./limites";
import type { TipoTrabajo } from "../../../src/lib/tipos";

export const CONFIG_TRABAJOS: Record<TipoTrabajo, { funcion: string; uso: TipoUso; cuenta: boolean }> = {
  leer_apuntes: { funcion: "leer-apuntes-background", uso: "lectura", cuenta: true },
  organizar_temas: { funcion: "organizar-temas-background", uso: "lectura", cuenta: false },
  resumen: { funcion: "generar-material-background", uso: "generacion", cuenta: true },
  esquema: { funcion: "generar-material-background", uso: "generacion", cuenta: true },
  flashcards: { funcion: "generar-material-background", uso: "generacion", cuenta: true },
  test: { funcion: "generar-material-background", uso: "generacion", cuenta: true },
  simulacro: { funcion: "generar-material-background", uso: "generacion", cuenta: true },
  corregir_simulacro: { funcion: "corregir-background", uso: "correccion", cuenta: true },
  feynman: { funcion: "corregir-background", uso: "correccion", cuenta: true },
  tutor: { funcion: "tutor-background", uso: "tutor", cuenta: true },
};

export interface Trabajo {
  id: string;
  user_id: string;
  exam_id: string | null;
  tipo: TipoTrabajo;
  parametros: Record<string, unknown>;
  estado: string;
}

/** Crea el trabajo, registra que cuenta para el límite diario y lanza la función en segundo plano. */
export async function encolarTrabajo(
  origen: string,
  userId: string,
  examId: string | null,
  tipo: TipoTrabajo,
  parametros: Record<string, unknown>,
): Promise<string> {
  const cfg = CONFIG_TRABAJOS[tipo];
  const sb = supabaseAdmin();
  let usoId: number | null = null;
  if (cfg.cuenta) {
    const { data } = await sb.from("ai_usage").insert({ user_id: userId, tipo: cfg.uso, operacion: "trabajo" }).select("id").single();
    usoId = data?.id ?? null;
  }
  const { data, error } = await sb
    .from("ai_jobs")
    .insert({ user_id: userId, exam_id: examId, tipo, parametros: { ...parametros, _uso_id: usoId }, mensaje: "En cola…" })
    .select("id")
    .single();
  if (error || !data) throw new ErrorUsuario("No se pudo iniciar la tarea. Inténtalo de nuevo.", 500);
  const r = await fetch(`${origen}/.netlify/functions/${cfg.funcion}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-interno": process.env.INTERNAL_SECRET ?? "" },
    body: JSON.stringify({ job_id: data.id }),
  }).catch((e) => {
    console.error("[estudia] no se pudo lanzar la función en segundo plano:", e);
    return null;
  });
  if (!r || (r.status !== 202 && !r.ok)) {
    await marcarError(data.id, "No se pudo iniciar la tarea en el servidor. Inténtalo de nuevo.");
    throw new ErrorUsuario("No se pudo iniciar la tarea en el servidor. Inténtalo de nuevo.", 503);
  }
  return data.id;
}

export async function progreso(jobId: string, porcentaje: number, mensaje: string) {
  await supabaseAdmin()
    .from("ai_jobs")
    .update({ estado: "en_curso", progreso: Math.max(0, Math.min(100, Math.round(porcentaje))), mensaje })
    .eq("id", jobId);
}

async function marcarError(jobId: string, mensaje: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("ai_jobs").update({ estado: "error", error: mensaje, mensaje }).eq("id", jobId).select("parametros").single();
  const usoId = (data?.parametros as { _uso_id?: number } | null)?._uso_id;
  // Un trabajo fallido no gasta el límite diario
  if (usoId) await sb.from("ai_usage").update({ exito: false }).eq("id", usoId);
}

export type Manejador = (t: Trabajo, avanzar: (p: number, m: string) => Promise<void>) => Promise<Record<string, unknown>>;

/** Envoltorio de las funciones en segundo plano. */
export async function ejecutarTrabajo(req: Request, manejadores: Partial<Record<TipoTrabajo, Manejador>>): Promise<Response> {
  if (!esInterna(req)) return json({ error: "No autorizado" }, 401);
  const { job_id } = (await req.json().catch(() => ({}))) as { job_id?: string };
  if (!job_id) return json({ error: "Falta job_id" }, 400);
  const sb = supabaseAdmin();
  const { data: t } = await sb.from("ai_jobs").select("*").eq("id", job_id).single();
  if (!t || t.estado !== "pendiente") return json({ ok: true });
  const manejador = manejadores[t.tipo as TipoTrabajo];
  if (!manejador) {
    await marcarError(job_id, "Tipo de tarea no válido.");
    return json({ ok: false });
  }
  try {
    await progreso(job_id, 2, "Empezando…");
    const resultado = await manejador(t as Trabajo, (p, m) => progreso(job_id, p, m));
    await sb.from("ai_jobs").update({ estado: "completado", progreso: 100, mensaje: "¡Listo!", resultado }).eq("id", job_id);
  } catch (e) {
    const mensaje = e instanceof ErrorUsuario ? e.message : "Algo ha fallado al procesar la tarea. Inténtalo de nuevo.";
    if (!(e instanceof ErrorUsuario)) console.error("[estudia] fallo en trabajo", t.tipo, e);
    await marcarError(job_id, mensaje);
    if (t.tipo === "leer_apuntes" && t.parametros?.upload_id) {
      await sb.from("uploads").update({ estado: "error", error: mensaje }).eq("id", t.parametros.upload_id).eq("user_id", t.user_id);
    }
    if (t.tipo === "corregir_simulacro" && t.parametros?.attempt_id) {
      await sb.from("mock_exam_attempts").update({ estado: "error" }).eq("id", t.parametros.attempt_id).eq("user_id", t.user_id);
    }
  }
  return json({ ok: true });
}
