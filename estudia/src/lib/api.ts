// Llamadas a las funciones de servidor (/api/*) con el token del usuario.
import { supabase } from "./supabase";
import type { TipoTrabajo } from "./tipos";

export class ErrorApi extends Error {
  constructor(message: string, public codigo: string, public estado: number) {
    super(message);
  }
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export async function api<T = unknown>(ruta: string, opciones: { method?: string; body?: unknown; sinAuth?: boolean } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/${ruta}`, {
      method: opciones.method ?? (opciones.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(opciones.sinAuth ? {} : { authorization: `Bearer ${await token()}` }),
      },
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    });
  } catch {
    throw new ErrorApi("No hay conexión. Revisa tu internet e inténtalo de nuevo.", "conexion", 0);
  }
  const tipo = r.headers.get("content-type") ?? "";
  const datos = tipo.includes("json") ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new ErrorApi((datos as { error?: string }).error ?? "Ha ocurrido un error. Inténtalo de nuevo.", (datos as { codigo?: string }).codigo ?? "error", r.status);
  return datos as T;
}

export function lanzarTrabajo(tipo: TipoTrabajo, examId: string, parametros: Record<string, unknown> = {}) {
  return api<{ job_id: string }>("trabajos", { body: { tipo, exam_id: examId, parametros } });
}

export async function descargarMisDatos() {
  const r = await fetch("/api/privacidad", { headers: { authorization: `Bearer ${await token()}` } });
  if (!r.ok) throw new ErrorApi("No se pudieron exportar los datos. Inténtalo de nuevo.", "exportar", r.status);
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `estudia-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Mensaje legible para cualquier error. */
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    const m = (e as { message: string }).message;
    if (/row-level security|permission denied/i.test(m)) return "No tienes permiso para hacer esto. Si eres menor de 14 años, necesitas el permiso de tu tutor.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "No hay conexión. Revisa tu internet e inténtalo de nuevo.";
    if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
    if (/User already registered/i.test(m)) return "Ya existe una cuenta con ese correo.";
    if (/Password should be at least/i.test(m)) return "La contraseña debe tener al menos 8 caracteres.";
    if (/Email not confirmed/i.test(m)) return "Confirma tu correo antes de entrar (revisa tu bandeja de entrada).";
    return m;
  }
  return "Ha ocurrido un error inesperado.";
}
