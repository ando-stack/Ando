// Límites diarios de uso de la IA por usuario (configurables con variables de entorno) y registro del consumo.

import { ErrorUsuario, supabaseAdmin } from "./base";

export type TipoUso = "lectura" | "generacion" | "correccion" | "tutor";

const VARIABLE: Record<TipoUso, [string, number]> = {
  lectura: ["AI_LIMITE_LECTURAS_DIA", 40],
  generacion: ["AI_LIMITE_GENERACIONES_DIA", 30],
  correccion: ["AI_LIMITE_CORRECCIONES_DIA", 20],
  tutor: ["AI_LIMITE_TUTOR_DIA", 60],
};

export function limiteDiario(tipo: TipoUso): number {
  const [v, def] = VARIABLE[tipo];
  const n = Number(process.env[v]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export function limiteTokens(): number {
  const n = Number(process.env.AI_LIMITE_TOKENS_DIA);
  return Number.isFinite(n) && n > 0 ? n : 1_500_000;
}

function inicioDelDia(): string {
  // Día natural en horario de España peninsular
  const ahora = new Date();
  const enMadrid = new Date(ahora.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const diff = ahora.getTime() - enMadrid.getTime();
  enMadrid.setHours(0, 0, 0, 0);
  return new Date(enMadrid.getTime() + diff).toISOString();
}

export interface EstadoUso {
  tipo: TipoUso;
  usados: number;
  limite: number;
  tokens: number;
  limiteTokens: number;
}

export async function usoDeHoy(userId: string, tipo: TipoUso): Promise<EstadoUso> {
  const { data, error } = await supabaseAdmin()
    .from("ai_usage")
    .select("tipo, operacion, tokens_entrada, tokens_salida, exito")
    .eq("user_id", userId)
    .gte("created_at", inicioDelDia());
  if (error) throw error;
  const filas = data ?? [];
  // Cada trabajo cuenta una vez aunque haga varias llamadas (se registra con operacion "trabajo")
  const usados = filas.filter((f) => f.tipo === tipo && f.operacion === "trabajo" && f.exito !== false).length;
  const tokens = filas.reduce((a, f) => a + (f.tokens_entrada ?? 0) + (f.tokens_salida ?? 0), 0);
  return { tipo, usados, limite: limiteDiario(tipo), tokens, limiteTokens: limiteTokens() };
}

/** Lanza un error amable si se ha alcanzado el límite. */
export async function comprobarLimite(userId: string, tipo: TipoUso): Promise<void> {
  const u = await usoDeHoy(userId, tipo);
  if (u.usados >= u.limite || u.tokens >= u.limiteTokens) {
    throw new ErrorUsuario(
      "Has llegado al límite diario de uso de la IA. Mañana se renueva. Mientras tanto puedes seguir usando todo lo que ya tienes: resúmenes, flashcards, tests y tu plan.",
      429,
      "limite_diario",
    );
  }
}

export async function registrarUso(fila: {
  user_id: string;
  tipo: TipoUso;
  operacion: string;
  modelo?: string;
  tokens_entrada?: number;
  tokens_salida?: number;
  exito?: boolean;
}) {
  const { error } = await supabaseAdmin().from("ai_usage").insert({
    tokens_entrada: 0,
    tokens_salida: 0,
    exito: true,
    ...fila,
  });
  if (error) console.error("[estudia] no se pudo registrar el uso de IA:", error.message);
}
