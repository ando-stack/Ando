/* Cuota Justa — análisis de partidos y detección de cuotas con valor.
   Todo el cálculo de mercados se hace aquí, a partir de las medias esperadas
   (goles, córners, faltas, tarjetas, tiros a puerta) que genera actualizar_datos.py. */
"use strict";

// ---------------------------------------------------------------------------
// Ajustes (se guardan en este navegador)
// ---------------------------------------------------------------------------
const AJUSTES_DEF = { casa: "max", minEdge: 100, pesoModelo: 100, probMin: 25, cuotaMin: 1.01, cuotaMax: 50, cuotaMinOU: 1.15, oddsKey: "" };
const guardado = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
let AJ = { ...AJUSTES_DEF, ...guardado("cj_ajustes2", {}) };
let MANUAL = guardado("cj_manual", {});        // cuotas que escribe el usuario: {partido: {clave: cuota}}
let VIVO = guardado("cj_vivo", {});            // cuotas de The Odds API: {partido: {t, cuotas:{clave:{avg,max,n}}}}

let D = null;                                  // datos.json
const EST = { vista: "picks", comp: null, jornada: null, partido: null };

const CASAS = { b365: "Bet365", avg: "Media del mercado", max: "Mejor cuota del mercado" };
const GRUPOS = ["Resultado", "Goles", "Hándicap asiático", "Córners", "Tarjetas", "Faltas", "Tiros a puerta", "Tiros", "Resultado exacto"];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p, d = 0) => (p == null || !isFinite(p) ? "—" : (100 * p).toFixed(d) + "%");
const dec = (x, d = 2) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));
const signo = (x, d = 1) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d) + "%";
const linea = (x) => String(+x);
const lineaH = (x) => (x > 0 ? "+" : "") + linea(x);
const TZ = "Europe/Madrid";
const fHora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fDia = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const fCorto = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", timeZone: TZ });
const nombre = (k) => D.equipos[k]?.nombre ?? k.split(":")[1];
const comp = (id) => D.competiciones.find((c) => c.id === id);
const normal = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(fc|cf|ac|afc|sc|ssc|as|ss|club|de|cd|ud|rc|rcd|sv|vfb|vfl|tsg|bv|fk|sk|1\.)\b/g, " ")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Distribuciones
// ---------------------------------------------------------------------------
function poisson(l, max) {
  const out = new Array(max + 1); out[0] = Math.exp(-l);
  for (let i = 1; i <= max; i++) out[i] = out[i - 1] * l / i;
  return out;
}
function binNeg(m, k, max) {           // binomial negativa con media m y dispersión k
  if (!k || k >= 300) return poisson(m, max);
  const p = k / (k + m); const out = new Array(max + 1);
  out[0] = Math.pow(p, k);
  for (let i = 1; i <= max; i++) out[i] = out[i - 1] * (i - 1 + k) / i * (1 - p);
  return out;
}
/** Conjunta local/visitante como lista [x, y, prob]. */
function conjuntaGoles(lh, la, rho) {
  const N = 10, ph = poisson(lh, N), pa = poisson(la, N), out = [];
  let s = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    let t = 1;                                  // corrección Dixon-Coles para marcadores bajos
    if (i === 0 && j === 0) t = 1 - lh * la * rho;
    else if (i === 0 && j === 1) t = 1 + lh * rho;
    else if (i === 1 && j === 0) t = 1 + la * rho;
    else if (i === 1 && j === 1) t = 1 - rho;
    const p = ph[i] * pa[j] * t; s += p; out.push([i, j, p]);
  }
  out.forEach((e) => (e[2] /= s));
  return out;
}
function conjuntaStat(ml, mv, k) {
  const N = Math.max(12, Math.ceil(Math.max(ml, mv) * 3 + 10));
  const ph = binNeg(ml, k, N), pa = binNeg(mv, k, N), out = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) out.push([i, j, ph[i] * pa[j]]);
  return out;
}
/** Valor de una "dimensión" a partir de (local, visitante). */
const DIM = {
  t: (a, b) => a + b, l: (a) => a, v: (a, b) => b, d: (a, b) => a - b,
  ad: (a, b) => Math.abs(a - b), min: (a, b) => Math.min(a, b),
};
/** Reparto asiático: la apuesta gana si signo*x + linea > 0 (líneas .25/.75 se parten en dos). */
function asiatico(conj, dim, s, lin) {
  const partes = Math.abs(Math.round(lin * 4)) % 2 === 1 ? [lin - 0.25, lin + 0.25] : [lin, lin];
  let w = 0, hw = 0, pu = 0, hl = 0, l = 0;
  // distribución marginal de la dimensión (se calcula una vez por conjunta)
  const cache = (conj._m = conj._m || {});
  let marg = cache[dim];
  if (!marg) {
    const acc = new Map();
    for (const [a, b, p] of conj) { const v = DIM[dim](a, b); acc.set(v, (acc.get(v) || 0) + p); }
    marg = cache[dim] = [...acc];
  }
  for (const [v, p] of marg) {
    const x = s * v;
    const r = partes.map((h) => (x + h > 1e-9 ? 1 : x + h < -1e-9 ? -1 : 0));
    const t = r[0] + r[1];
    if (t === 2) w += p; else if (t === 1) hw += p; else if (t === 0) pu += p; else if (t === -1) hl += p; else l += p;
  }
  return { w, hw, pu, hl, l };
}
const probEf = (o) => o.w + o.hw / 2 + o.pu * 0;          // prob. "comparable" sin cuota (empates de reembolso aparte)
const ev = (o, c) => o.w * (c - 1) + o.hw * (c - 1) / 2 - o.hl / 2 - o.l;
const cuotaJusta = (o) => { const g = o.w + o.hw / 2, p = o.l + o.hl / 2; return g > 0 ? 1 + p / g : Infinity; };
const probEquiv = (o, c) => (ev(o, c) + 1) / c;          // probabilidad equivalente a esa cuota (incluye reembolsos)

function liquidar(m, partido) {      // resultado real de un mercado: 1 gana, 0.5 medio, 0 nulo, -0.5, -1
  const r = valoresReales(partido)[m.stat];
  if (!r) return null;
  if (m.exacto) return r[0] === m.exacto[0] && r[1] === m.exacto[1] ? 1 : -1;
  const o = asiatico([[r[0], r[1], 1]], m.dim, m.s, m.lin);
  return o.w ? 1 : o.hw ? 0.5 : o.pu ? 0 : o.hl ? -0.5 : -1;
}
function valoresReales(p) {
  const v = {};
  if (p.res) v.g = p.res;
  if (p.real) for (const k of ["c", "f", "t", "tp", "s", "g1"]) if (p.real[k]) v[k] = p.real[k];
  if (v.g && v.g1) v.g2 = [v.g[0] - v.g1[0], v.g[1] - v.g1[1]];
  return v;
}

// ---------------------------------------------------------------------------
// Mercados de un partido
// ---------------------------------------------------------------------------
function lineasAlrededor(media, ancho, paso = 1) {
  const c = Math.round(media) + 0.5, out = [];
  for (let x = c - ancho; x <= c + ancho + 1e-9; x += paso) if (x > 0) out.push(+x.toFixed(1));
  return out;
}
const CALIBRA = { g: 0.95, g1: 0.96, g2: 0.94, c: 0.97, c1: 0.97, t: 1, f: 0.98, tp: 0.88, s: 0.9 };
function mercados(p, ligero = false) {
  const L = nombre(p.l), V = nombre(p.v), M = p.modelo, out = [];
  const add = (grupo, sub, sel, clave, stat, dim, s, lin, conj, extra = {}) => {
    let o = asiatico(conj, dim, s, lin);
    if (extra.fam && !o.hw && !o.hl) {
      // Calibración: en los partidos jugados el modelo se pasaba algo de confianza en los más/menos
      const f = CALIBRA[stat] ?? 0.95, w = 0.5 + (o.w - 0.5) * f;
      o = { w, hw: 0, pu: o.pu, hl: 0, l: Math.max(0, 1 - w - o.pu) };
    }
    out.push({ grupo, sub, sel, clave, stat, dim, s, lin, o, ...extra });
  };
  const G = conjuntaGoles(M.g[0], M.g[1], D.rho);
  // Resultado
  add("Resultado", "1X2", `Gana ${L}`, "1x2:1", "g", "d", 1, -0.5, G);
  add("Resultado", "1X2", "Empate", "1x2:X", "g", "ad", -1, 0.5, G);
  add("Resultado", "1X2", `Gana ${V}`, "1x2:2", "g", "d", -1, -0.5, G);
  add("Resultado", "Doble oportunidad", `${L} o empate (1X)`, "dc:1X", "g", "d", 1, 0.5, G);
  add("Resultado", "Doble oportunidad", `${L} o ${V} (12)`, "dc:12", "g", "ad", 1, -0.5, G);
  add("Resultado", "Doble oportunidad", `Empate o ${V} (X2)`, "dc:X2", "g", "d", -1, 0.5, G);
  add("Resultado", "Empate no válido", `${L} (DNB)`, "dnb:1", "g", "d", 1, 0, G);
  add("Resultado", "Empate no válido", `${V} (DNB)`, "dnb:2", "g", "d", -1, 0, G);
  // Goles (más/menos)
  const ou = (grupo, sub, fam, pre, stat, dim, conj, lineas, extra = {}, quien = "") => {
    for (const x of lineas) {
      add(grupo, sub, `${quien}Más de ${x}`, `${pre}:o:${x}`, stat, dim, 1, -x, conj, { fam, ...extra });
      add(grupo, sub, `${quien}Menos de ${x}`, `${pre}:u:${x}`, stat, dim, -1, x, conj, { fam, ...extra });
    }
  };
  const rango = (a, b) => { const r = []; for (let x = a; x <= b + 1e-9; x++) r.push(x); return r; };
  ou("Goles", "Total de goles", "Goles del partido", "g", "g", "t", G, ligero ? [2.5] : rango(0.5, 6.5));
  if (!ligero) {
  add("Goles", "Ambos marcan", "Sí", "btts:si", "g", "min", 1, -0.5, G);
  add("Goles", "Ambos marcan", "No", "btts:no", "g", "min", -1, 0.5, G);
  ou("Goles", `Goles de ${L}`, `Goles de ${L}`, "gl", "g", "l", G, rango(0.5, 4.5), {}, `${L}: `);
  ou("Goles", `Goles de ${V}`, `Goles de ${V}`, "gv", "g", "v", G, rango(0.5, 4.5), {}, `${V}: `);
  // Por partes: la 1ª parte suele llevar ~45% de los goles
  const G1 = conjuntaGoles(M.g[0] * 0.45, M.g[1] * 0.45, 0), G2 = conjuntaGoles(M.g[0] * 0.55, M.g[1] * 0.55, 0);
  ou("Goles", "Goles en la 1ª parte", "Goles 1ª parte", "g1", "g1", "t", G1, rango(0.5, 3.5));
  ou("Goles", "Goles en la 2ª parte", "Goles 2ª parte", "g2", "g2", "t", G2, rango(0.5, 4.5));
  ou("Goles", `Goles de ${L} en la 1ª parte`, `Goles de ${L} 1ª parte`, "g1l", "g1", "l", G1, rango(0.5, 2.5), {}, `${L}: `);
  ou("Goles", `Goles de ${V} en la 1ª parte`, `Goles de ${V} 1ª parte`, "g1v", "g1", "v", G1, rango(0.5, 2.5), {}, `${V}: `);
  }
  // Hándicap asiático
  const lineasAH = new Set([-2.5, -2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5]);
  const ahCasa = p.cuotas?.ah?.linea; if (ahCasa != null) lineasAH.add(ahCasa);
  for (const k of Object.keys(cuotasDe(p))) if (k.startsWith("ah:1:")) lineasAH.add(+k.slice(5));
  for (const x of [...lineasAH].sort((a, b) => a - b)) {
    add("Hándicap asiático", `Línea ${lineaH(x)} / ${lineaH(-x)}`, `${L} ${lineaH(x)}`, `ah:1:${linea(x)}`, "g", "d", 1, x, G);
    add("Hándicap asiático", `Línea ${lineaH(x)} / ${lineaH(-x)}`, `${V} ${lineaH(-x)}`, `ah:2:${linea(-x)}`, "g", "d", -1, -x, G);
  }
  if (ligero) return out;
  // Resultado exacto (los 8 más probables)
  G.slice().sort((a, b) => b[2] - a[2]).slice(0, 8).forEach(([i, j, pr]) => {
    out.push({ grupo: "Resultado exacto", sub: "Marcador", sel: `${L} ${i}-${j} ${V}`, clave: `cs:${i}-${j}`, stat: "g",
      exacto: [i, j], o: { w: pr, hw: 0, pu: 0, hl: 0, l: 1 - pr } });
  });
  // Estadísticas (más/menos por partido y por equipo)
  const STATS = [
    ["c", "Córners", "córners"], ["t", "Tarjetas", "tarjetas"], ["f", "Faltas", "faltas"],
    ["tp", "Tiros a puerta", "tiros a puerta"], ["s", "Tiros", "tiros totales"],
  ];
  const sd = (m, k) => Math.sqrt(m + (k && k < 300 ? (m * m) / k : 0));
  const lineasDe = (m, k) => { const r = []; const a = Math.max(0.5, Math.floor(m - 2.6 * sd(m, k)) + 0.5); for (let x = a; x <= m + 2.6 * sd(m, k) + 0.5; x++) r.push(x); return r; };
  const totalNB = (m, k) => binNeg(m, k, Math.ceil(m + 6 * sd(m, k) + 6)).map((pr, n) => [n, 0, pr]);
  for (const [st, grupo, txt] of STATS) {
    if (!M[st]) continue;
    const ke = D.dispersion?.[st]?.ke ?? 300, kt = D.dispersion?.[st]?.k ?? 300;
    const C = conjuntaStat(M[st][0], M[st][1], ke);
    const extra = M.aprox?.includes(st) ? { aprox: true } : {};
    const mt = M[st][0] + M[st][1];
    const tot = new Set(lineasDe(mt, kt));
    for (const kk of Object.keys(cuotasDe(p))) { const m = kk.match(new RegExp(`^${st}:[ou]:([\\d.]+)$`)); if (m) tot.add(+m[1]); }
    ou(grupo, `Total de ${txt}`, `${grupo} del partido`, st, st, "t", totalNB(mt, kt), [...tot].sort((a, b) => a - b), extra);
    ou(grupo, `${grupo} de ${L}`, `${grupo} de ${L}`, `${st}l`, st, "l", C, lineasDe(M[st][0], ke), extra, `${L}: `);
    ou(grupo, `${grupo} de ${V}`, `${grupo} de ${V}`, `${st}v`, st, "v", C, lineasDe(M[st][1], ke), extra, `${V}: `);
    if (st === "c") {
      const m1 = mt * 0.46;
      ou(grupo, "Córners en la 1ª parte", "Córners 1ª parte", "c1", "c1", "t", totalNB(m1, kt), lineasDe(m1, kt), { ...extra, aprox: true });
    }
    if (st === "c" || st === "t") {
      add(grupo, `Quién tiene más ${txt}`, `${L}`, `${st}w:1`, st, "d", 1, -0.5, C, extra);
      add(grupo, `Quién tiene más ${txt}`, "Igualados", `${st}w:X`, st, "ad", -1, 0.5, C, extra);
      add(grupo, `Quién tiene más ${txt}`, `${V}`, `${st}w:2`, st, "d", -1, -0.5, C, extra);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cuotas: datos (football-data), en vivo (The Odds API) y escritas a mano
// ---------------------------------------------------------------------------
/** Devuelve {clave: {c: cuota, fuente, avg?}} con la casa elegida en ajustes. */
function cuotasDe(p) {
  const out = {};
  const elegir = (obj) => obj?.[AJ.casa] ?? obj?.avg ?? obj?.b365 ?? obj?.max;
  const cu = p.cuotas || {};
  if (cu["1x2"]) {
    const c = elegir(cu["1x2"]), a = cu["1x2"].avg;
    ["1", "X", "2"].forEach((s, i) => { if (c) out[`1x2:${s}`] = { c: c[i], fuente: "datos", avg: a?.[i], grupoAvg: a }; });
  }
  if (cu.ou25) {
    const c = elegir(cu.ou25), a = cu.ou25.avg;
    if (c) { out["g:o:2.5"] = { c: c[0], fuente: "datos", avg: a?.[0], grupoAvg: a }; out["g:u:2.5"] = { c: c[1], fuente: "datos", avg: a?.[1], grupoAvg: a }; }
  }
  if (cu.ah) {
    const c = elegir(cu.ah), a = cu.ah.avg, x = cu.ah.linea;
    if (c) {
      out[`ah:1:${linea(x)}`] = { c: c[0], fuente: "datos", avg: a?.[0], grupoAvg: a };
      out[`ah:2:${linea(-x)}`] = { c: c[1], fuente: "datos", avg: a?.[1], grupoAvg: a };
    }
  }
  const vivo = VIVO[p.id]?.cuotas || {};
  for (const [k, v] of Object.entries(vivo)) {
    const c = AJ.casa === "max" ? v.max : v.avg;
    if (c) out[k] = { c, fuente: "vivo", avg: v.avg };
  }
  for (const [k, c] of Object.entries(MANUAL[p.id] || {})) if (c > 1) out[k] = { ...(out[k] || {}), c, fuente: "manual" };
  return out;
}
/** Probabilidad "justa" del mercado (sin margen) para una clave, si conocemos su grupo completo. */
function probMercado(clave, cuotas) {
  const grupos = [["1x2:1", "1x2:X", "1x2:2"], ["btts:si", "btts:no"]];
  let g = grupos.find((x) => x.includes(clave));
  if (!g) {
    const m = clave.match(/^([a-z]+):([ou]):(.+)$/);
    if (m) g = [`${m[1]}:o:${m[3]}`, `${m[1]}:u:${m[3]}`];
    const a = clave.match(/^ah:([12]):(.+)$/);
    if (a) { const x = +a[2]; g = a[1] === "1" ? [clave, `ah:2:${linea(-x)}`] : [`ah:1:${linea(-x)}`, clave]; }
  }
  if (!g) return null;
  const vals = g.map((k) => cuotas[k]?.avg ?? (cuotas[k]?.fuente !== "manual" ? cuotas[k]?.c : null));
  if (vals.some((v) => !v)) return null;
  const inv = vals.map((v) => 1 / v), s = inv.reduce((a, b) => a + b, 0);
  return inv[g.indexOf(clave)] / s;
}

// ---------------------------------------------------------------------------
// Evaluación y mejor pick
// ---------------------------------------------------------------------------
let VERSION = 0;
const MEMO = new Map();
function evaluar(p, opciones = {}) {
  if (opciones.cuotas || opciones.peso != null) return evaluarSinMemo(p, opciones);
  const k = p.id + "|" + VERSION + "|" + AJ.casa;
  if (!MEMO.has(k)) MEMO.set(k, evaluarSinMemo(p, opciones));
  return MEMO.get(k);
}
function evaluarSinMemo(p, opciones = {}) {
  const ms = mercados(p, !!opciones.ligero), cuotas = opciones.cuotas || cuotasDe(p), w = (opciones.peso ?? AJ.pesoModelo) / 100;
  for (const m of ms) {
    m.pModelo = probEf(m.o);
    m.justa = cuotaJusta(m.o);
    const cu = cuotas[m.clave];
    if (!cu) continue;
    m.cuota = cu.c; m.fuente = cu.fuente;
    const pm = probMercado(m.clave, cuotas);
    m.pCasa = 1 / cu.c;                 // lo que "dice" la cuota (con margen)
    m.pMercado = pm;                    // consenso sin margen
    // Nuestra estimación: modelo mezclado con el consenso del mercado cuando existe
    const reparto = m.o;
    let o = reparto;
    if (pm != null && !m.exacto) {
      const pModEq = probEquiv(reparto, cu.c);
      const pMezcla = w * pModEq + (1 - w) * pm;
      m.pNuestra = pMezcla;
      m.ev = pMezcla * cu.c - 1;
    } else {
      m.pNuestra = probEquiv(o, cu.c);
      m.ev = ev(o, cu.c);
    }
    m.pModeloEq = probEquiv(reparto, cu.c);
    m.kelly = m.ev / (cu.c - 1);
  }
  const fiab = p.modelo.fiab ?? 1;
  // Error de cuota: la ventaja tiene que llegar al mínimo de Ajustes (por defecto +100%:
  // la casa paga al menos el doble de nuestra cuota justa)
  const candidatos = ms.filter((m) => m.cuota && m.ev != null && !m.exacto &&
    m.cuota >= AJ.cuotaMin && m.cuota <= AJ.cuotaMax && m.pNuestra * 100 >= AJ.probMin && m.ev * 100 >= AJ.minEdge);
  for (const m of candidatos) {
    m.puntos = m.kelly * (0.5 + 0.5 * fiab) * (m.aprox ? 0.6 : 1);
    m.choque = m.pMercado != null && Math.abs(m.pModeloEq - m.pMercado) > 0.2;
  }
  candidatos.sort((a, b) => b.puntos - a.puntos);
  return { ms, pick: candidatos[0] || null, cuotas, fiab, ou: mejoresOU(ms, fiab) };
}
/** Mejor más/menos de cada mercado: el más probable cuya cuota justa llega a la mínima de Ajustes. */
function mejoresOU(ms, fiab) {
  const fams = new Map();
  for (const m of ms) {
    if (!m.fam || !isFinite(m.justa) || m.justa < AJ.cuotaMinOU) continue;
    const act = fams.get(m.fam);
    if (!act || m.pModelo > act.pModelo + 1e-9) fams.set(m.fam, m);
  }
  const out = [...fams.values()];
  for (const m of out) {
    m.errorSi = m.justa * (1 + AJ.minEdge / 100);          // cuota a partir de la cual es error de cuota
    m.puntosOU = m.pModelo * (0.5 + 0.5 * fiab) * (m.aprox ? 0.8 : 1);
  }
  return out;
}
const etiqueta = (m) => (m.fam && !m.sel.includes(":") ? `${m.sel} · ${m.fam}` : m.sel);
function staked(m) { return Math.min(3, Math.max(0.25, 25 * m.kelly)); }  // 1/4 de Kelly, máx. 3% del bank

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------
function render() {
  document.querySelectorAll("nav.comps button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === (EST.vista === "comp" || EST.vista === "partido" ? EST.comp : EST.vista))));
  const main = $("#main");
  if (EST.vista === "picks") main.innerHTML = vistaPicks();
  else if (EST.vista === "rend") main.innerHTML = vistaRendimiento();
  else if (EST.vista === "partido") main.innerHTML = vistaPartido();
  else main.innerHTML = vistaComp();
  if (EST.vista === "partido") enlazarPartido();
  window.scrollTo({ top: EST.vista === "partido" ? 0 : window.scrollY });
}

function filaPartido(p, extraIzq = "") {
  const ev = evaluar(p);
  const G = conjuntaGoles(p.modelo.g[0], p.modelo.g[1], D.rho);
  let h = 0, x = 0, a = 0;
  for (const [i, j, pr] of G) { if (i > j) h += pr; else if (i === j) x += pr; else a += pr; }
  const fecha = new Date(p.fecha);
  const res = p.res;
  const cls = (i) => (!res ? "" : res[i] > res[1 - i] ? "gana" : res[i] < res[1 - i] ? "pierde" : "");
  let chip;
  if (ev.pick) {
    const r = res ? liquidar(ev.pick, p) : null;
    const c = r == null ? "valor" : r > 0 ? "gano" : r < 0 ? "perdio" : "";
    const icono = r == null ? "💥" : r > 0 ? "✓" : r < 0 ? "✗" : "↺";
    chip = `<span class="chip ${c}"><span>${icono}</span><span class="t"><b>${esc(etiqueta(ev.pick))}</b> @${dec(ev.pick.cuota)} · ${signo(ev.pick.ev, 0)}</span></span>`;
  } else {
    const m = ev.ou.filter((x) => !x.aprox).sort((a, b) => b.puntosOU - a.puntosOU)[0];
    if (m) {
      const r = res ? liquidar(m, p) : null;
      const c = r == null ? "" : r > 0 ? "gano" : r < 0 ? "perdio" : "";
      chip = `<span class="chip ${c}"><span>${r == null ? "📊" : r > 0 ? "✓" : "✗"}</span><span class="t"><b>${esc(etiqueta(m))}</b> · ${pct(m.pModelo)} · justa ${dec(m.justa)}</span></span>`;
    } else chip = `<span class="chip"><span class="t">Sin datos</span></span>`;
  }
  return `<button class="partido" data-id="${p.id}">
    ${extraIzq}
    <span class="hora">${res ? "FIN" : fHora.format(fecha)}<small>${fCorto.format(fecha)}</small></span>
    <span class="equipos">
      <span class="eq ${cls(0)}"><span>${esc(nombre(p.l))}</span><b>${res ? res[0] : ""}</b></span>
      <span class="eq ${cls(1)}"><span>${esc(nombre(p.v))}</span><b>${res ? res[1] : ""}</b></span>
    </span>
    ${extraIzq ? "" : `<span class="barra3" title="Probabilidades del modelo 1 · X · 2">
      <span class="b"><i class="c1" style="width:${100 * h}%"></i><i class="cx" style="width:${100 * x}%"></i><i class="c2" style="width:${100 * a}%"></i></span>
      <span class="lbl"><span>1 · ${pct(h)}</span><span>X · ${pct(x)}</span><span>2 · ${pct(a)}</span></span>
    </span>`}
    ${chip}
  </button>`;
}

function vistaComp() {
  const c = comp(EST.comp);
  const ps = D.partidos.filter((p) => p.comp === c.id && p.j === EST.jornada);
  const jugados = ps.filter((p) => p.res).length;
  const conPick = ps.filter((p) => !p.res && evaluar(p).pick).length;
  const nombreJ = c.europea ? "Jornada" : "Jornada";
  let html = `<div class="jornadas">
    <h2>${esc(c.nombre)}</h2>
    <button class="btn flecha" data-j="-1" aria-label="Jornada anterior">‹</button>
    <select id="selJ" aria-label="Jornada">${c.jornadas.map((j) => `<option value="${j}" ${j === EST.jornada ? "selected" : ""}>${nombreJ} ${j}${j === c.actual ? " (actual)" : ""}</option>`).join("")}</select>
    <button class="btn flecha" data-j="1" aria-label="Jornada siguiente">›</button>
    <span class="resumen">${ps.length} partidos · ${jugados} jugados${conPick ? ` · <b>${conPick} con valor</b>` : ""}</span>
  </div>`;
  let dia = "";
  html += `<div class="lista">`;
  for (const p of ps) {
    const d = fDia.format(new Date(p.fecha));
    if (d !== dia) { html += `</div><div class="dia">${esc(d)}</div><div class="lista">`; dia = d; }
    html += filaPartido(p);
  }
  html += `</div>`;
  if (c.europea) html += `<p class="aviso">En competiciones europeas no hay cuotas gratuitas en las fuentes de datos: escribe la cuota de tu casa en el mercado que quieras (o añade una clave de The Odds API en Ajustes) y verás al momento si tiene valor.</p>`;
  return html;
}

function vistaPicks() {
  const ahora = Date.now();
  const proximos = D.partidos.filter((p) => !p.res && new Date(p.fecha).getTime() > ahora);
  const lista = [];
  const conCuotasL = proximos.filter((p) => Object.keys(cuotasDe(p)).length);
  for (const p of conCuotasL) { const e = evaluar(p); if (e.pick) lista.push([p, e.pick]); }
  lista.sort((a, b) => b[1].puntos - a[1].puntos);
  const conCuotas = conCuotasL.length;
  let html = `<div class="jornadas"><h2>Errores de cuota</h2><span class="resumen">La casa paga al menos un ${AJ.minEdge}% más que nuestra cuota justa · ${conCuotas} próximos partidos con cuotas · ${esc(CASAS[AJ.casa])}</span></div>`;
  if (!lista.length) {
    html += `<div class="vacio">Ahora mismo ninguna cuota disponible llega a +${AJ.minEdge}% sobre nuestra cuota justa.<br>Abajo tienes los over/under más probables: mira la columna <b>“Error si pagan ≥”</b> y compárala con tu casa. Si tu casa paga eso o más, es error de cuota.</div>`;
  } else {
    html += `<div class="ranking">` + lista.slice(0, 25).map(([p], i) => filaPartido(p, `<span class="pos">${i + 1}</span>`)).join("") + `</div>`;
  }
  // Over/under más probables de los próximos días
  const limite = ahora + 4 * 86400e3;
  const filas = [];
  for (const p of proximos) {
    if (new Date(p.fecha).getTime() > limite) continue;
    for (const m of evaluar(p).ou) if (!m.aprox) filas.push([p, m]);
  }
  filas.sort((a, b) => b[1].puntosOU - a[1].puntosOU);
  html += `<div class="jornadas"><h2>Over/Under más probables</h2><span class="resumen">Próximos 4 días · el pick más seguro de cada mercado con cuota justa ≥ ${dec(AJ.cuotaMinOU)}</span></div>`;
  html += filas.length ? tablaOU(filas.slice(0, 60), true) : `<div class="vacio">No hay partidos en los próximos 4 días.</div>`;
  return html;
}

/** Tabla de over/under: filas [partido, mercado]. */
function tablaOU(filas, conPartido) {
  let html = `<div class="panel tabla-wrap" style="padding:8px"><table class="m ou"><thead><tr>${conPartido ? "<th>Partido</th>" : ""}<th>Mercado</th><th>Pick</th><th>Prob.</th><th>Cuota justa</th><th>Error si pagan ≥</th><th>Cuota casa</th><th>Diferencia</th>${conPartido ? "" : "<th>Resultado</th>"}</tr></thead><tbody>`;
  for (const [p, m] of filas) {
    const r = p.res ? liquidar(m, p) : null;
    const err = m.ev != null && m.ev * 100 >= AJ.minEdge;
    html += `<tr class="${err ? "elegido" : ""} ${conPartido ? "clic" : ""}" ${conPartido ? `data-id="${p.id}"` : ""}>
      ${conPartido ? `<td>${fCorto.format(new Date(p.fecha))} ${fHora.format(new Date(p.fecha))} · <b>${esc(nombre(p.l))} – ${esc(nombre(p.v))}</b></td>` : ""}
      <td>${esc(m.fam)}${m.aprox ? " (aprox.)" : ""}</td>
      <td><b>${esc(m.sel.replace(/^.*?: /, ""))}</b></td>
      <td><span class="barrita"><i style="width:${100 * m.pModelo}%"></i></span>${pct(m.pModelo, 1)}</td>
      <td>${dec(m.justa)}</td>
      <td><b>${dec(m.errorSi)}</b></td>
      <td>${m.cuota ? dec(m.cuota) : "—"}</td>
      <td class="${err ? "v-pos" : "v-neg"}">${m.ev != null ? signo(m.ev, 0) : "—"}</td>
      ${conPartido ? "" : `<td>${r == null ? "—" : r > 0 ? '<span class="v-pos">✓ Acertado</span>' : r < 0 ? '<span style="color:var(--bad)">✗ Fallado</span>' : "↺ Nulo"}</td>`}
    </tr>`;
  }
  return html + `</tbody></table></div>`;
}

function vistaPartido() {
  const p = D.partidos.find((x) => x.id === EST.partido);
  if (!p) return `<div class="vacio">Partido no encontrado.</div>`;
  const c = comp(p.comp), E = evaluar(p), M = p.modelo, eqL = D.equipos[p.l], eqV = D.equipos[p.v];
  const fecha = new Date(p.fecha);
  let html = `<button class="btn volver" id="volver">‹ ${esc(c.corto)} · Jornada ${p.j}</button>
  <section class="marcador">
    <div class="linea1"><span>${esc(c.nombre)} · Jornada ${p.j}</span><span>${esc(fDia.format(fecha))} · ${fHora.format(fecha)}${p.estadio ? " · " + esc(p.estadio) : ""}</span></div>
    <div class="eqs"><span class="n">${esc(nombre(p.l))}</span><span class="res ${p.res ? "" : "vs"}">${p.res ? `${p.res[0]}–${p.res[1]}` : "vs"}</span><span class="n">${esc(nombre(p.v))}</span></div>
    <div class="xg"><span>Goles esperados (modelo): ${dec(M.g[0])} – ${dec(M.g[1])}</span>${p.real?.xg ? `<span>xG real: ${dec(p.real.xg[0])} – ${dec(p.real.xg[1])}</span>` : ""}<span>Fiabilidad de datos: ${pct(M.fiab)}</span></div>
  </section>`;
  html += `<div class="grid2">` + panelPick(p, E) + panelEsperados(p, eqL, eqV) + `</div>`;
  html += `<div class="jornadas" style="margin-top:22px"><h2>Mejor over/under de cada mercado</h2><span class="resumen">El más probable con cuota justa ≥ ${dec(AJ.cuotaMinOU)} · error de cuota si tu casa paga ≥ ${AJ.minEdge}% más</span></div>`;
  html += tablaOU(E.ou.map((m) => [p, m]), false);
  html += `<div class="mercados">` + tablasMercados(p, E) + `</div>`;
  html += panelVivo(p);
  return html;
}

function panelPick(p, E) {
  const m = E.pick;
  if (!m) {
    const hay = Object.keys(E.cuotas).length;
    return `<section class="panel pick sinpick">
      <div class="eyebrow">Error de cuota</div>
      <div class="sel">${hay ? `Ninguna cuota llega a +${AJ.minEdge}%` : p.res ? "Sin cuotas registradas" : "Aún sin cuotas"}</div>
      <p class="nota">${hay ? `Para ser error de cuota la casa tiene que pagar al menos un ${AJ.minEdge}% más que nuestra cuota justa. Mira abajo el mejor over/under de cada mercado y su cuota mínima de error.`
        : p.res ? `Las fuentes no guardaron cuotas de este partido, así que no se puede saber qué pick habría salido. Abajo ves lo que esperaba el modelo antes del partido.`
        : `Este partido aún no tiene cuotas en las fuentes gratuitas. Abajo tienes el mejor over/under de cada mercado con su <b>cuota justa</b> y la cuota a partir de la cual sería error de cuota. Escribe la cuota de tu casa en la columna “Tu cuota” de los mercados y, si llega, aparecerá aquí.`}</p>
    </section>`;
  }
  const r = p.res ? liquidar(m, p) : null;
  const res = r == null ? "" : r > 0 ? `<span class="chip gano">✓ Acertado</span>` : r < 0 ? `<span class="chip perdio">✗ Fallado</span>` : `<span class="chip">↺ Nulo</span>`;
  const pModelo = m.pModeloEq, pCasa = m.pCasa;
  const boom = m.ev >= 1 ? `<span class="boom">BOOM</span>` : "";
  return `<section class="panel pick">
    <div class="eyebrow">💥 Error de cuota ${boom} ${res}</div>
    <div class="sel">${esc(etiqueta(m))}</div>
    <div class="mercado">${esc(m.grupo)} · ${esc(m.sub)} · cuota <b>${dec(m.cuota)}</b> (${esc(m.fuente === "manual" ? "tu cuota" : m.fuente === "vivo" ? "The Odds API" : CASAS[AJ.casa])})</div>
    <div class="cifras">
      <div><small>Nuestra prob.</small><b>${pct(m.pNuestra, 1)}</b></div>
      <div><small>Prob. de la casa</small><b>${pct(pCasa, 1)}</b></div>
      <div><small>Ventaja</small><b class="pos">${signo(m.ev)}</b></div>
      <div><small>Stake sugerido</small><b>${dec(staked(m), 1)}%</b></div>
    </div>
    <div class="comparar">
      <div class="fila mod"><span>Nuestra estimación</span><span class="pista"><i style="width:${100 * m.pNuestra}%"></i></span><b class="num">${pct(m.pNuestra, 1)}</b></div>
      <div class="fila"><span>Modelo puro</span><span class="pista"><i style="width:${100 * pModelo}%;background:var(--accent);opacity:.5"></i></span><b class="num">${pct(pModelo, 1)}</b></div>
      ${m.pMercado != null ? `<div class="fila casa"><span>Mercado sin margen</span><span class="pista"><i style="width:${100 * m.pMercado}%"></i></span><b class="num">${pct(m.pMercado, 1)}</b></div>` : ""}
      <div class="fila casa"><span>Cuota ${dec(m.cuota)} implica</span><span class="pista"><i style="width:${100 * pCasa}%"></i></span><b class="num">${pct(pCasa, 1)}</b></div>
    </div>
    <p class="nota">Cuota justa según nuestra estimación: <b>${dec(1 / m.pNuestra)}</b>. Mientras te paguen por encima, la apuesta tiene valor. Stake = ¼ de Kelly sobre tu bank (máx. 3%).${m.aprox ? " Ojo: estadística estimada con datos parciales." : ""}${m.choque ? " <b>Aviso:</b> el modelo y el resto de casas discrepan mucho; antes de apostar comprueba lesiones y alineaciones, que el modelo no conoce." : ""}</p>
  </section>`;
}

function panelEsperados(p, eqL, eqV) {
  const M = p.modelo, R = p.real || {};
  const fila = (txt, k, real) => M[k] ? `<div>${txt}</div><div class="r">${dec(M[k][0], 1)}</div><div class="r">${dec(M[k][1], 1)}</div><div class="r">${real ? `${real[0]}–${real[1]}` : dec(M[k][0] + M[k][1], 1)}</div>` : "";
  const forma = (eq) => `<div class="forma">${(eq?.forma || []).map((f) => `<span class="${f.r}" title="${esc(f.f)} ${f.casa ? "vs" : "en"} ${esc(f.rival)} ${esc(f.m)}">${f.r}</span>`).join("")}</div>`;
  const est = (eq, k) => eq?.est?.[k] ?? null;
  const filaEst = (txt, k) => `<div>${txt}</div><div class="r">${dec(est(eqL, k), 2)}</div><div class="r">${dec(est(eqV, k), 2)}</div><div></div>`;
  return `<section class="panel">
    <h3>Lo que espera el modelo <small>${p.res ? "antes del partido" : "medias por equipo"}</small></h3>
    <div class="esperados">
      <div class="h"></div><div class="h r">${esc(nombre(p.l))}</div><div class="h r">${esc(nombre(p.v))}</div><div class="h r">${p.res ? "Real" : "Total"}</div>
      ${fila("Goles", "g", p.res)}${fila("Córners", "c", R.c)}${fila("Tarjetas", "t", R.t)}${fila("Faltas", "f", R.f)}${fila("Tiros a puerta", "tp", R.tp)}
    </div>
    <h3 style="margin-top:16px">Temporada <small>por partido</small></h3>
    <div class="esperados">
      <div class="h"></div><div class="h r">${esc(nombre(p.l))}</div><div class="h r">${esc(nombre(p.v))}</div><div class="h"></div>
      ${filaEst("Goles a favor", "gf")}${filaEst("Goles en contra", "gc")}${filaEst("xG a favor", "xgf")}${filaEst("xG en contra", "xgc")}
      ${filaEst("Córners a favor", "cf")}${filaEst("Córners en contra", "cc")}${filaEst("Tarjetas", "tf")}${filaEst("Faltas cometidas", "ff")}
    </div>
    <div class="esperados" style="margin-top:12px;grid-template-columns:auto 1fr">
      <div>Forma ${esc(nombre(p.l))}</div><div>${forma(eqL)}</div>
      <div>Forma ${esc(nombre(p.v))}</div><div>${forma(eqV)}</div>
    </div>
    ${M.aprox?.length ? `<p class="aviso">Algún equipo no tiene estadísticas de córners/faltas/tarjetas en su liga: esos mercados usan medias aproximadas.</p>` : ""}
    ${p.arbitro ? `<p class="aviso">Árbitro: ${esc(p.arbitro)}</p>` : ""}
  </section>`;
}

function tablasMercados(p, E) {
  const porGrupo = new Map(GRUPOS.map((g) => [g, []]));
  for (const m of E.ms) porGrupo.get(m.grupo)?.push(m);
  let html = "";
  for (const [g, ms] of porGrupo) {
    if (!ms.length) continue;
    const visibles = ms.filter((m) => m.cuota || (m.pModelo > 0.06 && m.pModelo < 0.96) || g === "Resultado exacto");
    const conValor = visibles.filter((m) => m.ev != null && m.ev * 100 >= AJ.minEdge).length;
    const abierto = ["Resultado", "Goles"].includes(g) || visibles.some((m) => m === E.pick);
    html += `<details class="grupo" ${abierto ? "open" : ""}><summary><span>${esc(g)}</span>${conValor ? `<span class="cnt">${conValor} con valor</span>` : ""}</summary>
      <div class="tabla-wrap"><table class="m"><thead><tr><th>Selección</th><th>Prob. modelo</th><th>Cuota justa</th><th>Tu cuota</th><th>Prob. casa</th><th>Ventaja</th></tr></thead><tbody>`;
    let sub = "";
    for (const m of visibles) {
      if (m.sub !== sub) { html += `<tr><td class="sub" colspan="6">${esc(m.sub)}${m.aprox ? " · aproximado" : ""}</td></tr>`; sub = m.sub; }
      const val = m.ev != null && m.ev * 100 >= AJ.minEdge;
      const cls = m === E.pick ? "elegido" : val ? "valor" : "";
      const prob = m.o.pu > 0.001 ? `${pct(m.pModelo, 1)} <small title="Probabilidad de que te devuelvan la apuesta">(nulo ${pct(m.o.pu, 0)})</small>` : pct(m.pModelo, 1);
      const manual = MANUAL[p.id]?.[m.clave];
      html += `<tr class="${cls}"><td>${m === E.pick ? "💥 " : ""}${esc(m.sel)}</td>
        <td><span class="barrita"><i style="width:${100 * Math.min(1, m.pModelo)}%"></i></span>${prob}</td>
        <td>${isFinite(m.justa) ? dec(m.justa) : "—"}</td>
        <td><input inputmode="decimal" data-k="${esc(m.clave)}" class="${m.cuota && !manual ? "fuente" : ""}" value="${manual ?? ""}" placeholder="${m.cuota && !manual ? dec(m.cuota) : ""}" aria-label="Cuota de tu casa para ${esc(m.sel)}"></td>
        <td>${m.cuota ? pct(m.pCasa, 1) : "—"}</td>
        <td class="${val ? "v-pos" : "v-neg"}">${m.ev != null ? signo(m.ev) : "—"}</td></tr>`;
    }
    html += `</tbody></table></div></details>`;
  }
  html += `<p class="aviso">“Prob. modelo” es la del modelo estadístico puro. La ventaja combina el modelo (${AJ.pesoModelo}%) con el consenso del mercado sin margen (${100 - AJ.pesoModelo}%) cuando existe; si solo hay tu cuota, usa el modelo puro. Las cuotas grises vienen de ${esc(CASAS[AJ.casa])}; escribe la tuya para sustituirla.</p>`;
  return html;
}

function panelVivo(p) {
  const c = comp(p.comp);
  const v = VIVO[p.id];
  return `<section class="panel" style="margin-top:14px">
    <h3>Cuotas en vivo <small>The Odds API · opcional</small></h3>
    <p class="aviso" style="margin-top:0">Con una clave gratuita de the-odds-api.com cargo cuotas de decenas de casas para ${esc(c.corto)}: resultado, goles, hándicap y, si la casa las ofrece, ambos marcan, córners y tarjetas.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn prim" id="cargarVivo">${AJ.oddsKey ? "Cargar cuotas de este partido" : "Añadir clave en Ajustes"}</button>
      ${MANUAL[p.id] && Object.keys(MANUAL[p.id]).length ? `<button class="btn" id="borrarManual">Borrar mis cuotas</button>` : ""}
      <span class="estado" id="estadoVivo">${v ? `Cargadas ${new Date(v.t).toLocaleString("es-ES")} · ${Object.keys(v.cuotas).length} cuotas` : ""}</span>
    </div>
  </section>`;
}

function enlazarPartido() {
  const p = D.partidos.find((x) => x.id === EST.partido);
  $("#volver")?.addEventListener("click", () => { EST.vista = "comp"; EST.comp = p.comp; EST.jornada = p.j; render(); });
  document.querySelectorAll("table.m input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const v = parseFloat(inp.value.replace(",", "."));
      MANUAL[p.id] = MANUAL[p.id] || {};
      if (v > 1) MANUAL[p.id][inp.dataset.k] = v; else delete MANUAL[p.id][inp.dataset.k];
      guardar("cj_manual", MANUAL); VERSION++;
      const y = window.scrollY; render(); window.scrollTo({ top: y });
    });
  });
  $("#borrarManual")?.addEventListener("click", () => { delete MANUAL[p.id]; guardar("cj_manual", MANUAL); VERSION++; render(); });
  $("#cargarVivo")?.addEventListener("click", () => (AJ.oddsKey ? cargarVivo(p) : abrirAjustes()));
}

// ---------------------------------------------------------------------------
// Rendimiento: simulación sobre los partidos ya jugados (modelo sin ver el futuro, cuotas de cierre)
// ---------------------------------------------------------------------------
function backtest(casa) {
  const filas = [];
  const prev = AJ.casa; AJ.casa = casa;
  for (const p of D.partidos) {
    if (!p.res || !p.cierre || !p.cuotas) continue;
    const E = evaluar(p, { cuotas: cuotasDatos(p), ligero: true });
    if (!E.pick) continue;
    const r = liquidar(E.pick, p);
    if (r == null) continue;
    const o = E.pick.cuota;
    const ganancia = r === 1 ? o - 1 : r === 0.5 ? (o - 1) / 2 : r === 0 ? 0 : r === -0.5 ? -0.5 : -1;
    filas.push({ p, m: E.pick, r, g: ganancia });
  }
  AJ.casa = prev;
  filas.sort((a, b) => new Date(a.p.fecha) - new Date(b.p.fecha));
  return filas;
}
function cuotasDatos(p) {   // solo cuotas de los datos (sin manuales ni en vivo) para que la simulación sea limpia
  const guardaM = MANUAL, guardaV = VIVO; MANUAL = {}; VIVO = {};
  const c = cuotasDe(p); MANUAL = guardaM; VIVO = guardaV; return c;
}
const CATEG = {
  g: "Goles del partido", gl: "Goles del local", gv: "Goles del visitante", g1: "Goles 1ª parte", g2: "Goles 2ª parte",
  g1l: "Goles del local 1ª parte", g1v: "Goles del visitante 1ª parte", c: "Córners del partido", cl: "Córners del local",
  cv: "Córners del visitante", t: "Tarjetas del partido", tl: "Tarjetas del local", tv: "Tarjetas del visitante",
  f: "Faltas del partido", fl: "Faltas del local", fv: "Faltas del visitante", tp: "Tiros a puerta del partido",
  tpl: "Tiros a puerta del local", tpv: "Tiros a puerta del visitante", s: "Tiros del partido", sl: "Tiros del local", sv: "Tiros del visitante",
};
function aciertoOU() {
  const por = {};
  for (const p of D.partidos) {
    if (!p.res) continue;
    for (const m of evaluar(p).ou) {
      const r = liquidar(m, p);
      if (r == null || r === 0) continue;
      const k = m.clave.split(":")[0];
      const a = (por[k] = por[k] || { n: 0, ok: 0, esp: 0, justa: 0 });
      a.n++; a.ok += r > 0 ? 1 : 0; a.esp += m.pModelo; a.justa += m.justa;
    }
  }
  return Object.entries(por).filter(([k]) => CATEG[k]);
}
function vistaRendimiento() {
  const filas = backtest(AJ.casa);
  const n = filas.length, g = filas.reduce((a, f) => a + f.g, 0), ac = filas.filter((f) => f.r > 0).length;
  const cuotaMedia = n ? filas.reduce((a, f) => a + f.m.cuota, 0) / n : 0;
  let html = `<div class="jornadas"><h2>Rendimiento del modelo</h2><span class="resumen">Partidos ya jugados de esta temporada · 1 unidad por pick · cuotas de cierre (${esc(CASAS[AJ.casa])})</span></div>`;
  html += `<div class="kpis">
    <div class="kpi"><small>Picks</small><b>${n}</b></div>
    <div class="kpi"><small>Acierto</small><b>${pct(n ? ac / n : null, 0)}</b></div>
    <div class="kpi"><small>Beneficio</small><b style="color:${g >= 0 ? "var(--good)" : "var(--bad)"}">${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)} u</b></div>
    <div class="kpi"><small>Rentabilidad (ROI)</small><b style="color:${g >= 0 ? "var(--good)" : "var(--bad)"}">${n ? signo(g / n) : "—"}</b></div>
  </div>`;
  if (n) html += `<section class="panel grafica" style="margin-top:14px"><h3>Beneficio acumulado <small>${n} picks · cuota media ${dec(cuotaMedia)}</small></h3>${graficaAcumulada(filas)}</section>`;
  // Por competición
  const porComp = {};
  for (const f of filas) { const k = f.p.comp; porComp[k] = porComp[k] || { n: 0, g: 0, a: 0 }; porComp[k].n++; porComp[k].g += f.g; porComp[k].a += f.r > 0 ? 1 : 0; }
  html += `<section class="panel" style="margin-top:14px"><h3>Por competición</h3><div class="tabla-wrap"><table class="m"><thead><tr><th>Competición</th><th>Picks</th><th>Acierto</th><th>Beneficio</th><th>ROI</th></tr></thead><tbody>
    ${Object.entries(porComp).map(([k, v]) => `<tr><td>${esc(comp(k)?.nombre)}</td><td>${v.n}</td><td>${pct(v.a / v.n, 0)}</td><td>${v.g >= 0 ? "+" : ""}${v.g.toFixed(1)} u</td><td class="${v.g >= 0 ? "v-pos" : ""}">${signo(v.g / v.n)}</td></tr>`).join("")}
  </tbody></table></div></section>`;
  // Comparativa de casas
  const comparar = ["b365", "avg", "max"].map((c) => { const f = backtest(c); const gg = f.reduce((a, x) => a + x.g, 0); return [c, f.length, gg]; });
  html += `<section class="panel" style="margin-top:14px"><h3>Según dónde apuestes</h3><div class="tabla-wrap"><table class="m"><thead><tr><th>Cuotas</th><th>Picks</th><th>Beneficio</th><th>ROI</th></tr></thead><tbody>
    ${comparar.map(([c, nn, gg]) => `<tr><td>${esc(CASAS[c])}</td><td>${nn}</td><td>${gg >= 0 ? "+" : ""}${gg.toFixed(1)} u</td><td class="${gg >= 0 ? "v-pos" : ""}">${nn ? signo(gg / nn) : "—"}</td></tr>`).join("")}
  </tbody></table></div></section>`;
  const ou = aciertoOU();
  if (ou.length) {
    const tn = ou.reduce((a, [, v]) => a + v.n, 0), tok = ou.reduce((a, [, v]) => a + v.ok, 0), tesp = ou.reduce((a, [, v]) => a + v.esp, 0);
    html += `<section class="panel" style="margin-top:14px"><h3>Mejor over/under de cada mercado <small>partidos jugados · ${tn} picks · acierto ${pct(tok / tn, 1)} (el modelo esperaba ${pct(tesp / tn, 1)})</small></h3>
    <div class="tabla-wrap"><table class="m"><thead><tr><th>Mercado</th><th>Picks</th><th>Acierto real</th><th>Esperado por el modelo</th><th>Cuota justa media</th></tr></thead><tbody>
    ${ou.map(([k, v]) => `<tr><td>${esc(CATEG[k])}</td><td>${v.n}</td><td class="${v.ok / v.n >= v.esp / v.n - 0.03 ? "v-pos" : ""}">${pct(v.ok / v.n, 1)}</td><td>${pct(v.esp / v.n, 1)}</td><td>${dec(v.justa / v.n)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="aviso">Si el acierto real está cerca del esperado, las probabilidades del modelo son fiables en ese mercado. Así puedes fiarte de la cuota justa para detectar errores de cuota.</p></section>`;
  }
  html += `<section class="texto"><p><b>Cómo leer esto.</b> Cada partido jugado se ha predicho solo con datos anteriores a su fecha, y el pick se compara con las cuotas de cierre, que son las más difíciles de batir. Solo cuentan los mercados con cuotas históricas (1X2, más/menos 2,5 y hándicap asiático); córners, faltas y tarjetas no tienen cuotas gratuitas para comprobarlos.</p>
  <p>La conclusión práctica: el valor aparece sobre todo cuando comparas casas y apuestas en la que mejor paga. Con una sola casa, el margen se come buena parte de la ventaja. Es una muestra de pocas jornadas: tómala como orientación, no como garantía.</p></section>`;
  return html;
}
function graficaAcumulada(filas) {
  const W = 900, H = 220, pad = { l: 44, r: 12, t: 12, b: 26 };
  let acc = 0; const pts = filas.map((f) => (acc += f.g));
  const min = Math.min(0, ...pts), max = Math.max(0, ...pts), rango = max - min || 1;
  const x = (i) => pad.l + (W - pad.l - pad.r) * (pts.length > 1 ? i / (pts.length - 1) : 0);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / rango);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${d}L${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const ticks = [min, 0, max].filter((v, i, a) => a.indexOf(v) === i);
  const col = acc >= 0 ? "var(--good)" : "var(--bad)";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Beneficio acumulado en unidades">
    ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" font-size="12" fill="var(--ink-3)">${t >= 0 ? "+" : ""}${t.toFixed(1)}</text>`).join("")}
    <path d="${area}" fill="${col}" opacity=".12"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2.2"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(acc)}" r="4" fill="${col}"/>
    <text x="${pad.l}" y="${H - 6}" font-size="12" fill="var(--ink-3)">${fCorto.format(new Date(filas[0].p.fecha))}</text>
    <text x="${W - pad.r}" y="${H - 6}" font-size="12" text-anchor="end" fill="var(--ink-3)">${fCorto.format(new Date(filas[filas.length - 1].p.fecha))}</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// The Odds API (opcional)
// ---------------------------------------------------------------------------
const DEPORTE = {
  laliga: "soccer_spain_la_liga", premier: "soccer_epl", seriea: "soccer_italy_serie_a",
  bundesliga: "soccer_germany_bundesliga", ligue1: "soccer_france_ligue_one",
  champions: "soccer_uefa_champs_league", europa: "soccer_uefa_europa_league", conference: "soccer_uefa_europa_conference_league",
};
function parecido(a, b) {
  const A = new Set(normal(a).split(" ")), B = new Set(normal(b).split(" "));
  let c = 0; A.forEach((t) => { if (t.length > 2 && B.has(t)) c++; });
  return c / Math.max(1, Math.min(A.size, B.size)) + (normal(a).includes(normal(b)) || normal(b).includes(normal(a)) ? 1 : 0);
}
async function cargarVivo(p) {
  const est = $("#estadoVivo"); est.textContent = "Cargando…";
  try {
    const sport = DEPORTE[p.comp];
    const base = "https://api.the-odds-api.com/v4/sports/" + sport;
    const r = await fetch(`${base}/events?apiKey=${encodeURIComponent(AJ.oddsKey)}`);
    if (!r.ok) throw new Error(r.status === 401 ? "clave no válida" : "error " + r.status);
    const eventos = await r.json();
    const t = new Date(p.fecha).getTime();
    const nl = [nombre(p.l), p.l.split(":")[1]], nv = [nombre(p.v), p.v.split(":")[1]];
    let mejor = null, mp = 0;
    for (const e of eventos) {
      if (Math.abs(new Date(e.commence_time).getTime() - t) > 36 * 3600e3) continue;
      const s = Math.max(...nl.map((n) => parecido(n, e.home_team))) + Math.max(...nv.map((n) => parecido(n, e.away_team)));
      if (s > mp) { mp = s; mejor = e; }
    }
    if (!mejor || mp < 0.6) throw new Error("no encuentro este partido en The Odds API (puede que aún no tenga cuotas)");
    const mercadosApi = "h2h,totals,spreads,btts,draw_no_bet,alternate_totals,team_totals,alternate_totals_corners,alternate_totals_cards";
    const r2 = await fetch(`${base}/events/${mejor.id}/odds?apiKey=${encodeURIComponent(AJ.oddsKey)}&regions=eu,uk&oddsFormat=decimal&markets=${mercadosApi}`);
    if (!r2.ok) throw new Error("error " + r2.status + " al pedir cuotas");
    const ev = await r2.json();
    const acum = {};
    const meter = (k, precio) => { if (!k || !(precio > 1)) return; const a = (acum[k] = acum[k] || { s: 0, n: 0, max: 0 }); a.s += precio; a.n++; a.max = Math.max(a.max, precio); };
    for (const bk of ev.bookmakers || []) for (const mk of bk.markets || []) for (const o of mk.outcomes || []) {
      const lado = o.name === mejor.home_team ? "1" : o.name === mejor.away_team ? "2" : null;
      const ou = o.name === "Over" ? "o" : o.name === "Under" ? "u" : null;
      let k = null;
      switch (mk.key) {
        case "h2h": k = lado ? `1x2:${lado}` : o.name === "Draw" ? "1x2:X" : null; break;
        case "draw_no_bet": k = lado ? `dnb:${lado}` : null; break;
        case "btts": k = o.name === "Yes" ? "btts:si" : o.name === "No" ? "btts:no" : null; break;
        case "spreads": k = lado ? `ah:${lado}:${linea(o.point)}` : null; break;
        case "totals": case "alternate_totals": k = ou ? `g:${ou}:${linea(o.point)}` : null; break;
        case "team_totals": {
          const eq = o.description === mejor.home_team ? "gl" : o.description === mejor.away_team ? "gv" : null;
          k = eq && ou ? `${eq}:${ou}:${linea(o.point)}` : null; break;
        }
        case "alternate_totals_corners": k = ou ? `c:${ou}:${linea(o.point)}` : null; break;
        case "alternate_totals_cards": k = ou ? `t:${ou}:${linea(o.point)}` : null; break;
      }
      meter(k, o.price);
    }
    const cuotas = {};
    for (const [k, a] of Object.entries(acum)) cuotas[k] = { avg: +(a.s / a.n).toFixed(3), max: a.max, n: a.n };
    VIVO[p.id] = { t: Date.now(), cuotas };
    guardar("cj_vivo", VIVO); VERSION++;
    const quedan = r2.headers.get("x-requests-remaining");
    render();
    const e2 = $("#estadoVivo"); if (e2) e2.textContent += quedan ? ` · te quedan ${quedan} créditos este mes` : "";
  } catch (e) {
    est.textContent = "No se pudieron cargar: " + e.message + ".";
  }
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
function abrirAjustes() {
  const d = $("#ajustes");
  $("#ajCasa").value = AJ.casa; $("#ajEdge").value = AJ.minEdge; $("#ajPeso").value = AJ.pesoModelo;
  $("#ajProb").value = AJ.probMin; $("#ajOU").value = AJ.cuotaMinOU; $("#ajMin").value = AJ.cuotaMin; $("#ajMax").value = AJ.cuotaMax; $("#ajKey").value = AJ.oddsKey;
  d.showModal();
}
function guardarAjustes(e) {
  e.preventDefault();
  const n = (id, def) => { const v = parseFloat($(id).value); return isFinite(v) ? v : def; };
  AJ = { casa: $("#ajCasa").value, minEdge: n("#ajEdge", 100), pesoModelo: Math.min(100, Math.max(0, n("#ajPeso", 100))),
    probMin: n("#ajProb", 25), cuotaMinOU: n("#ajOU", 1.15),
    cuotaMin: n("#ajMin", 1.01), cuotaMax: n("#ajMax", 50), oddsKey: $("#ajKey").value.trim() };
  guardar("cj_ajustes2", AJ); VERSION++;
  $("#ajustes").close();
  render();
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function iniciar() {
  try {
    const r = await fetch("datos.json", { cache: "no-cache" });
    D = await r.json();
  } catch (e) {
    $("#main").innerHTML = `<div class="vacio">No encuentro <b>datos.json</b>. Ejecuta <code>python3 actualizar_datos.py</code> y abre la web con <code>iniciar_apuestas.sh</code> (no con doble clic sobre el HTML).</div>`;
    return;
  }
  const gen = new Date(D.generado);
  $("#meta").textContent = `Temporada ${D.temporada} · datos del ${gen.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} a las ${gen.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
  const nav = $("nav.comps");
  nav.innerHTML = `<button data-v="picks" class="picks">🔥 Mejores picks</button>` +
    D.competiciones.map((c) => `<button data-v="${c.id}">${c.bandera} ${esc(c.corto)}</button>`).join("") +
    `<button data-v="rend">📈 Rendimiento</button>`;
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const v = b.dataset.v;
    if (v === "picks" || v === "rend") EST.vista = v;
    else { EST.vista = "comp"; EST.comp = v; EST.jornada = comp(v).actual; }
    render();
  });
  $("#main").addEventListener("click", (e) => {
    const f = e.target.closest(".partido, tr.clic");
    if (f) { const p = D.partidos.find((x) => x.id === f.dataset.id); EST.partido = p.id; EST.comp = p.comp; EST.jornada = p.j; EST.vista = "partido"; render(); return; }
    const fl = e.target.closest("[data-j]");
    if (fl) { const c = comp(EST.comp), i = c.jornadas.indexOf(EST.jornada) + +fl.dataset.j; if (c.jornadas[i] != null) { EST.jornada = c.jornadas[i]; render(); } }
  });
  $("#main").addEventListener("change", (e) => { if (e.target.id === "selJ") { EST.jornada = +e.target.value; render(); } });
  $("#btnAjustes").addEventListener("click", abrirAjustes);
  $("#formAjustes").addEventListener("submit", guardarAjustes);
  $("#cerrarAjustes").addEventListener("click", () => $("#ajustes").close());
  render();
}
iniciar();
