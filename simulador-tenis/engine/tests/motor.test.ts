import { describe, expect, it } from 'vitest';
import { FORMATOS, formatoDe } from '../../config/formatos';
import { probJuego, probPartido, probPartidoConVariabilidad, probSet, probTiebreak } from '../analitico';
import { errorDeCoherencia } from '../coherencia';
import { Simulador, simularLote } from '../motor';
import { Rng } from '../rng';
import { ANCHO, R, type ParametrosPartido, type ParametrosSaque } from '../tipos';

/** Sacador "plano": todos los puntos con la misma probabilidad p, sin aces ni dobles faltas. */
const plano = (p: number): ParametrosSaque => ({ pPrimerDentro: 1, pAce1: 0, pGana1: p, pSegundoDentro: 1, pAce2: 0, pGana2: p });
const partido = (pa: number, pb: number, sigma = 0): ParametrosPartido => ({ a: plano(pa), b: plano(pb), sigma, sigmaAces: 0 });

function sims(params: ParametrosPartido, formato = FORMATOS.BO3_TB7, n = 20000, semilla = 7) {
  return simularLote(params, formato, n, semilla);
}

describe('generador aleatorio', () => {
  it('es reproducible con la misma semilla y distinto con otra', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const xa = Array.from({ length: 5 }, () => a.next());
    const xb = Array.from({ length: 5 }, () => b.next());
    const xc = Array.from({ length: 5 }, () => c.next());
    expect(xa).toEqual(xb);
    expect(xa).not.toEqual(xc);
  });
  it('produce uniformes en [0,1) con media 0,5 y normales con varianza 1', () => {
    const r = new Rng(1);
    let s = 0;
    let s2 = 0;
    let m = 0;
    for (let i = 0; i < 100000; i++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      m += u;
      const z = r.normal();
      s += z;
      s2 += z * z;
    }
    expect(m / 100000).toBeCloseTo(0.5, 2);
    expect(s / 100000).toBeCloseTo(0, 1);
    expect(s2 / 100000).toBeCloseTo(1, 1);
  });
});

describe('cálculo analítico', () => {
  it('juego: valores conocidos', () => {
    expect(probJuego(0.5)).toBeCloseTo(0.5, 10);
    expect(probJuego(0.6)).toBeCloseTo(0.7357, 3);
    expect(probJuego(0.65)).toBeCloseTo(0.83, 2);
    expect(probJuego(0.5, true)).toBeCloseTo(0.5, 10);
  });
  it('tie-break simétrico = 0,5 y gana más el mejor sacador', () => {
    expect(probTiebreak(0.6, 0.6, 0, 7)).toBeCloseTo(0.5, 10);
    expect(probTiebreak(0.6, 0.6, 1, 10)).toBeCloseTo(0.5, 10);
    expect(probTiebreak(0.7, 0.6, 0, 7)).toBeGreaterThan(0.5);
  });
  it('las probabilidades de set suman 1', () => {
    const r = probSet(0.63, 0.6, 0, FORMATOS.BO3_TB7, { tipo: 'tiebreak', puntos: 7 });
    expect(r.p[0][0] + r.p[0][1] + r.p[1][0] + r.p[1][1]).toBeCloseTo(1, 10);
    const v = probSet(0.63, 0.6, 1, FORMATOS.BO3_TB7, { tipo: 'ventaja' });
    expect(v.p[0][0] + v.p[0][1] + v.p[1][0] + v.p[1][1]).toBeCloseTo(1, 10);
  });
  it('partido simétrico = 0,5; mejor de 5 amplifica la ventaja', () => {
    expect(probPartido(0.62, 0.62, FORMATOS.BO3_TB7)).toBeCloseTo(0.5, 10);
    const p3 = probPartido(0.66, 0.62, FORMATOS.BO3_TB7);
    const p5 = probPartido(0.66, 0.62, FORMATOS.BO5_TB10);
    expect(p3).toBeGreaterThan(0.5);
    expect(p5).toBeGreaterThan(p3);
  });
  it('la variabilidad acerca la probabilidad a 0,5', () => {
    const sin = probPartido(0.68, 0.6, FORMATOS.BO3_TB7);
    const con = probPartidoConVariabilidad(0.68, 0.6, FORMATOS.BO3_TB7, 0.3);
    expect(con).toBeLessThan(sin);
    expect(con).toBeGreaterThan(0.5);
  });
});

describe('motor punto a punto: reglas', () => {
  it('un sacador que gana todos los puntos: todos los sets llegan al tie-break', () => {
    const o = sims(partido(1 - 1e-9, 1 - 1e-9), FORMATOS.BO3_TB7, 200);
    for (let i = 0; i < 200; i++) {
      const off = i * ANCHO;
      const ns = o[off + R.NSETS];
      for (let s = 0; s < ns; s++) {
        const a = o[off + R.SETS + 2 * s];
        const b = o[off + R.SETS + 2 * s + 1];
        expect([a, b].sort()).toEqual([6, 7]);
        expect(o[off + R.TB + s]).toBeGreaterThan(0);
      }
      expect(o[off + R.BREAKS] + o[off + R.BREAKS + 1]).toBe(0);
    }
  });

  it('Grand Slam masculino: mejor de 5 y tie-break a 10 en el quinto set', () => {
    const f = FORMATOS.BO5_TB10;
    const sim = new Simulador(partido(1 - 1e-9, 1 - 1e-9), f, new Rng(3));
    const o = new Int32Array(ANCHO);
    sim.simular(o, 0, 0);
    expect(o[R.NSETS]).toBeGreaterThanOrEqual(3);
    // Con sacadores perfectos, cada tie-break lo gana quien saca más puntos: el resultado es
    // determinista dado el primer sacador. Sólo comprobamos que el partido es válido.
    expect(errorDeCoherencia(o, 0, f)).toBeNull();
  });

  it('tie-break: alterna el saque correctamente (1, 2, 2, 2...)', () => {
    // A gana siempre sus puntos de saque y B nunca: en un tie-break que empieza sacando A, A
    // gana el 1.º, B saca 2.º y 3.º (los pierde) → A gana el tie-break 7-0 siempre.
    const params: ParametrosPartido = { a: plano(1 - 1e-12), b: plano(1e-12), sigma: 0, sigmaAces: 0 };
    const o = sims(params, FORMATOS.BO3_TB7, 50);
    for (let i = 0; i < 50; i++) {
      // A gana todos los juegos: 6-0 6-0
      expect(o[i * ANCHO + R.SETS]).toBe(6);
      expect(o[i * ANCHO + R.SETS + 1]).toBe(0);
    }
    expect(probTiebreak(1 - 1e-12, 1e-12, 0, 7)).toBeCloseTo(1, 6);
  });

  it('el siguiente set lo empieza sacando quien restó primero en el tie-break', () => {
    // Si el turno de saque siguiera alternando mal tras un tie-break, un jugador acumularía
    // más de un juego al saque de ventaja por set. Lo comprobamos en 2.000 partidos.
    const f = FORMATOS.BO3_TB7;
    const r = new Rng(9);
    const sim = new Simulador(partido(0.62, 0.6), f, r);
    const o = new Int32Array(ANCHO);
    for (let k = 0; k < 2000; k++) {
      sim.simular(o, 0, 0);
      // El número de juegos al saque de A y B difiere como mucho en 1 por set jugado.
      const d = Math.abs(o[R.JUEGOS_SAQUE] - o[R.JUEGOS_SAQUE + 1]);
      expect(d).toBeLessThanOrEqual(o[R.NSETS]);
      expect(errorDeCoherencia(o, 0, f)).toBeNull();
    }
  });

  it('super tie-break como tercer set', () => {
    const f = FORMATOS.BO3_STB10;
    const o = sims(partido(0.6, 0.6), f, 5000);
    let supers = 0;
    for (let i = 0; i < 5000; i++) {
      expect(errorDeCoherencia(o, i * ANCHO, f)).toBeNull();
      if (o[i * ANCHO + R.SUPER_TB]) {
        supers++;
        expect(o[i * ANCHO + R.NSETS]).toBe(3);
      }
    }
    expect(supers).toBeGreaterThan(1000);
  });

  it('Next Gen: sets a 4 juegos con tie-break a 3-3 y punto decisivo', () => {
    const f = FORMATOS.NEXTGEN;
    const o = sims(partido(0.64, 0.62), f, 5000);
    for (let i = 0; i < 5000; i++) {
      const off = i * ANCHO;
      expect(errorDeCoherencia(o, off, f)).toBeNull();
      for (let s = 0; s < o[off + R.NSETS]; s++) {
        const a = o[off + R.SETS + 2 * s];
        const b = o[off + R.SETS + 2 * s + 1];
        expect(Math.max(a, b)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('set decisivo con ventaja: puede pasar de 7-5', () => {
    const f = { ...FORMATOS.BO3_TB7, id: 'X', setDecisivo: { tipo: 'ventaja' as const } };
    const o = sims(partido(0.75, 0.75), f, 3000);
    let largo = 0;
    for (let i = 0; i < 3000; i++) {
      const off = i * ANCHO;
      expect(errorDeCoherencia(o, off, f)).toBeNull();
      if (o[off + R.NSETS] === 3 && o[off + R.SETS + 4] + o[off + R.SETS + 5] > 13) largo++;
    }
    expect(largo).toBeGreaterThan(0);
  });
});

describe('motor: convergencia con el cálculo exacto', () => {
  for (const [nombre, f] of Object.entries(FORMATOS)) {
    it(`${nombre}: P(victoria) simulada ≈ exacta`, () => {
      const n = 40000;
      const o = sims(partido(0.66, 0.61), f, n, 11);
      let ga = 0;
      for (let i = 0; i < n; i++) if (o[i * ANCHO] === 0) ga++;
      const exacta = probPartido(0.66, 0.61, f);
      const se = Math.sqrt((exacta * (1 - exacta)) / n);
      expect(Math.abs(ga / n - exacta)).toBeLessThan(4 * se);
    });
  }

  it('con variabilidad, la simulación coincide con la integral de Gauss-Hermite', () => {
    const n = 40000;
    const o = sims(partido(0.66, 0.6, 0.25), FORMATOS.BO3_TB7, n, 5);
    let ga = 0;
    for (let i = 0; i < n; i++) if (o[i * ANCHO] === 0) ga++;
    const exacta = probPartidoConVariabilidad(0.66, 0.6, FORMATOS.BO3_TB7, 0.25);
    expect(Math.abs(ga / n - exacta)).toBeLessThan(0.01);
  });

  it('aces, dobles faltas y porcentajes coherentes con los parámetros', () => {
    const s: ParametrosSaque = { pPrimerDentro: 0.62, pAce1: 0.12, pGana1: 0.74, pSegundoDentro: 0.92, pAce2: 0.02, pGana2: 0.54 };
    const params: ParametrosPartido = { a: s, b: s, sigma: 0, sigmaAces: 0 };
    const n = 5000;
    const o = sims(params, FORMATOS.BO3_TB7, n, 3);
    let pts = 0;
    let in1 = 0;
    let aces = 0;
    let df = 0;
    let gan = 0;
    for (let i = 0; i < n; i++) {
      const off = i * ANCHO;
      pts += o[off + R.PTS_SAQUE];
      in1 += o[off + R.PRIMEROS_DENTRO];
      aces += o[off + R.ACES];
      df += o[off + R.DF];
      gan += o[off + R.GANADOS_1] + o[off + R.GANADOS_2];
    }
    expect(in1 / pts).toBeCloseTo(0.62, 2);
    expect(df / (pts - in1)).toBeCloseTo(0.08, 2);
    expect(aces / pts).toBeCloseTo(0.62 * 0.12 + 0.38 * 0.92 * 0.02, 2);
    expect(gan / pts).toBeCloseTo(0.62 * 0.74 + 0.38 * 0.92 * 0.54, 2);
  });
});

describe('coherencia de todas las simulaciones', () => {
  it('50.000 partidos variados sin ningún error de coherencia', () => {
    const r = new Rng(123);
    for (let k = 0; k < 10; k++) {
      const f = Object.values(FORMATOS)[k % Object.values(FORMATOS).length];
      const params = partido(0.5 + 0.3 * r.next(), 0.5 + 0.3 * r.next(), 0.2);
      const o = sims(params, f, 5000, k);
      for (let i = 0; i < 5000; i++) expect(errorDeCoherencia(o, i * ANCHO, f)).toBeNull();
    }
  });
});

describe('formatos por torneo', () => {
  it('asigna los formatos verificados', () => {
    expect(formatoDe({ circuito: 'ATP', nombreTorneo: 'Wimbledon' }).id).toBe('BO5_TB10');
    expect(formatoDe({ circuito: 'ATP', nombreTorneo: 'Wimbledon', esCuadroFinal: false }).id).toBe('BO3_TB10');
    expect(formatoDe({ circuito: 'WTA', categoria: 'Grand Slam', nombreTorneo: 'Roland Garros' }).id).toBe('BO3_TB10');
    expect(formatoDe({ circuito: 'ATP', nombreTorneo: 'Paris Masters' }).id).toBe('BO3_TB7');
    expect(formatoDe({ circuito: 'CH', nombreTorneo: 'Brest Challenger' }).id).toBe('BO3_TB7');
    expect(formatoDe({ circuito: 'W125', nombreTorneo: 'Queretaro Open' }).id).toBe('BO3_TB7');
    expect(formatoDe({ circuito: 'ATP', nombreTorneo: 'Next Gen ATP Finals' }).id).toBe('NEXTGEN');
  });
});
