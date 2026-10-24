-- Estudia · Consentimiento, Row Level Security y Storage

-- ─────────────────────────────────────────────────────────────
-- Funciones auxiliares
-- ─────────────────────────────────────────────────────────────

-- ¿El usuario actual tiene consentimiento válido para tratar apuntes con IA?
create or replace function public.puede_tratar_datos()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.consentimiento_estado = 'concedido'
      and p.consentimiento_ia
  )
$$;

-- ¿El examen pertenece al usuario actual?
create or replace function public.es_mi_examen(p_exam_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.exams e where e.id = p_exam_id and e.user_id = auth.uid())
$$;

-- Crear el perfil al registrarse. Los datos llegan en raw_user_meta_data desde el formulario.
-- Si falta la fecha de nacimiento se trata como menor (opción más protectora).
create or replace function public.crear_perfil()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_fecha date;
  v_acepta boolean := coalesce((new.raw_user_meta_data ->> 'acepta_privacidad')::boolean, false);
  v_ia boolean := coalesce((new.raw_user_meta_data ->> 'acepta_ia')::boolean, false);
  v_estado text;
begin
  begin
    v_fecha := (new.raw_user_meta_data ->> 'fecha_nacimiento')::date;
  exception when others then
    v_fecha := null;
  end;
  if v_fecha is null or v_fecha > current_date then
    v_fecha := current_date;
  end if;

  if public.edad(v_fecha) < 14 then
    v_estado := 'pendiente_tutor';
    v_ia := false;               -- lo decide el tutor
  elsif v_acepta then
    v_estado := 'concedido';
  else
    v_estado := 'pendiente';
  end if;

  insert into public.profiles (
    id, nombre, fecha_nacimiento, consentimiento_estado, consentimiento_ia,
    consentimiento_fecha, consentimiento_version, consentimiento_otorgado_por
  ) values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'nombre', ''), 80),
    v_fecha,
    v_estado,
    v_estado = 'concedido' and v_ia,
    case when v_estado = 'concedido' then now() end,
    case when v_estado = 'concedido' then new.raw_user_meta_data ->> 'version_politica' end,
    case when v_estado = 'concedido' then 'usuario' end
  );
  insert into public.streaks (user_id) values (new.id);
  return new;
end $$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- Aceptar la política (solo mayores de 14). Los menores necesitan al tutor (función de servidor).
create or replace function public.aceptar_consentimiento(p_version text, p_ia boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_perfil public.profiles;
begin
  select * into v_perfil from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Perfil no encontrado';
  end if;
  if public.edad(v_perfil.fecha_nacimiento) < 14 then
    raise exception 'Necesitas el consentimiento de tu padre, madre o tutor';
  end if;
  update public.profiles
     set consentimiento_estado = 'concedido',
         consentimiento_ia = p_ia,
         consentimiento_fecha = now(),
         consentimiento_version = p_version,
         consentimiento_otorgado_por = 'usuario'
   where id = auth.uid();
end $$;

-- Retirar el permiso de IA (cualquier edad). Volver a darlo siendo menor requiere al tutor.
create or replace function public.retirar_consentimiento_ia()
returns void
language sql security definer
set search_path = public
as $$
  update public.profiles set consentimiento_ia = false where id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────
-- Rachas (con un día de descanso por semana que no la rompe) y logros
-- ─────────────────────────────────────────────────────────────
create or replace function public.dar_logro(p_user uuid, p_codigo text)
returns void language sql security definer set search_path = public as $$
  insert into public.achievements (user_id, codigo) values (p_user, p_codigo)
  on conflict (user_id, codigo) do nothing
$$;

create or replace function public.actualizar_racha()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  s public.streaks;
  v_dia date := new.fecha;
  v_semana_descanso text;
  v_nueva int;
begin
  if not new.completada then
    return new;
  end if;
  insert into public.streaks (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select * into s from public.streaks where user_id = new.user_id for update;

  if s.ultimo_dia is not null and v_dia <= s.ultimo_dia then
    v_nueva := s.actual;                                  -- mismo día (o sesión antigua): no cambia
  elsif s.ultimo_dia = v_dia - 1 then
    v_nueva := s.actual + 1;
  elsif s.ultimo_dia = v_dia - 2 then
    -- un hueco de un día: vale como descanso si no se ha usado esa semana
    v_semana_descanso := to_char(v_dia - 1, 'IYYY-"W"IW');
    if not (s.descansos ? v_semana_descanso) then
      v_nueva := s.actual + 1;
      s.descansos := s.descansos || to_jsonb(v_semana_descanso);
    else
      v_nueva := 1;
    end if;
  else
    v_nueva := 1;
  end if;

  update public.streaks
     set actual = v_nueva,
         mejor = greatest(s.mejor, v_nueva),
         ultimo_dia = greatest(coalesce(s.ultimo_dia, v_dia), v_dia),
         descansos = s.descansos,
         updated_at = now()
   where user_id = new.user_id;

  perform public.dar_logro(new.user_id, 'primera_sesion');
  if v_nueva >= 3 then perform public.dar_logro(new.user_id, 'racha_3'); end if;
  if v_nueva >= 7 then perform public.dar_logro(new.user_id, 'racha_7'); end if;
  if v_nueva >= 14 then perform public.dar_logro(new.user_id, 'racha_14'); end if;
  if v_nueva >= 30 then perform public.dar_logro(new.user_id, 'racha_30'); end if;
  if (select count(distinct fecha) from public.study_sessions where user_id = new.user_id) >= 10 then
    perform public.dar_logro(new.user_id, 'diez_dias');
  end if;
  return new;
end $$;

create trigger al_registrar_sesion
  after insert on public.study_sessions
  for each row execute function public.actualizar_racha();

create or replace function public.logros_por_actividad()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_table_name = 'mock_exam_attempts' and new.estado = 'corregido' then
    perform public.dar_logro(new.user_id, 'primer_simulacro');
    if (select count(*) from public.mock_exam_attempts where user_id = new.user_id and estado = 'corregido') >= 3 then
      perform public.dar_logro(new.user_id, 'tres_simulacros');
    end if;
  elsif tg_table_name = 'reviews' then
    if (select count(*) from public.reviews where user_id = new.user_id) >= 100 then
      perform public.dar_logro(new.user_id, 'cien_tarjetas');
    end if;
  elsif tg_table_name = 'quiz_attempts' then
    perform public.dar_logro(new.user_id, 'primer_test');
  elsif tg_table_name = 'feynman_attempts' then
    perform public.dar_logro(new.user_id, 'feynman');
  end if;
  return new;
end $$;

create trigger logro_simulacro after insert or update of estado on public.mock_exam_attempts
  for each row execute function public.logros_por_actividad();
create trigger logro_reviews after insert on public.reviews
  for each row execute function public.logros_por_actividad();
create trigger logro_test after insert on public.quiz_attempts
  for each row execute function public.logros_por_actividad();
create trigger logro_feynman after insert on public.feynman_attempts
  for each row execute function public.logros_por_actividad();

-- ─────────────────────────────────────────────────────────────
-- Búsqueda híbrida de fragmentos (texto completo + vectores, fusión RRF)
-- SECURITY INVOKER: respeta la RLS del usuario que llama.
-- ─────────────────────────────────────────────────────────────
create or replace function public.buscar_fragmentos(
  p_exam_id uuid,
  p_consulta text,
  p_embedding extensions.vector(1024) default null,
  p_topic_id uuid default null,
  p_limite int default 12
)
returns table (
  id uuid, topic_id uuid, upload_id uuid, origen text, seccion text,
  pagina int, contenido text, puntuacion double precision
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with base as (
    select c.* from public.chunks c
    where c.exam_id = p_exam_id and (p_topic_id is null or c.topic_id = p_topic_id)
  ),
  consulta as (
    select nullif(replace(plainto_tsquery('spanish', coalesce(p_consulta, ''))::text, '&', '|'), '')::tsquery as q
  ),
  texto as (
    select b.id, ts_rank_cd(b.tsv, c.q) as r
    from base b, consulta c
    where c.q is not null and b.tsv @@ c.q
    order by r desc limit 50
  ),
  vec as (
    select b.id, 1 - (b.embedding <=> p_embedding) as r
    from base b
    where p_embedding is not null and b.embedding is not null
    order by b.embedding <=> p_embedding limit 50
  ),
  fusion as (
    select x.id, sum(1.0 / (60 + x.rk))::double precision as s
    from (
      select t.id, row_number() over (order by t.r desc) as rk from texto t
      union all
      select v.id, row_number() over (order by v.r desc) as rk from vec v
    ) x
    group by x.id
  )
  select b.id, b.topic_id, b.upload_id, b.origen, b.seccion, b.pagina, b.contenido, f.s
  from fusion f join base b on b.id = f.id
  order by f.s desc
  limit greatest(1, least(p_limite, 50))
$$;

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.exams enable row level security;
alter table public.exam_topics enable row level security;
alter table public.uploads enable row level security;
alter table public.extracted_texts enable row level security;
alter table public.chunks enable row level security;
alter table public.summaries enable row level security;
alter table public.mindmaps enable row level security;
alter table public.flashcards enable row level security;
alter table public.reviews enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.mock_exams enable row level security;
alter table public.mock_exam_attempts enable row level security;
alter table public.study_plans enable row level security;
alter table public.study_sessions enable row level security;
alter table public.streaks enable row level security;
alter table public.achievements enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.tutor_messages enable row level security;
alter table public.feynman_attempts enable row level security;

-- Nada para usuarios anónimos
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Perfil: el usuario lo ve y solo puede cambiar nombre y preferencias.
-- Fecha de nacimiento y consentimiento solo se cambian con las funciones de arriba o desde el servidor.
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (nombre, preferencias) on public.profiles to authenticated;
create policy "perfil: ver el propio" on public.profiles for select to authenticated using (id = auth.uid());
create policy "perfil: editar el propio" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Exámenes
create policy "examenes: propios" on public.exams for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tablas hijas de un examen: propias y ligadas a un examen propio
do $$
declare
  t text;
begin
  foreach t in array array[
    'exam_topics', 'extracted_texts', 'chunks', 'summaries', 'mindmaps', 'flashcards',
    'reviews', 'quizzes', 'quiz_attempts', 'mock_exams', 'mock_exam_attempts',
    'study_plans', 'tutor_messages', 'feynman_attempts'
  ] loop
    execute format(
      'create policy "propios" on public.%I for all to authenticated
         using (user_id = auth.uid())
         with check (user_id = auth.uid() and public.es_mi_examen(exam_id))', t);
  end loop;
end $$;

-- Subidas: además exigen consentimiento vigente para crear nuevas
create policy "subidas: ver propias" on public.uploads for select to authenticated using (user_id = auth.uid());
create policy "subidas: crear con consentimiento" on public.uploads for insert to authenticated
  with check (user_id = auth.uid() and public.es_mi_examen(exam_id) and public.puede_tratar_datos());
create policy "subidas: editar propias" on public.uploads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.es_mi_examen(exam_id));
create policy "subidas: borrar propias" on public.uploads for delete to authenticated using (user_id = auth.uid());

-- Sesiones de estudio (exam_id opcional)
create policy "sesiones: propias" on public.study_sessions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (exam_id is null or public.es_mi_examen(exam_id)));

-- Solo lectura para el usuario (las escribe el servidor o los disparadores)
revoke insert, update, delete on public.streaks, public.achievements, public.ai_usage, public.ai_jobs from authenticated;
create policy "racha: ver la propia" on public.streaks for select to authenticated using (user_id = auth.uid());
create policy "logros: ver los propios" on public.achievements for select to authenticated using (user_id = auth.uid());
create policy "consumo: ver el propio" on public.ai_usage for select to authenticated using (user_id = auth.uid());
create policy "trabajos: ver los propios" on public.ai_jobs for select to authenticated using (user_id = auth.uid());

-- Funciones que puede llamar el usuario autenticado
grant execute on function public.aceptar_consentimiento(text, boolean) to authenticated;
grant execute on function public.retirar_consentimiento_ia() to authenticated;
grant execute on function public.buscar_fragmentos(uuid, text, extensions.vector, uuid, int) to authenticated;
grant execute on function public.puede_tratar_datos() to authenticated;
revoke execute on function public.dar_logro(uuid, text) from authenticated, public;
revoke execute on function public.crear_perfil() from authenticated, public;

-- ─────────────────────────────────────────────────────────────
-- Storage: bucket privado "apuntes", carpeta por usuario: {user_id}/{exam_id}/{archivo}
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('apuntes', 'apuntes', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false;

create policy "apuntes: ver los propios" on storage.objects for select to authenticated
  using (bucket_id = 'apuntes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "apuntes: subir con consentimiento" on storage.objects for insert to authenticated
  with check (bucket_id = 'apuntes' and (storage.foldername(name))[1] = auth.uid()::text
              and public.puede_tratar_datos());
create policy "apuntes: actualizar los propios" on storage.objects for update to authenticated
  using (bucket_id = 'apuntes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'apuntes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "apuntes: borrar los propios" on storage.objects for delete to authenticated
  using (bucket_id = 'apuntes' and (storage.foldername(name))[1] = auth.uid()::text);
