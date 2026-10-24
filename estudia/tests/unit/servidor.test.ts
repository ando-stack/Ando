import { describe, expect, it } from "vitest";
import { etiquetaOrigen, fragmentar } from "../../src/lib/fragmentar";
import { composicionSimulacro, repartirPuntos } from "../../src/lib/simulacro";
import { mapaReferencias } from "../../src/lib/citas";
import { construirArbol, normalizarTest } from "../../netlify/functions/_shared/tareas/materiales";
import { dudasDesdeTexto } from "../../netlify/functions/_shared/tareas/lectura";
import { esquemaFlashcards, esquemaLectura, esquemaTest } from "../../netlify/functions/_shared/esquemas";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

const mapa = mapaReferencias([
  { ref: "F1", chunk_id: "c1", origen: "Foto 1" },
  { ref: "F2", chunk_id: "c2", origen: "Foto 2" },
]);

describe("fragmentado de apuntes para citar", () => {
  it("respeta páginas, apartados y fórmulas en bloque", () => {
    const md = `<!-- pagina:1 -->\n\n# Tema 2. Funciones\n\nUna función asigna a cada x un único y.\n\n$$\nf(x) = ax^2 + bx + c\n\n$$\n\n<!-- pagina:2 -->\n\n## Dominio\n\nEl dominio es el conjunto de valores de x.`;
    const f = fragmentar(md, "PDF «Mates»", true);
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f[0]).toMatchObject({ pagina: 1, seccion: "Tema 2. Funciones", origen: "PDF «Mates» · p. 1" });
    expect(f[0].contenido).toContain("f(x) = ax^2 + bx + c");
    expect(f.at(-1)).toMatchObject({ pagina: 2, seccion: "Dominio", origen: "PDF «Mates» · p. 2" });
  });
  it("parte los bloques muy largos por frases", () => {
    const largo = Array.from({ length: 60 }, (_, i) => `Frase número ${i} sobre la mitosis celular.`).join(" ");
    const f = fragmentar(largo, "Foto 3", false);
    expect(f.length).toBeGreaterThan(1);
    expect(f.every((x) => x.contenido.length <= 1700 && x.origen === "Foto 3")).toBe(true);
  });
  it("etiqueta el origen de forma estable", () => {
    expect(etiquetaOrigen({ tipo: "imagen", orden: 5, nombre_original: "Foto 2" })).toBe("Foto 2");
    expect(etiquetaOrigen({ tipo: "pdf", orden: 0, nombre_original: "Tema 4.pdf" })).toBe("PDF «Tema 4»");
  });
});

describe("lectura: dudas marcadas", () => {
  it("extrae las lecturas dudosas con su motivo y página", () => {
    const d = dudasDesdeTexto([{ numero: 2, markdown: "La batalla de [[?Lepanto?]] fue en [[?1571?]].", dudas: [{ texto: "1571", motivo: "Número borroso" }] }]);
    expect(d).toEqual([
      { id: "d1", texto: "Lepanto", motivo: "Lectura dudosa", pagina: 2, resuelta: false },
      { id: "d2", texto: "1571", motivo: "Número borroso", pagina: 2, resuelta: false },
    ]);
  });
});

describe("validación de materiales generados", () => {
  it("el mapa conceptual descarta nodos sin cita y conserva las ampliaciones", () => {
    const raiz = construirArbol(
      [
        { id: "n1", padre: "", texto: "Célula", fuentes: ["F1"], ampliacion: false },
        { id: "n2", padre: "n1", texto: "Núcleo", fuentes: ["F1"], ampliacion: false },
        { id: "n3", padre: "n1", texto: "Inventado", fuentes: ["F99"], ampliacion: false },
        { id: "n4", padre: "n2", texto: "ADN", fuentes: ["F2"], ampliacion: false },
        { id: "n5", padre: "n1", texto: "Aclaración", fuentes: [], ampliacion: true },
      ],
      mapa,
      "x",
    );
    expect(raiz.texto).toBe("Célula");
    expect(raiz.hijos.map((h) => h.texto)).toEqual(["Núcleo", "Aclaración"]);
    expect(raiz.hijos[0].hijos[0].fuentes).toEqual([{ chunk_id: "c2", origen: "Foto 2" }]);
    expect(raiz.hijos[1].ampliacion).toBe(true);
  });
  it("los tests solo admiten preguntas citadas y coherentes", () => {
    const temaDe = new Map([["F1", "t1"], ["F2", "t2"]]);
    const base = { explicacion: "…", ampliacion: false };
    const r = normalizarTest(
      [
        { ...base, tipo: "opcion_multiple", enunciado: "ok", opciones: ["a", "b", "c", "d"], correcta: 2, fuentes: ["F2"] },
        { ...base, tipo: "opcion_multiple", enunciado: "índice imposible", opciones: ["a", "b"], correcta: 5, fuentes: ["F1"] },
        { ...base, tipo: "verdadero_falso", enunciado: "sin cita", verdadero: true, fuentes: [] },
        { ...base, tipo: "verdadero_falso", enunciado: "ampliación", verdadero: true, fuentes: [], ampliacion: true },
        { ...base, tipo: "ordenar", enunciado: "pocos", orden_correcto: ["a", "b"], fuentes: ["F1"] },
        { ...base, tipo: "relacionar", enunciado: "rel", pares: [{ izquierda: "x", derecha: "1" }, { izquierda: "y", derecha: "2" }], fuentes: ["F1"] },
      ],
      mapa,
      temaDe,
      null,
    );
    expect(r.map((p) => p.enunciado)).toEqual(["ok", "rel"]);
    expect(r[0].topic_id).toBe("t2"); // el tema se deduce del fragmento citado
  });
  it("los esquemas de salida se pueden enviar como salida estructurada", () => {
    for (const e of [esquemaLectura, esquemaFlashcards, esquemaTest]) {
      const f = betaZodOutputFormat(e);
      expect(f.type).toBe("json_schema");
      expect(JSON.stringify(f.schema)).toContain("properties");
    }
  });
});

describe("formato del examen de práctica", () => {
  it("respeta la distribución y la duración, y los puntos suman 10", () => {
    const c = composicionSimulacro("mixto", { test: 40, desarrollo: 60 }, 60);
    expect(c.map((x) => x.tipo)).toEqual(["test", "desarrollo"]);
    expect(c[0].n).toBe(16); // 24 min / 1,5
    expect(c[1].n).toBe(2); // 36 min / 20
    expect(c.reduce((a, x) => a + x.puntos, 0)).toBeCloseTo(10);
    const p = repartirPuntos([{ tipo: "test" as const }, { tipo: "test" as const }, { tipo: "desarrollo" as const }], c);
    expect(p.reduce((a, x) => a + x.puntos, 0)).toBeCloseTo(10);
    expect(composicionSimulacro("problemas", {}, 90)).toEqual([{ tipo: "problemas", n: 8, puntos: 10 }]);
  });
});
