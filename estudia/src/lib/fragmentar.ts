// División del texto de los apuntes en fragmentos citables (para pgvector y para las citas).

export interface Fragmento {
  orden: number;
  seccion: string | null;
  pagina: number | null;
  origen: string;
  contenido: string;
}

const MARCA_PAGINA = /<!--\s*pagina:(\d+)\s*-->/;
const OBJETIVO = 900;
const MAXIMO = 1600;

/** Etiqueta legible del origen de una subida. */
export function etiquetaOrigen(s: { tipo: "imagen" | "pdf" | "texto"; orden: number; nombre_original?: string | null }): string {
  if (s.tipo === "imagen") return s.nombre_original?.match(/^Foto \d+$/) ? s.nombre_original : `Foto ${s.orden + 1}`;
  if (s.tipo === "pdf") {
    const nombre = (s.nombre_original ?? "PDF").replace(/\.pdf$/i, "");
    return `PDF «${nombre.length > 40 ? nombre.slice(0, 39) + "…" : nombre}»`;
  }
  return s.nombre_original?.match(/^Texto \d+$/) ? s.nombre_original : `Texto ${s.orden + 1}`;
}

function partirLargo(bloque: string): string[] {
  if (bloque.length <= MAXIMO) return [bloque];
  // no partir fórmulas en bloque ni tablas
  if (bloque.trimStart().startsWith("$$") || bloque.trimStart().startsWith("|")) return [bloque];
  const frases = bloque.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  let actual = "";
  for (const f of frases) {
    if ((actual + " " + f).length > OBJETIVO && actual) {
      out.push(actual.trim());
      actual = f;
    } else actual = actual ? `${actual} ${f}` : f;
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

export function fragmentar(contenido: string, origenBase: string, multipagina: boolean): Fragmento[] {
  const lineas = contenido.replace(/\r\n/g, "\n").split("\n");
  const bloques: { texto: string; seccion: string | null; pagina: number | null }[] = [];
  let pagina: number | null = null;
  let seccion: string | null = null;
  let actual: string[] = [];
  let enFormula = false;

  const cerrar = () => {
    const t = actual.join("\n").trim();
    if (t) bloques.push({ texto: t, seccion, pagina });
    actual = [];
  };

  for (const l of lineas) {
    const m = l.match(MARCA_PAGINA);
    if (m) {
      cerrar();
      pagina = Number(m[1]);
      continue;
    }
    if (l.trim().startsWith("$$")) {
      const cuenta = (l.match(/\$\$/g) ?? []).length;
      if (cuenta % 2 === 1) enFormula = !enFormula;
    }
    const titulo = !enFormula && l.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (titulo) {
      cerrar();
      seccion = titulo[2].replace(/[*_`]/g, "").trim().slice(0, 160) || seccion;
      actual.push(l);
      continue;
    }
    if (!enFormula && l.trim() === "") {
      cerrar();
      continue;
    }
    actual.push(l);
  }
  cerrar();

  // Agrupar bloques pequeños de la misma sección y página hasta ~900 caracteres
  const out: Fragmento[] = [];
  let grupo: typeof bloques = [];
  const volcar = () => {
    if (!grupo.length) return;
    const texto = grupo.map((b) => b.texto).join("\n\n");
    const { seccion: sec, pagina: pag } = grupo[0];
    for (const parte of partirLargo(texto)) {
      out.push({
        orden: out.length,
        seccion: sec,
        pagina: pag,
        origen: multipagina && pag ? `${origenBase} · p. ${pag}` : origenBase,
        contenido: parte,
      });
    }
    grupo = [];
  };
  for (const b of bloques) {
    const largo = grupo.reduce((a, x) => a + x.texto.length, 0);
    const cambia = grupo.length && (grupo[0].seccion !== b.seccion || grupo[0].pagina !== b.pagina);
    if (cambia || largo + b.texto.length > OBJETIVO) volcar();
    grupo.push(b);
  }
  volcar();
  return out;
}

export function contarPalabras(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}
