-- Clients: the RPCs (migration *_clients_rpcs.sql, plan C2.2 – C2.4). Covers: privileges; create
-- (normalised fields, notes, the primary professional linked, a HIGH duplicate refused with HINT
-- duplicate, a MEDIUM one only once confirmed, French refusals on the field); update; archive;
-- relations (stored once, both directions' rights, one main contact per client, removal);
-- insurance (the secondary promoted); payers (one active per kind, an IVAC file once, ended);
-- tags (≤ 5, the clinic's list); merge (relations with a shared person combined, the relation
-- between the two gone, payers, tags, links, notes, the agreements' handler, the merged file
-- archived and closed, the trail); search (staff, a professional's own); the summary; who receives
-- what; the active payers view; Loi 25 export (logged) and anonymisation; the permissions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(99);

select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': authenticated may call it')
  from (values
    ('create_client', array['jsonb', 'boolean']), ('update_client', array['uuid', 'jsonb']),
    ('set_client_notes', array['uuid', 'text', 'text']), ('archive_client', array['uuid']), ('unarchive_client', array['uuid']),
    ('set_client_relation', array['uuid', 'uuid', 'text', 'jsonb', 'jsonb']), ('remove_client_relation', array['uuid', 'uuid']),
    ('upsert_client_insurance', array['uuid', 'integer', 'text', 'text', 'text', 'text', 'text']), ('delete_client_insurance', array['uuid', 'integer']),
    ('save_client_payer', array['uuid', 'uuid', 'text', 'text', 'text', 'integer', 'integer', 'integer', 'date', 'date', 'text']),
    ('end_client_payer', array['uuid']), ('set_client_tags', array['uuid', 'uuid[]']), ('save_client_tag', array['uuid', 'text']),
    ('set_client_tag_active', array['uuid', 'boolean']), ('merge_clients', array['uuid', 'uuid', 'jsonb']), ('search_clients', array['text', 'integer']),
    ('get_client_summary', array['uuid']), ('export_client_privacy', array['uuid']), ('anonymize_client', array['uuid'])
  ) as f(name, args);
select function_privs_are('public', 'create_client', array['jsonb', 'boolean'], 'anon', array[]::text[], 'anon cannot create a client');
select function_privs_are('private', f.name, f.args, 'authenticated', array[]::text[], f.name || ': no role')
  from (values ('client_contacts_for', array['uuid', 'uuid', 'text']), ('clients_unlink_professional', array['uuid', 'uuid', 'uuid']),
               ('professionals_reassign_client', array['uuid', 'uuid'])) as f(name, args);
select table_privs_are('public', 'client_payers_active', 'authenticated', array['SELECT'], 'client_payers_active: read only');
select table_privs_are('public', 'client_merge_handlers', 'authenticated', array[]::text[], 'client_merge_handlers: no client access');
select is_empty($$ select h.function_name from public.client_merge_handlers h
                    where to_regprocedure(h.function_name || '(uuid, uuid)') is null
                       or (select p.prorettype from pg_proc p where p.oid = to_regprocedure(h.function_name || '(uuid, uuid)')) <> 'integer'::regtype $$,
  'every merge handler is a function (uuid, uuid) → int');
select is_empty($$ select h.function_name from public.client_anonymize_handlers h
                    where to_regprocedure(h.function_name || '(uuid)') is null
                       or (select p.prorettype from pg_proc p where p.oid = to_regprocedure(h.function_name || '(uuid)')) <> 'integer'::regtype $$,
  'every anonymisation handler is a function (uuid) → int');
select results_eq($$ select module_key from public.client_merge_handlers order by 1 $$, array['clients', 'demandes', 'professionals'], 'merge handlers: the consents (Clients), Demandes and Professionnels');

-- Fixtures: clinic A (admin, adjointe, conseillère, provider linked to P1), clinic B (admin).
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
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'clients', true);

set local role authenticated;
-- =============================================================================
-- Create, update, archive (the conseillère: clients.manage)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.alice', public.create_client(jsonb_build_object(
  'first_name', '  Alice ', 'last_name', 'Tremblay', 'email', 'Alice@Exemple.test', 'mobile_e164', '514 555-0101',
  'birthday', '1990-03-04', 'postal_code', 'h2x1a1', 'province', 'qc', 'admin_notes', 'Préfère les soirs.',
  'primary_professional_id', 'c0000000-0000-0000-0000-000000000001'))::text, true);
select results_eq($$ select first_name, email, mobile_e164, postal_code, province, client_number from public.clients where id = current_setting('test.alice')::uuid $$,
  $$ values ('Alice', 'alice@exemple.test', '+15145550101', 'H2X 1A1', 'QC', 1) $$, 'create: the fields normalised, file n° 1');
select is((select admin_notes from public.client_notes where client_id = current_setting('test.alice')::uuid), 'Préfère les soirs.', '… the staff notes saved');
select results_eq($$ select professional_id, reason from public.client_professional_links where client_id = current_setting('test.alice')::uuid $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'primary') $$, '… the primary professional linked');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', 'ALICE', 'last_name', 'tremblay', 'mobile_e164', '+1 514 555 0101')) $$,
  'P0001', 'Ce client a déjà un dossier : n° 1. Ouvrez le dossier existant.', 'a HIGH duplicate is refused');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', 'Marc', 'last_name', 'Tremblay', 'email', 'alice@exemple.test')) $$,
  'P0001', 'Un dossier semblable existe (n° 1). Vérifiez-le, puis confirmez qu''il s''agit d''une autre personne.', 'a MEDIUM one needs a confirmation');
select set_config('test.marc', public.create_client(jsonb_build_object('first_name', 'Marc', 'last_name', 'Tremblay', 'email', 'alice@exemple.test',
  'birthday', '1960-01-01'), true)::text, true);
select ok(current_setting('test.marc') <> '', '… and is created once confirmed');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', 'X', 'last_name', 'Y', 'mobile_e164', '555-1234')) $$,
  'P0001', 'Le cellulaire n''est pas un numéro valide (10 chiffres, ou + et l''indicatif du pays).', 'a phone that cannot be read is refused in French');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', '', 'last_name', 'Y')) $$,
  'P0001', 'Indiquez le prénom (100 caractères au plus).', 'the first name is required');
select throws_ok($$ select public.create_client(jsonb_build_object('first_name', 'X', 'last_name', 'Y', 'birthday', '2999-01-01')) $$,
  'P0001', 'La date de naissance doit être passée (et après 1900).', 'a future birthday is refused');
select set_config('test.lea', public.create_client(jsonb_build_object('first_name', 'Léa', 'last_name', 'Gagnon', 'birthday', '2013-06-01'))::text, true);
select set_config('test.paul', public.create_client(jsonb_build_object('first_name', 'Paul', 'last_name', 'Gagnon', 'mobile_e164', '4385550111',
  'reminders_by_email', false))::text, true);
select set_config('test.ines', public.create_client(jsonb_build_object('first_name', 'Inès', 'last_name', 'Roy', 'email', 'ines@exemple.test'))::text, true);

select lives_ok($$ select public.update_client(current_setting('test.alice')::uuid, jsonb_build_object(
  'first_name', 'Alice', 'last_name', 'Tremblay', 'email', 'alice@exemple.test', 'mobile_e164', '+15145550101', 'birthday', '1990-03-04',
  'rate_variant', 'student', 'tax_exempt', true, 'primary_professional_id', 'c0000000-0000-0000-0000-000000000002')) $$, 'update');
select results_eq($$ select rate_variant, tax_exempt, primary_professional_id, postal_code from public.clients where id = current_setting('test.alice')::uuid $$,
  $$ values ('student', true, 'c0000000-0000-0000-0000-000000000002'::uuid, 'H2X 1A1') $$, '… the sent fields changed, the others kept (C3)');
select is((select count(*)::int from public.client_notes where client_id = current_setting('test.alice')::uuid), 1, '… the notes kept when the form leaves them out');
select is((select count(*)::int from public.client_professional_links where client_id = current_setting('test.alice')::uuid), 2, '… the new primary professional linked too');
select lives_ok($$ select public.set_client_notes(current_setting('test.alice')::uuid, null, 'Paiement en deux fois.') $$, 'set_client_notes');
select results_eq($$ select admin_notes, special_agreement_note from public.client_notes where client_id = current_setting('test.alice')::uuid $$,
  $$ values (null::text, 'Paiement en deux fois.') $$, '… both notes replaced');
select public.archive_client(current_setting('test.ines')::uuid);
select ok((select archived_at is not null from public.clients where id = current_setting('test.ines')::uuid), 'archive');
select public.unarchive_client(current_setting('test.ines')::uuid);
select ok((select archived_at is null from public.clients where id = current_setting('test.ines')::uuid), 'unarchive');

-- =============================================================================
-- Relations: Paul is Léa's parent (manages her appointments, receives her invoices); Marc too
-- =============================================================================
select lives_ok($$ select public.set_client_relation(current_setting('test.lea')::uuid, current_setting('test.paul')::uuid, 'parent',
  '{"main_contact": true, "manages_appointments": true, "receives_invoices": true, "receives_communications": true}', '{}') $$, 'a parent with three rights');
select results_eq($$ select x.type, (x.related_rights ->> 'manages_appointments')::boolean, (x.client_rights ->> 'manages_appointments')::boolean
                       from jsonb_to_recordset(public.get_client_summary(current_setting('test.lea')::uuid) -> 'relations') as x(type text, related_rights jsonb, client_rights jsonb) $$,
  $$ values ('parent', true, false) $$, 'the summary reads it from the child''s side');
select results_eq($$ select x.type from jsonb_to_recordset(public.get_client_summary(current_setting('test.paul')::uuid) -> 'relations') as x(type text) $$,
  array['child'], '… and its inverse from the parent''s side');
select results_eq($$ select (x.client_rights ->> 'manages_appointments')::boolean, (x.related_rights ->> 'manages_appointments')::boolean
                       from jsonb_to_recordset(public.get_client_summary(current_setting('test.paul')::uuid) -> 'relations') as x(client_rights jsonb, related_rights jsonb) $$,
  $$ values (true, false) $$, '… the parent''s rights are the client''s side there');
select public.set_client_relation(current_setting('test.lea')::uuid, current_setting('test.marc')::uuid, 'parent', '{"main_contact": true, "receives_communications": true}', '{}');
select results_eq($$ select x.related_name, (x.related_rights ->> 'main_contact')::boolean
                       from jsonb_to_recordset(public.get_client_summary(current_setting('test.lea')::uuid) -> 'relations') as x(related_name text, related_rights jsonb)
                      order by 1 $$,
  $$ values ('Marc Tremblay', true), ('Paul Gagnon', false) $$, 'one main contact per client: the new one clears the other');
-- private helpers are called as their definer callers would, never as a role without EXECUTE.
reset role;
select results_eq($$ select first_name, is_self, reminders_by_email from private.client_contacts_for('b0000000-0000-0000-0000-00000000000a', current_setting('test.lea')::uuid, 'communications') order by is_self desc, first_name $$,
  $$ values ('Léa', true, true), ('Marc', false, true), ('Paul', false, false) $$, 'who receives her communications, with their own channels');
select results_eq($$ select first_name from private.client_contacts_for('b0000000-0000-0000-0000-00000000000a', current_setting('test.lea')::uuid, 'appointments') where not is_self $$,
  array['Paul'], '… who may book and sign for her');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_client_relation(current_setting('test.lea')::uuid, current_setting('test.lea')::uuid, 'other') $$,
  'P0001', 'Un client ne peut pas être lié à lui-même.', 'no relation with oneself');

-- =============================================================================
-- Insurance, payers, tags
-- =============================================================================
select public.upsert_client_insurance(current_setting('test.alice')::uuid, 1, 'Assureur Un', 'POL-1', null, 'self', null);
select public.upsert_client_insurance(current_setting('test.alice')::uuid, 2, 'Assureur Deux', null, null, 'spouse', 'Marc Tremblay');
select public.delete_client_insurance(current_setting('test.alice')::uuid, 1);
select results_eq($$ select rank, insurer from public.client_insurances where client_id = current_setting('test.alice')::uuid $$,
  $$ values (1::smallint, 'Assureur Deux') $$, 'the secondary insurance becomes the main one');
select set_config('test.ivac', public.save_client_payer(current_setting('test.alice')::uuid, null, 'ivac', null, 'IV-123', 9450, null, null, null, null, null)::text, true);
select is(public.save_client_payer(current_setting('test.alice')::uuid, null, 'ivac', null, 'IV-124', 9450, 20, null, null, null, null)::text,
  current_setting('test.ivac'), 'one active payer per kind: the second save updates it');
select throws_ok($$ select public.save_client_payer(current_setting('test.marc')::uuid, null, 'ivac', null, 'iv-124', null, null, null, null, null, null) $$,
  'P0001', 'Ce numéro de dossier IVAC est déjà au dossier d''un autre client.', 'an IVAC file once in the clinic');
select throws_ok($$ select public.save_client_payer(current_setting('test.marc')::uuid, null, 'pae', null, null, null, null, null, null, null, null) $$,
  'P0001', 'Indiquez le fournisseur du PAE.', 'a PAE names its provider');
select is((select count(*)::int from public.client_payers_active where client_id = current_setting('test.alice')::uuid), 1, 'client_payers_active');
select set_config('test.tag1', public.save_client_tag(null, 'Atelier')::text, true);
select set_config('test.tag2', public.save_client_tag(null, 'Couple')::text, true);
select throws_ok($$ select public.save_client_tag(null, 'atelier') $$, 'P0001', 'Cette étiquette existe déjà.', 'tag names are unique');
select public.set_client_tags(current_setting('test.alice')::uuid, array[current_setting('test.tag1')::uuid]);
select public.set_client_tags(current_setting('test.marc')::uuid, array[current_setting('test.tag1')::uuid, current_setting('test.tag2')::uuid]);
select is((select count(*)::int from public.client_tag_links where client_id = current_setting('test.marc')::uuid), 2, 'set_client_tags');
select throws_ok($$ select public.set_client_tags(current_setting('test.marc')::uuid, array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]) $$,
  'P0001', 'Un client a au plus 5 étiquettes.', 'at most 5 tags');

-- =============================================================================
-- Search and summary
-- =============================================================================
select results_eq($$ select first_name from public.search_clients('tremb') order by first_name $$, array['Alice', 'Marc'], 'search: a part of the name');
select results_eq($$ select first_name from public.search_clients('lea gagnon') $$, array['Léa'], '… accents ignored, every word');
select results_eq($$ select first_name from public.search_clients('5550111') $$, array['Paul'], '… a phone''s digits');
select is((public.get_client_summary(current_setting('test.alice')::uuid) -> 'client' ->> 'client_number'), '1', 'the summary: the file');
select is(jsonb_array_length(public.get_client_summary(current_setting('test.alice')::uuid) -> 'payers'), 1, '… its payers');

-- The professional: her linked clients only (Alice, through her first primary link).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select first_name from public.search_clients('a') $$, array['Alice'], 'a professional searches only her clients');
select ok(public.get_client_summary(current_setting('test.alice')::uuid) -> 'client' ? 'display_name', '… her client''s summary: the published columns');
select ok(not (public.get_client_summary(current_setting('test.alice')::uuid) ? 'notes'), '… never the notes');
select throws_ok($$ select public.get_client_summary(current_setting('test.marc')::uuid) $$, '42501', 'Permission refusée : clients.view', '… not another client');
select throws_ok($$ select public.create_client('{"first_name": "X", "last_name": "Y"}') $$, '42501', 'Permission refusée : clients.manage', 'a professional creates no file');

-- Another clinic.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select 1 from public.search_clients('tremblay') $$, 'clinic B finds none of A''s clients');
select throws_ok($$ select public.update_client(current_setting('test.alice')::uuid, '{"first_name": "X", "last_name": "Y"}') $$,
  'P0001', 'Dossier client introuvable.', '… nor changes one');

-- =============================================================================
-- Merge (the adjointe: clients.merge)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.merge_clients(current_setting('test.alice')::uuid, current_setting('test.marc')::uuid) $$,
  '42501', 'Permission refusée : clients.merge', 'the conseillère cannot merge');
-- Marc is a duplicate of Paul: both parents of Léa; Marc also related to Paul (spouse); links, notes.
select public.set_client_relation(current_setting('test.paul')::uuid, current_setting('test.marc')::uuid, 'spouse', '{}', '{}');
select public.set_client_relation(current_setting('test.paul')::uuid, current_setting('test.ines')::uuid, 'sibling', '{"main_contact": true}', '{}');
select public.set_client_relation(current_setting('test.marc')::uuid, current_setting('test.alice')::uuid, 'other', '{"main_contact": true}', '{}');
select public.set_client_notes(current_setting('test.marc')::uuid, 'Note de Marc.', null);
select public.save_client_payer(current_setting('test.marc')::uuid, null, 'pae', 'PAE Fictif', 'P-1', 8000, 10, null, null, null, null);
reset role;
select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', current_setting('test.marc')::uuid, 'c0000000-0000-0000-0000-000000000002', 'demande');
insert into public.professional_client_agreements (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'CLI-2', current_setting('test.marc')::uuid, 50, 9000, 12000, date '2026-10-01');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.merge', public.merge_clients(current_setting('test.paul')::uuid, current_setting('test.marc')::uuid)::text, true);
select results_eq($$ select x.related_name, (x.related_rights ->> 'main_contact')::boolean, (x.related_rights ->> 'manages_appointments')::boolean,
                           (x.related_rights ->> 'receives_communications')::boolean, (x.related_rights ->> 'receives_invoices')::boolean
                       from jsonb_to_recordset(public.get_client_summary(current_setting('test.lea')::uuid) -> 'relations')
                         as x(related_name text, related_rights jsonb) $$,
  $$ values ('Paul Gagnon', true, true, true, true) $$, 'merge: one parent left for Léa, with the rights of both');
select is_empty($$ select 1 from jsonb_to_recordset(public.get_client_summary(current_setting('test.paul')::uuid) -> 'relations') as x(related_id uuid)
                    where x.related_id = current_setting('test.marc')::uuid $$, '… the relation between the two is gone');
select results_eq($$ select x.related_name from jsonb_to_recordset(public.get_client_summary(current_setting('test.paul')::uuid) -> 'relations') as x(related_name text, related_rights jsonb)
                      where (x.related_rights ->> 'main_contact')::boolean $$,
  array['Inès Roy'], '… one main contact left: the kept file''s own');
select is((select count(*)::int from public.client_payers where client_id = current_setting('test.paul')::uuid), 1, '… the payer moved');
select is((select count(*)::int from public.client_tag_links where client_id = current_setting('test.paul')::uuid), 2, '… the tags moved');
select is((select count(*)::int from public.client_professional_links where client_id = current_setting('test.paul')::uuid), 1, '… the links moved');
select is((select admin_notes from public.client_notes where client_id = current_setting('test.paul')::uuid), 'Note de Marc.', '… the notes moved');
select is((select email from public.clients where id = current_setting('test.paul')::uuid), 'alice@exemple.test', '… an empty field filled from the merged file');
select results_eq($$ select merged_into_id, archived_at is not null from public.clients where id = current_setting('test.marc')::uuid $$,
  $$ values (current_setting('test.paul')::uuid, true) $$, '… the merged file archived and pointed at the kept one');
select is((select moved -> 'modules' ->> 'professionals' from public.client_merges where id = current_setting('test.merge')::uuid), '1', '… the trail counts the agreement moved');
reset role;
select is((select client_id from public.professional_client_agreements where client_label = 'CLI-2'), current_setting('test.paul')::uuid, '… the agreement follows the kept file');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_client_notes(current_setting('test.marc')::uuid, 'x', null) $$,
  'P0001', 'Ce dossier a été fusionné dans un autre : modifiez le dossier conservé.', 'a merged file refuses every write');
select is_empty($$ select 1 from public.search_clients('marc') $$, 'a merged file leaves the search');

-- =============================================================================
-- Loi 25 (the admin: clients.privacy)
-- =============================================================================
select throws_ok($$ select public.export_client_privacy(current_setting('test.alice')::uuid) $$,
  '42501', 'Permission refusée : clients.privacy', 'the adjointe cannot export');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.export_client_privacy(current_setting('test.alice')::uuid) ? 'exported_at', 'the export');
reset role;
select is((select source from public.audit_log where table_name = 'clients' and action = 'read' and record_id = current_setting('test.alice')) , 'rpc:export_client_privacy', '… logged as a read');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.anonymize_client(current_setting('test.alice')::uuid);
select results_eq($$ select first_name, last_name, email, mobile_e164, birthday, anonymized_at is not null, archived_at is not null from public.clients where id = current_setting('test.alice')::uuid $$,
  $$ values ('Client', 'anonymisé n° 1', null::text, null::text, null::date, true, true) $$, 'anonymised: the identity blanked, archived');
select results_eq($$ select file_number, is_active from public.client_payers where client_id = current_setting('test.alice')::uuid $$,
  $$ values ('anonymisé', false) $$, '… the payer kept for past invoices, its number blanked');
select is((select count(*)::int from public.client_insurances where client_id = current_setting('test.alice')::uuid)
        + (select count(*)::int from public.client_tag_links where client_id = current_setting('test.alice')::uuid)
        + (select count(*)::int from public.client_notes where client_id = current_setting('test.alice')::uuid), 0, '… insurance, tags and notes gone');
select is((select count(*)::int from public.client_professional_links where client_id = current_setting('test.alice')::uuid), 2, '… the links kept (ids only)');
select throws_ok($$ select public.update_client(current_setting('test.alice')::uuid, '{"first_name": "Alice", "last_name": "T"}') $$,
  'P0001', 'Ce dossier a été anonymisé : il ne se modifie plus.', '… and it never changes again');

-- Unlink (for Demandes): the primary professional stays.
reset role;
select private.clients_unlink_professional('b0000000-0000-0000-0000-00000000000a', current_setting('test.paul')::uuid, 'c0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.client_professional_links where client_id = current_setting('test.paul')::uuid), 0, 'unlink: a non-primary link goes');
select private.clients_unlink_professional('b0000000-0000-0000-0000-00000000000a', current_setting('test.alice')::uuid, 'c0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.client_professional_links where client_id = current_setting('test.alice')::uuid and professional_id = 'c0000000-0000-0000-0000-000000000002'), 1,
  '… the primary professional''s stays');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.anonymize_client(current_setting('test.paul')::uuid);
reset role;
select results_eq($$ select first_name, email from public.clients where id = current_setting('test.marc')::uuid $$,
  $$ values ('Client', null::text) $$, 'anonymising a file blanks the files merged into it');
select is((select client_label from public.professional_client_agreements where client_id = current_setting('test.paul')::uuid), 'CLI-4',
  '… and the agreement''s label becomes the file number (Professionnels'' handler)');

select * from finish();
rollback;
