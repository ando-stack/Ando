-- Fantasy A1 · tablas para las ligas privadas. Pega esto en Supabase → SQL Editor → Run.
create table if not exists public.ligas (
  code    text primary key check (code ~ '^[A-Z0-9]{6}$'),
  name    text not null check (char_length(name) between 1 and 40),
  owner   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created bigint not null,
  start   int not null
);
create table if not exists public.equipos (
  id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nombre  text check (char_length(nombre) <= 30),
  ligas   text[] not null default '{}',
  teams   jsonb not null default '{}',
  updated timestamptz not null default now()
);
alter table public.ligas   enable row level security;
alter table public.equipos enable row level security;

-- Ligas: cualquiera con cuenta las lee (para unirse con el código); solo el creador las crea, cambia o borra.
drop policy if exists "ligas leer"  on public.ligas;
drop policy if exists "ligas crear" on public.ligas;
drop policy if exists "ligas editar" on public.ligas;
drop policy if exists "ligas borrar" on public.ligas;
create policy "ligas leer"   on public.ligas for select to authenticated using (true);
create policy "ligas crear"  on public.ligas for insert to authenticated with check (owner = auth.uid());
create policy "ligas editar" on public.ligas for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "ligas borrar" on public.ligas for delete to authenticated using (owner = auth.uid());

-- Equipos: los ven los usuarios con cuenta (para la clasificación); cada uno solo escribe el suyo.
drop policy if exists "equipos leer"   on public.equipos;
drop policy if exists "equipos crear"  on public.equipos;
drop policy if exists "equipos editar" on public.equipos;
drop policy if exists "equipos borrar" on public.equipos;
create policy "equipos leer"   on public.equipos for select to authenticated using (true);
create policy "equipos crear"  on public.equipos for insert to authenticated with check (id = auth.uid());
create policy "equipos editar" on public.equipos for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "equipos borrar" on public.equipos for delete to authenticated using (id = auth.uid());
