-- Esquema del simulador de tenis.
-- Seguridad: RLS activo en TODAS las tablas. Lectura pública (anon y authenticated); no hay
-- políticas de escritura, así que sólo la ingesta (service_role, que salta RLS) puede escribir.

create table if not exists public.tours (
  id text primary key check (id in ('ATP', 'WTA', 'CH', 'W125')),
  name text not null
);

insert into public.tours (id, name) values
  ('ATP', 'ATP Tour'), ('WTA', 'WTA Tour'), ('CH', 'ATP Challenger Tour'), ('W125', 'WTA 125')
on conflict (id) do nothing;

create table if not exists public.tournaments (
  id text primary key,
  tour_id text not null references public.tours (id),
  name text not null,
  category text,
  city text,
  country text,
  start_date date not null,
  end_date date not null,
  surface text check (surface in ('dura', 'tierra', 'hierba')),
  indoor boolean,
  format_id text not null,
  qualy_format_id text not null,
  status text not null check (status in ('en curso', 'próximo', 'terminado')),
  has_order_of_play boolean not null default false,
  source text not null,
  notices jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
create index if not exists tournaments_fechas on public.tournaments (start_date, end_date);

create table if not exists public.draws (
  id text primary key,
  tournament_id text not null references public.tournaments (id) on delete cascade,
  phase text not null check (phase in ('Q', 'M')),
  size integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id text primary key,
  name text not null,
  country text,
  pool text not null check (pool in ('M', 'F')),
  main_tour text,
  birth_date date,
  hand text,
  backhand text,
  height integer,
  last_match date,
  matches_count integer not null default 0,
  stats_matches integer not null default 0,
  estimated boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists players_nombre on public.players (name);

create table if not exists public.matches (
  id text primary key,
  tournament_id text references public.tournaments (id) on delete set null,
  tour text,
  level text,
  tournament_name text,
  surface text,
  match_date date,
  round text,
  phase text,
  player_a text references public.players (id),
  player_b text references public.players (id),
  player_a_name text,
  player_b_name text,
  winner text check (winner in ('a', 'b')),
  score text,
  status text not null check (status in ('programado', 'en juego', 'terminado')),
  retired boolean not null default false,
  best_of integer,
  source text not null,
  updated_at timestamptz not null default now()
);
create index if not exists matches_torneo on public.matches (tournament_id);
create index if not exists matches_a on public.matches (player_a, match_date);
create index if not exists matches_b on public.matches (player_b, match_date);

create table if not exists public.order_of_play (
  match_id text primary key references public.matches (id) on delete cascade,
  tournament_id text not null references public.tournaments (id) on delete cascade,
  scheduled_at timestamptz,
  not_before boolean not null default false,
  court text,
  order_num integer
);

create table if not exists public.match_stats (
  match_id text not null references public.matches (id) on delete cascade,
  player_id text not null references public.players (id),
  aces integer, double_faults integer, serve_points integer, first_in integer, first_won integer,
  second_won integer, service_games integer, bp_saved integer, bp_faced integer,
  primary key (match_id, player_id),
  check (serve_points >= 0 and first_in <= serve_points and first_won <= first_in and bp_saved <= bp_faced)
);

create table if not exists public.rankings (
  player_id text not null references public.players (id) on delete cascade,
  ranking_date date not null,
  rank integer not null check (rank > 0),
  points numeric,
  source text not null,
  primary key (player_id, ranking_date, source)
);

create table if not exists public.player_surface_stats (
  player_id text not null references public.players (id) on delete cascade,
  surface text not null check (surface in ('todas', 'dura', 'tierra', 'hierba')),
  -- Vector del modelo (mismo orden que CAMPOS en engine/modelo.ts), sumas con decaimiento.
  vector real[] not null,
  real_matches integer not null default 0,
  serve_points real, first_in_pct real, first_won_pct real, second_won_pct real, aces_pct real,
  df_pct real, return_won_pct real, tiebreaks_played real, tiebreaks_won real,
  updated_at timestamptz not null default now(),
  primary key (player_id, surface)
);

create table if not exists public.elo_ratings (
  player_id text primary key references public.players (id) on delete cascade,
  overall real not null, hard real not null, clay real not null, grass real not null,
  n integer not null, n_hard integer not null, n_clay integer not null, n_grass integer not null,
  form real not null default 0,
  estimated boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.data_updates (
  id bigint generated always as identity primary key,
  source text not null,
  description text,
  ok boolean not null,
  attempted_at timestamptz not null,
  succeeded_at timestamptz,
  records integer not null default 0,
  error text,
  payload jsonb
);
create index if not exists data_updates_fuente on public.data_updates (source, attempted_at desc);

create table if not exists public.saved_simulations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  player_a text,
  player_b text,
  params jsonb not null,
  results jsonb not null
);

-- RLS: activado en todas las tablas y sólo lectura pública.
do $$
declare t text;
begin
  foreach t in array array['tours','tournaments','draws','players','matches','order_of_play','match_stats',
                           'rankings','player_surface_stats','elo_ratings','data_updates','saved_simulations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "lectura publica" on public.%I', t);
    execute format('create policy "lectura publica" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;
