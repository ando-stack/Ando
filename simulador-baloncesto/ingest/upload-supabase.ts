/**
 * Sube los snapshots a Supabase con la clave de servicio (solo en el entorno de la ingesta).
 *   npx tsx ingest/upload-supabase.ts [nba|euroleague|acb|all]
 * Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno o en .env.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import type { CompetitionSnapshot } from '../engine/snapshot';
import type { CompetitionId } from '../engine/datatypes';
import { snapshotToRows, TABLES } from './lib/supabase-map';
import { readJson } from './lib/util';

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
} catch {
  /* sin .env */
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: no se sube nada (la app seguirá usando los snapshots estáticos).');
  process.exit(0);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const arg = process.argv[2] ?? 'all';
const comps: CompetitionId[] = arg === 'all' ? ['nba', 'euroleague', 'acb'] : [arg as CompetitionId];

for (const c of comps) {
  const path = `data/snapshot/${c}.json`;
  if (!existsSync(path)) {
    console.log(`Sin snapshot de ${c}`);
    continue;
  }
  const snap: CompetitionSnapshot = JSON.parse(readFileSync(path, 'utf8'));
  const rows = snapshotToRows(snap);
  // Reemplazo completo de la temporada: se borran las filas anteriores y se insertan las nuevas
  for (const t of [...TABLES].reverse()) {
    const { error } = await db.from(t).delete().eq('competition_id', c).eq('season', snap.season);
    if (error) throw new Error(`${t}: ${error.message}`);
  }
  await db.from('seasons').update({ is_current: false }).eq('competition_id', c);
  for (const t of TABLES) {
    const list = rows[t];
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await db.from(t).insert(list.slice(i, i + 500));
      if (error) throw new Error(`${t}: ${error.message}`);
    }
  }
  console.log(`Subido ${c}: ${snap.teams.length} equipos, ${snap.players.length} jugadores`);
}
// Registro de actualizaciones
const updates = readJson<{ comp: string; step: string; ok: boolean; message: string; at: string }[]>('data/data_updates.json') ?? [];
if (updates.length) {
  const recent = updates.slice(-50).map((u) => ({ competition_id: u.comp, step: u.step, ok: u.ok, message: u.message, at: u.at }));
  const { error } = await db.from('data_updates').insert(recent);
  if (error) console.log('data_updates:', error.message);
}
