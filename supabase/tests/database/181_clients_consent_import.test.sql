-- Clients, the GOrendezvous import of signed consents (migration *_clients_consent_import.sql;
-- decision I-18). Covers: privileges (clients.manage and clients.merge); a dry run writes nothing;
-- a consent as a fact (source `import`, its date, version label and signer, no PDF), in force in
-- `client_consents_status`; already in force `skipped`; a client not found `unmatched`; an
-- unknown consent and a date in the future refused with their field.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select function_privs_are('public', 'import_client_consent', array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], 'import_client_consent: authenticated');
select function_privs_are('public', 'import_client_consent', array['jsonb', 'boolean'], 'anon', array[]::text[], 'import_client_consent: never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@cc.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@cc.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@cc.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@cc.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.clients (id, org_id, first_name, last_name, language, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'fr', 'gorendezvous:701');
select set_config('test.row', '{"client_ref": "gorendezvous:701", "consent_key": "general", "signed_at": "2024-05-06T10:00:00-04:00",
  "version_label": "Version 2023", "signer_name": "Camille Essai"}', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_client_consent(current_setting('test.row')::jsonb, true) $$, '42501', 'Permission refusée : clients.merge',
  'the conseillère (no clients.merge): refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.row')::jsonb, true) ->> 'status', 'ok', 'a dry run: ok');
reset role;
select is((select count(*)::int from public.client_consents where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing written');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.row')::jsonb, false) ->> 'status', 'ok', 'imported');
reset role;
select results_eq($$ select source, signed_at, version_label, signed_by -> 0 ->> 'name', signed_file_id is null
                       from public.client_consents where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'general' $$,
  $$ values ('import'::text, '2024-05-06T10:00:00-04:00'::timestamptz, 'Version 2023'::text, 'Camille Essai'::text, true) $$,
  'a fact: source « import », its date, version and signer, no PDF');
select is((select in_force from public.client_consents_status where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'general'),
  true, '… in force');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.row')::jsonb, false) ->> 'status', 'skipped', 'already in force: skipped');
select is(public.import_client_consent('{"client_name": "Personne Inconnue", "consent_key": "general", "signed_at": "2024-05-06"}', true) ->> 'reason',
  'client_not_found', 'a file not imported: unmatched');
select is(public.import_client_consent(current_setting('test.row')::jsonb || '{"consent_key": "astrologie"}', true) -> 'errors' -> 0 ->> 'field',
  'consent_key', 'an unknown consent: refused with its field');
select is(public.import_client_consent(current_setting('test.row')::jsonb || '{"consent_key": "coaching", "signed_at": "2099-01-01"}', true) -> 'errors' -> 0 ->> 'field',
  'signed_at', 'a signature in the future: refused');
reset role;

select * from finish();
rollback;
