-- Clients, « Référé par » a file (migration *_clients_referrer.sql, CL-19). Covers: the column, its
-- constraints, index and trigger; the new private functions granted to no role; create_client with a
-- file, never with both, never another clinic's file; update_client: choosing a file clears the
-- typed name and typing a name clears the file, the file itself, a merged or an anonymised file
-- refused, a card save that does not touch it never re-checks it; the record's bundle (number,
-- name, « anonymisé »); the merge (links to the merged file move to the kept one, the kept file never
-- names itself, an empty kept file takes the merged file's link, a kept link wins over the merged
-- typed name, the take moves both columns); the anonymisation (links to the file stay, its own link
-- goes); a professional never reads it (my_clients).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

select has_column('public', 'clients', 'referred_by_client_id', 'clients.referred_by_client_id');
select col_is_null('public', 'clients', 'referred_by_client_id', '… nullable');
select fk_ok('public', 'clients', array['org_id', 'referred_by_client_id'], 'public', 'clients', array['org_id', 'id'], '… a file of the same clinic');
select has_index('public', 'clients', 'clients_org_referred_by_client_idx', '… indexed (the merge moves the links)');
select has_trigger('public', 'clients', 'clients_referrer_one', '… the trigger keeping one of the two');
select hasnt_column('public', 'my_clients', 'referred_by_client_id', 'a professional never reads it (my_clients)');
select hasnt_column('public', 'my_clients', 'referred_by', '… nor the typed name');
select function_privs_are('private', 'clients_check_referrer', array['uuid', 'uuid', 'uuid'], 'authenticated', array[]::text[], 'the referrer check: no role');
select function_privs_are('private', 'clients_reassign_client', array['uuid', 'uuid'], 'authenticated', array[]::text[], 'Clients'' merge handler: no role');
select is((select function_name from public.client_merge_handlers where module_key = 'clients'), 'private.clients_reassign_client',
  'Clients'' merge handler is the one that also moves the links');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'clients', true);

set local role authenticated;
-- Org B's file, for the cross-clinic refusal.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_config('test.b', public.create_client('{"first_name": "Bruno", "last_name": "Ailleurs"}', true)::text, true);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ref', public.create_client('{"first_name": "Rita", "last_name": "Référente"}', true)::text, true);
select set_config('test.new', public.create_client(jsonb_build_object('first_name', 'Nora', 'last_name', 'Nouvelle',
  'referred_by_client_id', current_setting('test.ref')), true)::text, true);
select results_eq($$ select referred_by_client_id::text, referred_by from public.clients where id = current_setting('test.new')::uuid $$,
  $$ values (current_setting('test.ref'), null::text) $$, 'create_client links the referring file');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', 'Zed', 'last_name', 'Deux',
  'referred_by', 'Une amie', 'referred_by_client_id', current_setting('test.ref'))) $$,
  'P0001', '« Référé par » est un dossier ou un nom écrit, pas les deux.', '… never a file and a typed name together');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', 'Zed', 'last_name', 'Trois',
  'referred_by_client_id', current_setting('test.b'))) $$,
  'P0001', 'Choisissez un dossier de la clinique.', '… never another clinic''s file');

-- update_client: one clears the other.
select lives_ok($$ select public.update_client(current_setting('test.new')::uuid, '{"referred_by": "Une collègue", "referred_by_client_id": null}') $$,
  'a typed name');
select results_eq($$ select referred_by_client_id, referred_by from public.clients where id = current_setting('test.new')::uuid $$,
  $$ values (null::uuid, 'Une collègue') $$, '… clears the file');
select lives_ok($$ select public.update_client(current_setting('test.new')::uuid, jsonb_build_object('referred_by_client_id', current_setting('test.ref'))) $$,
  'a file chosen (the typed name not sent)');
select results_eq($$ select referred_by_client_id::text, referred_by from public.clients where id = current_setting('test.new')::uuid $$,
  $$ values (current_setting('test.ref'), null::text) $$, '… clears the typed name');
select throws_ok($$ select public.update_client(current_setting('test.new')::uuid, jsonb_build_object('referred_by_client_id', current_setting('test.new'))) $$,
  'P0001', 'Un client ne peut pas être référé par son propre dossier.', 'never the file itself');

-- The record's bundle.
select is(public.get_client_summary(current_setting('test.new')::uuid) -> 'referrer',
  jsonb_build_object('id', current_setting('test.ref'), 'client_number', (select client_number from public.clients where id = current_setting('test.ref')::uuid),
                     'display_name', 'Rita Référente', 'anonymized', false, 'archived', false),
  'the record reads the referring file''s number and name');
select is(public.get_client_summary(current_setting('test.ref')::uuid) -> 'referrer', 'null'::jsonb, '… none when it names no file');

-- The merge.
select set_config('test.keep', public.create_client('{"first_name": "Karim", "last_name": "Gardé"}', true)::text, true);
select set_config('test.gone', public.create_client(jsonb_build_object('first_name', 'Karima', 'last_name', 'Fusionnée',
  'referred_by_client_id', current_setting('test.ref')), true)::text, true);
select set_config('test.child', public.create_client(jsonb_build_object('first_name', 'Chloé', 'last_name', 'Filleule',
  'referred_by_client_id', current_setting('test.gone')), true)::text, true);
select lives_ok($$ select public.merge_clients(current_setting('test.keep')::uuid, current_setting('test.gone')::uuid) $$, 'a merge');
reset role;
select is((select referred_by_client_id::text from public.clients where id = current_setting('test.child')::uuid), current_setting('test.keep'),
  '… a file the merged one referred now names the kept one');
select is((select referred_by_client_id::text from public.clients where id = current_setting('test.keep')::uuid), current_setting('test.ref'),
  '… the kept file with no « Référé par » takes the merged file''s');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.update_client(current_setting('test.ref')::uuid, jsonb_build_object('referred_by_client_id', current_setting('test.gone'))) $$,
  'P0001', 'Ce dossier a été fusionné dans un autre : choisissez le dossier conservé.', 'a merged file cannot be chosen');

-- A kept file that names a file keeps it over the merged file's typed name; one that names the merged file names nobody.
select set_config('test.k2', public.create_client(jsonb_build_object('first_name', 'Kim', 'last_name', 'Deux',
  'referred_by_client_id', current_setting('test.ref')), true)::text, true);
select set_config('test.m2', public.create_client('{"first_name": "Mia", "last_name": "Deux", "referred_by": "Une voisine"}', true)::text, true);
select lives_ok($$ select public.merge_clients(current_setting('test.k2')::uuid, current_setting('test.m2')::uuid) $$, 'a merge, both with a « Référé par »');
reset role;
select results_eq($$ select referred_by_client_id::text, referred_by from public.clients where id = current_setting('test.k2')::uuid $$,
  $$ values (current_setting('test.ref'), null::text) $$, '… the kept file keeps its own (the file), the typed name is not added');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.k3', public.create_client('{"first_name": "Léa", "last_name": "Trois"}', true)::text, true);
select set_config('test.m3', public.create_client('{"first_name": "Léo", "last_name": "Trois"}', true)::text, true);
select public.update_client(current_setting('test.k3')::uuid, jsonb_build_object('referred_by_client_id', current_setting('test.m3')));
select public.update_client(current_setting('test.m3')::uuid, '{"referred_by": "Un ami"}');
select lives_ok($$ select public.merge_clients(current_setting('test.k3')::uuid, current_setting('test.m3')::uuid, array['referred_by']) $$,
  'a merge taking the merged file''s « Référé par » (the kept one named the merged file)');
reset role;
select results_eq($$ select referred_by_client_id, referred_by from public.clients where id = current_setting('test.k3')::uuid $$,
  $$ values (null::uuid, 'Un ami') $$, '… the typed name taken, the kept file never names itself');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- The anonymisation.
select lives_ok($$ select public.anonymize_client(current_setting('test.ref')::uuid) $$, 'the referring file anonymised');
select is(public.get_client_summary(current_setting('test.new')::uuid) -> 'referrer' -> 'anonymized', 'true'::jsonb,
  '… the link stays, read as anonymised');
select is(public.get_client_summary(current_setting('test.new')::uuid) -> 'referrer' -> 'display_name', 'null'::jsonb, '… never with a name');
select lives_ok($$ select public.update_client(current_setting('test.new')::uuid, '{"city": "Laval"}') $$,
  'a card save that does not touch it is not refused');
select throws_ok($$ select public.update_client(current_setting('test.child')::uuid, jsonb_build_object('referred_by_client_id', current_setting('test.ref'))) $$,
  'P0001', 'Ce dossier a été anonymisé : il ne peut plus être choisi.', 'an anonymised file cannot be chosen');
select lives_ok($$ select public.anonymize_client(current_setting('test.new')::uuid) $$, 'a referred file anonymised');
reset role;
select is((select referred_by_client_id from public.clients where id = current_setting('test.new')::uuid), null::uuid,
  '… its own « Référé par » goes with its name');

select * from finish();
rollback;
