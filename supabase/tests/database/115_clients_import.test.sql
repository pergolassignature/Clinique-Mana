-- Clients: the GOrendezvous import (migration *_clients_import.sql, plan §9 I1). Covers: privileges
-- (authenticated only), both permissions required; a dry run checks everything and writes nothing;
-- a real run writes the file with its GOrendezvous reference, archived state, primary professional
-- (linked « import »), free tags (an existing one reused, case and accents aside; a new one created),
-- main insurance and agreement note, under the audit source `import`; a re-run is skipped; a
-- duplicate is imported and named by level and file number, never refused; a refused value is a
-- French error with its field, nothing written; relations by external refs (dry run, real,
-- re-run, unknown file, bad type).
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

select function_privs_are('public', f.name, array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], f.name || ': authenticated may call it')
  from (values ('import_client'), ('import_client_relation')) as f(name);
select function_privs_are('public', f.name, array['jsonb', 'boolean'], 'anon', array[]::text[], f.name || ': anon may not')
  from (values ('import_client'), ('import_client_relation')) as f(name);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.client_tags (org_id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Atelier');
insert into public.client_tags (org_id, name, is_active) values ('b0000000-0000-0000-0000-00000000000a', 'Archivée', false);

create temporary table row_alice as
select jsonb_build_object(
  'external_ref', 'gorendezvous:1001', 'first_name', 'Alice', 'last_name', 'Tremblay', 'email', 'Alice@Exemple.test',
  'mobile_e164', '+15145550101', 'birthday', '1990-03-04', 'sex', 'female', 'language', 'fr', 'postal_code', 'h2x1a1',
  'province', 'QC', 'primary_professional_id', 'c0000000-0000-0000-0000-000000000001', 'rate_variant', 'student',
  'special_agreement', true, 'special_agreement_note', 'Entente de paiement (GOrendezvous)', 'archived', true,
  'tags', jsonb_build_array('atelier', 'Couple'),
  'insurance', jsonb_build_object('insurer', 'Assureur fictif', 'policy_number', 'P-1', 'holder_relation', 'self')) as r;
grant select on row_alice to authenticated;
create temporary table rel as
select jsonb_build_object('client_ref', 'gorendezvous:2001', 'related_ref', 'gorendezvous:2002', 'type', 'parent',
                          'related_rights', jsonb_build_object('main_contact', true, 'manages_appointments', true)) as r;
grant select on rel to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_client((select r from row_alice), true) $$, '42501', 'Permission refusée : clients.merge',
  'clients.manage alone may not import (the one who imports merges the duplicates)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- =============================================================================
-- A dry run
-- =============================================================================
select set_config('test.dry', public.import_client((select r from row_alice), true)::text, true);
select results_eq($$ select x ->> 'status', (x ->> 'dry_run')::boolean, x ->> 'id', x -> 'duplicates', x -> 'tags_created'
                       from (select current_setting('test.dry')::jsonb as x) s $$,
  $$ values ('ok', true, null::text, '[]'::jsonb, '["Couple"]'::jsonb) $$, 'a dry run: ok, « Couple » would be added to the list, no id');
reset role;
select is((select count(*)::int from public.clients where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… and nothing is written');
select is((select count(*)::int from public.client_tags where org_id = 'b0000000-0000-0000-0000-00000000000a'), 2, '… not even the new tag');

-- =============================================================================
-- A real run
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.alice', public.import_client((select r from row_alice), false)::text, true);
select results_eq($$ select x ->> 'status', (x ->> 'client_number')::int, x -> 'tags_created' from (select current_setting('test.alice')::jsonb as x) s $$,
  $$ values ('ok', 1, '["Couple"]'::jsonb) $$, 'a real run: file n° 1');
reset role;
select set_config('test.alice_id', current_setting('test.alice')::jsonb ->> 'id', true);
select results_eq($$ select external_ref, email, postal_code, rate_variant, special_agreement, archived_at is not null, primary_professional_id
                       from public.clients where id = current_setting('test.alice_id')::uuid $$,
  $$ values ('gorendezvous:1001', 'alice@exemple.test', 'H2X 1A1', 'student', true, true, 'c0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the file: its reference, the fields as the form checks them, archived');
select is((select reason from public.client_professional_links where client_id = current_setting('test.alice_id')::uuid), 'import',
  'the primary professional is linked by the import');
select results_eq($$ select t.name from public.client_tag_links l join public.client_tags t on t.id = l.tag_id
                      where l.client_id = current_setting('test.alice_id')::uuid order by t.name $$,
  array['Atelier', 'Couple'], 'the free tags: the clinic''s « Atelier » reused, « Couple » created');
select is((select count(*)::int from public.client_tags where org_id = 'b0000000-0000-0000-0000-00000000000a'), 3, '… one tag added to the list');
select results_eq($$ select rank, insurer, policy_number from public.client_insurances where client_id = current_setting('test.alice_id')::uuid $$,
  $$ values (1::smallint, 'Assureur fictif', 'P-1') $$, 'the main insurance');
select is((select special_agreement_note from public.client_notes where client_id = current_setting('test.alice_id')::uuid),
  'Entente de paiement (GOrendezvous)', 'the agreement''s note');
select is((select source from public.audit_log where table_name = 'clients' and record_id = current_setting('test.alice_id') and action = 'insert'),
  'import', 'written under the audit source « import »');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select x ->> 'status', x ->> 'id', (x ->> 'client_number')::int from (select public.import_client((select r from row_alice), false) as x) s $$,
  $$ values ('skipped', current_setting('test.alice_id'), 1) $$, 'a re-run: skipped, the file named');

-- A duplicate in GOrendezvous: imported all the same, named by level and file number.
select set_config('test.dup', public.import_client(jsonb_build_object('external_ref', 'gorendezvous:1002', 'first_name', 'ALICE', 'last_name', 'tremblay',
  'email', 'alice@exemple.test'), false)::text, true);
select results_eq($$ select x ->> 'status', x -> 'duplicates' from (select current_setting('test.dup')::jsonb as x) s $$,
  $$ values ('ok', '[{"level": "high", "client_number": 1}]'::jsonb) $$, 'a duplicate is imported and named: HIGH with n° 1, never a name');
select ok(not (current_setting('test.dup')::jsonb::text ~* 'alice|tremblay|exemple'), '… the answer holds no personal value');

-- Refused values: a French error with its field; nothing written.
select results_eq($$ select x ->> 'status', x -> 'errors' -> 0 ->> 'field', x -> 'errors' -> 0 ->> 'message'
                       from (select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:1003', 'first_name', 'Bob', 'last_name', 'Roy',
                                                                            'email', 'pas un courriel'), false) as x) s $$,
  $$ values ('error', 'email', 'Le courriel n''est pas une adresse valide.') $$, 'an unreadable email: refused with its field');
select results_eq($$ select x ->> 'status', x -> 'errors' -> 0 ->> 'field'
                       from (select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:1004', 'first_name', 'Bob', 'last_name', 'Roy',
                                                                            'tags', '["a","b","c","d","e","f"]'::jsonb), false) as x) s $$,
  $$ values ('error', 'tags') $$, 'more than 5 tags: refused');
select results_eq($$ select x ->> 'status', x -> 'errors' -> 0 ->> 'field'
                       from (select public.import_client(jsonb_build_object('first_name', 'Bob', 'last_name', 'Roy'), false) as x) s $$,
  $$ values ('error', 'external_ref') $$, 'no GOrendezvous reference: refused');
select results_eq($$ select x ->> 'status', x -> 'errors' -> 0 ->> 'field'
                       from (select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:1005', 'first_name', 'Bob', 'last_name', 'Roy',
                                                                            'insurance', jsonb_build_object('insurer', '')), false) as x) s $$,
  $$ values ('error', 'insurer') $$, 'an insurance without its insurer: refused');
select results_eq($$ select x ->> 'status', x -> 'errors' -> 0 ->> 'field'
                       from (select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:1006', 'first_name', 'Bob', 'last_name', 'Roy',
                                                                            'archived', 'peut-être'), false) as x) s $$,
  $$ values ('error', 'archived') $$, 'a yes / no field that is not a boolean: a row error, never a stopped run');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_client_relation((select r from rel), true) $$, '42501', 'Permission refusée : clients.merge',
  'relations: whoever lacks clients.merge may not import them');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
reset role;
select is((select count(*)::int from public.clients where external_ref in ('gorendezvous:1003', 'gorendezvous:1004', 'gorendezvous:1005', 'gorendezvous:1006')), 0,
  'no refused row is written');

-- =============================================================================
-- Relations
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:2001', 'first_name', 'Léa', 'last_name', 'Gagnon', 'birthday', '2015-06-01'), false);
select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:2002', 'first_name', 'Paul', 'last_name', 'Gagnon', 'email', 'paul@exemple.test'), false);
select is(public.import_client_relation((select r from rel), true) ->> 'status', 'ok', 'a relation, dry run');
reset role;
select is((select count(*)::int from public.client_relations where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing written');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_relation((select r from rel), false) ->> 'status', 'ok', 'a relation, real run');
reset role;
select results_eq($$ select k.first_name, k.relation_type
                       from private.client_contacts_for('b0000000-0000-0000-0000-00000000000a',
                              (select id from public.clients where external_ref = 'gorendezvous:2001'), 'appointments') k
                      where not k.is_self $$,
  $$ values ('Paul', 'parent') $$, '… Paul is Léa''s parent and manages her appointments');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_relation((select r from rel), false) ->> 'status', 'skipped', 'a re-run: skipped');
select is(public.import_client_relation(jsonb_build_object('client_ref', 'gorendezvous:9999', 'related_ref', 'gorendezvous:2002', 'type', 'parent'), false)
            -> 'errors' -> 0 ->> 'field', 'client_ref', 'a file not imported yet: refused');
select is(public.import_client_relation(jsonb_build_object('client_ref', 'gorendezvous:1001', 'related_ref', 'gorendezvous:2002', 'type', 'cousin'), false)
            -> 'errors' -> 0 ->> 'field', 'type', 'an unknown relation type: refused with its field');
reset role;

-- An archived tag of the clinic is put back, and said; a tag that is not text is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select x ->> 'status', x -> 'tags_reactivated', x -> 'tags_created'
                       from (select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:3002', 'first_name', 'Rose', 'last_name', 'Lalonde',
                                                                            'tags', '["archivée"]'::jsonb), false) as x) s $$,
  $$ values ('ok', '["archivée"]'::jsonb, '[]'::jsonb) $$, 'an archived tag is put back and reported');
select throws_ok($$ select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:3003', 'first_name', 'Rose', 'last_name', 'Roy',
                                                                  'tags', '[1]'::jsonb), true) $$, '22023', 'tags : une liste de noms est attendue.',
  'a tag that is not text is refused');

-- Loi 25: an imported file anonymised since is never brought back by a later run.
select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:3001', 'first_name', 'Effacée', 'last_name', 'Plus-Tard'), false);
select public.anonymize_client((select id from public.clients where external_ref = 'gorendezvous:3001'));
reset role;
select ok((select count(*) = 1 from public.clients where external_ref ~ '^anon:' and external_ref !~ '3001' and anonymized_at is not null),
  'the anonymised file keeps a one-way tombstone, no GOrendezvous id');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select x ->> 'status', x ->> 'reason'
                       from (select public.import_client(jsonb_build_object('external_ref', 'gorendezvous:3001', 'first_name', 'Effacée', 'last_name', 'Plus-Tard'), false) as x) s $$,
  $$ values ('skipped', 'Dossier anonymisé') $$, 'a re-run skips it: the person is not re-created');
reset role;
select is((select count(*)::int from public.clients where first_name = 'Effacée'), 0, '… and nothing of her is back');

-- The module off: nobody imports (has_permission drops a disabled module's keys).
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.import_client((select r from row_alice), true) $$, '42501', 'Permission refusée : clients.manage',
  'Clients disabled: import_client refused');
select throws_ok($$ select public.import_client_relation((select r from rel), true) $$, '42501', 'Permission refusée : clients.manage',
  'Clients disabled: import_client_relation refused');
reset role;

select * from finish();
rollback;
