import { describe, expect, it } from "vitest";
import { barajar, corregirRespuestaCorta, normalizar, notaSobre10, puntuarPregunta } from "../../src/lib/corregir";
import { mapaReferencias, validarCitas } from "../../src/lib/citas";
import { dominioPorTema, notaEstimada, rachaVigente, recomendaciones } from "../../src/lib/progreso";
import { cuentaAtras, semanaISO, sumarDias } from "../../src/lib/fechas";
import { detectarHoja, estimarInclinacion, percentiles, type Gris } from "../../src/lib/imagen";
import type { PreguntaTest } from "../../src/lib/tipos";

describe("corrección instantánea", () => {
  it("normaliza tildes, mayúsculas y signos", () => {
    expect(normalizar("¡La Revolución  Francesa!")).toBe("la revolucion francesa");
  });
  it("respuesta corta: acepta variantes y erratas pequeñas", () => {
    expect(corregirRespuestaCorta("mitocondria", ["Mitocondrias"])).toBe(true);
    expect(corregirRespuestaCorta("la mitocondira", ["mitocondria"])).toBe(true);
    expect(corregirRespuestaCorta("ribosoma", ["mitocondria"])).toBe(false);
    expect(corregirRespuestaCorta("en 1789 con la toma de la Bastilla", [], ["1789", "Bastilla"])).toBe(true);
    expect(corregirRespuestaCorta("", ["x"])).toBe(false);
  });
  it("puntúa cada tipo de pregunta", () => {
    const base = { id: "p", enunciado: "?", topic_id: null, explicacion: "", fuentes: [], ampliacion: false };
    const om: PreguntaTest = { ...base, tipo: "opcion_multiple", opciones: ["a", "b"], correcta: 1 };
    expect(puntuarPregunta(om, { tipo: "opcion_multiple", indice: 1 })).toBe(1);
    expect(puntuarPregunta(om, { tipo: "opcion_multiple", indice: 0 })).toBe(0);
    const vf: PreguntaTest = { ...base, tipo: "verdadero_falso", verdadero: false };
    expect(puntuarPregunta(vf, { tipo: "verdadero_falso", valor: false, justificacion: "porque…" })).toBe(1);
    const rel: PreguntaTest = { ...base, tipo: "relacionar", pares: [{ izquierda: "H2O", derecha: "agua" }, { izquierda: "NaCl", derecha: "sal" }] };
    expect(puntuarPregunta(rel, { tipo: "relacionar", emparejamiento: { 0: 1, 1: 0 } }, ["sal", "agua"])).toBe(1);
    expect(puntuarPregunta(rel, { tipo: "relacionar", emparejamiento: { 0: 0, 1: 1 } }, ["sal", "agua"])).toBe(0);
    const ord: PreguntaTest = { ...base, tipo: "ordenar", orden_correcto: ["a", "b", "c", "d"] };
    expect(puntuarPregunta(ord, { tipo: "ordenar", orden: ["a", "b", "d", "c"] })).toBe(0.5);
    expect(notaSobre10([{ pregunta_id: "1", topic_id: null, correcta: true, puntos: 1 }, { pregunta_id: "2", topic_id: null, correcta: false, puntos: 0.5 }])).toBe(7.5);
  });
  it("baraja de forma determinista y nunca deja el mismo orden", () => {
    expect(barajar([1, 2, 3, 4], "x")).toEqual(barajar([1, 2, 3, 4], "x"));
    expect(barajar([1, 2], "y")).not.toEqual([1, 2]);
  });
});

describe("validación de citas (nada inventado)", () => {
  const mapa = mapaReferencias([
    { ref: "F1", chunk_id: "c1", origen: "Foto 1 · p. 1" },
    { ref: "F2", chunk_id: "c2", origen: "Foto 2" },
  ]);
  it("descarta elementos sin cita válida y conserva las ampliaciones marcadas", () => {
    const { validos, descartados } = validarCitas(
      [
        { texto: "a", fuentes: ["F1", "f2", "F1"] },
        { texto: "inventado", fuentes: ["F9"] },
        { texto: "sin nada", fuentes: [] },
        { texto: "aclaración", fuentes: [], ampliacion: true },
      ],
      mapa,
    );
    expect(descartados).toBe(2);
    expect(validos.map((v) => v.texto)).toEqual(["a", "aclaración"]);
    expect(validos[0].fuentes).toEqual([{ chunk_id: "c1", origen: "Foto 1 · p. 1" }, { chunk_id: "c2", origen: "Foto 2" }]);
    expect(validos[1].ampliacion).toBe(true);
  });
  it("puede prohibir ampliaciones (p. ej. en flashcards)", () => {
    const { validos } = validarCitas([{ texto: "x", fuentes: [], ampliacion: true }], mapa, { permitirAmpliaciones: false });
    expect(validos).toHaveLength(0);
  });
});

describe("progreso y nota estimada", () => {
  const ahora = new Date("2026-10-10T12:00:00Z");
  const temas = [{ id: "a", titulo: "Tema A" }, { id: "b", titulo: "Tema B" }];
  const res = [
    ...Array.from({ length: 10 }, (_, i) => ({ topic_id: "a", correcta: i < 9, fecha: "2026-10-09T10:00:00Z" })),
    ...Array.from({ length: 10 }, (_, i) => ({ topic_id: "b", correcta: i < 3, fecha: "2026-10-09T10:00:00Z", enunciado: "¿Qué es la fotosíntesis?" })),
  ];
  it("calcula el dominio por tema y recomienda repasar el más flojo", () => {
    const dom = dominioPorTema(temas, res, [], ahora);
    expect(dom[0].dominio).toBeCloseTo(0.9);
    expect(dom[1].dominio).toBeCloseTo(0.3);
    const recs = recomendaciones(dom, res, 4);
    expect(recs[0].texto).toMatch(/Tema B/);
    expect(recs[0].texto).toMatch(/fotosíntesis/);
    expect(recs.some((r) => /4 flashcards/.test(r.texto))).toBe(true);
  });
  it("la nota estimada combina temas y simulacros y se presenta como orientativa", () => {
    const dom = dominioPorTema(temas, res, [], ahora);
    const sinSim = notaEstimada(dom, { a: 1, b: 1 }, [], ahora);
    expect(sinSim.nota).toBeCloseTo(6, 0);
    const conSim = notaEstimada(dom, { a: 1, b: 1 }, [{ nota: 8, fecha: "2026-10-09T10:00:00Z" }], ahora);
    expect(conSim.nota!).toBeGreaterThan(sinSim.nota!);
    expect(conSim.explicacion).toMatch(/orientativa/);
    expect(notaEstimada([], {}, [], ahora).nota).toBeNull();
  });
  it("racha: un día de descanso no la rompe; dos sí", () => {
    const r = { actual: 5, mejor: 5, ultimo_dia: "2026-10-07", descansos: [] };
    expect(rachaVigente(r, "2026-10-08").dias).toBe(5);
    expect(rachaVigente(r, "2026-10-09").dias).toBe(5); // ayer fue descanso
    expect(rachaVigente(r, "2026-10-10").dias).toBe(0);
    expect(rachaVigente({ ...r, descansos: [semanaISO("2026-10-08")] }, "2026-10-09").dias).toBe(0);
  });
});

describe("fechas", () => {
  it("suma días y calcula semanas ISO", () => {
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(semanaISO("2026-10-05")).toBe("2026-W41");
    expect(semanaISO("2027-01-01")).toBe("2026-W53");
  });
  it("cuenta atrás", () => {
    const c = cuentaAtras("2026-10-02T12:30:00Z", new Date("2026-10-01T10:00:00Z"));
    expect(c).toMatchObject({ pasado: false, dias: 1, horas: 2, minutos: 30 });
  });
});

describe("mejora de fotos", () => {
  // Imagen sintética: hoja blanca sobre fondo oscuro con líneas de texto inclinadas
  function sintetica(grados: number, ancho = 400, alto = 500): Gris {
    const data = new Uint8ClampedArray(ancho * alto).fill(40);
    const x0 = 60, y0 = 50, x1 = 340, y1 = 450;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * ancho + x] = 235;
    const tan = Math.tan((grados * Math.PI) / 180);
    for (let linea = 90; linea < 420; linea += 22) {
      for (let x = x0 + 20; x < x1 - 20; x++) {
        const y = Math.round(linea + (x - ancho / 2) * tan);
        for (let g = 0; g < 4; g++) if (y + g > y0 && y + g < y1 && (x % 9) < 7) data[(y + g) * ancho + x] = 20;
      }
    }
    return { data, width: ancho, height: alto };
  }
  it("detecta la hoja para recortar el fondo", () => {
    const c = detectarHoja(sintetica(0))!;
    expect(c).not.toBeNull();
    expect(Math.abs(c.x - 60)).toBeLessThanOrEqual(8);
    expect(Math.abs(c.y - 50)).toBeLessThanOrEqual(8);
    expect(Math.abs(c.w - 280)).toBeLessThanOrEqual(12);
  });
  it("estima la inclinación del texto", () => {
    const g = sintetica(4);
    const hoja = detectarHoja(g)!;
    const rec = new Uint8ClampedArray(hoja.w * hoja.h);
    for (let y = 0; y < hoja.h; y++) for (let x = 0; x < hoja.w; x++) rec[y * hoja.w + x] = g.data[(y + hoja.y) * g.width + x + hoja.x];
    expect(estimarInclinacion({ data: rec, width: hoja.w, height: hoja.h })).toBeCloseTo(4, 0);
    expect(Math.abs(estimarInclinacion(sintetica(0)))).toBeLessThanOrEqual(0.5);
  });
  it("calcula percentiles para el contraste", () => {
    const [p0, p1] = percentiles(sintetica(0));
    expect(p0).toBeLessThan(50);
    expect(p1).toBeGreaterThan(200);
  });
});

import { normalizarUrlSupabase } from "../../src/lib/urlSupabase";
describe("URL de Supabase mal pegada", () => {
  it("se corrige sola", () => {
    for (const u of ["https://abc123.supabase.co", "https://abc123.supabase.co/", " https://abc123.supabase.co/rest/v1/ ", '"https://abc123.supabase.co"', "abc123.supabase.co", "https://supabase.com/dashboard/project/abc123/settings/api"]) {
      expect(normalizarUrlSupabase(u)).toBe("https://abc123.supabase.co");
    }
  });
});
