/**
 * Agregación de las simulaciones en distribuciones. Todo se guarda como histogramas (número de
 * veces) para poder calcular después cualquier línea de over/under o hándicap sin re-simular.
 */
import type { FormatoPartido } from '../config/formatos';
import { ANCHO, R } from './tipos';

export interface Histograma {
  /** Valor del primer elemento de `cuentas`. */
  min: number;
  cuentas: number[];
}

export interface FilaFrecuencia {
  clave: string;
  veces: number;
}

export interface EstadisticaJugador {
  aces: Histograma;
  dobles: Histograma;
  breaks: Histograma;
  /** Puntos de break disputados como restador (oportunidades de break). */
  bpDisputados: Histograma;
  juegosSaquePerdidos: Histograma;
  juegos: Histograma;
  /** Porcentajes redondeados al entero. */
  pctPrimeros: Histograma;
  pctGanados1: Histograma;
  pctGanados2: Histograma;
  setsGanados: Histograma;
  tiebreaksGanados: Histograma;
  /** Ganó sin perder su saque. */
  sinPerderSaque: number;
  /** Ganó el partido tras perder el primer set. */
  remontadas: number;
  /** Ganó al menos un set. */
  alMenosUnSet: number;
  /** Ganó al menos un set 6-0 (o G-0). */
  setEnBlanco: number;
}

export interface ResultadosAgregados {
  n: number;
  formatoId: string;
  mejorDe: number;
  victoriasA: number;
  resultadoSets: FilaFrecuencia[];
  marcadores: FilaFrecuencia[];
  juegosTotales: Histograma;
  /** Diferencia de juegos A − B. */
  diferenciaJuegos: Histograma;
  /** Diferencia de sets A − B. */
  diferenciaSets: Histograma;
  numSets: Histograma;
  /** Por set (índice 0 = primer set): marcadores, juegos del set, ganador. */
  porSet: {
    jugado: number;
    marcadores: FilaFrecuencia[];
    juegos: Histograma;
    ganaA: number;
    tiebreak: number;
    tiebreakGanaA: number;
  }[];
  tiebreaks: Histograma;
  alMenosUnTiebreak: number;
  setEnBlanco: number;
  totales: {
    aces: Histograma;
    dobles: Histograma;
    breaks: Histograma;
    bpDisputados: Histograma;
  };
  jugadores: [EstadisticaJugador, EstadisticaJugador];
  /** Simulaciones que no pasaron las comprobaciones de coherencia (debe ser 0). */
  incoherentes: number;
  primerErrorCoherencia: string | null;
}

class Contador {
  private m = new Map<number, number>();
  add(v: number) {
    this.m.set(v, (this.m.get(v) ?? 0) + 1);
  }
  hist(): Histograma {
    if (this.m.size === 0) return { min: 0, cuentas: [] };
    let min = Infinity;
    let max = -Infinity;
    for (const k of this.m.keys()) {
      if (k < min) min = k;
      if (k > max) max = k;
    }
    const cuentas = new Array(max - min + 1).fill(0);
    for (const [k, v] of this.m) cuentas[k - min] = v;
    return { min, cuentas };
  }
}

class ContadorTexto {
  private m = new Map<string, number>();
  add(k: string) {
    this.m.set(k, (this.m.get(k) ?? 0) + 1);
  }
  filas(): FilaFrecuencia[] {
    return [...this.m.entries()]
      .map(([clave, veces]) => ({ clave, veces }))
      .sort((a, b) => b.veces - a.veces || a.clave.localeCompare(b.clave));
  }
}

function contadoresJugador() {
  return {
    aces: new Contador(),
    dobles: new Contador(),
    breaks: new Contador(),
    bpDisputados: new Contador(),
    juegosSaquePerdidos: new Contador(),
    juegos: new Contador(),
    pctPrimeros: new Contador(),
    pctGanados1: new Contador(),
    pctGanados2: new Contador(),
    setsGanados: new Contador(),
    tiebreaksGanados: new Contador(),
    sinPerderSaque: 0,
    remontadas: 0,
    alMenosUnSet: 0,
    setEnBlanco: 0,
  };
}

/** Texto de un set desde la perspectiva de A ("6-4", "7-6", o "[10]" / "[−]" para super tie-break). */
export function textoSet(a: number, b: number, superTb: boolean): string {
  if (superTb) return a > b ? '[STB A]' : '[STB B]';
  return `${a}-${b}`;
}

export function agregar(
  registros: Int32Array[],
  formato: FormatoPartido,
  comprobar?: (o: Int32Array, off: number) => string | null,
): ResultadosAgregados {
  const nMaxSets = formato.mejorDe;
  const resSets = new ContadorTexto();
  const marcadores = new ContadorTexto();
  const juegosTot = new Contador();
  const difJuegos = new Contador();
  const difSets = new Contador();
  const numSets = new Contador();
  const tbs = new Contador();
  const porSet = Array.from({ length: nMaxSets }, () => ({
    jugado: 0,
    marcadores: new ContadorTexto(),
    juegos: new Contador(),
    ganaA: 0,
    tiebreak: 0,
    tiebreakGanaA: 0,
  }));
  const tot = { aces: new Contador(), dobles: new Contador(), breaks: new Contador(), bpDisputados: new Contador() };
  const J = [contadoresJugador(), contadoresJugador()];
  let n = 0;
  let victoriasA = 0;
  let alMenosUnTb = 0;
  let setEnBlanco = 0;
  let incoherentes = 0;
  let primerError: string | null = null;

  for (const o of registros) {
    const total = o.length / ANCHO;
    for (let i = 0; i < total; i++) {
      const off = i * ANCHO;
      n++;
      if (comprobar) {
        const e = comprobar(o, off);
        if (e) {
          incoherentes++;
          if (!primerError) primerError = e;
        }
      }
      const ganador = o[off + R.GANADOR];
      if (ganador === 0) victoriasA++;
      const ns = o[off + R.NSETS];
      numSets.add(ns);
      const superTbFinal = o[off + R.SUPER_TB] === 1;
      const sets = [0, 0];
      const juegos = [0, 0];
      const tbGanados = [0, 0];
      const blanco = [false, false];
      let nTb = 0;
      const partes: string[] = [];
      let ganadorPrimerSet = -1;
      for (let s = 0; s < ns; s++) {
        const a = o[off + R.SETS + 2 * s];
        const b = o[off + R.SETS + 2 * s + 1];
        const esSuper = superTbFinal && s === ns - 1;
        const g = a > b ? 0 : 1;
        if (s === 0) ganadorPrimerSet = g;
        sets[g]++;
        const t = o[off + R.TB + s];
        const ps = porSet[s];
        ps.jugado++;
        ps.marcadores.add(textoSet(a, b, esSuper));
        if (g === 0) ps.ganaA++;
        if (t && !esSuper) {
          ps.tiebreak++;
          if (t === 1) ps.tiebreakGanaA++;
          nTb++;
          tbGanados[t - 1]++;
        }
        if (!esSuper) {
          ps.juegos.add(a + b);
          juegos[0] += a;
          juegos[1] += b;
          if (b === 0 && a >= formato.juegosPorSet) blanco[0] = true;
          if (a === 0 && b >= formato.juegosPorSet) blanco[1] = true;
        }
        partes.push(textoSet(a, b, esSuper));
      }
      resSets.add(`${sets[0]}-${sets[1]}`);
      marcadores.add(partes.join(' '));
      juegosTot.add(juegos[0] + juegos[1]);
      difJuegos.add(juegos[0] - juegos[1]);
      difSets.add(sets[0] - sets[1]);
      tbs.add(nTb);
      if (nTb > 0) alMenosUnTb++;
      if (blanco[0] || blanco[1]) setEnBlanco++;
      tot.aces.add(o[off + R.ACES] + o[off + R.ACES + 1]);
      tot.dobles.add(o[off + R.DF] + o[off + R.DF + 1]);
      tot.breaks.add(o[off + R.BREAKS] + o[off + R.BREAKS + 1]);
      tot.bpDisputados.add(o[off + R.BP_CONCEDIDOS] + o[off + R.BP_CONCEDIDOS + 1]);
      for (const j of [0, 1]) {
        const c = J[j];
        const otro = 1 - j;
        c.aces.add(o[off + R.ACES + j]);
        c.dobles.add(o[off + R.DF + j]);
        c.breaks.add(o[off + R.BREAKS + j]);
        c.bpDisputados.add(o[off + R.BP_CONCEDIDOS + otro]);
        c.juegosSaquePerdidos.add(o[off + R.BREAKS + otro]);
        c.juegos.add(juegos[j]);
        const pts = o[off + R.PTS_SAQUE + j];
        const in1 = o[off + R.PRIMEROS_DENTRO + j];
        if (pts > 0) c.pctPrimeros.add(Math.round((100 * in1) / pts));
        if (in1 > 0) c.pctGanados1.add(Math.round((100 * o[off + R.GANADOS_1 + j]) / in1));
        if (pts - in1 > 0) c.pctGanados2.add(Math.round((100 * o[off + R.GANADOS_2 + j]) / (pts - in1)));
        c.setsGanados.add(sets[j]);
        c.tiebreaksGanados.add(tbGanados[j]);
        if (ganador === j && o[off + R.BREAKS + otro] === 0) c.sinPerderSaque++;
        if (ganador === j && ganadorPrimerSet === otro) c.remontadas++;
        if (sets[j] > 0) c.alMenosUnSet++;
        if (blanco[j]) c.setEnBlanco++;
      }
    }
  }
  const fin = (c: ReturnType<typeof contadoresJugador>): EstadisticaJugador => ({
    aces: c.aces.hist(),
    dobles: c.dobles.hist(),
    breaks: c.breaks.hist(),
    bpDisputados: c.bpDisputados.hist(),
    juegosSaquePerdidos: c.juegosSaquePerdidos.hist(),
    juegos: c.juegos.hist(),
    pctPrimeros: c.pctPrimeros.hist(),
    pctGanados1: c.pctGanados1.hist(),
    pctGanados2: c.pctGanados2.hist(),
    setsGanados: c.setsGanados.hist(),
    tiebreaksGanados: c.tiebreaksGanados.hist(),
    sinPerderSaque: c.sinPerderSaque,
    remontadas: c.remontadas,
    alMenosUnSet: c.alMenosUnSet,
    setEnBlanco: c.setEnBlanco,
  });
  return {
    n,
    formatoId: formato.id,
    mejorDe: formato.mejorDe,
    victoriasA,
    resultadoSets: resSets.filas(),
    marcadores: marcadores.filas(),
    juegosTotales: juegosTot.hist(),
    diferenciaJuegos: difJuegos.hist(),
    diferenciaSets: difSets.hist(),
    numSets: numSets.hist(),
    porSet: porSet.map((p) => ({
      jugado: p.jugado,
      marcadores: p.marcadores.filas(),
      juegos: p.juegos.hist(),
      ganaA: p.ganaA,
      tiebreak: p.tiebreak,
      tiebreakGanaA: p.tiebreakGanaA,
    })),
    tiebreaks: tbs.hist(),
    alMenosUnTiebreak: alMenosUnTb,
    setEnBlanco,
    totales: {
      aces: tot.aces.hist(),
      dobles: tot.dobles.hist(),
      breaks: tot.breaks.hist(),
      bpDisputados: tot.bpDisputados.hist(),
    },
    jugadores: [fin(J[0]), fin(J[1])],
    incoherentes,
    primerErrorCoherencia: primerError,
  };
}

/** Fusiona agregados parciales (de varios workers) en uno. */
export function fusionar(partes: ResultadosAgregados[]): ResultadosAgregados {
  if (partes.length === 1) return partes[0];
  const sumH = (hs: Histograma[]): Histograma => {
    const validos = hs.filter((h) => h.cuentas.length);
    if (!validos.length) return { min: 0, cuentas: [] };
    const min = Math.min(...validos.map((h) => h.min));
    const max = Math.max(...validos.map((h) => h.min + h.cuentas.length - 1));
    const cuentas = new Array(max - min + 1).fill(0);
    for (const h of validos) h.cuentas.forEach((v, i) => (cuentas[h.min + i - min] += v));
    return { min, cuentas };
  };
  const sumF = (fs: FilaFrecuencia[][]): FilaFrecuencia[] => {
    const m = new Map<string, number>();
    for (const f of fs) for (const r of f) m.set(r.clave, (m.get(r.clave) ?? 0) + r.veces);
    return [...m.entries()].map(([clave, veces]) => ({ clave, veces })).sort((a, b) => b.veces - a.veces || a.clave.localeCompare(b.clave));
  };
  const p0 = partes[0];
  const jug = (j: 0 | 1): EstadisticaJugador => {
    const xs = partes.map((p) => p.jugadores[j]);
    const h = (k: keyof EstadisticaJugador) => sumH(xs.map((x) => x[k] as Histograma));
    const s = (k: keyof EstadisticaJugador) => xs.reduce((a, x) => a + (x[k] as number), 0);
    return {
      aces: h('aces'),
      dobles: h('dobles'),
      breaks: h('breaks'),
      bpDisputados: h('bpDisputados'),
      juegosSaquePerdidos: h('juegosSaquePerdidos'),
      juegos: h('juegos'),
      pctPrimeros: h('pctPrimeros'),
      pctGanados1: h('pctGanados1'),
      pctGanados2: h('pctGanados2'),
      setsGanados: h('setsGanados'),
      tiebreaksGanados: h('tiebreaksGanados'),
      sinPerderSaque: s('sinPerderSaque'),
      remontadas: s('remontadas'),
      alMenosUnSet: s('alMenosUnSet'),
      setEnBlanco: s('setEnBlanco'),
    };
  };
  return {
    n: partes.reduce((a, p) => a + p.n, 0),
    formatoId: p0.formatoId,
    mejorDe: p0.mejorDe,
    victoriasA: partes.reduce((a, p) => a + p.victoriasA, 0),
    resultadoSets: sumF(partes.map((p) => p.resultadoSets)),
    marcadores: sumF(partes.map((p) => p.marcadores)),
    juegosTotales: sumH(partes.map((p) => p.juegosTotales)),
    diferenciaJuegos: sumH(partes.map((p) => p.diferenciaJuegos)),
    diferenciaSets: sumH(partes.map((p) => p.diferenciaSets)),
    numSets: sumH(partes.map((p) => p.numSets)),
    porSet: p0.porSet.map((_, i) => ({
      jugado: partes.reduce((a, p) => a + p.porSet[i].jugado, 0),
      marcadores: sumF(partes.map((p) => p.porSet[i].marcadores)),
      juegos: sumH(partes.map((p) => p.porSet[i].juegos)),
      ganaA: partes.reduce((a, p) => a + p.porSet[i].ganaA, 0),
      tiebreak: partes.reduce((a, p) => a + p.porSet[i].tiebreak, 0),
      tiebreakGanaA: partes.reduce((a, p) => a + p.porSet[i].tiebreakGanaA, 0),
    })),
    tiebreaks: sumH(partes.map((p) => p.tiebreaks)),
    alMenosUnTiebreak: partes.reduce((a, p) => a + p.alMenosUnTiebreak, 0),
    setEnBlanco: partes.reduce((a, p) => a + p.setEnBlanco, 0),
    totales: {
      aces: sumH(partes.map((p) => p.totales.aces)),
      dobles: sumH(partes.map((p) => p.totales.dobles)),
      breaks: sumH(partes.map((p) => p.totales.breaks)),
      bpDisputados: sumH(partes.map((p) => p.totales.bpDisputados)),
    },
    jugadores: [jug(0), jug(1)],
    incoherentes: partes.reduce((a, p) => a + p.incoherentes, 0),
    primerErrorCoherencia: partes.find((p) => p.primerErrorCoherencia)?.primerErrorCoherencia ?? null,
  };
}

// ---------- Mercados a partir de histogramas ----------

export function totalHist(h: Histograma): number {
  return h.cuentas.reduce((a, b) => a + b, 0);
}

export function mediaHist(h: Histograma): number {
  const t = totalHist(h);
  if (!t) return 0;
  return h.cuentas.reduce((a, v, i) => a + v * (h.min + i), 0) / t;
}

export interface LineaOU {
  linea: number;
  over: number;
  under: number;
  /** Empate exacto con la línea (sólo en líneas enteras). */
  push: number;
}

/** Over/under en líneas de 0,5 en 0,5 alrededor de la media (± rango). */
export function lineasOverUnder(h: Histograma, rango: number, paso = 0.5): LineaOU[] {
  const t = totalHist(h);
  if (!t) return [];
  const m = mediaHist(h);
  const desde = Math.max(paso, Math.floor((m - rango) / paso) * paso);
  const hasta = Math.ceil((m + rango) / paso) * paso;
  const res: LineaOU[] = [];
  for (let l = desde; l <= hasta + 1e-9; l += paso) {
    const linea = Math.round(l * 100) / 100;
    let over = 0;
    let under = 0;
    let push = 0;
    h.cuentas.forEach((v, i) => {
      const x = h.min + i;
      if (x > linea) over += v;
      else if (x < linea) under += v;
      else push += v;
    });
    res.push({ linea, over, under, push });
  }
  return res;
}

export interface LineaHandicap {
  /** Hándicap aplicado al jugador A (p. ej. −3,5). */
  linea: number;
  ganaA: number;
  ganaB: number;
  push: number;
}

/** Hándicap sobre la diferencia A − B: A cubre si dif + línea > 0. */
export function lineasHandicap(dif: Histograma, rango: number, paso = 0.5): LineaHandicap[] {
  const t = totalHist(dif);
  if (!t) return [];
  const m = mediaHist(dif);
  const desde = Math.floor((-m - rango) / paso) * paso;
  const hasta = Math.ceil((-m + rango) / paso) * paso;
  const res: LineaHandicap[] = [];
  for (let l = desde; l <= hasta + 1e-9; l += paso) {
    const linea = Math.round(l * 100) / 100;
    let ganaA = 0;
    let ganaB = 0;
    let push = 0;
    dif.cuentas.forEach((v, i) => {
      const x = dif.min + i + linea;
      if (x > 1e-9) ganaA += v;
      else if (x < -1e-9) ganaB += v;
      else push += v;
    });
    res.push({ linea, ganaA, ganaB, push });
  }
  return res;
}

/** Filas valor → veces ordenadas de mayor a menor frecuencia. */
export function filasHist(h: Histograma, sufijo = ''): FilaFrecuencia[] {
  return h.cuentas
    .map((veces, i) => ({ clave: `${h.min + i}${sufijo}`, veces }))
    .filter((f) => f.veces > 0)
    .sort((a, b) => b.veces - a.veces);
}
