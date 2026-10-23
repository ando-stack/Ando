/**
 * Punto de entrada de la ingesta.
 *   npx tsx ingest/run.ts <nba|euroleague|acb|all> [--raw-only] [--build-only]
 * Fase "raw": descarga partidos (box scores) y plantillas a data/games/<comp>/.
 * Fase "build": calcula estadísticas, quintetos probables, rotaciones y bajas en data/snapshot/<comp>.json.
 * Si una fuente falla, se conservan los últimos datos válidos y se registra el error en data_updates.
 */
import { CURRENT_SEASON, PREVIOUS_SEASON, ACB_MATCH_RANGES } from '../config/temporadas';
import { ingestEuroleagueSeason, ingestEuroleagueRoster } from './euroleague';
import { ingestAcbSeason, ingestAcbRoster } from './acb';
import { ingestNbaSeason, ingestNbaRoster } from './nba';
import { buildSnapshot } from './build';
import { log, readJson, writeJson } from './lib/util';
import type { CompetitionId } from '../engine/datatypes';

const args = process.argv.slice(2);
const target = args[0] ?? 'all';
const rawOnly = args.includes('--raw-only');
const buildOnly = args.includes('--build-only');
const skipPrev = args.includes('--skip-previous');

interface UpdateLog {
  comp: CompetitionId;
  step: string;
  ok: boolean;
  message: string;
  at: string;
}
const updates: UpdateLog[] = readJson<UpdateLog[]>('data/data_updates.json') ?? [];
function record(comp: CompetitionId, step: string, ok: boolean, message: string) {
  updates.push({ comp, step, ok, message, at: new Date().toISOString() });
  writeJson('data/data_updates.json', updates.slice(-500));
}

async function step(comp: CompetitionId, name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    record(comp, name, true, 'ok');
  } catch (e) {
    const msg = (e as Error).message;
    log(`ERROR ${comp} ${name}: ${msg} — se mantienen los últimos datos válidos`);
    record(comp, name, false, msg);
  }
}

async function raw(comp: CompetitionId) {
  if (comp === 'euroleague') {
    if (!skipPrev) await step(comp, `partidos ${PREVIOUS_SEASON}`, () => ingestEuroleagueSeason(PREVIOUS_SEASON, { withPbp: true, maxAgeHours: 24 * 30 }));
    await step(comp, `partidos ${CURRENT_SEASON}`, () => ingestEuroleagueSeason(CURRENT_SEASON, { withPbp: true, maxAgeHours: 3 }));
    await step(comp, `plantillas ${CURRENT_SEASON}`, () => ingestEuroleagueRoster(CURRENT_SEASON));
  }
  if (comp === 'acb') {
    await step(comp, `plantillas ${CURRENT_SEASON}`, () => ingestAcbRoster(CURRENT_SEASON));
    const cur = ACB_MATCH_RANGES[CURRENT_SEASON];
    await step(comp, `partidos ${CURRENT_SEASON}`, () => ingestAcbSeason(CURRENT_SEASON, cur.ranges, cur.stopAfterMisses));
    if (!skipPrev) {
      const prev = ACB_MATCH_RANGES[PREVIOUS_SEASON];
      await step(comp, `partidos ${PREVIOUS_SEASON}`, () => ingestAcbSeason(PREVIOUS_SEASON, prev.ranges, prev.stopAfterMisses));
    }
  }
  if (comp === 'nba') {
    await step(comp, `partidos ${CURRENT_SEASON}`, async () => {
      const f = await ingestNbaSeason(CURRENT_SEASON, { exactStarters: true, maxAgeHours: 3 });
      await ingestNbaRoster(CURRENT_SEASON, f);
    });
    if (!skipPrev) await step(comp, `partidos ${PREVIOUS_SEASON}`, () => ingestNbaSeason(PREVIOUS_SEASON, { exactStarters: false, maxAgeHours: 24 * 30 }));
  }
}

const comps: CompetitionId[] = target === 'all' ? ['euroleague', 'acb', 'nba'] : [target as CompetitionId];
// --season AAAA-AA: descarga solo los partidos de esa temporada (por ejemplo, la base del backtest)
const si = args.indexOf('--season');
if (si > 0) {
  const season = args[si + 1];
  for (const c of comps) {
    if (c === 'euroleague') await step(c, `partidos ${season}`, () => ingestEuroleagueSeason(season, { withPbp: false, maxAgeHours: 24 * 30 }));
    if (c === 'acb') await step(c, `partidos ${season}`, () => ingestAcbSeason(season, ACB_MATCH_RANGES[season].ranges, 0));
    if (c === 'nba') await step(c, `partidos ${season}`, () => ingestNbaSeason(season, { exactStarters: false, maxAgeHours: 24 * 30 }));
  }
  log('Ingesta terminada');
  process.exit(0);
}
for (const c of comps) {
  if (!buildOnly) await raw(c);
  if (!rawOnly) await step(c, 'snapshot', () => buildSnapshot(c));
}
log('Ingesta terminada');
