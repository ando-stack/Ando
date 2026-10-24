import { describe, expect, it } from "vitest";
import {
  FACTOR,
  PESOS_FSRS5,
  ajustarAExamen,
  colaDelDia,
  dificultadInicial,
  estabilidadInicial,
  formatearIntervalo,
  intervaloOptimo,
  recuperabilidad,
  repasar,
  tarjetaNueva,
  type Calificacion,
  type TarjetaCola,
} from "../../src/lib/fsrs";

const DIA = 86_400_000;
const t0 = new Date("2026-10-01T10:00:00Z");
const masDias = (d: Date, n: number) => new Date(d.getTime() + n * DIA);

describe("fórmulas de FSRS-5", () => {
  it("FACTOR = 19/81 y R(S, S) = 0,9 por definición de estabilidad", () => {
    expect(FACTOR).toBeCloseTo(19 / 81, 10);
    for (const s of [0.5, 1, 7, 30, 365]) expect(recuperabilidad(s, s)).toBeCloseTo(0.9, 10);
    expect(recuperabilidad(0, 5)).toBe(1);
  });

  it("con retención 0,9 el intervalo óptimo es igual a la estabilidad", () => {
    for (const s of [1, 3.17, 15.7, 100]) expect(intervaloOptimo(s, 0.9)).toBeCloseTo(s, 8);
    // Mayor retención deseada → intervalos más cortos
    expect(intervaloOptimo(10, 0.95)).toBeLessThan(intervaloOptimo(10, 0.85));
  });

  it("estabilidad y dificultad iniciales siguen los pesos por defecto", () => {
    expect(estabilidadInicial(1)).toBeCloseTo(PESOS_FSRS5[0]);
    expect(estabilidadInicial(4)).toBeCloseTo(PESOS_FSRS5[3]);
    // D0(G) = w4 − e^(w5·(G−1)) + 1
    expect(dificultadInicial(1)).toBeCloseTo(PESOS_FSRS5[4]);
    expect(dificultadInicial(3)).toBeCloseTo(PESOS_FSRS5[4] - Math.exp(PESOS_FSRS5[5] * 2) + 1, 8);
    expect(dificultadInicial(1)).toBeGreaterThan(dificultadInicial(4));
  });
});

describe("programación de repasos", () => {
  it("una tarjeta nueva con 'Bien' pasa a repaso en ~3 días (S0 = 3,17)", () => {
    const r = repasar(tarjetaNueva(t0), 3, t0);
    expect(r.tarjeta.estado).toBe("repaso");
    expect(r.intervaloDias).toBe(3);
    expect(new Date(r.tarjeta.vence).getTime() - t0.getTime()).toBe(3 * DIA);
    expect(r.tarjeta.repeticiones).toBe(1);
  });

  it("'Otra vez' en una nueva la vuelve a mostrar en minutos y cuenta como fallo", () => {
    const r = repasar(tarjetaNueva(t0), 1, t0);
    expect(r.tarjeta.estado).toBe("aprendiendo");
    expect(r.intervaloDias * 24 * 60).toBeCloseTo(1);
    expect(r.tarjeta.fallos).toBe(1);
  });

  it("los intervalos crecen con aciertos sucesivos", () => {
    let c = repasar(tarjetaNueva(t0), 3, t0);
    let ahora = t0;
    const intervalos: number[] = [c.intervaloDias];
    for (let i = 0; i < 5; i++) {
      ahora = new Date(c.tarjeta.vence);
      c = repasar(c.tarjeta, 3, ahora);
      intervalos.push(c.intervaloDias);
    }
    for (let i = 1; i < intervalos.length; i++) expect(intervalos[i]).toBeGreaterThan(intervalos[i - 1]);
    // y la recuperabilidad en el momento del repaso ronda la retención deseada
    expect(c.recuperabilidad).toBeGreaterThan(0.85);
    expect(c.recuperabilidad).toBeLessThan(0.95);
  });

  it("orden de los botones: Otra vez < Difícil < Bien < Fácil", () => {
    const base = repasar(tarjetaNueva(t0), 3, t0).tarjeta;
    const ahora = masDias(t0, 3);
    const iv = ([1, 2, 3, 4] as Calificacion[]).map((g) => repasar(base, g, ahora).intervaloDias);
    expect(iv[0]).toBeLessThan(iv[1]);
    expect(iv[1]).toBeLessThan(iv[2]);
    expect(iv[2]).toBeLessThan(iv[3]);
  });

  it("olvidar reduce la estabilidad y sube la dificultad", () => {
    const base = repasar(tarjetaNueva(t0), 3, t0).tarjeta;
    const fallo = repasar(base, 1, masDias(t0, 3));
    expect(fallo.tarjeta.estado).toBe("reaprendiendo");
    expect(fallo.tarjeta.estabilidad).toBeLessThan(base.estabilidad);
    expect(fallo.tarjeta.dificultad).toBeGreaterThan(base.dificultad);
    expect(fallo.intervaloDias * 24 * 60).toBeCloseTo(10);
    const recuperada = repasar(fallo.tarjeta, 3, new Date(fallo.tarjeta.vence));
    expect(recuperada.tarjeta.estado).toBe("repaso");
  });

  it("la dificultad se mantiene entre 1 y 10", () => {
    let c = repasar(tarjetaNueva(t0), 1, t0).tarjeta;
    let ahora = t0;
    for (let i = 0; i < 30; i++) {
      ahora = masDias(ahora, 1);
      c = repasar(c, 1, ahora).tarjeta;
    }
    expect(c.dificultad).toBeLessThanOrEqual(10);
    let e = repasar(tarjetaNueva(t0), 4, t0).tarjeta;
    for (let i = 0; i < 30; i++) e = repasar(e, 4, new Date(e.vence)).tarjeta;
    expect(e.dificultad).toBeGreaterThanOrEqual(1);
  });
});

describe("adaptación a la fecha del examen", () => {
  it("ningún repaso queda después del examen", () => {
    const examen = masDias(t0, 5).toISOString();
    let c = repasar(tarjetaNueva(t0), 4, t0, { fechaExamen: examen }); // Fácil: S0 ≈ 15,7 días
    expect(new Date(c.tarjeta.vence).getTime()).toBeLessThan(new Date(examen).getTime());
    expect(c.intervaloDias).toBe(4); // la víspera
    c = repasar(c.tarjeta, 4, new Date(c.tarjeta.vence), { fechaExamen: examen });
    expect(new Date(c.tarjeta.vence).getTime()).toBeLessThanOrEqual(new Date(examen).getTime());
  });

  it("con el examen en horas, programa el repaso a mitad de camino", () => {
    const examen = new Date(t0.getTime() + 12 * 3_600_000).toISOString();
    expect(ajustarAExamen(3, t0, examen) * 24).toBeCloseTo(6);
    // examen ya pasado: sin cambios
    expect(ajustarAExamen(10, t0, masDias(t0, -1).toISOString())).toBe(10);
  });

  it("la cola prioriza lo que más se olvida e intercala nuevas", () => {
    const mk = (id: string, diasDesde: number, s: number): TarjetaCola => ({
      id,
      estado: "repaso",
      estabilidad: s,
      dificultad: 5,
      ultima_revision: masDias(t0, -diasDesde).toISOString(),
      vence: masDias(t0, -1).toISOString(),
      repeticiones: 3,
      fallos: 0,
    });
    const nueva = (id: string): TarjetaCola => ({ ...tarjetaNueva(t0), id });
    const cola = colaDelDia([mk("casi_olvidada", 30, 2), mk("reciente", 2, 10), mk("media", 10, 5), mk("otra", 5, 5), nueva("n1")], t0, {
      nuevasMax: 5,
    });
    expect(cola[0].id).toBe("casi_olvidada");
    expect(cola.map((c) => c.id)).toContain("n1");
    expect(cola.findIndex((c) => c.id === "n1")).toBe(3);
  });

  it("en los 3 últimos días añade tarjetas que se olvidarían para el examen", () => {
    const examen = masDias(t0, 2).toISOString();
    const noVencida: TarjetaCola = {
      id: "fragil",
      estado: "repaso",
      estabilidad: 1,
      dificultad: 7,
      ultima_revision: masDias(t0, -0.5).toISOString(),
      vence: masDias(t0, 0.5).toISOString(),
      repeticiones: 2,
      fallos: 1,
    };
    expect(colaDelDia([noVencida], t0).length).toBe(0);
    expect(colaDelDia([noVencida], t0, { fechaExamen: examen }).map((c) => c.id)).toEqual(["fragil"]);
  });

  it("formatea intervalos de forma legible", () => {
    expect(formatearIntervalo(1 / 1440)).toBe("1 min");
    expect(formatearIntervalo(0.25)).toBe("6 h");
    expect(formatearIntervalo(3)).toBe("3 d");
    expect(formatearIntervalo(60)).toBe("2 meses");
  });
});
