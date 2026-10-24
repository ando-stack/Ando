// Corrección instantánea de preguntas cerradas (sin IA).

import type { PreguntaTest, ResultadoPregunta } from "./tipos";

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PALABRAS_VACIAS = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "y", "o", "en", "a", "que", "es", "por", "con", "se"]);

/** Distancia de edición (para tolerar erratas pequeñas). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function casiIgual(a: string, b: string): boolean {
  if (a === b) return true;
  const tolerancia = Math.max(a.length, b.length) <= 4 ? 0 : Math.max(a.length, b.length) <= 8 ? 1 : 2;
  return levenshtein(a, b) <= tolerancia;
}

/** Respuesta corta: coincide con una respuesta aceptada o contiene la mayoría de palabras clave. */
export function corregirRespuestaCorta(respuesta: string, aceptadas: string[] = [], claves: string[] = []): boolean {
  const r = normalizar(respuesta);
  if (!r) return false;
  for (const a of aceptadas) {
    const na = normalizar(a);
    if (!na) continue;
    if (casiIgual(r, na)) return true;
    // la respuesta aceptada aparece dentro de la del estudiante (tolerando erratas)
    const pr = r.split(" ");
    const n = na.split(" ").length;
    if (na.length >= 4) {
      for (let i = 0; i + n <= pr.length; i++) {
        if (casiIgual(pr.slice(i, i + n).join(" "), na)) return true;
      }
    }
  }
  const clavesN = claves.map(normalizar).filter((c) => c && !PALABRAS_VACIAS.has(c));
  if (clavesN.length) {
    const palabras = r.split(" ");
    const encontradas = clavesN.filter((c) => (c.includes(" ") ? r.includes(c) : palabras.some((p) => casiIgual(p, c))));
    return encontradas.length >= Math.ceil(clavesN.length * 0.6);
  }
  return false;
}

export type Respuesta =
  | { tipo: "opcion_multiple"; indice: number | null }
  | { tipo: "verdadero_falso"; valor: boolean | null; justificacion: string }
  | { tipo: "respuesta_corta"; texto: string }
  | { tipo: "relacionar"; emparejamiento: Record<number, number> } // índice izquierda → índice derecha (en el orden barajado mostrado)
  | { tipo: "ordenar"; orden: string[] };

/** Devuelve puntos entre 0 y 1 (crédito parcial en relacionar y ordenar). */
export function puntuarPregunta(p: PreguntaTest, r: Respuesta, derechaMostrada?: string[]): number {
  switch (p.tipo) {
    case "opcion_multiple":
      return r.tipo === "opcion_multiple" && r.indice !== null && r.indice === p.correcta ? 1 : 0;
    case "verdadero_falso":
      return r.tipo === "verdadero_falso" && r.valor !== null && r.valor === p.verdadero ? 1 : 0;
    case "respuesta_corta":
      return r.tipo === "respuesta_corta" && corregirRespuestaCorta(r.texto, p.respuestas_aceptadas, p.palabras_clave) ? 1 : 0;
    case "relacionar": {
      if (r.tipo !== "relacionar" || !p.pares?.length) return 0;
      const derecha = derechaMostrada ?? p.pares.map((x) => x.derecha);
      let bien = 0;
      p.pares.forEach((par, i) => {
        const elegido = r.emparejamiento[i];
        if (elegido !== undefined && derecha[elegido] === par.derecha) bien++;
      });
      return bien / p.pares.length;
    }
    case "ordenar": {
      if (r.tipo !== "ordenar" || !p.orden_correcto?.length) return 0;
      const ok = p.orden_correcto.filter((x, i) => r.orden[i] === x).length;
      return ok / p.orden_correcto.length;
    }
  }
}

/** Nota sobre 10 de un conjunto de resultados. */
export function notaSobre10(resultados: ResultadoPregunta[]): number {
  if (!resultados.length) return 0;
  const puntos = resultados.reduce((a, r) => a + r.puntos, 0);
  return Math.round((puntos / resultados.length) * 100) / 10;
}

/** Baraja determinista (para relacionar/ordenar) a partir de una semilla de texto. */
export function barajar<T>(arr: T[], semilla: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < semilla.length; i++) h = Math.imul(h ^ semilla.charCodeAt(i), 16777619);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const j = Math.abs(h ^ (h >>> 16)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  // Evitar que salga igual que el original si hay más de un elemento
  if (out.length > 1 && out.every((x, i) => x === arr[i])) out.push(out.shift()!);
  return out;
}
