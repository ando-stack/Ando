import { describe, expect, it } from "vitest";
import { generarPlan, minutosEstudioTema, necesitaReajuste, type EntradaPlan } from "../../src/lib/plan";
import { diaSemana } from "../../src/lib/fechas";

const temas = [
  { id: "t1", titulo: "Tema 1", palabras: 1400, dominio: 0 },
  { id: "t2", titulo: "Tema 2", palabras: 2100, dominio: 0 },
  { id: "t3", titulo: "Tema 3", palabras: 1000, dominio: 0 },
];
const cadaDia = (min: number) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), min]));

const base: EntradaPlan = {
  hoy: "2026-10-05", // lunes
  fechaExamen: "2026-10-19T09:00:00",
  disponibilidad: cadaDia(90),
  notaObjetivo: 7,
  nivelActual: "medio",
  duracionExamenMin: 60,
  temas,
};

describe("plan de estudio", () => {
  it("cubre todos los días hasta la víspera, sin tareas después del examen", () => {
    const { dias } = generarPlan(base);
    expect(dias.length).toBe(14);
    expect(dias[0].fecha).toBe("2026-10-05");
    expect(dias.at(-1)!.fecha).toBe("2026-10-18");
  });

  it("nunca supera los minutos disponibles de cada día", () => {
    const { dias } = generarPlan({ ...base, disponibilidad: { ...cadaDia(45), "6": 120, "0": 0 } });
    for (const d of dias) {
      const total = d.tareas.reduce((a, t) => a + t.minutos, 0);
      expect(total).toBeLessThanOrEqual(d.minutos_disponibles);
      if (diaSemana(d.fecha) === 0) expect(d.fase).toBe("descanso");
    }
  });

  it("estudia todos los temas antes del repaso final y deja los últimos días para repasar", () => {
    const { dias, viabilidad } = generarPlan(base);
    expect(viabilidad.alcanzable).toBe(true);
    const finales = dias.slice(-2);
    expect(finales.every((d) => d.fase === "repaso_final")).toBe(true);
    for (const d of finales) expect(d.tareas.some((t) => t.tipo === "estudio")).toBe(false);
    for (const t of temas) {
      const ultimaParte = dias.findLastIndex((d) => d.tareas.some((x) => x.tipo === "estudio" && x.topic_id === t.id));
      expect(ultimaParte).toBeGreaterThanOrEqual(0);
      expect(ultimaParte).toBeLessThan(dias.length - 2);
    }
  });

  it("incluye simulacros en la fase de práctica y tests espaciados después de estudiar", () => {
    const { dias } = generarPlan(base);
    const simulacros = dias.filter((d) => d.tareas.some((t) => t.tipo === "simulacro"));
    expect(simulacros.length).toBe(2); // nota 7 → 2 simulacros
    const iEstudioT1 = dias.findLastIndex((d) => d.tareas.some((t) => t.tipo === "estudio" && t.topic_id === "t1"));
    const iTestT1 = dias.findIndex((d) => d.tareas.some((t) => t.tipo === "test" && t.topic_id === "t1"));
    expect(iTestT1).toBeGreaterThan(iEstudioT1); // espaciado: no el mismo día
    expect(dias.some((d) => d.tareas.some((t) => t.id.startsWith("test:mixto")))).toBe(true); // intercalado
    expect(dias.slice(1).some((d) => d.tareas.some((t) => t.tipo === "flashcards"))).toBe(true);
  });

  it("más nota objetivo y menos nivel → más tiempo necesario", () => {
    const t = temas[0];
    expect(minutosEstudioTema(t, "bajo", 9)).toBeGreaterThan(minutosEstudioTema(t, "medio", 7));
    expect(minutosEstudioTema(t, "alto", 5)).toBeLessThan(minutosEstudioTema(t, "medio", 7));
    expect(minutosEstudioTema({ ...t, dominio: 0.8 }, "medio", 7)).toBeLessThan(minutosEstudioTema(t, "medio", 7));
    const a = generarPlan({ ...base, notaObjetivo: 9.5 }).viabilidad.minutos_necesarios;
    const b = generarPlan({ ...base, notaObjetivo: 6 }).viabilidad.minutos_necesarios;
    expect(a).toBeGreaterThan(b);
  });

  it("si no da tiempo, lo dice con tacto y propone ajustes concretos", () => {
    const { viabilidad } = generarPlan({ ...base, hoy: "2026-10-15", disponibilidad: cadaDia(30), notaObjetivo: 9.5, nivelActual: "bajo" });
    expect(viabilidad.alcanzable).toBe(false);
    expect(viabilidad.mensaje).toMatch(/no pasa nada/i);
    expect(viabilidad.mensaje).not.toMatch(/imposible|suspender|fracas/i);
    expect(viabilidad.sugerencias.length).toBeGreaterThanOrEqual(2);
    expect(viabilidad.sugerencias[0]).toMatch(/minutos más/);
  });

  it("se reajusta: lo ya estudiado no se vuelve a programar", () => {
    const completo = generarPlan(base);
    const minutosT1 = completo.dias.flatMap((d) => d.tareas).filter((t) => t.tipo === "estudio" && t.topic_id === "t1").reduce((a, t) => a + t.minutos, 0);
    const reajustado = generarPlan({ ...base, hoy: "2026-10-08", minutosEstudiados: { t1: minutosT1 }, testsHechos: { t1: 1 } });
    expect(reajustado.dias[0].fecha).toBe("2026-10-08");
    expect(reajustado.dias.flatMap((d) => d.tareas).some((t) => t.tipo === "estudio" && t.topic_id === "t1")).toBe(false);
    // t1 sigue teniendo sus tests de repaso pendientes
    expect(reajustado.dias.flatMap((d) => d.tareas).filter((t) => t.tipo === "test" && t.topic_id === "t1").length).toBe(1);
  });

  it("detecta días saltados y cuando va adelantado", () => {
    const { dias } = generarPlan(base);
    const hechas = new Set<string>();
    expect(necesitaReajuste(dias, hechas, "2026-10-07")).toBe("atrasado");
    dias[0].tareas.forEach((t) => hechas.add(t.id));
    dias[1].tareas.forEach((t) => hechas.add(t.id));
    expect(necesitaReajuste(dias, hechas, "2026-10-06")).toBeNull();
    dias[2].tareas.forEach((t) => hechas.add(t.id));
    expect(necesitaReajuste(dias, hechas, "2026-10-06")).toBe("adelantado");
  });

  it("si el examen es hoy, da un mensaje de ánimo", () => {
    const r = generarPlan({ ...base, hoy: "2026-10-19" });
    expect(r.dias.length).toBe(0);
    expect(r.viabilidad.mensaje).toMatch(/ánimo/);
  });
});
