-- Clients: migration *_clients_email_match_partial_update.sql. Covers: update_client changes only
-- the keys it is sent (a card's fields), still checks the result and still needs clients.manage;
-- private.clients_match_email: granted to no role, the person herself and her relations, the
-- address trimmed and folded, a placeholder (6+ files) matches nothing, merged and anonymised
-- files never, archived ones yes, the clinic only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select function_privs_are('private', 'clients_match_email', array['uuid', 'text[]'], 'authenticated', array[]::text[], 'authenticated cannot call it');
select function_privs_are('private', 'clients_match_email', array['uuid', 'text[]'], 'service_role', array[]::text[], 'nor service_role (definer callers only)');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.clients (id, org_id, client_number, first_name, last_name, email, postal_code, city, archived_at, merged_into_id, anonymized_at) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 1, 'Marc', 'Parent', 'marc@exemple.test', 'H2X 1A1', 'Montréal', null, null, null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 2, 'Léa', 'Enfant', null, null, null, null, null, null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 3, 'Zoé', 'Archivée', 'zoe@exemple.test', null, null, now(), null, null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 4, 'Fusion', 'Née', 'zoe@exemple.test', null, null, now(), 'd0000000-0000-0000-0000-000000000003', null),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 5, 'Client', 'anonymisé n° 5', 'marc@exemple.test', null, null, now(), null, now()),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 1, 'Autre', 'Clinique', 'marc@exemple.test', null, null, null, null, null);
-- Six files sharing the clinic's own address: a placeholder.
insert into public.clients (org_id, client_number, first_name, last_name, email)
select 'b0000000-0000-0000-0000-00000000000a', 10 + n, 'Personne', 'N' || n, 'info@clinique.test' from generate_series(1, 6) n;
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, a_main_contact) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'parent', 'child', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', 'sibling', 'sibling', false);

select results_eq(
  $$ select email, client_id, match_kind from private.clients_match_email('b0000000-0000-0000-0000-00000000000a', array[' Marc@Exemple.TEST ']) $$,
  $$ values ('marc@exemple.test', 'd0000000-0000-0000-0000-000000000001'::uuid, 'client'), ('marc@exemple.test', 'd0000000-0000-0000-0000-000000000002'::uuid, 'relation') $$,
  'the person herself, then the files she is related to; the address trimmed and folded; this clinic only');
select results_eq(
  $$ select client_id from private.clients_match_email('b0000000-0000-0000-0000-00000000000a', array['zoe@exemple.test']) $$,
  array['d0000000-0000-0000-0000-000000000003'::uuid], 'an archived file matches, a merged one never');
select is((select count(*)::int from private.clients_match_email('b0000000-0000-0000-0000-00000000000a', array['info@clinique.test'])), 0,
  'an address on 6 files is a placeholder: no match');
select is((select count(*)::int from private.clients_match_email('b0000000-0000-0000-0000-00000000000a', array['', null, 'nobody@exemple.test'])), 0,
  'empty, null and unknown addresses: nothing');
select is((select count(*)::int from private.clients_match_email('b0000000-0000-0000-0000-00000000000a', array['marc@exemple.test'])
            where client_id = 'd0000000-0000-0000-0000-000000000005'), 0,
  'an anonymised file never matches, as herself or as a relation');

-- update_client: a card sends its own keys; the others stay as stored.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.update_client('d0000000-0000-0000-0000-000000000001', '{"email": "marc.nouveau@exemple.test"}') $$, 'a card saves its field alone');
reset role;
select results_eq(
  $$ select email, first_name, last_name, postal_code, city from public.clients where id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('marc.nouveau@exemple.test', 'Marc', 'Parent', 'H2X 1A1', 'Montréal') $$, '… the other fields kept as stored');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.update_client('d0000000-0000-0000-0000-000000000001', '{"city": null, "postal_code": ""}') $$, 'a sent empty value clears the field');
reset role;
select results_eq($$ select city, postal_code, email from public.clients where id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values (null::text, null::text, 'marc.nouveau@exemple.test') $$, '… and only that one');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.update_client('d0000000-0000-0000-0000-000000000001', '{"first_name": " "}') $$, 'P0001',
  'Indiquez le prénom (100 caractères au plus).', 'the result is still checked');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.update_client('d0000000-0000-0000-0000-000000000001', '{"city": "Laval"}') $$, '42501',
  'Permission refusée : clients.manage', 'still clients.manage only');

select * from finish();
rollback;
