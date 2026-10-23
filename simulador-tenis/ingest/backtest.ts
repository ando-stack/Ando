/**
 * Backtest de la temporada 2025 (fuera de la muestra de calibración, que es 2024).
 * Para cada partido se usan SÓLO los datos anteriores a él (walk-forward).
 * Uso: npm run backtest   → docs/validacion.md y public/data/validacion.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOMBRE_CIRCUITO, NOMBRE_SUPERFICIE, type Circuito, type Superficie } from '../config/formatos';
import { parametrosPartido } from '../engine/modelo';
import { cargarHistoricoCache } from './historico';
import { cargarCalibracion, construirParams, mediasDesde } from './ajuste';
import { muestrear, pOver, recolectar, simularCaso, type Caso } from './evaluacion';
import { dias, log } from './lib/util';
import { DIR_PUBLICO } from './publicar';

const TEMPORADA = Number(process.env.TEMPORADA_BACKTEST ?? 2025);
const S = 300;
const POR_GRUPO = Number(process.env.BACKTEST_POR_GRUPO ?? 1200);
const cl = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

interface Pred {
  c: Caso;
  p: number;
  pElo: number;
  pEst: number;
}

const ll = (p: number, y: number) => -(y * Math.log(cl(p)) + (1 - y) * Math.log(1 - cl(p)));
const brier = (p: number, y: number) => (p - y) ** 2;

function resumenVictoria(ps: Pred[]) {
  const n = ps.length || 1;
  const s = { ll: 0, br: 0, ac: 0, llElo: 0, llEst: 0 };
  for (const x of ps) {
    const y = x.c.real.ganaA ? 1 : 0;
    s.ll += ll(x.p, y);
    s.br += brier(x.p, y);
    s.ac += (x.p >= 0.5 ? 1 : 0) === y ? 1 : 0;
    s.llElo += ll(x.pElo, y);
    s.llEst += ll(x.pEst, y);
  }
  return { n: ps.length, logLoss: s.ll / n, brier: s.br / n, aciertos: s.ac / n, logLossElo: s.llElo / n, logLossEst: s.llEst / n };
}

function binsCalibracion(pares: { p: number; y: number }[], nBins = 10) {
  const bins = Array.from({ length: nBins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const { p, y } of pares) {
    const b = Math.min(nBins - 1, Math.floor(p * nBins));
    bins[b].n++;
    bins[b].p += p;
    bins[b].y += y;
  }
  return bins.map((b, i) => ({ rango: `${(i / nBins).toFixed(1)}–${((i + 1) / nBins).toFixed(1)}`, n: b.n, predicho: b.n ? b.p / b.n : 0, real: b.n ? b.y / b.n : 0 }));
}

const f3 = (x: number) => x.toFixed(3);
const f2 = (x: number) => x.toFixed(2);
const p1 = (x: number) => `${(100 * x).toFixed(1)} %`;

function main() {
  const t0 = Date.now();
  const partidos = cargarHistoricoCache();
  const base = construirParams(cargarCalibracion(), mediasDesde(partidos, dias(`${TEMPORADA - 3}-01-01`), dias(`${TEMPORADA}-01-01`)));
  const { casos, M } = recolectar(partidos, base, TEMPORADA, { desdeStats: dias(`${TEMPORADA - 2}-01-01`) });
  log(`Backtest ${TEMPORADA}: ${casos.length} partidos; parámetros ${base.version}`);

  // Probabilidad de victoria: todos los partidos (cálculo exacto, sin simular).
  const preds: Pred[] = [];
  casos.forEach((c, i) => {
    const { detalle } = parametrosPartido(c.A, c.B, { superficie: c.sup, circuito: c.circuito, formato: c.formato }, M);
    preds.push({ c, p: detalle.pFormato, pElo: detalle.pElo, pEst: detalle.pEstadisticas });
    if (i % 5000 === 0) log('  victoria', i);
  });

  // Distribuciones: muestra de partidos con estadísticas, simulados punto a punto.
  const muestra = muestrear(casos, POR_GRUPO, (c) => c.conStats);
  log('Simulando', muestra.length, 'partidos ×', S);
  const dist = muestra.map((c, i) => {
    const s = simularCaso(c, M, S, 77 + i);
    const lineaJ = Math.floor(s.mediaJuegos) + 0.5;
    const lineaA = Math.floor(s.mediaAces) + 0.5;
    return {
      c,
      s,
      lineaJ,
      pOverJ: pOver(s.juegos, lineaJ),
      overJ: c.real.juegos > lineaJ ? 1 : 0,
      lineaA,
      pOverA: pOver(s.aces, lineaA),
      overA: (c.real.aces ?? 0) > lineaA ? 1 : 0,
    };
  });

  const grupos = new Map<string, Pred[]>();
  for (const x of preds) {
    for (const k of [x.c.circuito, `${x.c.circuito}|${x.c.sup}`, 'Todos']) grupos.set(k, [...(grupos.get(k) ?? []), x]);
  }
  const nombreGrupo = (k: string) => {
    if (k === 'Todos') return 'Todos';
    const [c, s] = k.split('|');
    return `${NOMBRE_CIRCUITO[c as Circuito]}${s ? ` · ${NOMBRE_SUPERFICIE[s as Superficie]}` : ''}`;
  };
  const orden = [...grupos.keys()].sort((a, b) => (a === 'Todos' ? -1 : b === 'Todos' ? 1 : a.localeCompare(b)));
  const filas = orden.filter((k) => (grupos.get(k)?.length ?? 0) >= 50).map((k) => ({ grupo: nombreGrupo(k), clave: k, ...resumenVictoria(grupos.get(k)!) }));

  const distGrupo = new Map<string, typeof dist>();
  for (const d of dist) for (const k of [d.c.circuito, `${d.c.circuito}|${d.c.sup}`, 'Todos']) distGrupo.set(k, [...(distGrupo.get(k) ?? []), d]);
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const filasDist = orden
    .filter((k) => (distGrupo.get(k)?.length ?? 0) >= 50)
    .map((k) => {
      const ds = distGrupo.get(k)!;
      return {
        grupo: nombreGrupo(k),
        n: ds.length,
        juegosSim: media(ds.map((d) => d.s.mediaJuegos)),
        juegosReal: media(ds.map((d) => d.c.real.juegos)),
        brierOverJ: media(ds.map((d) => brier(d.pOverJ, d.overJ))),
        overJSim: media(ds.map((d) => d.pOverJ)),
        overJReal: media(ds.map((d) => d.overJ)),
        decisivoSim: media(ds.map((d) => d.s.pDecisivo)),
        decisivoReal: media(ds.map((d) => (d.c.real.decisivo ? 1 : 0))),
        brierDecisivo: media(ds.map((d) => brier(d.s.pDecisivo, d.c.real.decisivo ? 1 : 0))),
        acesSim: media(ds.map((d) => d.s.mediaAces)),
        acesReal: media(ds.map((d) => d.c.real.aces ?? 0)),
        brierOverA: media(ds.map((d) => brier(d.pOverA, d.overA))),
        doblesSim: media(ds.map((d) => d.s.mediaDobles)),
        doblesReal: media(ds.map((d) => d.c.real.dobles ?? 0)),
        breaksSim: media(ds.map((d) => d.s.mediaBreaks)),
        breaksReal: media(ds.map((d) => d.c.real.breaks ?? 0)),
        tbSim: media(ds.map((d) => d.s.mediaTb)),
        tbReal: media(ds.map((d) => d.c.real.tiebreaks)),
      };
    });

  const calVictoria = binsCalibracion(preds.map((x) => ({ p: x.p, y: x.c.real.ganaA ? 1 : 0 })));
  const calJuegos = binsCalibracion(dist.map((d) => ({ p: d.pOverJ, y: d.overJ })), 5);
  const calSets = binsCalibracion(dist.map((d) => ({ p: d.s.pDecisivo, y: d.c.real.decisivo ? 1 : 0 })), 5);
  const calAces = binsCalibracion(dist.map((d) => ({ p: d.pOverA, y: d.overA })), 5);

  // ---------- Informe ----------
  const tablaCal = (t: ReturnType<typeof binsCalibracion>) =>
    ['| Rango predicho | Partidos | Predicho | Real |', '|---|---:|---:|---:|', ...t.filter((b) => b.n).map((b) => `| ${b.rango} | ${b.n} | ${p1(b.predicho)} | ${p1(b.real)} |`)].join('\n');
  const md = `# Validación del modelo (backtest)

Generado automáticamente por \`npm run backtest\` el ${new Date().toISOString().slice(0, 10)}.

- **Temporada evaluada:** ${TEMPORADA} (ATP, ATP Challenger, WTA y WTA 125; cuadro final y previa).
- **Sin mirar el futuro:** el histórico se recorre en orden y cada partido se predice con los perfiles, el Elo y la forma calculados sólo con partidos anteriores. Las medias del circuito se calculan con las tres temporadas previas.
- **Parámetros:** \`${base.version}\` — calibrados con la temporada ${TEMPORADA - 1} (\`npm run calibrar\`), que no se solapa con la evaluada.
- **Partidos:** ${preds.length.toLocaleString('es-ES')} para la probabilidad de victoria (cálculo exacto) y ${dist.length.toLocaleString('es-ES')} con estadísticas detalladas para las distribuciones (simulación punto a punto, ${S} simulaciones por partido; hasta ${POR_GRUPO} por circuito y superficie). Se excluyen retiradas y walkovers.
- Peso del Elo ${M.pesoElo}, peso de la superficie en el Elo ${M.pesoSuperficieElo}, forma ${M.gammaForma}, σ = ${M.sigma}, σ aces = ${M.sigmaAces}.

## 1. Probabilidad de victoria

Log loss y Brier: cuanto más bajos, mejor (una moneda al aire da log loss 0,693 y Brier 0,25). Se compara el modelo combinado con el Elo de superficie solo y con las estadísticas de saque/resto solas.

| Grupo | Partidos | Log loss | Brier | Aciertos | Log loss sólo Elo | Log loss sólo estadísticas |
|---|---:|---:|---:|---:|---:|---:|
${filas.map((f) => `| ${f.grupo} | ${f.n} | ${f3(f.logLoss)} | ${f3(f.brier)} | ${p1(f.aciertos)} | ${f3(f.logLossElo)} | ${f3(f.logLossEst)} |`).join('\n')}

### Calibración de la probabilidad de victoria (todos los partidos)

${tablaCal(calVictoria)}

## 2. Distribuciones simuladas frente a la realidad

Medias por partido (simulado / real). «Over» = P(total por encima de la línea suelo(media simulada) + 0,5); se compara la probabilidad media predicha con la frecuencia real y se da su Brier.

| Grupo | Partidos | Juegos sim / real | P(over juegos) pred / real (Brier) | P(set decisivo) pred / real (Brier) | Aces sim / real | P(over aces) Brier | Dobles faltas sim / real | Breaks sim / real | Tie-breaks sim / real |
|---|---:|---|---|---|---|---:|---|---|---|
${filasDist
  .map(
    (f) =>
      `| ${f.grupo} | ${f.n} | ${f2(f.juegosSim)} / ${f2(f.juegosReal)} | ${p1(f.overJSim)} / ${p1(f.overJReal)} (${f3(f.brierOverJ)}) | ${p1(f.decisivoSim)} / ${p1(f.decisivoReal)} (${f3(f.brierDecisivo)}) | ${f2(f.acesSim)} / ${f2(f.acesReal)} | ${f3(f.brierOverA)} | ${f2(f.doblesSim)} / ${f2(f.doblesReal)} | ${f2(f.breaksSim)} / ${f2(f.breaksReal)} | ${f2(f.tbSim)} / ${f2(f.tbReal)} |`,
  )
  .join('\n')}

### Calibración del over/under de juegos

${tablaCal(calJuegos)}

### Calibración de P(set decisivo) (número de sets)

${tablaCal(calSets)}

### Calibración del over/under de aces

${tablaCal(calAces)}

## 3. Lectura de los resultados

Ver la sección «Interpretación» de docs/modelo.md: qué significa cada métrica, qué grupos tienen menos datos y los ajustes hechos tras el backtest.
`;
  mkdirSync(join(import.meta.dirname, '..', 'docs'), { recursive: true });
  writeFileSync(join(import.meta.dirname, '..', 'docs', 'validacion.md'), md);
  mkdirSync(DIR_PUBLICO, { recursive: true });
  writeFileSync(join(DIR_PUBLICO, 'validacion.json'), JSON.stringify({ temporada: String(TEMPORADA), filas, filasDist, calVictoria, calJuegos, calSets, calAces }));
  log(`Backtest terminado en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const f of filas) log(f.grupo.padEnd(28), f.n, 'LL', f3(f.logLoss), 'Elo', f3(f.logLossElo), 'Est', f3(f.logLossEst), 'Brier', f3(f.brier), 'Ac', p1(f.aciertos));
  for (const f of filasDist) log(f.grupo.padEnd(28), 'juegos', f2(f.juegosSim), f2(f.juegosReal), 'dec', p1(f.decisivoSim), p1(f.decisivoReal), 'aces', f2(f.acesSim), f2(f.acesReal), 'df', f2(f.doblesSim), f2(f.doblesReal), 'brk', f2(f.breaksSim), f2(f.breaksReal), 'tb', f2(f.tbSim), f2(f.tbReal));
}

main();
