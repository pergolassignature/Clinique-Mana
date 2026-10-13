-- Clients: duplicate detection (migration *_clients_duplicates.sql, plan C2.1, decision I-5).
-- The cases of the import library's tests (scripts/import-gorendezvous/import-gorendezvous.test.mjs,
-- « findDuplicates ») with the same fictitious people, so the app and the import agree:
-- HIGH on a shared contact and the same name (accents and case folded); MEDIUM « shared_contact »
-- for a parent's contact on two files; MEDIUM on the same name and birth date alone; never a name
-- alone; a placeholder contact never pairs; a similar name with a partial email is MEDIUM; a birth
-- date conflict demotes a HIGH; the legacy similarity; the RPC's permission and clinic scope.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select function_privs_are('public', 'find_client_duplicates', array['text', 'text', 'text', 'text[]', 'date', 'uuid'], 'anon', array[]::text[], 'anon cannot call it');
select function_privs_are('public', 'find_client_duplicates', array['text', 'text', 'text', 'text[]', 'date', 'uuid'], 'authenticated', array['EXECUTE'], 'authenticated may call it');
select function_privs_are('private', 'clients_find_duplicates', array['uuid', 'text', 'text', 'text', 'text[]', 'date', 'uuid'], 'authenticated', array[]::text[], 'the helper: no role');

-- The legacy similarity.
select is(private.clients_name_similarity('marie', 'marie'), 1::numeric, 'similarity: equal');
select is(private.clients_name_similarity('anne', 'anne marie'), 0.7, 'similarity: inside, at least 0.7');
select ok(abs(private.clients_name_similarity('alexandra', 'alexandr') - 8::numeric / 9) < 0.0001, 'similarity: inside, short / long');
select is(private.clients_name_similarity('', 'x'), 0::numeric, 'similarity: empty');
select is(private.clients_name_form(' Marie-Ève  D''Amours '), 'marie eve d amours', 'name form: folded, - and '' as spaces');

-- Fixtures: clinic A with the import fixture's people already filed; clinic B with Camille too.
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164, home_e164, work_e164, birthday) values
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Tremblay-Fictif', 'camille.fictive@exemple.test', '+15145550101', null, null, date '1990-04-12'),
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Léo', 'Fictif', 'parent.fictif@exemple.test', '+14385550102', null, null, date '2010-02-03'),
  ('d0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Essai', null, null, null, null, date '1985-07-08'),
  ('d0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000a', 'Jean', 'Exemple', 'jean.exemple@exemple.test', null, null, '+18195550104', date '1970-01-01'),
  ('d0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'Alexandra', 'Fictive', 'alexandra.f@exemple.test', null, null, null, null),
  ('d0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-00000000000a', 'Sam', 'Essai', null, '+15145550199', null, null, date '2000-01-01'),
  ('d0000000-0000-0000-0000-000000000090', 'b0000000-0000-0000-0000-00000000000b', 'Camille', 'Tremblay-Fictif', 'camille.fictive@exemple.test', '+15145550101', null, null, date '1990-04-12');
-- A placeholder email on six files.
insert into public.clients (org_id, first_name, last_name, email)
select 'b0000000-0000-0000-0000-00000000000a', 'P' || n, 'Fictif', 'aucun@exemple.test' from generate_series(1, 6) n;
-- An archived and a merged file.
insert into public.clients (id, org_id, first_name, last_name, email, archived_at, merged_into_id) values
  ('d0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Archivée', 'zoe.archivee@exemple.test', now(), null),
  ('d0000000-0000-0000-0000-000000000021', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Archivée', 'zoe.archivee@exemple.test', now(), 'd0000000-0000-0000-0000-000000000020');

-- HIGH: the same email and phone, the name in capitals (line 5 of the fixture).
select results_eq($$ select client_id, level from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'CAMILLE', 'TREMBLAY-FICTIF', 'Camille.Fictive@Exemple.test', array['514 555-0101'], date '1990-04-12', null) $$,
  $$ values ('d0000000-0000-0000-0000-000000000004'::uuid, 'high') $$, 'HIGH: a shared contact and the same name, folded');
select is((select reasons from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'CAMILLE', 'TREMBLAY-FICTIF', 'Camille.Fictive@Exemple.test', array['514 555-0101'], date '1990-04-12', null)),
  array['email', 'phone', 'same_name', 'birthday'], '… with every reason');

-- MEDIUM: a parent's email and phone on a sibling's file (lines 6 and 7).
select results_eq($$ select client_id, level, 'shared_contact' = any (reasons) from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Maude', 'Fictif', 'parent.fictif@exemple.test', array['4385550102'], date '2012-06-15', null) $$,
  $$ values ('d0000000-0000-0000-0000-000000000006'::uuid, 'medium', true) $$, 'MEDIUM « shared_contact »: a parent on two files, never a merge');

-- MEDIUM: the same name (accents folded) and birth date, no shared contact (lines 8 and 9).
select results_eq($$ select client_id, level, reasons from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Helene', 'Essai', null, array['4505550103'], date '1985-07-08', null) $$,
  $$ values ('d0000000-0000-0000-0000-000000000008'::uuid, 'medium', array['same_name', 'birthday']) $$, 'MEDIUM: the same name and birth date alone');

-- Never a name alone (lines 10 and 11).
select is_empty($$ select 1 from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Jean', 'Exemple', 'autre.adresse@exemple.test', null, date '1980-01-01', null) $$,
  'never a name alone');

-- A placeholder contact never pairs.
select is_empty($$ select 1 from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'P9', 'Fictif', 'aucun@exemple.test', null, null, null) $$,
  'an email on six files is a placeholder: no pair');

-- A similar name with a partial email is MEDIUM; a birth date conflict demotes a HIGH.
select results_eq($$ select client_id, level, reasons[array_length(reasons, 1)] from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Alexandr', 'Fictive', 'alexandra.f@autre.test', null, null, null) $$,
  $$ values ('d0000000-0000-0000-0000-000000000012'::uuid, 'medium', 'partial_email') $$, 'MEDIUM: a similar name and a partial email');
select results_eq($$ select client_id, level, reasons[array_length(reasons, 1)] from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Sam', 'Essai', null, array['+15145550199'], date '2001-01-01', null) $$,
  $$ values ('d0000000-0000-0000-0000-000000000014'::uuid, 'medium', 'birthday_differs') $$, 'a birth date conflict demotes a HIGH to MEDIUM');

-- Archived files are candidates, merged ones never; a file never matches itself.
select results_eq($$ select client_id from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Archivée', 'zoe.archivee@exemple.test', null, null, null) $$,
  array['d0000000-0000-0000-0000-000000000020'::uuid], 'an archived file is a candidate, a merged one never');
select is_empty($$ select 1 from private.clients_find_duplicates('b0000000-0000-0000-0000-00000000000a', 'Camille', 'Tremblay-Fictif', 'camille.fictive@exemple.test', null, null, 'd0000000-0000-0000-0000-000000000004') $$,
  'the file being edited is excluded');

-- The RPC: clients.view first, the caller's clinic only, with the panel's columns.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select client_id, level, client_number, display_name from public.find_client_duplicates('Camille', 'Tremblay-Fictif', 'camille.fictive@exemple.test', array['5145550101'], null) $$,
  $$ values ('d0000000-0000-0000-0000-000000000004'::uuid, 'high', 1, 'Camille Tremblay-Fictif') $$, 'the RPC: clinic A''s file only, with its number and name');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.find_client_duplicates('Camille', 'Tremblay-Fictif', null, null, null) $$,
  '42501', 'Permission refusée : clients.view', 'a professional cannot search duplicates');

select * from finish();
rollback;
