/**
 * La migración de Supabase se ejecuta en un PostgreSQL embebido (PGlite) y se comprueba que:
 * RLS está activo en todas las tablas, el rol anónimo puede leer y no puede escribir (aunque
 * tenga permisos sobre las tablas, como en Supabase), y la clave de servicio sí escribe.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

describe('migración de Supabase y RLS', () => {
  it('lectura pública y escritura solo con la clave de servicio', async () => {
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`);
    await db.exec(readFileSync('supabase/migrations/20261023000000_esquema_inicial.sql', 'utf8'));
    // Permisos por defecto de Supabase: anon/authenticated tienen permisos de tabla; RLS es la barrera
    await db.exec(`grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;`);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rls.rows.length).toBe(13);
    for (const r of rls.rows) expect(r.relrowsecurity).toBe(true);
    await db.exec(`set role service_role; insert into seasons (competition_id, season, is_current) values ('acb','2026-27',true); reset role;`);
    await db.exec(`set role anon;`);
    expect((await db.query(`select * from seasons`)).rows.length).toBe(1);
    await expect(db.query(`insert into seasons (competition_id, season) values ('nba','2026-27')`)).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`insert into saved_simulations (id, competition_id, label, home_team, away_team, n, seed, payload) values ('x','nba','a','b','c',1,1,'{}')`),
    ).rejects.toThrow(/row-level security/);
    expect((await db.query(`update seasons set is_current = false`)).affectedRows).toBe(0);
    expect((await db.query(`delete from seasons`)).affectedRows).toBe(0);
    await db.exec(`reset role;`);
    const n = await db.query<{ n: number }>(`select count(*)::int as n from seasons where is_current`);
    expect(n.rows[0].n).toBe(1);
    await db.close();
  });
});
