-- Rendez-vous, batch R1 (migrations *_appointments_module.sql, *_professionals_booking_facts.sql,
-- *_clients_booking_facts.sql, *_appointments_booking.sql). Covers: the registry and grants; RLS
-- per role (staff, the professional's own, another clinic, personal appointments); the seeds;
-- availability rules (overlap refused) and exceptions; booking: a 50 min session blocks 60 min,
-- overlap and buffer refused, outside availability refused in French, DST Sundays (two of 2027)
-- in local time, the service offered by the professional's titles, a couple service needs two,
-- the professional's limits (women only, minimum age), archived files, the balance rule (stub
-- replaced in the test) with its override; move, presence, cancel (late flag, kept on schedule);
-- get_open_slots; the Clients merge and anonymisation handlers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(97);

-- =============================================================================
-- Registry and privileges
-- =============================================================================
select ok(exists (select 1 from public.modules where key = 'appointments'), 'module appointments registered');
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'appointments' order by 1 $$,
  array['clients', 'professionals', 'services'], 'depends on clients, professionals, services');
select results_eq($$ select key from public.permissions where module_key = 'appointments' order by 1 $$,
  array['appointments.balance_override', 'appointments.manage', 'appointments.self', 'appointments.settings', 'appointments.view'], 'its permissions');
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': select only')
  from (values ('appointment_settings'), ('cancellation_reasons'), ('availability_rules'), ('availability_exceptions'),
               ('appointments'), ('appointment_participants')) as t(name);
select table_privs_are('public', 'appointments', 'anon', array[]::text[], 'appointments: nothing for anon');
select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': authenticated may call it')
  from (values
    ('set_appointment_settings', array['integer[]', 'time without time zone', 'time without time zone', 'integer', 'integer', 'boolean']),
    ('set_availability_rule', array['uuid', 'uuid', 'integer', 'time without time zone', 'time without time zone', 'uuid[]', 'boolean', 'boolean', 'date', 'date']),
    ('delete_availability_rule', array['uuid']),
    ('add_availability_exception', array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone', 'text']),
    ('remove_availability_exception', array['uuid']),
    ('book_appointment', array['uuid', 'uuid', 'timestamp with time zone', 'uuid[]', 'text', 'text', 'text', 'text', 'text']),
    ('move_appointment', array['uuid', 'timestamp with time zone', 'uuid', 'text']),
    ('set_appointment_presence', array['uuid', 'uuid', 'text']),
    ('cancel_appointment', array['uuid', 'text', 'text', 'boolean']),
    ('get_open_slots', array['uuid', 'uuid', 'date', 'date']),
    ('get_appointment_consents', array['uuid'])
  ) as f(name, args);
select function_privs_are('private', f.name, f.args, 'authenticated', array[]::text[], f.name || ': no role')
  from (values ('client_has_balance', array['uuid', 'uuid']), ('professional_booking_facts', array['uuid', 'uuid']),
               ('service_booking_facts', array['uuid', 'uuid']),
               ('clients_booking_facts', array['uuid', 'uuid[]']), ('appointments_reassign_client', array['uuid', 'uuid']),
               ('appointments_anonymize_client', array['uuid'])) as f(name, args);

-- =============================================================================
-- Fixtures: clinic A (admin, conseillère, adjointe, provider P1), clinic B (admin)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o),
                       (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);

-- P1 (psychologue, the provider's file), P2 (travailleuse sociale, women only, 18 and over).
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Trois', 'pro3@a.test', 'draft');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'psychologue'), ('c0000000-0000-0000-0000-000000000002'::uuid, 'travailleur_social')) as x(p, k)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = x.k;
insert into public.professional_matching_profiles (org_id, professional_id, women_only, min_client_age) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', true, 18);

insert into public.clients (id, org_id, first_name, last_name, sex, birthday, archived_at) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai', 'female', '1990-01-01', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc',  'Essai', 'male',   '1985-01-01', null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Léa',   'Essai', 'female', '2015-01-01', null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Archi', 'Essai', null,     null,         now()),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Autre', 'Clinique', null,  null,         null);

select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.couple', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 20160), true);
select set_config('test.fee', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 20100), true);

-- =============================================================================
-- Seeds
-- =============================================================================
select results_eq($$ select business_days, business_start, business_end from public.appointment_settings where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('{1,2,3,4,5}'::smallint[], time '08:00', time '17:00') $$, 'business hours: Monday–Friday 8:00–17:00 (R-52)');
select results_eq($$ select key from public.cancellation_reasons where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order $$,
  array['not_specified', 'no_longer_needed', 'personal_emergency', 'family_emergency', 'work_emergency', 'dissatisfied', 'other'],
  'the cancellation reasons, without COVID-19');

-- =============================================================================
-- Availability (the conseillère: appointments.manage)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
-- P1: Monday 9:00–12:00; Sunday 9:00–12:00 (the DST Sundays); P2: Monday 9:00–17:00 couple only.
select set_config('test.r_mon', public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 1, '09:00', '12:00', '{}', true, false, '2026-10-01', null)::text, true);
select set_config('test.r_sun', public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 7, '09:00', '12:00', '{}', true, false, '2026-10-01', null)::text, true);
select lives_ok($$ select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000002', 1, '09:00', '17:00',
  array[current_setting('test.couple')::uuid], true, false, '2026-10-01', null) $$, 'a window for one service');
select throws_ok($$ select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 1, '11:00', '13:00', '{}', true, false, '2026-10-01', null) $$,
  'P0001', 'Cette plage chevauche une autre plage du même jour.', 'two windows of a weekday never overlap');
select throws_ok($$ select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000003', 2, '09:00', '12:00', '{}', true, false, null, null) $$,
  'P0001', 'Ce professionnel n''est pas actif : il ne reçoit pas de rendez-vous.', 'not for an inactive professional');
select throws_ok($$ select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 2, '09:07', '12:00', '{}', true, false, null, null) $$,
  'P0001', 'Les heures d''une plage tombent sur un multiple de 5 minutes.', 'five-minute marks');
-- Monday 2027-03-22: a holiday for P1 from 11:00 local.
select lives_ok($$ select public.add_availability_exception('c0000000-0000-0000-0000-000000000001', 'holiday', '2027-03-22 15:00Z', '2027-03-22 20:00Z', 'Congé') $$,
  'an exception');

-- =============================================================================
-- Booking
-- =============================================================================
-- Monday 2027-03-15 9:00 in Montréal (EDT) = 13:00Z: 50 minutes, blocks 60.
select set_config('test.a1', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
reset role;
select results_eq($$ select ends_at, blocks_until, state, mode from public.appointments where id = current_setting('test.a1')::uuid $$,
  $$ values (timestamptz '2027-03-15 13:50Z', timestamptz '2027-03-15 14:00Z', 'booked', 'video') $$, 'a 50 min session blocks 60 min (R-13)');
select is((select count(*)::int from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000001' and professional_id = 'c0000000-0000-0000-0000-000000000001'),
  1, 'the client is linked to the professional (R-8)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 13:55Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'inside the « pause après »: refused');
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$, 'right after the pause: booked');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 15:30Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', '11:30–12:20 passes the window: refused in French');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-16 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'a Tuesday without a window: refused');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-22 15:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'during an exception: refused');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 13:07Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'L''heure du rendez-vous tombe sur un multiple de 5 minutes.', 'five-minute marks');

-- Daylight saving: 9:00 local on both 2027 change Sundays (EDT then EST).
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-14 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$, 'Sunday 2027-03-14 9:00 EDT (the spring change day)');
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-11-07 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$, 'Sunday 2027-11-07 9:00 EST (the fall change day)');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-11-07 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', '… 13:00Z that day is 8:00 EST: refused');

-- The service and the clients.
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.couple')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce professionnel n''offre pas ce service.', 'a couple service the psychologue does not offer');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.fee')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce service ne se réserve pas à l''agenda (il n''a pas de durée).', 'a fee is not booked');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.couple')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce service se réserve pour deux personnes : choisissez les deux clients.', 'a couple service needs two clients');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.couple')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce professionnel reçoit seulement des femmes.', 'women only: the first client is a man');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.couple')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000003'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce professionnel reçoit les clients de 18 ans et plus.', 'a minimum age on the first client');
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.couple')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'a couple booked: a woman first, then the second person');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000004'::uuid]) $$,
  'P0001', 'Ce dossier est archivé : restaurez-le avant de réserver.', 'an archived file');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-29 13:00Z', array['d0000000-0000-0000-0000-000000000009'::uuid]) $$,
  'P0001', 'Dossier client introuvable.', 'another clinic''s client');

-- The balance rule (R-58): the stub is replaced for the test.
reset role;
create or replace function private.client_has_balance(p_org uuid, p_client_id uuid) returns boolean
language sql stable set search_path = '' as $$ select p_client_id = 'd0000000-0000-0000-0000-000000000002'::uuid $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-04-05 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce client a un solde dû : il faut le régler, ou une exception approuvée, avant un nouveau rendez-vous.', 'a balance: refused');
do $$
begin
  perform public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
    '2027-04-05 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]);
exception when others then
  declare v_hint text;
  begin
    get stacked diagnostics v_hint = pg_exception_hint;
    perform set_config('test.hint', v_hint, true);
  end;
end;
$$;
select is(current_setting('test.hint'), 'balance_due', '… with HINT balance_due (R-58)');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-04-05 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], 'video', null, null, 'Entente de paiement') $$,
  '42501', 'Permission refusée : appointments.balance_override', '… a conseillère cannot override');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.a_override', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-04-05 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], 'video', null, null, 'Entente de paiement')::text, true);
reset role;
select results_eq($$ select balance_override_reason, balance_override_by from public.appointments where id = current_setting('test.a_override')::uuid $$,
  $$ values ('Entente de paiement', 'a0000000-0000-0000-0000-000000000002'::uuid) $$, '… the adjointe overrides, the reason kept');
create or replace function private.client_has_balance(p_org uuid, p_client_id uuid) returns boolean
language sql stable set search_path = '' as $$ select false $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.a_noreason', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-04-26 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, 'Pas de solde')::text, true);
reset role;
select is((select balance_override_reason from public.appointments where id = current_setting('test.a_noreason')::uuid), null,
  'a reason without a balance to override is not kept');
set local role authenticated;

-- =============================================================================
-- Move, presence, cancel
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
reset role;
update public.appointments set state = 'confirmed', confirmed_at = now() where id = current_setting('test.a1')::uuid;
set local role authenticated;
select lives_ok($$ select public.move_appointment(current_setting('test.a1')::uuid, '2027-03-15 15:00Z') $$, 'moved to 11:00');
reset role;
select results_eq($$ select starts_at, blocks_until, state, confirmed_at from public.appointments where id = current_setting('test.a1')::uuid $$,
  $$ values (timestamptz '2027-03-15 15:00Z', timestamptz '2027-03-15 16:00Z', 'booked', null::timestamptz) $$,
  '… its times follow, and the client must confirm again');
set local role authenticated;
select throws_ok($$ select public.move_appointment(current_setting('test.a1')::uuid, '2027-03-15 14:00Z') $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'a move onto another appointment: refused');
select lives_ok($$ select public.set_appointment_presence(current_setting('test.a1')::uuid, 'd0000000-0000-0000-0000-000000000001', 'present') $$, 'presence noted');
select throws_ok($$ select public.set_appointment_presence(current_setting('test.a1')::uuid, 'd0000000-0000-0000-0000-000000000002', 'present') $$,
  'P0001', 'Ce client n''est pas au rendez-vous.', '… only for a participant');
select lives_ok($$ select public.cancel_appointment(current_setting('test.a1')::uuid, 'personal_emergency', 'Malade', true) $$, 'cancelled, kept on the schedule');
reset role;
select results_eq($$ select a.state, a.cancel_late, a.kept_on_schedule, r.key from public.appointments a join public.cancellation_reasons r on r.id = a.cancel_reason_id
                      where a.id = current_setting('test.a1')::uuid $$,
  $$ values ('cancelled', false, true, 'personal_emergency') $$, '… months ahead: not late; the reason and « garder à l''horaire » kept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 15:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'a slot kept on the schedule stays taken');
select throws_ok($$ select public.move_appointment(current_setting('test.a1')::uuid, '2027-03-15 16:00Z') $$,
  'P0001', 'Un rendez-vous annulé ou terminé ne se déplace pas.', 'a cancelled appointment does not move');
-- Late: an appointment in an hour (inserted directly), cancelled now.
reset role;
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
        current_setting('test.couple')::uuid, date_trunc('hour', now()) + interval '2 hours', date_trunc('hour', now()) + interval '3 hours', date_trunc('hour', now()) + interval '3 hours');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_appointment('e0000000-0000-0000-0000-000000000001', 'not_specified') $$, 'a cancellation two hours before');
reset role;
select is((select cancel_late from public.appointments where id = 'e0000000-0000-0000-0000-000000000001'), true, '… is late (under 24 h, the policy in force)');

-- =============================================================================
-- Open slots
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select starts_at from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-15', '2027-03-15') $$,
  $$ values (timestamptz '2027-03-15 13:00Z') $$, 'Monday: 9:00 freed by the move, 10:00 taken, 11:00 cancelled but kept on the schedule');
select results_eq($$ select starts_at from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-14', '2027-03-14') $$,
  $$ values (timestamptz '2027-03-14 14:00Z'), (timestamptz '2027-03-14 15:00Z') $$, 'the spring Sunday: 9:00 taken; 10:00 and 11:00 EDT');
set local timezone = 'America/Toronto';
select results_eq($$ select starts_at from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-11-07', '2027-11-07') $$,
  $$ values (timestamptz '2027-11-07 15:00Z'), (timestamptz '2027-11-07 16:00Z') $$, 'the fall Sunday, under a Montréal session: 9:00 EST taken; 10:00 and 11:00');
set local timezone = 'UTC';
select throws_ok($$ select * from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01', '2027-06-01') $$,
  'P0001', 'Choisissez une période de 62 jours au plus.', 'a bounded period');

-- A retired service: its appointments still move; it is not booked any more.
reset role;
update public.services set is_active = false where id = current_setting('test.s50')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.move_appointment(current_setting('test.a_override')::uuid, '2027-04-05 14:00Z') $$, 'a retired service''s appointment still moves');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-05-03 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce service n''existe pas ou n''est plus offert.', '… and is not booked any more');
reset role;
update public.services set is_active = true where id = current_setting('test.s50')::uuid;
-- A personal appointment of P1: the staff never act on it, P1 does.
insert into public.appointments (id, org_id, professional_id, starts_at, ends_at, blocks_until, is_personal, personal_label)
values ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        '2027-05-10 18:00Z', '2027-05-10 19:00Z', '2027-05-10 19:00Z', true, 'Dentiste');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_appointment('e0000000-0000-0000-0000-000000000002', 'other') $$,
  '42501', 'Permission refusée : appointments.manage', 'the staff never cancel a personal appointment');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_appointment('e0000000-0000-0000-0000-000000000002', 'other') $$, '… its professional does');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select * from public.get_appointment_consents(current_setting('test.a_override')::uuid) $$, 'the consents an appointment requires (C5a.6)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_appointment_consents((select id from public.appointments where professional_id = 'c0000000-0000-0000-0000-000000000002' limit 1)) $$,
  'P0001', 'Rendez-vous introuvable.', '… never for another professional''s appointment');

-- =============================================================================
-- RLS and the professional's own agenda
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok((select count(*) from public.appointments) > 0 and (select bool_and(professional_id = 'c0000000-0000-0000-0000-000000000001') from public.appointments),
  'a professional reads her own appointments only');
select is((select count(*)::int from public.availability_rules where professional_id = 'c0000000-0000-0000-0000-000000000002'), 0, '… nor another''s availability');
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-04-12 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$, 'she books her own agenda');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.couple')::uuid,
  '2027-04-12 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid]) $$,
  '42501', 'Permission refusée : appointments.manage', '… never another''s');
select throws_ok($$ select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000002', 3, '09:00', '12:00', '{}', true, false, null, null) $$,
  '42501', 'Permission refusée : appointments.manage', '… nor another''s availability');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.appointments), 0, 'another clinic reads none');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-04-19 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Professionnel introuvable.', '… nor books another clinic''s professional');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_appointment_settings(array[1, 2, 3, 4], '08:30', '16:30', 1, 8) $$, 'the admin sets the business hours');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_appointment_settings(array[1, 2, 3, 4, 5], '08:00', '17:00', 1, 8) $$,
  '42501', 'Permission refusée : appointments.settings', '… a conseillère cannot');

-- =============================================================================
-- Clients' merge and anonymisation
-- =============================================================================
reset role;
select is(private.appointments_reassign_client('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001') > 0, true,
  'a merge moves the merged file''s places');
select is((select count(*)::int from public.appointment_participants where client_id = 'd0000000-0000-0000-0000-000000000002'), 0, '… none left on it');
select is((select count(*)::int from public.appointment_participants p
            where p.client_id = 'd0000000-0000-0000-0000-000000000001'
              and p.appointment_id = (select a.id from public.appointments a where a.service_id = current_setting('test.couple')::uuid and a.state = 'booked' limit 1)), 1,
  '… a couple appointment holding both keeps the kept file once');
-- Marc (2) the person seen, Zoé (5) the second: merging Marc into Zoé makes her the person seen.
insert into public.clients (id, org_id, first_name, last_name) values ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Essai');
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, '2027-06-07 13:00Z', '2027-06-07 13:50Z', '2027-06-07 14:00Z');
insert into public.appointment_participants (appointment_id, client_id, org_id, role) values
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'client'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'second');
select private.appointments_reassign_client('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005');
select results_eq($$ select client_id, role from public.appointment_participants where appointment_id = 'e0000000-0000-0000-0000-000000000003' $$,
  $$ values ('d0000000-0000-0000-0000-000000000005'::uuid, 'client') $$, '… the kept file becomes the person seen');
update public.appointments set internal_note = 'Note', client_message = 'Message' where id = current_setting('test.a_override')::uuid;
-- A future appointment Alice shares with Zoé (Alice the person seen).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, '2027-06-14 13:00Z', '2027-06-14 13:50Z', '2027-06-14 14:00Z');
insert into public.appointment_participants (appointment_id, client_id, org_id, role) values
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'second');
select is(private.appointments_anonymize_client('d0000000-0000-0000-0000-000000000001') > 0, true, 'an anonymisation blanks the free texts');
select results_eq($$ select internal_note, client_message from public.appointments where id = current_setting('test.a_override')::uuid $$,
  $$ values (null::text, null::text) $$, '… of her appointments');
select is((select state from public.appointments where id = current_setting('test.a_override')::uuid), 'cancelled',
  '… her future appointment alone is cancelled (no reminder to an anonymised file)');
select results_eq($$ select client_id, role from public.appointment_participants where appointment_id = 'e0000000-0000-0000-0000-000000000004' $$,
  $$ values ('d0000000-0000-0000-0000-000000000005'::uuid, 'client') $$, '… and leaves a shared one, the other the person seen');
select ok(exists (select 1 from public.client_merge_handlers where module_key = 'appointments')
          and exists (select 1 from public.client_anonymize_handlers where module_key = 'appointments'), 'both handlers registered');

select * from finish();
rollback;
