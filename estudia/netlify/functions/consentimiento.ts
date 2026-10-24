// POST /api/consentimiento → consentimiento del padre, madre o tutor para menores de 14 años
// (RGPD art. 8 y LOPDGDD art. 7). Acciones: solicitar (menor autenticado), ver, confirmar y denegar (tutor con enlace).

import type { Config } from "@netlify/functions";
import { createHash, randomBytes } from "node:crypto";
import { ErrorUsuario, json, leerJSON, respuestaError, supabaseAdmin, usuarioDesdePeticion } from "./_shared/base";

export const VERSION_POLITICA = "2026-10-01";
const DIAS_VALIDEZ = 7;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;

async function enviarCorreo(para: string, nombreMenor: string, enlace: string): Promise<"email" | "registro"> {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) {
    // Sin proveedor de correo (desarrollo): el enlace solo aparece en los registros del servidor.
    console.info(`[estudia] (desarrollo) enlace de consentimiento para ${para}: ${enlace}`);
    return "registro";
  }
  const html = `<p>Hola:</p>
<p><strong>${nombreMenor.replace(/[<>&]/g, "")}</strong> quiere usar <strong>Estudia</strong>, una web para preparar exámenes a partir de sus propios apuntes con ayuda de inteligencia artificial.</p>
<p>Como es menor de 14 años, la ley (RGPD y LOPDGDD) exige el permiso de su padre, madre o tutor legal. En el siguiente enlace puedes leer qué datos se tratan y decidir:</p>
<p><a href="${enlace}">Revisar y responder la solicitud</a></p>
<p>El enlace caduca en ${DIAS_VALIDEZ} días. Si no conoces esta solicitud, ignora este correo.</p>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${clave}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "Estudia <onboarding@resend.dev>", to: [para], subject: "Permiso para que use Estudia", html }),
  });
  if (!r.ok) {
    console.error("[estudia] fallo al enviar el correo de consentimiento:", r.status);
    throw new ErrorUsuario("No hemos podido enviar el correo. Revisa la dirección e inténtalo de nuevo.", 502);
  }
  return "email";
}

interface Cuerpo {
  accion: "solicitar" | "ver" | "confirmar" | "denegar";
  tutor_email?: string;
  token?: string;
  nombre?: string;
  relacion?: string;
  acepta_cuenta?: boolean;
  acepta_ia?: boolean;
}

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const c = await leerJSON<Cuerpo>(req);
    const sb = supabaseAdmin();

    if (c.accion === "solicitar") {
      const u = await usuarioDesdePeticion(req);
      const { data: perfil } = await sb.from("profiles").select("nombre, fecha_nacimiento, consentimiento_estado, updated_at, consentimiento_token_hash").eq("id", u.id).single();
      if (!perfil) throw new ErrorUsuario("Perfil no encontrado.", 404);
      const { data: edad } = await sb.rpc("edad", { p_fecha: perfil.fecha_nacimiento });
      if (Number(edad) >= 14) throw new ErrorUsuario("Como tienes 14 años o más, puedes dar tu consentimiento tú mismo desde tu perfil.");
      const email = String(c.tutor_email ?? "").trim().toLowerCase();
      if (!emailValido(email)) throw new ErrorUsuario("Escribe un correo válido de tu padre, madre o tutor.");
      if (u.email && email === u.email.toLowerCase()) throw new ErrorUsuario("El correo tiene que ser el de tu padre, madre o tutor, no el tuyo.");
      if (perfil.consentimiento_token_hash && Date.now() - new Date(perfil.updated_at).getTime() < 2 * 60_000) {
        throw new ErrorUsuario("Acabamos de enviar una solicitud. Espera un par de minutos antes de volver a intentarlo.", 429);
      }
      const token = randomBytes(32).toString("hex");
      await sb
        .from("profiles")
        .update({
          tutor_email: email,
          consentimiento_token_hash: hash(token),
          consentimiento_token_expira: new Date(Date.now() + DIAS_VALIDEZ * 86_400_000).toISOString(),
          consentimiento_estado: perfil.consentimiento_estado === "concedido" ? "concedido" : "pendiente_tutor",
        })
        .eq("id", u.id);
      const base = process.env.PUBLIC_SITE_URL || new URL(req.url).origin;
      const via = await enviarCorreo(email, perfil.nombre || "Tu hijo/a", `${base}/consentimiento/${token}`);
      return json({ enviado: true, via });
    }

    const token = String(c.token ?? "");
    if (!/^[0-9a-f]{64}$/.test(token)) throw new ErrorUsuario("El enlace no es válido.", 400);
    const { data: perfil } = await sb
      .from("profiles")
      .select("id, nombre, consentimiento_token_expira, consentimiento_estado")
      .eq("consentimiento_token_hash", hash(token))
      .maybeSingle();
    if (!perfil || !perfil.consentimiento_token_expira || new Date(perfil.consentimiento_token_expira) < new Date()) {
      throw new ErrorUsuario("El enlace ha caducado o ya se ha usado. Pide al menor que envíe una nueva solicitud desde su perfil.", 410);
    }

    if (c.accion === "ver") {
      return json({ nombre: perfil.nombre || "el menor", version: VERSION_POLITICA, estado: perfil.consentimiento_estado });
    }

    if (c.accion === "denegar") {
      await sb.from("profiles").update({ consentimiento_token_hash: null, consentimiento_token_expira: null, consentimiento_estado: "pendiente_tutor", consentimiento_ia: false }).eq("id", perfil.id);
      return json({ ok: true });
    }

    if (c.accion === "confirmar") {
      const nombre = String(c.nombre ?? "").trim();
      const relacion = String(c.relacion ?? "").trim();
      if (nombre.length < 3) throw new ErrorUsuario("Escribe tu nombre y apellidos.");
      if (!["madre", "padre", "tutor_legal"].includes(relacion)) throw new ErrorUsuario("Indica tu relación con el menor.");
      if (!c.acepta_cuenta) throw new ErrorUsuario("Para crear la cuenta es necesario aceptar la política de privacidad.");
      const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "";
      await sb
        .from("profiles")
        .update({
          consentimiento_estado: "concedido",
          consentimiento_ia: Boolean(c.acepta_ia),
          consentimiento_fecha: new Date().toISOString(),
          consentimiento_version: VERSION_POLITICA,
          consentimiento_otorgado_por: "tutor",
          tutor_nombre: nombre.slice(0, 120),
          tutor_relacion: relacion,
          tutor_ip_hash: ip ? hash(`${ip}:${process.env.INTERNAL_SECRET ?? ""}`) : null,
          consentimiento_token_hash: null,
          consentimiento_token_expira: null,
        })
        .eq("id", perfil.id);
      return json({ ok: true });
    }
    throw new ErrorUsuario("Acción no válida.");
  } catch (e) {
    return respuestaError(e);
  }
};

export const config: Config = { path: "/api/consentimiento" };
