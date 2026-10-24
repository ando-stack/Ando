-- Estudia · Esquema principal
-- Requiere: extensión pgvector (Supabase: Database → Extensions → vector)

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- Perfiles y consentimiento
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null default '' check (char_length(nombre) <= 80),
  fecha_nacimiento date not null,
  -- pendiente: falta aceptar la política · pendiente_tutor: menor de 14 sin consentimiento del tutor
  consentimiento_estado text not null default 'pendiente'
    check (consentimiento_estado in ('pendiente', 'pendiente_tutor', 'concedido', 'retirado')),
  consentimiento_ia boolean not null default false,
  consentimiento_fecha timestamptz,
  consentimiento_version text,
  consentimiento_otorgado_por text check (consentimiento_otorgado_por in ('usuario', 'tutor')),
  tutor_email text,
  tutor_nombre text,
  tutor_relacion text,
  tutor_ip_hash text,
  consentimiento_token_hash text,
  consentimiento_token_expira timestamptz,
  preferencias jsonb not null default '{
    "pomodoro": {"trabajo": 25, "descanso": 5, "descanso_largo": 15, "ciclos": 4},
    "notificaciones": {"activas": false, "hora": "17:30"},
    "retencion": 0.9
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil del estudiante y prueba del consentimiento (RGPD art. 7-8, LOPDGDD art. 7).';

-- Edad en años cumplidos
create or replace function public.edad(p_fecha date)
returns int language sql stable as $$
  select extract(year from age(current_date, p_fecha))::int
$$;

-- ─────────────────────────────────────────────────────────────
-- Exámenes y temas
-- ─────────────────────────────────────────────────────────────
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asignatura text not null check (char_length(asignatura) between 1 and 120),
  curso text,
  fecha timestamptz not null,
  nota_objetivo numeric(4, 2) not null check (nota_objetivo between 0 and 10),
  tipo text not null check (tipo in ('test', 'cortas', 'desarrollo', 'problemas', 'mixto')),
  -- porcentaje aproximado de cada tipo: {"test":40,"cortas":20,"desarrollo":20,"problemas":20}
  distribucion jsonb not null default '{}'::jsonb,
  duracion_min int not null default 60 check (duracion_min between 5 and 600),
  -- minutos disponibles por día de la semana: {"0":30,"1":60,...} (0 = domingo)
  disponibilidad jsonb not null default '{"0":0,"1":60,"2":60,"3":60,"4":60,"5":60,"6":0}'::jsonb,
  nivel_actual text not null default 'medio' check (nivel_actual in ('bajo', 'medio', 'alto')),
  color text not null default '#7c3aed',
  archivado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exams_user_idx on public.exams (user_id, fecha);

create table public.exam_topics (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 200),
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index exam_topics_exam_idx on public.exam_topics (exam_id, orden);

-- ─────────────────────────────────────────────────────────────
-- Apuntes subidos y texto extraído
-- ─────────────────────────────────────────────────────────────
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete set null,
  tipo text not null check (tipo in ('imagen', 'pdf', 'texto')),
  storage_path text,                 -- null para texto pegado
  nombre_original text,
  orden int not null default 0,
  estado text not null default 'subido'
    check (estado in ('subido', 'leyendo', 'revisar', 'confirmado', 'error')),
  error text,
  created_at timestamptz not null default now(),
  check (tipo = 'texto' or storage_path is not null)
);
create index uploads_exam_idx on public.uploads (exam_id, orden);

create table public.extracted_texts (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null unique references public.uploads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  -- texto en Markdown con fórmulas en LaTeX ($…$ y $$…$$)
  contenido text not null default '',
  -- [{ "id": "d1", "texto": "…", "motivo": "…", "pagina": 1, "resuelta": false }]
  dudas jsonb not null default '[]'::jsonb,
  -- estructura detectada: [{ "titulo": "…", "nivel": 1, "pagina": 1, "tema_sugerido": "…" }]
  secciones jsonb not null default '[]'::jsonb,
  calidad text check (calidad in ('buena', 'regular', 'mala')),
  legible boolean not null default true,
  aviso text,
  paginas int not null default 1,
  revisado boolean not null default false,
  editado_por_usuario boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fragmentos indexados para citar el origen (RAG)
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete set null,
  upload_id uuid not null references public.uploads (id) on delete cascade,
  orden int not null default 0,
  seccion text,
  pagina int,
  origen text not null,             -- texto legible: "Foto 3 · p. 1 · Apartado 2.1"
  contenido text not null,
  embedding extensions.vector(1024),
  tsv tsvector generated always as (to_tsvector('spanish', coalesce(seccion, '') || ' ' || contenido)) stored,
  created_at timestamptz not null default now()
);
create index chunks_exam_idx on public.chunks (exam_id, topic_id, orden);
create index chunks_tsv_idx on public.chunks using gin (tsv);
create index chunks_embedding_idx on public.chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ─────────────────────────────────────────────────────────────
-- Materiales generados (todos citan fragmentos en "fuentes")
-- fuentes: [{ "chunk_id": "…", "origen": "Foto 3 · p. 1" }]
-- ─────────────────────────────────────────────────────────────
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete cascade,  -- null = examen completo
  ideas_clave jsonb not null default '[]'::jsonb,
  resumen jsonb not null default '[]'::jsonb,
  detallado jsonb not null default '[]'::jsonb,
  desactualizado boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index summaries_alcance_uidx on public.summaries
  (exam_id, coalesce(topic_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.mindmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete cascade,
  titulo text not null,
  -- árbol: { "id": "n1", "texto": "…", "fuentes": [...], "hijos": [...] }
  raiz jsonb not null,
  desactualizado boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index mindmaps_alcance_uidx on public.mindmaps
  (exam_id, coalesce(topic_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete set null,
  tipo text not null check (tipo in ('pregunta', 'huecos', 'definicion', 'formula', 'fecha')),
  anverso text not null check (char_length(anverso) between 1 and 2000),
  reverso text not null check (char_length(reverso) between 1 and 4000),
  fuentes jsonb not null default '[]'::jsonb,
  ampliacion boolean not null default false,
  editada boolean not null default false,
  suspendida boolean not null default false,
  -- Estado FSRS
  estado text not null default 'nueva' check (estado in ('nueva', 'aprendiendo', 'repaso', 'reaprendiendo')),
  estabilidad double precision not null default 0,
  dificultad double precision not null default 0,
  vence timestamptz not null default now(),
  ultima_revision timestamptz,
  repeticiones int not null default 0,
  fallos int not null default 0,
  created_at timestamptz not null default now()
);
create index flashcards_vence_idx on public.flashcards (user_id, exam_id, vence) where not suspendida;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  flashcard_id uuid not null references public.flashcards (id) on delete cascade,
  calificacion int not null check (calificacion between 1 and 4),   -- 1 otra vez · 2 difícil · 3 bien · 4 fácil
  recuperabilidad double precision,
  estabilidad double precision not null,
  dificultad double precision not null,
  intervalo_dias double precision not null,
  duracion_ms int,
  created_at timestamptz not null default now()
);
create index reviews_card_idx on public.reviews (flashcard_id, created_at);
create index reviews_user_idx on public.reviews (user_id, created_at);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete cascade,
  titulo text not null,
  preguntas jsonb not null,
  created_at timestamptz not null default now()
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  respuestas jsonb not null,
  -- [{ "pregunta_id": "…", "topic_id": "…", "correcta": true, "puntos": 1 }]
  resultados jsonb not null,
  nota numeric(4, 2) not null check (nota between 0 and 10),
  created_at timestamptz not null default now()
);

create table public.mock_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  titulo text not null,
  duracion_min int not null,
  distribucion jsonb not null default '{}'::jsonb,
  preguntas jsonb not null,
  created_at timestamptz not null default now()
);

create table public.mock_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  mock_exam_id uuid not null references public.mock_exams (id) on delete cascade,
  respuestas jsonb not null default '{}'::jsonb,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'corrigiendo', 'corregido', 'error')),
  inicio timestamptz not null default now(),
  fin timestamptz,
  correccion jsonb,
  nota numeric(4, 2) check (nota between 0 and 10),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Plan, sesiones, rachas y logros
-- ─────────────────────────────────────────────────────────────
create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null unique references public.exams (id) on delete cascade,
  dias jsonb not null,
  viabilidad jsonb not null,
  parametros jsonb not null default '{}'::jsonb,
  version int not null default 1,
  generado_en timestamptz not null default now()
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid references public.exams (id) on delete cascade,
  fecha date not null default current_date,
  tarea_id text,
  tipo text not null check (tipo in ('estudio', 'flashcards', 'test', 'simulacro', 'repaso', 'feynman', 'pomodoro')),
  minutos int not null default 0 check (minutos between 0 and 1440),
  completada boolean not null default true,
  created_at timestamptz not null default now()
);
create index study_sessions_user_idx on public.study_sessions (user_id, fecha);

create table public.streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  actual int not null default 0,
  mejor int not null default 0,
  ultimo_dia date,
  -- semanas ISO en las que ya se usó el día de descanso: ["2026-W42"]
  descansos jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  codigo text not null,
  obtenido_en timestamptz not null default now(),
  unique (user_id, codigo)
);

-- ─────────────────────────────────────────────────────────────
-- IA: consumo, trabajos en segundo plano, tutor y Feynman
-- ─────────────────────────────────────────────────────────────
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null,          -- lectura · generacion · correccion · tutor
  operacion text not null,     -- p. ej. "flashcards", "leer_apuntes"
  modelo text,
  tokens_entrada int not null default 0,
  tokens_salida int not null default 0,
  exito boolean not null default true,
  created_at timestamptz not null default now()
);
create index ai_usage_user_dia_idx on public.ai_usage (user_id, created_at);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid references public.exams (id) on delete cascade,
  tipo text not null,
  parametros jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'completado', 'error')),
  progreso int not null default 0 check (progreso between 0 and 100),
  mensaje text,
  resultado jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_jobs_user_idx on public.ai_jobs (user_id, created_at desc);

create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  rol text not null check (rol in ('usuario', 'tutor')),
  contenido text not null,
  nivel text check (nivel in ('sencillo', 'normal', 'avanzado')),
  fuentes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index tutor_messages_exam_idx on public.tutor_messages (exam_id, created_at);

create table public.feynman_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete cascade,
  explicacion text not null,
  analisis jsonb,
  created_at timestamptz not null default now()
);

-- updated_at automático
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated before update on public.profiles for each row execute function public.tocar_updated_at();
create trigger exams_updated before update on public.exams for each row execute function public.tocar_updated_at();
create trigger extracted_updated before update on public.extracted_texts for each row execute function public.tocar_updated_at();
create trigger ai_jobs_updated before update on public.ai_jobs for each row execute function public.tocar_updated_at();
