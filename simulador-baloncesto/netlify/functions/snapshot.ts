/**
 * GET /api/snapshot?comp=nba|euroleague|acb
 * Lee los datos de la competición en Supabase (en el servidor, con la clave anónima de solo
 * lectura protegida por RLS) y devuelve el snapshot. Las claves nunca llegan al navegador.
 */
import { rowsToSnapshot, TABLES, type Rows } from '../../ingest/lib/supabase-map';
import type { CompetitionId } from '../../engine/datatypes';

const COMPS: CompetitionId[] = ['nba', 'euroleague', 'acb'];

async function select(table: string, filter: string): Promise<Record<string, unknown>[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase no configurado');
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&${filter}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
    const page = (await r.json()) as Record<string, unknown>[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export default async (req: Request) => {
  const comp = new URL(req.url).searchParams.get('comp') as CompetitionId;
  if (!COMPS.includes(comp)) return new Response('Competición no válida', { status: 400 });
  try {
    const seasons = await select('seasons', `competition_id=eq.${comp}&is_current=eq.true`);
    if (!seasons.length) return new Response('Sin datos', { status: 404 });
    const season = String(seasons[0].season);
    const rows: Rows = { seasons };
    for (const t of TABLES) if (t !== 'seasons') rows[t] = await select(t, `competition_id=eq.${comp}&season=eq.${encodeURIComponent(season)}`);
    return new Response(JSON.stringify(rowsToSnapshot(comp, rows)), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 502 });
  }
};
