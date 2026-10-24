-- Pruebas de seguridad (RLS), consentimiento, rachas y búsqueda.
-- Cada bloque lanza una excepción si algo no se cumple (ON_ERROR_STOP detiene la ejecución).

\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''

-- Usuarios: A adulto que acepta, B adulto que acepta, C menor de 14
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@test.es', jsonb_build_object('nombre', 'Ana', 'fecha_nacimiento', (current_date - interval '17 years')::date, 'acepta_privacidad', true, 'acepta_ia', true, 'version_politica', '2026-10-01')),
  (:B, 'b@test.es', jsonb_build_object('nombre', 'Beto', 'fecha_nacimiento', (current_date - interval '20 years')::date, 'acepta_privacidad', true, 'acepta_ia', true, 'version_politica', '2026-10-01')),
  (:C, 'c@test.es', jsonb_build_object('nombre', 'Cris', 'fecha_nacimiento', (current_date - interval '12 years')::date, 'acepta_privacidad', true, 'acepta_ia', true));

do $$ begin
  assert (select consentimiento_estado from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'concedido', 'A debería tener consentimiento';
  assert (select consentimiento_estado from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003') = 'pendiente_tutor', 'C (12 años) debería esperar al tutor';
  assert (select not consentimiento_ia from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003'), 'C no puede activar la IA por sí mismo';
  assert (select count(*) from public.streaks) = 3, 'Se crea la racha de cada usuario';
  raise notice '✓ Perfiles y consentimiento al registrarse';
end $$;

-- ── Como A ──────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.exams (id, user_id, asignatura, fecha, nota_objetivo, tipo)
values ('e0000000-0000-0000-0000-00000000000a', :A, 'Historia', now() + interval '10 days', 8, 'mixto');
insert into public.exam_topics (id, exam_id, user_id, titulo)
values ('70000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', :A, 'La Revolución Francesa');
insert into public.uploads (id, user_id, exam_id, tipo, storage_path)
values ('00000000-0000-0000-0000-0000000000a1', :A, 'e0000000-0000-0000-0000-00000000000a', 'imagen', 'aaaaaaaa-0000-0000-0000-000000000001/e/foto1.jpg');
insert into storage.objects (bucket_id, name) values ('apuntes', 'aaaaaaaa-0000-0000-0000-000000000001/e0000000/foto1.jpg');
insert into public.chunks (user_id, exam_id, topic_id, upload_id, origen, contenido)
values (:A, 'e0000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1',
        'Foto 1 · p. 1', 'La toma de la Bastilla ocurrió el 14 de julio de 1789 y marcó el inicio de la Revolución Francesa.');

do $$ begin
  assert (select count(*) from public.buscar_fragmentos('e0000000-0000-0000-0000-00000000000a', '¿Cuándo fue la toma de la Bastilla?')) = 1,
    'La búsqueda de texto completo encuentra el fragmento';
  raise notice '✓ A crea examen, tema, subida, archivo y fragmento; la búsqueda funciona';
end $$;

-- A no puede cambiarse el consentimiento ni la fecha de nacimiento directamente
do $$ begin
  begin
    update public.profiles set consentimiento_estado = 'concedido' where id = auth.uid();
    raise exception 'FALLO: A pudo modificar su consentimiento';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set fecha_nacimiento = '2000-01-01' where id = auth.uid();
    raise exception 'FALLO: A pudo modificar su fecha de nacimiento';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set nombre = 'Ana M.' where id = auth.uid();
  assert (select nombre from public.profiles where id = auth.uid()) = 'Ana M.', 'A puede cambiar su nombre';
  begin
    insert into public.ai_usage (user_id, tipo, operacion) values (auth.uid(), 'tutor', 'x');
    raise exception 'FALLO: A pudo escribir en ai_usage';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.streaks set actual = 999 where user_id = auth.uid();
    raise exception 'FALLO: A pudo modificar su racha';
  exception when insufficient_privilege then null;
  end;
  raise notice '✓ Columnas protegidas del perfil, consumo de IA y rachas';
end $$;

-- Racha: lunes 5, martes 6, (miércoles 7 descanso), jueves 8, (viernes 9 sin descanso disponible), sábado 10
insert into public.study_sessions (user_id, fecha, tipo, minutos) values (:A, '2026-10-05', 'estudio', 30);
insert into public.study_sessions (user_id, fecha, tipo, minutos) values (:A, '2026-10-06', 'estudio', 30);
insert into public.study_sessions (user_id, fecha, tipo, minutos) values (:A, '2026-10-06', 'flashcards', 10);
insert into public.study_sessions (user_id, fecha, tipo, minutos) values (:A, '2026-10-08', 'estudio', 30);
do $$ begin
  assert (select actual from public.streaks where user_id = auth.uid()) = 3, 'El día de descanso no rompe la racha';
  assert exists (select 1 from public.achievements where user_id = auth.uid() and codigo = 'racha_3'), 'Logro racha_3';
end $$;
insert into public.study_sessions (user_id, fecha, tipo, minutos) values (:A, '2026-10-10', 'estudio', 30);
do $$ begin
  assert (select actual from public.streaks where user_id = auth.uid()) = 1, 'Segundo hueco en la misma semana reinicia la racha';
  assert (select mejor from public.streaks where user_id = auth.uid()) = 3, 'Se conserva la mejor racha';
  raise notice '✓ Rachas con día de descanso y logros';
end $$;

-- ── Como B ──────────────────────────────────────────────
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$
declare n int;
begin
  assert (select count(*) from public.exams) = 0, 'B no ve exámenes de A';
  assert (select count(*) from public.uploads) = 0, 'B no ve subidas de A';
  assert (select count(*) from public.chunks) = 0, 'B no ve fragmentos de A';
  assert (select count(*) from public.profiles) = 1, 'B solo ve su perfil';
  assert (select count(*) from storage.objects) = 0, 'B no ve archivos de A';
  assert (select count(*) from public.buscar_fragmentos('e0000000-0000-0000-0000-00000000000a', 'Bastilla')) = 0,
    'La búsqueda respeta la RLS';
  update public.exams set asignatura = 'hackeado' where id = 'e0000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  assert n = 0, 'B no puede modificar el examen de A';
  delete from public.chunks;
  get diagnostics n = row_count;
  assert n = 0, 'B no puede borrar fragmentos de A';
  begin
    insert into public.exam_topics (exam_id, user_id, titulo)
    values ('e0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000002', 'intruso');
    raise exception 'FALLO: B pudo añadir un tema al examen de A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.exams (user_id, asignatura, fecha, nota_objetivo, tipo)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'suplantación', now(), 5, 'test');
    raise exception 'FALLO: B pudo crear un examen a nombre de A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('apuntes', 'aaaaaaaa-0000-0000-0000-000000000001/x/y.jpg');
    raise exception 'FALLO: B pudo subir a la carpeta de A';
  exception when insufficient_privilege then null;
  end;
  raise notice '✓ Aislamiento entre usuarios (lectura, escritura, borrado, Storage)';
end $$;

-- ── Como C (menor sin consentimiento del tutor) ─────────
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.exams (id, user_id, asignatura, fecha, nota_objetivo, tipo)
values ('e0000000-0000-0000-0000-00000000000c', :C, 'Matemáticas', now() + interval '7 days', 7, 'problemas');
do $$ begin
  assert not public.puede_tratar_datos(), 'C no puede tratar datos todavía';
  begin
    insert into public.uploads (user_id, exam_id, tipo) values (auth.uid(), 'e0000000-0000-0000-0000-00000000000c', 'texto');
    raise exception 'FALLO: un menor sin consentimiento pudo subir apuntes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('apuntes', 'cccccccc-0000-0000-0000-000000000003/e/f.jpg');
    raise exception 'FALLO: un menor sin consentimiento pudo subir un archivo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.aceptar_consentimiento('2026-10-01', true);
    raise exception 'FALLO: un menor se dio el consentimiento a sí mismo';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
  raise notice '✓ Menor de 14 bloqueado hasta el consentimiento del tutor';
end $$;

-- El servidor (service_role) registra el consentimiento del tutor
reset role;
update public.profiles set consentimiento_estado = 'concedido', consentimiento_ia = true,
  consentimiento_otorgado_por = 'tutor', consentimiento_fecha = now()
where id = :C;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.uploads (user_id, exam_id, tipo) values (:C, 'e0000000-0000-0000-0000-00000000000c', 'texto');
do $$ begin
  assert (select count(*) from public.uploads) = 1, 'Con consentimiento del tutor ya puede subir';
  perform public.retirar_consentimiento_ia();
  assert not public.puede_tratar_datos(), 'Retirar el consentimiento bloquea el tratamiento';
  raise notice '✓ Consentimiento del tutor y retirada';
end $$;

-- ── Anónimo ─────────────────────────────────────────────
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$ begin
  begin
    perform 1 from public.exams;
    raise exception 'FALLO: anon pudo leer exámenes';
  exception when insufficient_privilege then null;
  end;
  raise notice '✓ Sin acceso anónimo';
end $$;
reset role;

-- ── Borrado de cuenta en cascada ────────────────────────
delete from auth.users where id = :A;
do $$ begin
  assert (select count(*) from public.exams where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'Se borran los exámenes';
  assert (select count(*) from public.chunks where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'Se borran los fragmentos';
  assert (select count(*) from public.study_sessions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'Se borran las sesiones';
  assert (select count(*) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'Se borra el perfil';
  raise notice '✓ Borrado completo de la cuenta';
end $$;

-- ── Todas las tablas públicas tienen RLS ────────────────
do $$
declare sin_rls text;
begin
  select string_agg(relname, ', ') into sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert sin_rls is null, 'Tablas sin RLS: ' || coalesce(sin_rls, '');
  raise notice '✓ RLS activo en todas las tablas';
end $$;
