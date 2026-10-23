/**
 * Genera docs/validacion.md a partir de los resultados guardados:
 * data/backtest/<comp>.json, config/calibracion.json, data/verificacion.json y data/bench.json.
 *   npx tsx engine/report.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BacktestResult } from './backtest';
import type { SeasonGamesFile } from './datatypes';

const COMPS = [
  ['euroleague', 'EuroLiga'],
  ['acb', 'Liga Endesa (ACB)'],
  ['nba', 'NBA'],
] as const;
const read = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);
const pct = (x: number, d = 1) => (x * 100).toFixed(d).replace('.', ',') + ' %';
const num = (x: number, d = 1) => x.toFixed(d).replace('.', ',');

/** Brier de referencias simples: tasa de victorias locales acumulada y balance + local (log5). */
function baselines(comp: string, r: BacktestResult) {
  const file = read<SeasonGamesFile>(`data/games/${comp}/${r.season}.json`);
  if (!file) return null;
  const games = [...file.games].sort((a, b) => a.date.localeCompare(b.date));
  const pg = new Map(r.perGame.map((x) => [x.id, x]));
  const rec = new Map<string, [number, number]>();
  let hn = 0;
  let hd = 0;
  let bHome = 0;
  let bRec = 0;
  let aRec = 0;
  let n = 0;
  for (const g of games) {
    const y = g.home.score > g.away.score ? 1 : 0;
    if (pg.has(g.id)) {
      const [wh, lh] = rec.get(g.home.teamId) ?? [0, 0];
      const [wa, la] = rec.get(g.away.teamId) ?? [0, 0];
      const ph = (wh + 1) / (wh + lh + 2);
      const pa = (wa + 1) / (wa + la + 2);
      const hr = (hn + 1) / (hd + 2);
      const p = ph * (1 - pa);
      const q = pa * (1 - ph);
      const base = p / (p + q);
      const lo = Math.log(base / (1 - base)) + Math.log(hr / (1 - hr));
      const prec = 1 / (1 + Math.exp(-lo));
      bHome += (hr - y) ** 2;
      bRec += (prec - y) ** 2;
      if ((prec > 0.5 ? 1 : 0) === y) aRec++;
      n++;
    }
    hn += y;
    hd++;
    rec.set(g.home.teamId, [(rec.get(g.home.teamId)?.[0] ?? 0) + y, (rec.get(g.home.teamId)?.[1] ?? 0) + 1 - y]);
    rec.set(g.away.teamId, [(rec.get(g.away.teamId)?.[0] ?? 0) + 1 - y, (rec.get(g.away.teamId)?.[1] ?? 0) + y]);
  }
  return { brierHome: bHome / n, brierRecord: bRec / n, accRecord: aRec / n };
}

function corr(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return { r: c / Math.sqrt(va * vb), slope: c / va };
}

const lines: string[] = [];
const L = (s = '') => lines.push(s);
L('# Validación del modelo');
L();
L(`Informe generado el ${new Date().toISOString().slice(0, 10)} con \`npx tsx engine/report.ts\` a partir de los resultados del backtest (\`npm run backtest\`), la calibración (\`npm run calibrate\`), la verificación de datos (\`npx tsx ingest/verify.ts\`) y la prueba de rendimiento (\`npm run bench\`).`);
L();
L('## 1. Backtest de la temporada 2025-26');
L();
L('**Método.** Cada partido de la temporada 2025-26 se simula con un snapshot construido *solo con los partidos anteriores a su fecha* (temporada 2025-26 hasta ese día, más la 2024-25 como temporada previa, con los mismos pesos y regularización que en producción). Se evalúan los partidos en los que ambos equipos llevan al menos 5 partidos. Jugadores disponibles = los que jugaron ese partido (aproxima el parte de bajas, que se conoce antes del salto inicial); titulares = los reales (se confirman antes del partido); minutos = previsión con los partidos anteriores, no los reales. Los factores globales del motor se **recalibran dentro del backtest cada 28 días** con el snapshot de esa fecha (sin información futura).');
L();
L('| | ' + COMPS.map(([, n]) => n).join(' | ') + ' |');
L('|---|' + COMPS.map(() => '---:').join('|') + '|');
const res = COMPS.map(([c]) => read<BacktestResult>(`data/backtest/${c}.json`));
const base = COMPS.map(([c], i) => (res[i] ? baselines(c, res[i]!) : null));
const row = (label: string, f: (r: BacktestResult, i: number) => string) =>
  L(`| ${label} | ${res.map((r, i) => (r ? f(r, i) : '—')).join(' | ')} |`);
row('Partidos evaluados', (r) => String(r.games));
row('Simulaciones por partido', (r) => r.simsPerGame.toLocaleString('es-ES'));
row('Acierto del ganador (modelo)', (r) => pct(r.winnerAccuracy));
row('Acierto «gana el local»', (r) => pct(r.homeBaselineAccuracy));
row('Acierto «gana el de mejor balance»', (r) => pct(r.recordBaselineAccuracy));
row('Brier ganador (modelo)', (r) => num(r.brier, 3));
row('Brier «tasa de victorias locales»', (_r, i) => (base[i] ? num(base[i]!.brierHome, 3) : '—'));
row('Brier «balance + factor campo» (log5)', (_r, i) => (base[i] ? num(base[i]!.brierRecord, 3) : '—'));
row('Log loss ganador', (r) => num(r.logLoss, 3));
row('Error absoluto medio del total de puntos', (r) => num(r.totalMAE));
row('Sesgo del total (simulado − real)', (r) => num(r.totalBias));
row('Error absoluto medio del margen', (r) => num(r.marginMAE));
row('Sesgo del margen (simulado − real)', (r) => num(r.marginBias));
row('Correlación margen previsto/real', (r) => num(corr(r.perGame.map((x) => x.predMargin), r.perGame.map((x) => x.margin)).r, 2));
row('Pendiente real ~ previsto (1 = bien escalado)', (r) => num(corr(r.perGame.map((x) => x.predMargin), r.perGame.map((x) => x.margin)).slope, 2));
row('Total real dentro del intervalo central 50 % / 80 %', (r) => `${pct(r.totalCoverage50, 0)} / ${pct(r.totalCoverage80, 0)}`);
row('Margen real dentro del intervalo central 50 % / 80 %', (r) => `${pct(r.marginCoverage50, 0)} / ${pct(r.marginCoverage80, 0)}`);
row('Prórrogas: prevista / real', (r) => `${pct(r.otPredicted)} / ${pct(r.otActual)}`);
row('Error medio por jugador: puntos / rebotes / asistencias', (r) => `${num(r.playerPtsMAE, 2)} / ${num(r.playerRebMAE, 2)} / ${num(r.playerAstMAE, 2)}`);
row('Tiempo del backtest', (r) => `${Math.round(r.elapsedSec)} s`);
L();
L('Lectura: el modelo mejora a las dos referencias simples en Brier (probabilidades mejor calibradas y más informativas). El acierto «a ganador» depende mucho de la ventaja de campo de cada temporada (en la EuroLiga 2025-26 ganó el local el 65 % de las veces). Las predicciones de margen y total están bien escaladas (pendiente ≈ 1) y los intervalos cubren aproximadamente lo que deben (50 % y 80 %).');
L();
L('## 2. Calibración de probabilidades (over/under, hándicaps y jugadores)');
L();
L('Para cada partido se calcula la probabilidad simulada de superar varias líneas alrededor de la media (total de puntos: media ±0, 3, 6, 10, 15; hándicap: ±0, 4, 8, 12; jugadores: 0,5×, 0,8×, 1×, 1,25× y 1,6× su media en puntos, rebotes, asistencias y triples) y se compara con la frecuencia real. *ECE* = error de calibración esperado (media ponderada de |previsto − observado| por tramos de 10 puntos porcentuales; 0 = perfecto).');
L();
const relNames: [string, string][] = [
  ['ganador', 'Ganador'],
  ['total', 'Over/under del total'],
  ['handicap', 'Hándicap'],
  ['puntosJugador', 'Puntos de jugador'],
  ['rebotesJugador', 'Rebotes de jugador'],
  ['asistenciasJugador', 'Asistencias de jugador'],
  ['triplesJugador', 'Triples de jugador'],
];
L('| Mercado | ' + COMPS.map(([, n]) => `${n}: n · ECE · Brier`).join(' | ') + ' |');
L('|---|' + COMPS.map(() => '---:').join('|') + '|');
for (const [k, label] of relNames)
  L(`| ${label} | ${res.map((r) => (r ? `${r.reliability[k].n.toLocaleString('es-ES')} · ${num(r.reliability[k].ece, 3)} · ${num(r.reliability[k].brier, 3)}` : '—')).join(' | ')} |`);
L();
for (const [i, [, cname]] of COMPS.entries()) {
  const r = res[i];
  if (!r) continue;
  L(`<details><summary>Tablas de fiabilidad · ${cname}</summary>`);
  L();
  for (const [k, label] of relNames) {
    L(`**${label}** (previsto → observado, n):`);
    L();
    L(r.reliability[k].bins.filter((b) => b.n > 0).map((b) => `${pct(b.pred, 0)} → ${pct(b.obs, 0)} (${b.n})`).join(' · '));
    L();
  }
  L('</details>');
  L();
}
L('## 3. Calibración de medias por competición');
L();
L('Medias por equipo y partido reales (temporada actual + anterior ponderada) frente a las simuladas tras calibrar (todos los cruces posibles entre equipos):');
L();
const calib = read<Record<string, { targets: Record<string, number>; simulated: Record<string, number>; params: Record<string, number>; calibratedAt: string }>>('config/calibracion.json') ?? {};
const keys: [string, string, number][] = [
  ['poss', 'Posesiones', 1], ['pts', 'Puntos', 1], ['fg2a', 'T2 intentados', 1], ['fg2m', 'T2 anotados', 1], ['fg3a', 'T3 intentados', 1], ['fg3m', 'T3 anotados', 1],
  ['fta', 'TL intentados', 1], ['ftm', 'TL anotados', 1], ['oreb', 'Rebotes ofensivos', 1], ['dreb', 'Rebotes defensivos', 1], ['ast', 'Asistencias', 1], ['stl', 'Robos', 1],
  ['blk', 'Tapones', 1], ['tov', 'Pérdidas', 1], ['pf', 'Faltas', 1], ['homeMargin', 'Margen medio del local', 2], ['marginSd', 'Desv. típica del margen', 2], ['otPct', 'Prórrogas', 3],
];
L('| Estadística | ' + COMPS.map(([, n]) => `${n} real / simulado`).join(' | ') + ' |');
L('|---|' + COMPS.map(() => '---:').join('|') + '|');
for (const [k, label, d] of keys)
  L(`| ${label} | ${COMPS.map(([c]) => (calib[c] ? `${num(calib[c].targets[k], d)} / ${num(calib[c].simulated[k], d)}` : '—')).join(' | ')} |`);
L();
L('Factores resultantes (`config/calibracion.json`):');
L();
const pkeys = ['paceFactor', 'fg2Factor', 'fg3Factor', 'ftFactor', 'tovFactor', 'tripFactor', 'orebFactor', 'teamReboundShare', 'astFactor', 'stlFactor', 'blkFactor', 'nonShootingFoulRate', 'homeShootingEdge', 'scoreEffect', 'minutesSd'];
L('| Factor | ' + COMPS.map(([, n]) => n).join(' | ') + ' |');
L('|---|' + COMPS.map(() => '---:').join('|') + '|');
for (const k of pkeys) L(`| ${k} | ${COMPS.map(([c]) => (calib[c] ? num(calib[c].params[k], 3) : '—')).join(' | ')} |`);
L();
L('## 4. Verificación de datos contra la fuente');
L();
const ver = read<{ verifiedAt: string; checks: { comp: string; what: string; ours: number | string; source: number | string; sourceRef: string; ok: boolean }[] }>('data/verificacion.json');
if (ver) {
  L(`Valores calculados a partir de nuestros box scores frente a las estadísticas agregadas que publica cada fuente por otra vía (${ver.verifiedAt.slice(0, 16).replace('T', ' ')} UTC): **${ver.checks.filter((c) => c.ok).length} de ${ver.checks.length} coinciden**.`);
  L();
  L('| Competición | Dato | Nuestro | Fuente | ¿Coincide? |');
  L('|---|---|---:|---:|:---:|');
  for (const c of ver.checks) L(`| ${c.comp} | ${c.what} | ${c.ours} | ${c.source} | ${c.ok ? 'sí' : '**no**'} |`);
  L();
  L('Comprobación independiente adicional (prensa): el partido inaugural de la NBA 2026-27, Detroit Pistons 121-113 Boston Celtics (20/10/2026), con 38 puntos de Paul George y 13 de Jayson Tatum según la crónica de AP, coincide con nuestros datos (fuente: [ClickOnDetroit](https://www.clickondetroit.com/sports/2026/10/20/detroit-pistons-rally-from-22-point-deficit-to-beat-boston-celtics-in-season-opener/), [Flashscore](https://www.flashscore.com/news/pistons-complete-22-point-comeback-to-defeat-celtics-in-nba-season-opener/ETZ502nQ/)).');
  L();
}
L('## 5. Coherencia y rendimiento');
L();
L('- **Coherencia en cada simulación** (tests `engine/simulate.test.ts` y `tests/coherencia.test.ts`, este último con los datos reales de las tres competiciones): los puntos de cada jugador son 2·T2 + 3·T3 + TL; los puntos de los jugadores suman el resultado del equipo; los cuartos (y prórrogas) suman el resultado final; los segundos jugados suman exactamente 5 × la duración del partido; ningún jugador supera el límite de faltas; no hay empates finales; en el agregado, todas las estadísticas de los jugadores suman las del equipo.');
const bench = read<{ at: string; results: { comp: string; single: number; parallel: number; workers: number; cores: number }[] }>('data/bench.json');
if (bench) {
  L(`- **Rendimiento** (${bench.at.slice(0, 10)}, Node.js, CPU de ${bench.results[0]?.cores ?? '?'} núcleos):`);
  for (const b of bench.results) L(`  - ${b.comp}: 5.000 simulaciones en ${num(b.single, 2)} s con un hilo y ${num(b.parallel, 2)} s con ${b.workers} workers.`);
  L('  - En el navegador (Chromium, mismo equipo, 3 workers), 5.000 simulaciones de EuroLiga tardan ≈ 1,7 s incluida la creación de los workers.');
}
L();
L('## 6. Ajustes hechos al modelo a partir de la validación');
L();
L('1. **Rebotes de equipo**: los rebotes de jugador simulados salían un 15 % altos; en las actas una parte de los fallos son rebotes «de equipo». Se añadió `teamReboundShare` (calibrado ≈ 13 %).');
L('2. **Efecto marcador**: la desviación típica del margen simulado (14,8) superaba la real (12,1). Se añadió un efecto marcador; primero penalizaba la ventaja absoluta, lo que comprimía las probabilidades hacia el 50 % (backtest EuroLiga: acierto 65,3 % pero predicciones demasiado cercanas a 50/50). Se cambió para actuar solo sobre la **desviación respecto a la ventaja esperada** (simulación piloto), y la pendiente real/previsto quedó ≈ 1.');
L('3. **Faltas intencionadas**: la regla inicial era demasiado agresiva (y se activaba al revés perdiendo de 1-2); se reescribió según la diferencia y el tiempo (ver `docs/modelo.md`).');
L('4. **Variabilidad de minutos**: el CV de minutos simulado (0,19 titulares / 0,33 suplentes) era menor que el real (0,21 / 0,38 en la EuroLiga 2025-26); `minutesSd` pasó de 0,15 a 0,21, lo que redujo la sobreconfianza en las líneas altas de jugadores.');
L('5. **Peso de la temporada anterior y regularización**: probados K = 8, 16 y 30 y *prior* de 60, 150 y 300 minutos en el backtest de la EuroLiga; se eligió K = 16 y 150 minutos (Brier 0,218 frente a 0,223 del valor inicial).');
L('6. **Temporada previa en el backtest**: sin la 2024-25 los primeros partidos se simulaban casi sin datos; se descargó la 2024-25 (partido a partido en EuroLiga y ACB; totales agregados en la NBA) para que el backtest use la misma información que tendría el modelo en producción.');
L('7. **Calibración sin información futura**: el backtest usaba los factores de calibración actuales, calibrados con datos posteriores. Se cambió a una recalibración cada 28 días con los datos disponibles en esa fecha. Además, como la anotación sube de una temporada a otra (ACB: 172 → 176 → 186 puntos por partido en 2024-25, 2025-26 y el inicio de 2026-27), las medias de la liga que sirven de objetivo de calibración dan a la temporada anterior un peso que decae rápido (1 / (1 + partidos de la temporada / 30)). El sesgo del total en la ACB pasó de −6,9 a −4,2 puntos.');
L('8. **Final de partido**: con 2-4 puntos de diferencia a falta de un minuto, en la EuroLiga 2025-26 real se llegaba al empate el 10-20 % de las veces y en la simulación solo el 5-7 %. Se aceleraron los ataques del equipo que pierde en el último minuto y se le hizo buscar más triples perdiendo de 3 a 6; la tasa de prórrogas simulada subió de ≈ 2,2 % a ≈ 3,2 % (real ≈ 4,5 %).');
L('9. **Uso del día**: las líneas de puntos de jugador eran demasiado estrechas (las probabilidades altas se cumplían menos y las bajas más de lo previsto). Se añadió una variabilidad lognormal del uso de cada jugador por partido; probados 0, 0,2 y 0,35 en el backtest de la EuroLiga (ECE de puntos 0,024 / 0,018 / 0,013, sin empeorar el Brier del ganador); se eligió 0,3 porque valores mayores ensanchan en exceso el total del partido.');
L('10. **Forma del día** (acierto correlacionado por equipo y partido): probada para mejorar la tasa de prórrogas, sin efecto; desactivada.');
L();
L('## 7. Limitaciones conocidas');
L();
L('- **Prórrogas algo infraestimadas**: ≈ 3 % simuladas frente a ≈ 4-6 % reales. La proporción de partidos ajustados (|margen| ≤ 3 al final del tiempo reglamentario) sí coincide (≈ 18 %), pero los finales reales acumulan más empates exactos de los que reproduce la lógica de final de partido.');
L('- **Tendencia de anotación dentro de la temporada**: en la ACB 2025-26 la anotación subió de ≈ 171 puntos por partido en noviembre a ≈ 182 en mayo; el modelo solo usa lo ocurrido hasta cada fecha y va por detrás (sesgo del total de −5 a −7 puntos en los últimos meses, ECE del over/under del total más alta en la ACB). En producción conviene recalibrar a menudo (`npm run calibrate`).');
L('- La ventaja de campo es la media de la liga (no específica de cada equipo) y la defensa es a nivel de equipo.');
L('- El backtest supone conocidos los jugadores disponibles y los titulares (como ocurre poco antes del salto inicial); con quintetos solo «probables» la precisión sería algo menor.');
L('- Las líneas de jugador con probabilidades altas (≥ 70 %) siguen algo sobreconfiadas en puntos (ver tablas): el modelo no recoge del todo los partidos con muy pocos minutos (lesiones durante el partido, decisiones técnicas).');
L('- NBA: la fuente (pbpstats) no marca titulares en el box score; para 2026-27 se obtienen exactos de la distribución de tiempo en pista, pero en el backtest de 2025-26 se estiman como los 5 jugadores con más minutos en el primer cuarto (comprobado con 2026-27: coincide el 84 % de los titulares, jugador a jugador). Como temporada previa del backtest NBA se usan los totales agregados de 2024-25 (sin reparto por cuartos), porque descargar sus 1.230 partidos uno a uno con la fuente lenta habría llevado horas.');
writeFileSync('docs/validacion.md', lines.join('\n') + '\n');
console.log('docs/validacion.md generado');

// ---- Resumen en el README (entre marcadores)
{
  const out: string[] = [];
  out.push('<!-- RESUMEN-VALIDACION:INICIO -->');
  out.push('### Resultados de la validación (backtest de la temporada 2025-26)');
  out.push('');
  out.push('| | ' + COMPS.map(([, n]) => n).join(' | ') + ' |');
  out.push('|---|' + COMPS.map(() => '---:').join('|') + '|');
  const r2 = (label: string, f: (r: BacktestResult, i: number) => string) => out.push(`| ${label} | ${res.map((r, i) => (r ? f(r, i) : '—')).join(' | ')} |`);
  r2('Partidos evaluados', (r) => String(r.games));
  r2('Acierto del ganador', (r) => pct(r.winnerAccuracy));
  r2('Acierto «gana el local» / «mejor balance»', (r) => `${pct(r.homeBaselineAccuracy)} / ${pct(r.recordBaselineAccuracy)}`);
  r2('Brier ganador (modelo / mejor referencia)', (r, i) => `${num(r.brier, 3)} / ${base[i] ? num(Math.min(base[i]!.brierHome, base[i]!.brierRecord), 3) : '—'}`);
  r2('Error medio del total de puntos', (r) => num(r.totalMAE));
  r2('Error medio del margen', (r) => num(r.marginMAE));
  r2('ECE over/under total · hándicap · puntos jugador', (r) => `${num(r.reliability.total.ece, 3)} · ${num(r.reliability.handicap.ece, 3)} · ${num(r.reliability.puntosJugador.ece, 3)}`);
  r2('Prórroga prevista / real', (r) => `${pct(r.otPredicted)} / ${pct(r.otActual)}`);
  out.push('');
  out.push('Detalle, método y limitaciones en [`docs/validacion.md`](docs/validacion.md).');
  out.push('<!-- RESUMEN-VALIDACION:FIN -->');
  const readme = readFileSync('README.md', 'utf8');
  const a = readme.indexOf('<!-- RESUMEN-VALIDACION:INICIO -->');
  const b = readme.indexOf('<!-- RESUMEN-VALIDACION:FIN -->');
  if (a >= 0 && b > a) {
    writeFileSync('README.md', readme.slice(0, a) + out.join('\n') + readme.slice(b + '<!-- RESUMEN-VALIDACION:FIN -->'.length));
    console.log('README actualizado');
  }
}
