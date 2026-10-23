import { describe, expect, it } from 'vitest';
import { FORMATOS } from '../../config/formatos';
import { agregar, filasHist, fusionar, lineasHandicap, lineasOverUnder, mediaHist, totalHist } from '../agregacion';
import { errorDeCoherencia } from '../coherencia';
import { nuevoRating } from '../elo';
import { componentesSaque, I, parametrosPartido, PARAMS_POR_DEFECTO, vectorVacio, type PerfilMinimo } from '../modelo';
import { simularLote } from '../motor';
import { tiebreaksDelMarcador } from '../perfiles';
import { ANCHO, R, type ParametrosSaque } from '../tipos';

const s = (p: number): ParametrosSaque => ({ pPrimerDentro: 0.62, pAce1: 0.1, pGana1: p + 0.08, pSegundoDentro: 0.92, pAce2: 0.02, pGana2: p - 0.12 });
const params = { a: s(0.66), b: s(0.62), sigma: 0.15, sigmaAces: 0.3 };

describe('agregación', () => {
  const f = FORMATOS.BO3_TB7;
  const o = simularLote(params, f, 4000, 21);
  const r = agregar([o], f, (x, off) => errorDeCoherencia(x, off, f));

  it('cuenta todas las simulaciones en cada distribución', () => {
    expect(r.n).toBe(4000);
    expect(r.incoherentes).toBe(0);
    expect(totalHist(r.juegosTotales)).toBe(4000);
    expect(totalHist(r.numSets)).toBe(4000);
    expect(r.resultadoSets.reduce((a, x) => a + x.veces, 0)).toBe(4000);
    expect(r.marcadores.reduce((a, x) => a + x.veces, 0)).toBe(4000);
    expect(totalHist(r.jugadores[0].aces)).toBe(4000);
  });

  it('ordena de mayor a menor frecuencia', () => {
    for (const l of [r.resultadoSets, r.marcadores, r.porSet[0].marcadores, filasHist(r.juegosTotales)]) {
      for (let i = 1; i < l.length; i++) expect(l[i - 1].veces).toBeGreaterThanOrEqual(l[i].veces);
    }
  });

  it('resultado en sets coherente con el ganador y con el número de sets', () => {
    const ganaA = r.resultadoSets.filter((x) => x.clave === '2-0' || x.clave === '2-1').reduce((a, x) => a + x.veces, 0);
    expect(ganaA).toBe(r.victoriasA);
    const tres = r.resultadoSets.filter((x) => x.clave.includes('1')).reduce((a, x) => a + x.veces, 0);
    expect(tres).toBe(r.numSets.cuentas[3 - r.numSets.min]);
  });

  it('la suma de juegos por jugador coincide con el total', () => {
    expect(mediaHist(r.jugadores[0].juegos) + mediaHist(r.jugadores[1].juegos)).toBeCloseTo(mediaHist(r.juegosTotales), 8);
    expect(mediaHist(r.jugadores[0].juegos) - mediaHist(r.jugadores[1].juegos)).toBeCloseTo(mediaHist(r.diferenciaJuegos), 8);
  });

  it('breaks de un jugador = juegos al saque perdidos del otro', () => {
    expect(r.jugadores[0].breaks).toEqual(r.jugadores[1].juegosSaquePerdidos);
    expect(r.jugadores[1].breaks).toEqual(r.jugadores[0].juegosSaquePerdidos);
  });

  it('over/under: over + under + nulo = total y over decrece con la línea', () => {
    const l = lineasOverUnder(r.juegosTotales, 6);
    expect(l.length).toBeGreaterThan(10);
    let prev = Infinity;
    for (const x of l) {
      expect(x.over + x.under + x.push).toBe(4000);
      if (!Number.isInteger(x.linea)) expect(x.push).toBe(0);
      expect(x.over).toBeLessThanOrEqual(prev);
      prev = x.over;
    }
  });

  it('hándicap: −0,5 de juegos equivale a ganar más juegos', () => {
    const h = lineasHandicap(r.diferenciaJuegos, 10).find((x) => x.linea === -0.5)!;
    let mas = 0;
    r.diferenciaJuegos.cuentas.forEach((v, i) => {
      if (r.diferenciaJuegos.min + i > 0) mas += v;
    });
    expect(h.ganaA).toBe(mas);
  });

  it('fusionar partes da lo mismo que agregar todo junto', () => {
    const o1 = simularLote(params, f, 1500, 5);
    const o2 = simularLote(params, f, 2500, 6);
    const junto = agregar([o1, o2], f);
    const partes = fusionar([agregar([o1], f), agregar([o2], f)]);
    expect(partes.n).toBe(junto.n);
    expect(partes.victoriasA).toBe(junto.victoriasA);
    expect(partes.juegosTotales).toEqual(junto.juegosTotales);
    expect(partes.marcadores).toEqual(junto.marcadores);
    expect(partes.jugadores[1].aces).toEqual(junto.jugadores[1].aces);
    expect(partes.porSet[2].marcadores).toEqual(junto.porSet[2].marcadores);
  });

  it('remontadas y "sin perder el saque" coinciden con los registros', () => {
    let rem = 0;
    let sinPerder = 0;
    for (let i = 0; i < 4000; i++) {
      const off = i * ANCHO;
      const g = o[off + R.GANADOR];
      const primero = o[off + R.SETS] > o[off + R.SETS + 1] ? 0 : 1;
      if (g === 0 && primero === 1) rem++;
      if (g === 0 && o[off + R.BREAKS + 1] === 0) sinPerder++;
    }
    expect(r.jugadores[0].remontadas).toBe(rem);
    expect(r.jugadores[0].sinPerderSaque).toBe(sinPerder);
  });
});

describe('modelo', () => {
  const perfil = (g: number, svpt = 0, exS = 0): PerfilMinimo => {
    const e = nuevoRating();
    e.g = g;
    e.s = { dura: g, tierra: g, hierba: g };
    const v = vectorVacio();
    v[I.svpt] = svpt;
    v[I.exS] = exS;
    return { pool: 'M', elo: e, stats: { todas: [...v], dura: [...v], tierra: vectorVacio(), hierba: vectorVacio() }, nReal: { todas: svpt ? 40 : 0, dura: svpt ? 40 : 0, tierra: 0, hierba: 0 }, forma: 0 };
  };

  it('componentes del saque reproducen la probabilidad total', () => {
    for (const p of [0.5, 0.6, 0.7, 0.8]) {
      const c = componentesSaque(p, 0.62, 0.72, 0.55, 0.08, 0.09, 0.15);
      const total = c.pPrimerDentro * c.pGana1 + (1 - c.pPrimerDentro) * c.pSegundoDentro * c.pGana2;
      expect(total).toBeCloseTo(p, 5);
      expect(c.pAce1).toBeLessThan(c.pGana1);
    }
  });

  it('la probabilidad final reproduce el objetivo combinado al mejor de 3', () => {
    const { detalle } = parametrosPartido(perfil(1900), perfil(1700), { superficie: 'dura', circuito: 'ATP', formato: FORMATOS.BO3_TB7 }, PARAMS_POR_DEFECTO);
    expect(detalle.pFormato).toBeCloseTo(detalle.pObjetivoBo3, 4);
    expect(detalle.pFormato).toBeGreaterThan(0.5);
  });

  it('al mejor de 5 el favorito tiene más probabilidad que al mejor de 3', () => {
    const ctx = { superficie: 'dura' as const, circuito: 'ATP' as const };
    const b3 = parametrosPartido(perfil(1900), perfil(1700), { ...ctx, formato: FORMATOS.BO3_TB7 }, PARAMS_POR_DEFECTO).detalle.pFormato;
    const b5 = parametrosPartido(perfil(1900), perfil(1700), { ...ctx, formato: FORMATOS.BO5_TB10 }, PARAMS_POR_DEFECTO).detalle.pFormato;
    expect(b5).toBeGreaterThan(b3);
  });

  it('un gran sacador (exceso de saque) gana más puntos al saque pero no cambia el favorito Elo', () => {
    const ctx = { superficie: 'dura' as const, circuito: 'ATP' as const, formato: FORMATOS.BO3_TB7 };
    const normal = parametrosPartido(perfil(1800), perfil(1800), ctx, PARAMS_POR_DEFECTO).detalle;
    const sacador = parametrosPartido(perfil(1800, 5000, 400), perfil(1800), ctx, PARAMS_POR_DEFECTO).detalle;
    expect(sacador.pSaqueA).toBeGreaterThan(normal.pSaqueA);
    expect(sacador.estA.estimado).toBe(false);
    expect(normal.estA.estimado).toBe(true);
  });

  it('la simulación con los parámetros del modelo reproduce la probabilidad exacta', () => {
    const { params: p, detalle } = parametrosPartido(perfil(1950), perfil(1750), { superficie: 'tierra', circuito: 'ATP', formato: FORMATOS.BO5_TB10 }, PARAMS_POR_DEFECTO);
    const n = 30000;
    const o = simularLote(p, FORMATOS.BO5_TB10, n, 9);
    let ga = 0;
    for (let i = 0; i < n; i++) if (o[i * ANCHO] === 0) ga++;
    // El motor aplica la variabilidad a primer y segundo saque por separado: tolerancia 1,5 puntos.
    expect(Math.abs(ga / n - detalle.pFormato)).toBeLessThan(0.015);
  });

  it('tie-breaks del marcador', () => {
    expect(tiebreaksDelMarcador('7-6(4) 6-7(5) 6-3')).toEqual([1, 1]);
    expect(tiebreaksDelMarcador('6-4 7-6(10)')).toEqual([1, 0]);
    expect(tiebreaksDelMarcador('6-3 2-1 RET')).toEqual([0, 0]);
  });
});
