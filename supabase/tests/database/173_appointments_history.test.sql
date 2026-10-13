-- Rendez-vous: an appointment's « Historique » (migration *_appointments_history.sql, AP-33). Covers:
-- the app executes it; the appointment's and its participants' rows, newest first, with the author;
-- redacted values stay redacted; paging; another appointment's rows never; a professional her own
-- appointment only; a staff member never a personal one; another clinic's « introuvable ».
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select function_privs_are('public', 'list_appointment_history', array['uuid', 'bigint', 'integer'], 'authenticated', array['EXECUTE'],
  'list_appointment_history: the app');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro2@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Pro B', 'pro2@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'Pro', 'Un', 'pro@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000007', 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p.id, t.id, 'L-' || right(p.id::text, 1), true
  from public.profession_titles t, (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) p(id)
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, email, reminders_by_email, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', null, false, 'fr');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.d', (((now() at time zone 'America/Toronto')::date + 10 + time '10:00') at time zone 'America/Toronto')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, p, d, '08:00', '20:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d,
       (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) x(p);
select set_config('test.a', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select set_config('test.b', public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.s50')::uuid,
  current_setting('test.d')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select public.set_appointment_details(current_setting('test.a')::uuid, 'phone', 'Note interne confidentielle', null);
select public.set_appointment_presence(current_setting('test.a')::uuid, 'd0000000-0000-0000-0000-000000000001', 'present');

select results_eq($$ select table_name, action, actor_name from public.list_appointment_history(current_setting('test.a')::uuid) $$,
  $$ values ('appointment_participants'::text, 'update'::text, 'Conseillère A'::text), ('appointments', 'update', 'Conseillère A'),
            ('appointment_participants', 'insert', 'Conseillère A'), ('appointments', 'insert', 'Conseillère A') $$,
  'the appointment''s and its participant''s rows, newest first, with who');
select ok(not exists (select 1 from public.list_appointment_history(current_setting('test.a')::uuid) h where h::text like '%confidentielle%'),
  'the internal note stays redacted');
select is((select count(*)::int from public.list_appointment_history(current_setting('test.a')::uuid, null, 2)), 2, 'a page of 2');
select is((select count(*)::int from public.list_appointment_history(current_setting('test.a')::uuid,
            (select min(h.id) from public.list_appointment_history(current_setting('test.a')::uuid, null, 2) h))), 2, '… then the next');
select ok(not exists (select 1 from public.list_appointment_history(current_setting('test.a')::uuid) h
                       where left(h.record_id, 36) <> current_setting('test.a')), 'never another appointment''s rows');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_appointment_history(current_setting('test.a')::uuid)), 4, 'its professional reads her appointment''s');
select throws_ok($$ select * from public.list_appointment_history(current_setting('test.b')::uuid) $$,
  'P0001', 'Rendez-vous introuvable.', '… never another professional''s');
select set_config('test.personal', public.book_personal_appointment(current_setting('test.d')::timestamptz + interval '3 hours',
  current_setting('test.d')::timestamptz + interval '4 hours', 'Dentiste')::text, true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_appointment_history(current_setting('test.personal')::uuid) $$,
  'P0001', 'Rendez-vous introuvable.', 'the staff never read a personal appointment''s');
select throws_ok($$ select * from public.list_appointment_history('99999999-0000-0000-0000-000000000000') $$,
  'P0001', 'Rendez-vous introuvable.', 'an unknown id');

select * from finish();
rollback;
