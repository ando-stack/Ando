/**
 * Validación de citas: garantiza que todo lo generado procede de los apuntes.
 * Se usa en el servidor tras cada respuesta de la IA.
 *
 * Reglas:
 *  1. Cada elemento debe citar al menos un fragmento que EXISTA en los apuntes
 *     que se enviaron a la IA (no vale inventar identificadores).
 *  2. Si no cita nada válido, solo se conserva si está marcado como "ampliación"
 *     (aclaración de la IA, que la interfaz señala para comprobar).
 *  3. Los elementos que no cumplen se descartan y se cuentan para el registro.
 */

import type { Fuente } from "./tipos";

export interface FragmentoCitable {
  /** Identificador corto que ve la IA, p. ej. "F3" */
  ref: string;
  chunk_id: string;
  origen: string;
}

export interface ConCitas {
  fuentes: string[]; // referencias cortas devueltas por la IA
  ampliacion?: boolean;
}

export function mapaReferencias(fragmentos: FragmentoCitable[]): Map<string, FragmentoCitable> {
  return new Map(fragmentos.map((f) => [f.ref.toUpperCase(), f]));
}

/** Convierte referencias cortas ("F3") en fuentes completas, descartando las inexistentes. */
export function resolverFuentes(refs: string[] | undefined, mapa: Map<string, FragmentoCitable>): Fuente[] {
  const vistos = new Set<string>();
  const out: Fuente[] = [];
  for (const r of refs ?? []) {
    const f = mapa.get(String(r).trim().replace(/^\[|\]$/g, "").toUpperCase());
    if (f && !vistos.has(f.chunk_id)) {
      vistos.add(f.chunk_id);
      out.push({ chunk_id: f.chunk_id, origen: f.origen });
    }
  }
  return out;
}

export interface Validado<T> {
  item: T & { fuentes: Fuente[]; ampliacion: boolean };
}

/**
 * Filtra y transforma una lista de elementos con citas.
 * Devuelve los válidos y el número de descartados.
 */
export function validarCitas<T extends ConCitas>(
  items: T[],
  mapa: Map<string, FragmentoCitable>,
  opciones: { permitirAmpliaciones?: boolean } = {},
): { validos: (Omit<T, "fuentes" | "ampliacion"> & { fuentes: Fuente[]; ampliacion: boolean })[]; descartados: number } {
  const permitir = opciones.permitirAmpliaciones ?? true;
  const validos: (Omit<T, "fuentes" | "ampliacion"> & { fuentes: Fuente[]; ampliacion: boolean })[] = [];
  let descartados = 0;
  for (const it of items) {
    const fuentes = resolverFuentes(it.fuentes, mapa);
    if (fuentes.length > 0) {
      validos.push({ ...it, fuentes, ampliacion: Boolean(it.ampliacion) });
    } else if (it.ampliacion && permitir) {
      validos.push({ ...it, fuentes: [], ampliacion: true });
    } else {
      descartados++;
    }
  }
  return { validos, descartados };
}

/** Texto agrupado de orígenes para mostrar: "Foto 1 · p. 1, Foto 3". */
export function textoOrigenes(fuentes: Fuente[]): string {
  return [...new Set(fuentes.map((f) => f.origen))].join(" · ");
}
