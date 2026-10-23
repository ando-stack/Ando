-- Esquema del simulador de baloncesto (NBA, EuroLiga, Liga Endesa).
-- Lectura pública (anon/authenticated) mediante Row Level Security; escritura solo con la clave
-- de servicio (ingesta y funciones de Netlify), que no está sujeta a RLS y nunca llega al navegador.

create table if not exists competitions (
  id text primary key check (id in ('nba', 'euroleague', 'acb')),
  name text not null,
  rules jsonb not null default '{}'::jsonb
);

create table if not exists seasons (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,               -- '2026-27'
  previous_season text,
  is_current boolean not null default false,
  generated_at timestamptz,
  last_game_date timestamptz,
  league jsonb,                       -- medias de la liga (LeagueAverages)
  sources jsonb,                      -- fuentes con condiciones de uso y fecha
  notes jsonb,
  primary key (competition_id, season)
);

create table if not exists teams (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  id text not null,
  name text not null,
  short text not null,
  logo text,
  blend_weights jsonb,
  home jsonb,
  away jsonb,
  primary key (competition_id, season, id)
);

create table if not exists players (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  id text not null,
  team_id text not null,
  name text not null,
  position text check (position in ('G', 'F', 'C')),
  position_raw text,
  height numeric,
  nationality text,
  jersey text,
  estimated boolean not null default false,
  estimate_note text,
  primary key (competition_id, season, id)
);
create index if not exists players_team_idx on players (competition_id, season, team_id);

-- Estadísticas de equipo: temporada actual, anterior y mezcla usada por el modelo.
create table if not exists team_stats (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  team_id text not null,
  scope text not null check (scope in ('current', 'previous', 'blended')),
  stats jsonb not null,               -- TeamSeasonStats
  updated_at timestamptz not null default now(),
  primary key (competition_id, season, team_id, scope)
);

create table if not exists team_quarter_stats (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  team_id text not null,
  quarter smallint not null check (quarter between 1 and 4),
  points_for numeric not null,
  points_against numeric not null,
  primary key (competition_id, season, team_id, quarter)
);

create table if not exists player_stats (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  player_id text not null,
  gp integer not null default 0,
  gs integer not null default 0,
  mpg numeric not null default 0,
  gp_prev integer not null default 0,
  mpg_prev numeric not null default 0,
  totals jsonb not null,              -- temporada actual
  totals_prev jsonb not null,         -- temporada anterior
  per36or40 jsonb not null,           -- por 36 (NBA) o 40 (FIBA) minutos, mezcla regularizada
  rates jsonb not null,               -- tasas por minuto, porcentajes regularizados y uso
  updated_at timestamptz not null default now(),
  primary key (competition_id, season, player_id)
);

create table if not exists player_minutes_patterns (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  player_id text not null,
  q1 numeric not null,
  q2 numeric not null,
  q3 numeric not null,
  q4 numeric not null,
  source text not null check (source in ('datos', 'estimado')),
  recent_minutes jsonb not null default '[]'::jsonb,
  recent_starts integer not null default 0,
  primary key (competition_id, season, player_id)
);

create table if not exists injuries (
  id bigserial primary key,
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  team_id text not null,
  player_id text,
  player_name text not null,
  status text not null check (status in ('baja', 'duda', 'probable', 'ausente-reciente')),
  detail text not null,
  source text not null,
  source_url text,
  updated_at timestamptz not null
);
create index if not exists injuries_team_idx on injuries (competition_id, season, team_id);

create table if not exists lineups (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  team_id text not null,
  starters text[] not null check (cardinality(starters) <= 5),
  status text not null check (status in ('confirmado', 'probable')),
  basis text not null,
  source text not null,
  warning text,
  updated_at timestamptz not null,
  primary key (competition_id, season, team_id)
);

create table if not exists rotations (
  competition_id text not null references competitions(id) on delete cascade,
  season text not null,
  team_id text not null,
  player_id text not null,
  minutes numeric not null check (minutes >= 0 and minutes <= 60),
  role text not null check (role in ('titular', 'rotacion', 'reserva')),
  basis text not null,
  updated_at timestamptz not null,
  primary key (competition_id, season, team_id, player_id)
);

create table if not exists data_updates (
  id bigserial primary key,
  competition_id text references competitions(id) on delete cascade,
  step text not null,
  ok boolean not null,
  message text,
  at timestamptz not null default now()
);

create table if not exists saved_simulations (
  id text primary key,
  created_at timestamptz not null default now(),
  competition_id text not null references competitions(id) on delete cascade,
  label text not null,
  home_team text not null,
  away_team text not null,
  n integer not null check (n between 1 and 100000),
  seed bigint not null,
  payload jsonb not null              -- SimRun completo (configuración y agregados)
);

-- Row Level Security: lectura pública, sin políticas de escritura (solo la clave de servicio escribe).
do $$
declare t text;
begin
  foreach t in array array['competitions','seasons','teams','players','team_stats','team_quarter_stats',
    'player_stats','player_minutes_patterns','injuries','lineups','rotations','data_updates','saved_simulations']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('create policy "lectura publica" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

insert into competitions (id, name) values
  ('nba', 'NBA'), ('euroleague', 'EuroLiga'), ('acb', 'Liga Endesa (ACB)')
on conflict (id) do nothing;
