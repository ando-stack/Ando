/**
 * POST /api/simulations — guarda una simulación en saved_simulations (con la clave de servicio,
 * solo en el servidor). GET /api/simulations — lista las últimas simulaciones guardadas.
 */
export default async (req: Request) => {
  const url = process.env.SUPABASE_URL;
  if (!url) return new Response('Supabase no configurado', { status: 501 });
  if (req.method === 'POST') {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return new Response('Supabase no configurado', { status: 501 });
    const run = (await req.json()) as {
      id: string; createdAt: string; comp: string; label: string; home: { name: string }; away: { name: string }; n: number; seed: number;
    };
    if (!run?.id || !['nba', 'euroleague', 'acb'].includes(run.comp) || !(run.n >= 1 && run.n <= 100000)) return new Response('Datos no válidos', { status: 400 });
    const body = JSON.stringify({ id: run.id, created_at: run.createdAt, competition_id: run.comp, label: run.label, home_team: run.home.name, away_team: run.away.name, n: run.n, seed: run.seed, payload: run });
    if (body.length > 5_000_000) return new Response('Simulación demasiado grande', { status: 413 });
    const r = await fetch(`${url}/rest/v1/saved_simulations`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body,
    });
    return new Response(r.ok ? 'ok' : await r.text(), { status: r.ok ? 201 : 502 });
  }
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!anon) return new Response('Supabase no configurado', { status: 501 });
  const r = await fetch(`${url}/rest/v1/saved_simulations?select=id,created_at,competition_id,label,home_team,away_team,n,seed&order=created_at.desc&limit=100`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};
