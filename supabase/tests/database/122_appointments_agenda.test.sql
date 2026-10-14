-- Rendez-vous, batch R2 (migrations *_clients_display_names.sql, *_appointments_agenda.sql).
-- Covers: privileges (the new signatures, the old ones gone); AP-12 « Hors disponibilités »: a
-- reason required from the staff (a professional on her own agenda needs none since R-82), overlaps still refused,
-- the reason kept with its author and redacted in the audit, a move back inside clears it;
-- set_appointment_details; list_agenda: names, busy time for another's personal appointment,
-- a professional's own only, the bounded period.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select function_privs_are('public', 'book_appointment',
  array['uuid', 'uuid', 'timestamp with time zone', 'uuid[]', 'text', 'text', 'text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'book_appointment (with the override)');
select hasnt_function('public', 'book_appointment', array['uuid', 'uuid', 'timestamp with time zone', 'uuid[]', 'text', 'text', 'text', 'text'], 'the old book_appointment is gone');
select function_privs_are('public', 'move_appointment', array['uuid', 'timestamp with time zone', 'uuid', 'text'], 'authenticated', array['EXECUTE'], 'move_appointment (with the override)');
select function_privs_are('public', 'list_agenda', array['timestamp with time zone', 'timestamp with time zone', 'uuid[]'], 'authenticated', array['EXECUTE'], 'list_agenda');
select function_privs_are('public', 'set_appointment_details', array['uuid', 'text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'set_appointment_details');
select function_privs_are('private', 'clients_display_names', array['uuid', 'uuid[]'], 'authenticated', array[]::text[], 'clients_display_names: no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- A personal appointment of P2 (busy time for the others).
insert into public.appointments (id, org_id, professional_id, starts_at, ends_at, blocks_until, is_personal, personal_label)
values ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
        '2027-03-15 18:00Z', '2027-03-15 19:00Z', '2027-03-15 19:00Z', true, 'Dentiste');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 1, '09:00', '12:00', '{}', true, false, '2026-10-01', null);

-- AP-12: Monday 2027-03-15 at 18:00 local (22:00Z) is outside P1's 9:00–12:00.
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 22:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'outside availability without a reason: refused');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 22:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, null, 'x') $$,
  'P0001', 'La raison « Hors disponibilités » compte de 3 à 500 caractères.', 'a reason of 3 characters at least');
select set_config('test.out', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 22:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, null, 'Soirée exceptionnelle')::text, true);
reset role;
select results_eq($$ select outside_availability_reason, outside_availability_by from public.appointments where id = current_setting('test.out')::uuid $$,
  $$ values ('Soirée exceptionnelle', 'a0000000-0000-0000-0000-000000000004'::uuid) $$, 'the conseillère books outside with a reason, kept with its author');
select is((select changed_fields ->> 'outside_availability_reason' from public.audit_log
            where table_name = 'appointments' and record_id = current_setting('test.out') and action = 'insert'),
  '[redacted]', '… the reason redacted in the audit');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 22:30Z', array['d0000000-0000-0000-0000-000000000002'::uuid], 'video', null, null, null, 'Encore une') $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'never across another appointment');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-16 22:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, null, 'Pour moi') $$,
  'R-82 (*_appointments_own_bookings.sql): a professional books on her own agenda outside her availability (was refused, AP-12)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.move_appointment(current_setting('test.out')::uuid, '2027-03-15 13:00Z') $$, 'moved inside the availability');
reset role;
select is((select outside_availability_reason from public.appointments where id = current_setting('test.out')::uuid), null, '… the reason cleared');
select is((select changed_fields ->> 'outside_availability_reason' from public.audit_log
            where table_name = 'appointments' and record_id = current_setting('test.out') and action = 'update'
              and changed_fields ? 'outside_availability_reason' order by id desc limit 1),
  '[redacted]', '… and its clearing is redacted too (the trigger''s own list, not a session setting)');
select is(coalesce(current_setting('app.audit_redact', true), ''), '', 'no session setting left behind');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.move_appointment(current_setting('test.out')::uuid, '2027-03-15 23:00Z') $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'a move outside needs the reason too');
select lives_ok($$ select public.move_appointment(current_setting('test.out')::uuid, '2027-03-15 23:00Z', null, 'Déplacé le soir') $$, '… and is made with it');

-- Details.
select lives_ok($$ select public.set_appointment_details(current_setting('test.out')::uuid, 'phone', '  Note interne ', 'Apportez vos documents.') $$, 'the details');
reset role;
select results_eq($$ select mode, internal_note, client_message from public.appointments where id = current_setting('test.out')::uuid $$,
  $$ values ('phone', 'Note interne', 'Apportez vos documents.') $$, '… trimmed and saved');
set local role authenticated;

-- The agenda.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select participants -> 0 ->> 'name', outside_availability from public.list_agenda('2027-03-15 00:00Z', '2027-03-16 12:00Z')
                      where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('Alice Essai', true) $$, 'the staff read the clients'' names and the « Hors disponibilités » flag');
select results_eq($$ select is_personal, personal_label, service_id, participants from public.list_agenda('2027-03-15 00:00Z', '2027-03-16 12:00Z')
                      where professional_id = 'c0000000-0000-0000-0000-000000000002' $$,
  $$ values (true, null::text, null::uuid, '[]'::jsonb) $$, '… another professional''s personal appointment as busy time only');
select is((select count(*)::int from public.list_agenda('2027-03-15 00:00Z', '2027-03-16 12:00Z', array['c0000000-0000-0000-0000-000000000002'::uuid])), 1,
  'a filter by professional');
select throws_ok($$ select * from public.list_agenda('2027-03-01 00:00Z', '2027-05-01 00:00Z') $$,
  'P0001', 'Choisissez une période de 45 jours au plus.', 'a bounded period');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select professional_id from public.list_agenda('2027-03-15 00:00Z', '2027-03-16 12:00Z') $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid) $$, 'a professional reads her own agenda only');
select throws_ok($$ select public.set_appointment_details('e0000000-0000-0000-0000-000000000009', 'video', null, null) $$,
  '42501', 'Permission refusée : appointments.manage', '… and never touches another''s personal appointment');

select * from finish();
rollback;
