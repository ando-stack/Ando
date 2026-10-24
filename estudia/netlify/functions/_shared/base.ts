// Utilidades comunes de las funciones de servidor: entorno, Supabase, respuestas y autenticación.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class ErrorUsuario extends Error {
  constructor(
    message: string,
    public estado = 400,
    public codigo = "error",
  ) {
    super(message);
  }
}

export function entorno(nombre: string, obligatorio = true): string {
  const v = process.env[nombre];
  if (!v && obligatorio) {
    throw new ErrorUsuario(`Falta configurar la variable de entorno ${nombre} en el servidor.`, 500, "configuracion");
  }
  return v ?? "";
}

let admin: SupabaseClient | null = null;
/** Cliente con service role: SOLO en el servidor. Siempre filtrar por user_id. */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(entorno("SUPABASE_URL"), entorno("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export function json(datos: unknown, estado = 200): Response {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function respuestaError(e: unknown): Response {
  if (e instanceof ErrorUsuario) return json({ error: e.message, codigo: e.codigo }, e.estado);
  console.error("[estudia] error inesperado:", e);
  return json({ error: "Ha ocurrido un error inesperado. Inténtalo de nuevo en un momento.", codigo: "interno" }, 500);
}

export interface Usuario {
  id: string;
  email: string | null;
  perfil: {
    nombre: string;
    fecha_nacimiento: string;
    consentimiento_estado: string;
    consentimiento_ia: boolean;
    tutor_email: string | null;
  };
}

/** Verifica el token del usuario (cabecera Authorization: Bearer …) y carga su perfil. */
export async function usuarioDesdePeticion(req: Request): Promise<Usuario> {
  const cab = req.headers.get("authorization") ?? "";
  const token = cab.startsWith("Bearer ") ? cab.slice(7) : "";
  if (!token) throw new ErrorUsuario("Inicia sesión para continuar.", 401, "no_autenticado");
  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new ErrorUsuario("Tu sesión ha caducado. Vuelve a iniciar sesión.", 401, "no_autenticado");
  const { data: perfil } = await sb
    .from("profiles")
    .select("nombre, fecha_nacimiento, consentimiento_estado, consentimiento_ia, tutor_email")
    .eq("id", data.user.id)
    .single();
  if (!perfil) throw new ErrorUsuario("No encontramos tu perfil.", 404, "sin_perfil");
  return { id: data.user.id, email: data.user.email ?? null, perfil };
}

/** Exige consentimiento vigente para tratar apuntes con IA (RGPD art. 6-8, LOPDGDD art. 7). */
export function exigirConsentimiento(u: Usuario) {
  if (u.perfil.consentimiento_estado === "pendiente_tutor") {
    throw new ErrorUsuario(
      "Para usar la IA con tus apuntes necesitamos que tu padre, madre o tutor dé su permiso. Puedes pedírselo desde tu perfil.",
      403,
      "consentimiento_tutor",
    );
  }
  if (u.perfil.consentimiento_estado !== "concedido" || !u.perfil.consentimiento_ia) {
    throw new ErrorUsuario("Para leer tus apuntes con IA necesitas aceptar el tratamiento en tu perfil.", 403, "consentimiento");
  }
}

/** Comprueba que el examen es del usuario. */
export async function exigirExamen(userId: string, examId: string) {
  const { data } = await supabaseAdmin().from("exams").select("*").eq("id", examId).eq("user_id", userId).single();
  if (!data) throw new ErrorUsuario("No encontramos ese examen.", 404, "no_encontrado");
  return data as import("../../../src/lib/tipos").Examen;
}

export function esInterna(req: Request): boolean {
  const secreto = process.env.INTERNAL_SECRET;
  return Boolean(secreto) && req.headers.get("x-interno") === secreto;
}

export async function leerJSON<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ErrorUsuario("Petición no válida.", 400, "peticion");
  }
}
