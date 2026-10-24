/**
 * Calibración del modelo con la temporada 2024 (el backtest se hace después sobre 2025, que no
 * se usa para ajustar nada).  Uso: npm run calibrar
 *
 * 1) Probabilidad de victoria: búsqueda en rejilla del peso del Elo, del peso de la superficie en
 *    el Elo y del coeficiente de forma, minimizando el log loss (partidos al mejor de 3).
 * 2) Distribuciones: para cada circuito y superficie se simulan partidos de 2024 y se ajustan
 *    (a) el desplazamiento del saque para que coincidan los breaks por partido, (b) el factor de
 *    aces y (c) el de dobles faltas, para que las medias simuladas igualen las reales.
 * 3) Variabilidad partido a partido (σ) y de los aces (σ_aces): rejilla por log score del total
 *    de juegos y del total de aces.
 */
import { writeFileSync } from 'node:fs';
import { FORMATOS } from '../config/formatos';
import { probPartidoConVariabilidad } from '../engine/analitico';
import { probElo } from '../engine/elo';
import { claveCalibracion, estimarJugador, PARAMS_POR_DEFECTO, type CalibracionGrupo, type ParamsModelo } from '../engine/modelo';
import { cargarHistoricoCache } from './historico';
import { RUTA_CALIBRACION, construirParams, mediasDesde } from './ajuste';
import { muestrear, probValor, recolectar, simularCaso, type Caso } from './evaluacion';
import { dias, log } from './lib/util';

const TEMPORADA = Number(process.env.TEMPORADA_CALIBRACION ?? 2024);
const sigm = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));
const cl = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

function main() {
  const t0 = Date.now();
  const partidos = cargarHistoricoCache();
  log('Histórico', partidos.length);
  const base = construirParams({}, mediasDesde(partidos, dias(`${TEMPORADA - 3}-01-01`), dias(`${TEMPORADA}-01-01`)));
  const { casos, M: M0 } = recolectar(partidos, base, TEMPORADA, { desdeStats: dias(`${TEMPORADA - 2}-01-01`) });
  log(`Casos ${TEMPORADA}:`, casos.length, `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // ---------- 1) Probabilidad de victoria ----------
  const bo3 = casos.filter((c) => c.formato.mejorDe === 3);
  const comp = bo3.map((c) => {
    const eA = estimarJugador(c.A, c.sup, M0);
    const eB = estimarJugador(c.B, c.sup, M0);
    const m = M0.medias[c.pool][c.sup];
    const pA = Math.min(0.92, Math.max(0.3, m.saque + eA.exSaque - eB.exResto));
    const pB = Math.min(0.92, Math.max(0.3, m.saque + eB.exSaque - eA.exResto));
    return {
      y: c.real.ganaA ? 1 : 0,
      lEst: logit(cl(probPartidoConVariabilidad(pA, pB, FORMATOS.BO3_TB7, M0.sigma, M0.sigmaComun))),
      gA: c.A.elo.g,
      gB: c.B.elo.g,
      sA: c.A.elo.s[c.sup],
      sB: c.B.elo.s[c.sup],
      f: c.A.forma - c.B.forma,
    };
  });
  log('Componentes de victoria calculados', comp.length);
  let mejor = { w: 0.75, ps: 0.5, g: 0, k: 1, ll: Infinity };
  for (const ps of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    const lElo = comp.map((x) => logit(cl(probElo((1 - ps) * x.gA + ps * x.sA, (1 - ps) * x.gB + ps * x.sB))));
    for (const w of [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]) {
      for (const g of [0, 0.05, 0.1, 0.15, 0.25]) {
        for (const k of [0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2]) {
          let ll = 0;
          comp.forEach((x, i) => {
            const p = cl(sigm(k * (w * (lElo[i] + g * x.f) + (1 - w) * x.lEst)));
            ll -= x.y * Math.log(p) + (1 - x.y) * Math.log(1 - p);
          });
          ll /= comp.length;
          if (ll < mejor.ll) mejor = { w, ps, g, k, ll };
        }
      }
    }
  }
  log('Victoria: peso Elo', mejor.w, 'peso superficie', mejor.ps, 'forma', mejor.g, 'escala', mejor.k, 'log loss', mejor.ll.toFixed(4));

  // ---------- 2) y 3) Distribuciones ----------
  const M: ParamsModelo = { ...M0, pesoElo: mejor.w, pesoSuperficieElo: mejor.ps, gammaForma: mejor.g, escalaVictoria: mejor.k, calibracion: {} };
  const muestra = muestrear(casos, 1000, (c) => c.conStats);
  const grupos = [...new Set(muestra.map((c) => claveCalibracion(c.circuito, c.sup)))];
  for (const g of grupos) M.calibracion[g] = { saque: 0, aces: 1, dobles: 1, n: muestra.filter((c) => claveCalibracion(c.circuito, c.sup) === g).length };
  const S = 200;

  const evaluar = (Mx: ParamsModelo, casosG: Caso[]) => {
    let sim = { breaks: 0, aces: 0, dobles: 0, juegos: 0, tb: 0 };
    let real = { breaks: 0, aces: 0, dobles: 0, juegos: 0, tb: 0 };
    let lsJuegos = 0;
    let lsAces = 0;
    casosG.forEach((c, i) => {
      const s = simularCaso(c, Mx, S, 1000 + i);
      sim = { breaks: sim.breaks + s.mediaBreaks, aces: sim.aces + s.mediaAces, dobles: sim.dobles + s.mediaDobles, juegos: sim.juegos + s.mediaJuegos, tb: sim.tb + s.mediaTb };
      real = {
        breaks: real.breaks + (c.real.breaks ?? 0),
        aces: real.aces + (c.real.aces ?? 0),
        dobles: real.dobles + (c.real.dobles ?? 0),
        juegos: real.juegos + c.real.juegos,
        tb: real.tb + c.real.tiebreaks,
      };
      lsJuegos += Math.log(probValor(s.juegos, c.real.juegos, S));
      if (c.real.aces !== null) lsAces += Math.log(probValor(s.aces, c.real.aces, S));
    });
    const n = casosG.length || 1;
    return {
      sim: Object.fromEntries(Object.entries(sim).map(([k, v]) => [k, v / n])) as typeof sim,
      real: Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v / n])) as typeof real,
      lsJuegos: lsJuegos / n,
      lsAces: lsAces / n,
    };
  };

  const ajustarGrupos = (iter: number) => {
    for (let it = 0; it < iter; it++) {
      for (const g of grupos) {
        const cg = muestra.filter((c) => claveCalibracion(c.circuito, c.sup) === g);
        const e = evaluar(M, cg);
        const cal = M.calibracion[g] as CalibracionGrupo;
        // Breaks: más saque → menos breaks. Paso proporcional a la diferencia relativa.
        if (e.sim.breaks > 0 && e.real.breaks > 0) cal.saque += 0.35 * Math.log(e.sim.breaks / e.real.breaks);
        // Dominancia: más dominancia → partidos más desequilibrados → menos juegos (≈ −14 juegos por unidad).
        cal.sigma = Math.max(0.05, Math.min(0.5, (cal.sigma ?? M.sigma) + (e.sim.juegos - e.real.juegos) / 14));
        if (e.sim.aces > 0) cal.aces *= e.real.aces / e.sim.aces;
        if (e.sim.dobles > 0) cal.dobles *= e.real.dobles / e.sim.dobles;
        cal.saque = Math.max(-0.5, Math.min(0.5, cal.saque));
        cal.aces = Math.max(0.5, Math.min(2, cal.aces));
        cal.dobles = Math.max(0.5, Math.min(2, cal.dobles));
        log(`  ${g} it${it}: breaks ${e.sim.breaks.toFixed(2)}/${e.real.breaks.toFixed(2)} aces ${e.sim.aces.toFixed(2)}/${e.real.aces.toFixed(2)} df ${e.sim.dobles.toFixed(2)}/${e.real.dobles.toFixed(2)} juegos ${e.sim.juegos.toFixed(2)}/${e.real.juegos.toFixed(2)} → saque ${cal.saque.toFixed(3)} aces×${cal.aces.toFixed(3)} df×${cal.dobles.toFixed(3)} σ ${cal.sigma?.toFixed(3)}`);
      }
    }
  };

  // Condiciones del día (común) y dominancia inicial: valores de la exploración en rejilla
  // (docs/modelo.md §6); la dominancia se ajusta después en cada grupo.
  M.sigma = 0.2;
  M.sigmaComun = 0.15;
  ajustarGrupos(4);
  const sub = muestrear(muestra, 300);
  let mejorSC = { s: M.sigmaComun, ls: -Infinity };
  for (const sc of [0.05, 0.15, 0.25]) {
    const e = evaluar({ ...M, sigmaComun: sc }, sub);
    log('σ común', sc, 'log score juegos', e.lsJuegos.toFixed(4), 'juegos', e.sim.juegos.toFixed(2), '/', e.real.juegos.toFixed(2));
    if (e.lsJuegos > mejorSC.ls) mejorSC = { s: sc, ls: e.lsJuegos };
  }
  M.sigmaComun = mejorSC.s;
  let mejorSA = { s: M.sigmaAces, ls: -Infinity };
  for (const s of [0.2, 0.3, 0.4]) {
    const e = evaluar({ ...M, sigmaAces: s }, sub);
    log('σ aces', s, 'log score aces', e.lsAces.toFixed(4));
    if (e.lsAces > mejorSA.ls) mejorSA = { s, ls: e.lsAces };
  }
  M.sigmaAces = mejorSA.s;
  ajustarGrupos(3);

  const salida: Partial<ParamsModelo> = {
    version: `calibrado-${TEMPORADA}`,
    ajustadoEl: new Date().toISOString(),
    vidaMediaDias: M.vidaMediaDias,
    pesoSuperficieElo: M.pesoSuperficieElo,
    pesoElo: M.pesoElo,
    escalaVictoria: M.escalaVictoria,
    gammaForma: M.gammaForma,
    sigma: M.sigma,
    sigmaComun: M.sigmaComun,
    sigmaAces: M.sigmaAces,
    rhoAce2: M.rhoAce2,
    K: M.K,
    calibracion: M.calibracion,
    minPartidosReales: PARAMS_POR_DEFECTO.minPartidosReales,
  };
  // Copia por temporada (la usa el backtest de la temporada siguiente) y versión de producción
  // (la usa la ingesta): la de la temporada más reciente calibrada.
  const rutaTemporada = RUTA_CALIBRACION.replace('.json', `-${TEMPORADA}.json`);
  writeFileSync(rutaTemporada, JSON.stringify(salida, null, 2));
  if (process.env.CALIBRACION_PRODUCCION !== '0') writeFileSync(RUTA_CALIBRACION, JSON.stringify(salida, null, 2));
  log('Calibración guardada en', rutaTemporada, process.env.CALIBRACION_PRODUCCION !== '0' ? `y ${RUTA_CALIBRACION}` : '', `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

main();
