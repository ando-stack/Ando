// Llamadas a la API de Claude (solo en el servidor) con salida estructurada y registro de consumo.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { ErrorUsuario, entorno } from "./base";
import { registrarUso, type TipoUso } from "./limites";

let cliente: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!cliente) cliente = new Anthropic({ apiKey: entorno("ANTHROPIC_API_KEY"), maxRetries: 3, timeout: 10 * 60 * 1000 });
  return cliente;
}

export function modelo(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

export type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max";

export interface PeticionIA<T extends z.ZodType> {
  userId: string;
  tipo: TipoUso;
  operacion: string;
  sistema: string;
  contenido: Anthropic.Beta.BetaContentBlockParam[] | string;
  esquema: T;
  esfuerzo?: Esfuerzo;
  maxTokens?: number;
  /** Historial previo (tutor). */
  historial?: Anthropic.Beta.BetaMessageParam[];
  /** false en scripts de prueba sin base de datos */
  registrar?: boolean;
}

/** Error de IA con mensaje en español apto para mostrar al estudiante. */
export class ErrorIA extends ErrorUsuario {}

function traducirError(e: unknown): ErrorUsuario {
  if (e instanceof ErrorUsuario) return e;
  if (e instanceof Anthropic.RateLimitError) {
    return new ErrorIA("La IA está muy solicitada ahora mismo. Inténtalo de nuevo en unos minutos.", 503, "ia_saturada");
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error("[estudia] clave de Anthropic no válida o sin permisos");
    return new ErrorIA("El servicio de IA no está bien configurado. Avisa a quien administra la web.", 500, "ia_configuracion");
  }
  if (e instanceof Anthropic.BadRequestError) {
    console.error("[estudia] petición rechazada por la API:", e.message);
    return new ErrorIA("La IA no ha podido procesar este contenido (puede que el archivo sea demasiado grande).", 400, "ia_peticion");
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ErrorIA("No hemos podido conectar con la IA. Revisa tu conexión e inténtalo de nuevo.", 503, "ia_conexion");
  }
  if (e instanceof Anthropic.APIError) {
    console.error("[estudia] error de la API de IA:", e.status, e.message);
    return new ErrorIA("La IA ha fallado temporalmente. Inténtalo de nuevo en un momento.", 503, "ia_fallo");
  }
  console.error("[estudia] error inesperado de IA:", e);
  return new ErrorIA("La IA ha fallado temporalmente. Inténtalo de nuevo en un momento.", 503, "ia_fallo");
}

/**
 * Pide a Claude una respuesta que cumpla el esquema (salidas estructuradas).
 * Usa streaming (respuestas largas), pensamiento adaptativo y reintento en otro
 * modelo si el principal rechaza la petición (fallbacks "default").
 */
export async function pedirJSON<T extends z.ZodType>(p: PeticionIA<T>): Promise<z.infer<T>> {
  const formato = betaZodOutputFormat(p.esquema);
  const mensajes: Anthropic.Beta.BetaMessageParam[] = [
    ...(p.historial ?? []),
    { role: "user", content: p.contenido },
  ];
  let entrada = 0;
  let salida = 0;
  let exito = false;
  try {
    const stream = anthropic().beta.messages.stream({
      model: modelo(),
      max_tokens: p.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: p.esfuerzo ?? "medium", format: { type: "json_schema", schema: formato.schema } },
      system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
      messages: mensajes,
    });
    const msg = await stream.finalMessage();
    entrada = (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    salida = msg.usage.output_tokens ?? 0;

    if (msg.stop_reason === "refusal") {
      throw new ErrorIA("La IA no ha podido trabajar con este contenido. Prueba con otra foto o revisa el texto.", 422, "ia_rechazo");
    }
    if (msg.stop_reason === "max_tokens") {
      throw new ErrorIA("El contenido es demasiado largo para procesarlo de una vez. Prueba a dividirlo en partes.", 413, "ia_largo");
    }
    const texto = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new ErrorIA("La respuesta de la IA llegó incompleta. Inténtalo de nuevo.", 502, "ia_formato");
    }
    const r = p.esquema.safeParse(datos);
    if (!r.success) {
      console.error("[estudia] respuesta de IA con formato inesperado:", r.error.message);
      throw new ErrorIA("La respuesta de la IA no tenía el formato esperado. Inténtalo de nuevo.", 502, "ia_formato");
    }
    exito = true;
    return r.data;
  } catch (e) {
    throw traducirError(e);
  } finally {
    if (p.registrar !== false) await registrarUso({
      user_id: p.userId,
      tipo: p.tipo,
      operacion: p.operacion,
      modelo: modelo(),
      tokens_entrada: entrada,
      tokens_salida: salida,
      exito,
    });
  }
}
