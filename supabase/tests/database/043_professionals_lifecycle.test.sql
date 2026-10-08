-- Professionnels lifecycle (migration *_professionals_lifecycle.sql, plan Phase 4 Task 4a.4).
-- Covers: privileges (views, RPCs, helpers) and indexes; readiness (« Profil de jumelage
-- complet »: profession, licence, regulated title for restricted motifs, language, clientèle,
-- motif; the login email warning) for staff, the provider and another org; activate_professional
-- (incomplete file, admin override with a reason, already active, permission, module gate, other
-- org); deactivate_professional (reasons and notes, already inactive, reasons of another org or
-- archived); the provider account disabled and re-enabled with its sessions ended, never an
-- account disabled by someone else; professionals_list, professionals_directory and
-- list_professionals (filters, sorts, keyset pages, provider and org isolation);
-- get_professional_record; get_professional_public_profile; list_professional_history (child rows,
-- deleted rows, newest first, keyset pages, cap, redaction, isolation, permission).
begin;
create extension if not exists pgtap with schema extensions;
select plan(133);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a conseillère; org B
-- with an admin. P2 (org A, linked to provider A, complete), P3 (org B). P1, P4 and P5 are created
-- by the adjointe below (P1 psychologue + licence, P4 no title, P5 naturopathe).
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
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

select set_config('test.p2', 'c0000000-0000-0000-0000-000000000002', true);
select set_config('test.p3', 'c0000000-0000-0000-0000-000000000003', true);
select set_config('test.psy',    (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.sexo',   (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'sexologue'), true);
select set_config('test.naturo', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'naturopathe'), true);
select set_config('test.opq',    (select o.id::text from public.professional_orders o where o.org_id = 'b0000000-0000-0000-0000-00000000000a' and o.key = 'opq'), true);
select set_config('test.b_psy',  (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000b' and t.key = 'psychologue'), true);
select set_config('test.adults',  (select c.id::text from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'adults'), true);
select set_config('test.couples', (select c.id::text from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'couples'), true);
select set_config('test.cbt',  (select s.id::text from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.key = 'cbt'), true);
select set_config('test.fr',   (select l.id::text from public.languages l where l.org_id = 'b0000000-0000-0000-0000-00000000000a' and l.code = 'fr'), true);
select set_config('test.en',   (select l.id::text from public.languages l where l.org_id = 'b0000000-0000-0000-0000-00000000000a' and l.code = 'en'), true);
select set_config('test.b_fr', (select l.id::text from public.languages l where l.org_id = 'b0000000-0000-0000-0000-00000000000b' and l.code = 'fr'), true);
select set_config('test.anxiete',  (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'anxiete'), true);
select set_config('test.deuil',    (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'deuil'), true);
select set_config('test.adoption', (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'adoption'), true);
select set_config('test.leave',     (select r.id::text from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave'), true);
select set_config('test.ended',     (select r.id::text from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'collaboration_ended'), true);
select set_config('test.other',     (select r.id::text from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'other'), true);
select set_config('test.insurance', (select r.id::text from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'insurance_expired'), true);
select set_config('test.b_leave',   (select r.id::text from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000b' and r.key = 'leave'), true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.ca');
insert into public.professional_public_profiles (org_id, professional_id, bio, public_email) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'Accompagne les adultes.', 'pia@clinique.ca'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003', null, null);
insert into public.professional_matching_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.psy')::uuid, 'OPQ-2000', true),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003', current_setting('test.b_psy')::uuid, 'OPQ-3000', true);
insert into public.professional_languages (org_id, professional_id, language_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.fr')::uuid),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003', current_setting('test.b_fr')::uuid);
insert into public.professional_motifs (org_id, professional_id, motif_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.anxiete')::uuid);
insert into public.professional_clienteles (org_id, professional_id, clientele_id, is_specialized) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.adults')::uuid, true);
insert into public.professional_specialties (org_id, professional_id, specialty_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.cbt')::uuid);

-- P1, P4, P5 through the RPC, as the adjointe (1:1 rows and French come with it).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.p1', public.create_professional('Paul', 'Un', 'p1@exemple.ca', current_setting('test.psy')::uuid, 'OPQ-1000')::text, true);
select set_config('test.p4', public.create_professional('Quinn', 'Quatre', 'p4@exemple.ca')::text, true);
select set_config('test.p5', public.create_professional('Nora', 'Cinq', 'p5@exemple.ca', current_setting('test.naturo')::uuid)::text, true);
reset role;

-- =============================================================================
-- Privileges and indexes
-- =============================================================================
select has_view('public', 'professionals_readiness', 'view professionals_readiness exists');
select has_view('public', 'professionals_list', 'view professionals_list exists');
select has_view('public', 'professionals_directory', 'view professionals_directory exists');
select table_privs_are('public', 'professionals_readiness', 'authenticated', array['SELECT'], 'authenticated: select only on the readiness view');
select table_privs_are('public', 'professionals_readiness', 'anon', array[]::text[], 'anon: nothing on the readiness view');
select table_privs_are('public', 'professionals_list', 'authenticated', array['SELECT'], 'authenticated: select only on the list view');
select table_privs_are('public', 'professionals_list', 'anon', array[]::text[], 'anon: nothing on the list view');
select table_privs_are('public', 'professionals_directory', 'authenticated', array['SELECT'], 'authenticated: select only on the directory');
select table_privs_are('public', 'professionals_directory', 'anon', array[]::text[], 'anon: nothing on the directory');

select function_privs_are('public', 'get_professional_readiness', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated may read readiness');
select function_privs_are('public', 'get_professional_readiness', array['uuid'], 'anon', array[]::text[], 'anon cannot read readiness');
select function_privs_are('public', 'activate_professional', array['uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call activate_professional');
select function_privs_are('public', 'activate_professional', array['uuid', 'text'], 'anon', array[]::text[], 'anon cannot activate');
select function_privs_are('public', 'activate_professional', array['uuid', 'text'], 'service_role', array[]::text[], 'service_role cannot activate (user-scoped)');
select function_privs_are('public', 'deactivate_professional', array['uuid', 'uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call deactivate_professional');
select function_privs_are('public', 'deactivate_professional', array['uuid', 'uuid', 'text'], 'anon', array[]::text[], 'anon cannot deactivate');
select function_privs_are('public', 'deactivate_professional', array['uuid', 'uuid', 'text'], 'service_role', array[]::text[], 'service_role cannot deactivate (user-scoped)');
select function_privs_are('public', 'get_professional_record', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated may read a record');
select function_privs_are('public', 'get_professional_record', array['uuid'], 'anon', array[]::text[], 'anon cannot read a record');
select function_privs_are('public', 'get_professional_public_profile', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated may read a public profile');
select function_privs_are('public', 'get_professional_public_profile', array['uuid'], 'anon', array[]::text[], 'anon cannot read a public profile');
select function_privs_are('public', 'list_professional_history', array['uuid', 'bigint', 'integer'], 'authenticated', array['EXECUTE'], 'authenticated may call the history');
select function_privs_are('public', 'list_professional_history', array['uuid', 'bigint', 'integer'], 'anon', array[]::text[], 'anon cannot call the history');
select function_privs_are('public', 'list_professionals',
  array['text[]', 'uuid[]', 'uuid[]', 'uuid[]', 'uuid[]', 'boolean', 'text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer'],
  'authenticated', array['EXECUTE'], 'authenticated may page the list');
select function_privs_are('public', 'list_professionals',
  array['text[]', 'uuid[]', 'uuid[]', 'uuid[]', 'uuid[]', 'boolean', 'text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer'],
  'anon', array[]::text[], 'anon cannot page the list');
select function_privs_are('private', 'professional_login_email_mismatches', array[]::text[], 'authenticated', array['EXECUTE'],
  'the invoker views may call the login email helper');
select function_privs_are('private', 'set_provider_account_status', array['uuid', 'uuid', 'text'], 'authenticated', array[]::text[],
  'clients cannot call the account helper');
select function_privs_are('private', 'professional_history_tables', array[]::text[], 'authenticated', array[]::text[],
  'clients cannot call the history table list');

select has_index('public', 'audit_log', 'audit_log_org_record_prefix_idx', 'history index on the record-id prefix');
select has_index('public', 'professionals', 'professionals_org_status_changed_idx', 'recent sort index');

-- =============================================================================
-- Readiness (conseillère A)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select r.matching_complete, r.ready from public.professionals_readiness r where r.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (false, false) $$, 'P1 (title, licence, French) is not ready');
select is(public.get_professional_readiness(current_setting('test.p1')::uuid),
  '{"complete": false, "done": 0, "total": 1, "items": [{"key": "matching_profile", "done": false, "missing": ["clientele", "motif"]}], "warnings": []}'::jsonb,
  'P1 misses a clientèle and a motif');
select is(public.get_professional_readiness(current_setting('test.p4')::uuid) -> 'items' -> 0 -> 'missing',
  '["profession", "clientele", "motif"]'::jsonb, 'without a title, the profession is missing too');
select is(public.get_professional_readiness(current_setting('test.p2')::uuid),
  '{"complete": true, "done": 1, "total": 1, "items": [{"key": "matching_profile", "done": true, "missing": []}], "warnings": []}'::jsonb,
  'P2 is complete');

-- P5 (naturopathe, no licence needed) completes its matching profile.
select public.set_professional_clienteles(current_setting('test.p5')::uuid, jsonb_build_array(jsonb_build_object('id', current_setting('test.adults'))));
select public.set_professional_motifs(current_setting('test.p5')::uuid, array[current_setting('test.anxiete')::uuid]);
select is((select r.ready from public.professionals_readiness r where r.professional_id = current_setting('test.p5')::uuid), true,
  'a title without an order needs no licence');

-- The title becomes regulated afterwards: the licence is missing.
reset role;
update public.profession_titles set order_id = current_setting('test.opq')::uuid where id = current_setting('test.naturo')::uuid;
set local role authenticated;
select is(public.get_professional_readiness(current_setting('test.p5')::uuid) -> 'items' -> 0 -> 'missing',
  '["licence"]'::jsonb, 'a regulated title without a licence leaves the profile incomplete');
reset role;
update public.profession_titles set order_id = null where id = current_setting('test.naturo')::uuid;

-- A motif becomes restricted while P5 (no regulated title) holds it; P2 (psychologue) is unaffected.
update public.motifs set is_restricted = true where id = current_setting('test.anxiete')::uuid;
set local role authenticated;
select is(public.get_professional_readiness(current_setting('test.p5')::uuid) -> 'items' -> 0 -> 'missing',
  '["regulated_title"]'::jsonb, 'a restricted motif without a regulated title leaves the profile incomplete');
select is((select r.ready from public.professionals_readiness r where r.professional_id = current_setting('test.p2')::uuid), true,
  'a restricted motif with a regulated title is fine');
reset role;
update public.motifs set is_restricted = false where id = current_setting('test.anxiete')::uuid;

-- The login address differs from the professional's email (sync conflict): a warning, not a gap.
update public.professionals set email = 'pia.autre@exemple.ca' where id = current_setting('test.p2')::uuid;
set local role authenticated;
select is(public.get_professional_readiness(current_setting('test.p2')::uuid) - 'items',
  '{"complete": true, "done": 1, "total": 1, "warnings": ["login_email_mismatch"]}'::jsonb,
  'a login email mismatch is a warning; the file stays complete');
select is((select l.email_matches_login from public.professionals_list l where l.id = current_setting('test.p2')::uuid), false,
  'the list flags the mismatch');
reset role;
update public.professionals set email = 'provider@a.test' where id = current_setting('test.p2')::uuid;

-- Who sees readiness: the provider their own only; another org nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.get_professional_readiness(current_setting('test.p2')::uuid) is not null, 'the provider reads their own readiness');
select ok(public.get_professional_readiness(current_setting('test.p1')::uuid) is null, 'the provider cannot read another professional''s readiness');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(public.get_professional_readiness(current_setting('test.p1')::uuid) is null, 'admin B cannot read org A''s readiness');

-- =============================================================================
-- activate_professional
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.activate_professional(current_setting('test.p1')::uuid) $$,
  'P0001', 'Le dossier n''est pas complet. Seule l''administration peut activer un dossier incomplet.',
  'the adjointe cannot activate an incomplete file');
select throws_ok($$ select public.activate_professional(current_setting('test.p1')::uuid, 'Dossier complété hors application') $$,
  'P0001', 'Le dossier n''est pas complet. Seule l''administration peut activer un dossier incomplet.',
  'nor with a reason (no override permission)');
select throws_ok($$ select public.activate_professional(current_setting('test.p3')::uuid) $$,
  'P0001', 'Professionnel introuvable.', 'a professional of another org is not found');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.activate_professional(current_setting('test.p2')::uuid) $$,
  '42501', null, 'the conseillère cannot activate');
select throws_ok($$ select public.deactivate_professional(current_setting('test.p2')::uuid, current_setting('test.leave')::uuid) $$,
  '42501', null, 'the conseillère cannot deactivate');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.activate_professional(current_setting('test.p1')::uuid, 'abc') $$,
  'P0001', 'Indiquez la raison (au moins 5 caractères).', 'the override needs a reason of 5 characters');
select throws_ok($$ select public.activate_professional(current_setting('test.p1')::uuid, E'  \t\n ') $$,
  'P0001', 'Indiquez la raison (au moins 5 caractères).', 'a blank reason is no reason');
select throws_ok($$ select public.activate_professional(current_setting('test.p1')::uuid, repeat('x', 501)) $$,
  'P0001', 'La raison compte au plus 500 caractères.', 'the reason has at most 500 characters');
select results_eq($$ select * from public.activate_professional(current_setting('test.p1')::uuid, '  Dossier complété hors application  ') $$,
  $$ values ('active'::text, null::text, null::uuid) $$, 'the admin activates an incomplete file with a reason');
reset role;
select results_eq($$ select p.status, p.activation_override_reason, p.status_changed_by, p.deactivation_reason_id
                       from public.professionals p where p.id = current_setting('test.p1')::uuid $$,
  $$ values ('active'::text, 'Dossier complété hors application'::text, 'a0000000-0000-0000-0000-000000000001'::uuid, null::uuid) $$,
  'status, trimmed override reason and actor are stored');
set local role authenticated;
select throws_ok($$ select public.activate_professional(current_setting('test.p1')::uuid, 'Encore une fois') $$,
  'P0001', 'Ce professionnel est déjà actif.', 'an active professional cannot be activated again');

-- =============================================================================
-- deactivate_professional (adjointe A)
-- =============================================================================
reset role;
update public.deactivation_reasons set is_active = false where id = current_setting('test.insurance')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.other')::uuid) $$,
  'P0001', 'Précisez la raison.', '« Autre » requires a note');
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.other')::uuid, E' \t ') $$,
  'P0001', 'Précisez la raison.', 'a blank note is no note');
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.other')::uuid, repeat('n', 501)) $$,
  'P0001', 'La note compte au plus 500 caractères.', 'the note has at most 500 characters');
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.b_leave')::uuid) $$,
  'P0001', 'Raison introuvable.', 'a reason of another org is not found');
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.insurance')::uuid) $$,
  'P0001', 'Raison introuvable.', 'an archived reason is not offered');
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, null) $$,
  'P0001', 'Raison introuvable.', 'a reason is required');
select results_eq($$ select * from public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.other')::uuid, ' Pause prolongée ') $$,
  $$ values ('inactive'::text, null::text, null::uuid) $$, 'deactivated with « Autre » and a note');
reset role;
select results_eq($$ select p.status, p.deactivation_reason_id, p.deactivation_note, p.activation_override_reason,
                            p.deactivation_disabled_account, p.status_changed_by
                       from public.professionals p where p.id = current_setting('test.p1')::uuid $$,
  $$ values ('inactive'::text, current_setting('test.other')::uuid, 'Pause prolongée'::text, null::text, false,
             'a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'reason, trimmed note and actor are stored; the override reason is cleared');
set local role authenticated;
select throws_ok($$ select public.deactivate_professional(current_setting('test.p1')::uuid, current_setting('test.leave')::uuid) $$,
  'P0001', 'Ce professionnel est déjà inactif.', 'an inactive professional cannot be deactivated again');

-- P1 completes its profile (couples, deuil): the adjointe reactivates it without a reason.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_professional_clienteles(current_setting('test.p1')::uuid, jsonb_build_array(jsonb_build_object('id', current_setting('test.couples'))));
select public.set_professional_motifs(current_setting('test.p1')::uuid, array[current_setting('test.deuil')::uuid]);
select is((select r.ready from public.professionals_readiness r where r.professional_id = current_setting('test.p1')::uuid), true,
  'P1 is ready once a clientèle and a motif are set');
select is(public.get_professional_readiness(current_setting('test.p1')::uuid) -> 'complete', 'true'::jsonb, 'the checklist says complete');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select * from public.activate_professional(current_setting('test.p1')::uuid, 'Raison inutile ici') $$,
  $$ values ('active'::text, null::text, null::uuid) $$, 'the adjointe reactivates a complete file');
reset role;
select results_eq($$ select p.status, p.activation_override_reason, p.deactivation_reason_id, p.deactivation_note
                       from public.professionals p where p.id = current_setting('test.p1')::uuid $$,
  $$ values ('active'::text, null::text, null::uuid, null::text) $$,
  'a complete file stores no override reason; the deactivation is cleared');
select ok(exists (select 1 from public.audit_log a
                   where a.table_name = 'professionals' and a.record_id = current_setting('test.p1') and a.action = 'update'
                     and a.changed_fields -> 'status' ->> 'after' = 'inactive'
                     and a.actor_id = 'a0000000-0000-0000-0000-000000000002'),
  'the deactivation is audited with the adjointe as actor');

-- =============================================================================
-- The provider's account (P2, linked to provider A)
-- =============================================================================
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', now(), now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select * from public.deactivate_professional(current_setting('test.p2')::uuid, current_setting('test.leave')::uuid) $$,
  $$ values ('inactive'::text, null::text, null::uuid) $$, 'a reason that keeps the account changes nothing on it');
reset role;
select is((select pr.status from public.profiles pr where pr.user_id = 'a0000000-0000-0000-0000-000000000003'), 'active',
  'the provider can still sign in (P4-11)');
set local role authenticated;
select results_eq($$ select * from public.activate_professional(current_setting('test.p2')::uuid) $$,
  $$ values ('active'::text, null::text, null::uuid) $$, 'P2 reactivated');
select results_eq($$ select * from public.deactivate_professional(current_setting('test.p2')::uuid, current_setting('test.ended')::uuid) $$,
  $$ values ('inactive'::text, 'disabled'::text, 'a0000000-0000-0000-0000-000000000003'::uuid) $$,
  '« Fin de collaboration » disables the account and says so');
reset role;
select results_eq($$ select pr.status, p.deactivation_disabled_account from public.profiles pr
                       join public.professionals p on p.profile_id = pr.user_id
                      where pr.user_id = 'a0000000-0000-0000-0000-000000000003' $$,
  $$ values ('disabled'::text, true) $$, 'the profile is disabled and the module remembers it did it');
select is((select count(*)::int from auth.sessions s where s.user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'the provider''s sessions are ended (as set_user_status does)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.get_professional_record(current_setting('test.p2')::uuid) is null, 'the disabled provider reads nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select * from public.activate_professional(current_setting('test.p2')::uuid) $$,
  $$ values ('active'::text, 'enabled'::text, 'a0000000-0000-0000-0000-000000000003'::uuid) $$,
  'reactivation re-enables the account the module disabled');
reset role;
select results_eq($$ select pr.status, p.deactivation_disabled_account from public.profiles pr
                       join public.professionals p on p.profile_id = pr.user_id
                      where pr.user_id = 'a0000000-0000-0000-0000-000000000003' $$,
  $$ values ('active'::text, false) $$, 'the profile is active again and the flag cleared');

-- An account disabled by someone else stays disabled.
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000003';
set local role authenticated;
select results_eq($$ select * from public.deactivate_professional(current_setting('test.p2')::uuid, current_setting('test.ended')::uuid) $$,
  $$ values ('inactive'::text, null::text, null::uuid) $$, 'an account already disabled is not the module''s doing');
select results_eq($$ select * from public.activate_professional(current_setting('test.p2')::uuid) $$,
  $$ values ('active'::text, null::text, null::uuid) $$, 'so reactivation leaves it alone');
reset role;
select is((select pr.status from public.profiles pr where pr.user_id = 'a0000000-0000-0000-0000-000000000003'), 'disabled',
  'the account disabled by someone else stays disabled');
update public.profiles set status = 'active' where user_id = 'a0000000-0000-0000-0000-000000000003';

-- Module off: refused.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select throws_ok($$ select public.activate_professional(current_setting('test.p4')::uuid) $$,
  '42501', null, 'module off: activation refused');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- professionals_list and professionals_directory
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_eq($$ select l.id from public.professionals_list l $$,
  array[current_setting('test.p1')::uuid, current_setting('test.p2')::uuid, current_setting('test.p4')::uuid, current_setting('test.p5')::uuid],
  'the conseillère lists every org-A professional, nothing of org B');
select results_eq($$ select l.primary_title_id, l.primary_licence_number, l.language_ids, l.clientele_ids, l.specialty_ids, l.motif_ids,
                            l.accepting_new_clients, l.matching_complete, l.ready, l.has_account, l.email_matches_login, l.status
                       from public.professionals_list l where l.id = current_setting('test.p2')::uuid $$,
  $$ values (current_setting('test.psy')::uuid, 'OPQ-2000'::text, array[current_setting('test.fr')::uuid], array[current_setting('test.adults')::uuid],
             array[current_setting('test.cbt')::uuid], array[current_setting('test.anxiete')::uuid], true, true, true, true, true, 'active'::text) $$,
  'a list row carries ids, flags and readiness');
select results_eq($$ select d.display_name, d.primary_title_key, d.category_key, d.order_acronym, d.licence_number, d.language_codes,
                            d.clienteles, d.motif_ids, d.motif_keys, d.insurance_status, d.ready
                       from public.professionals_directory d where d.id = current_setting('test.p2')::uuid $$,
  $$ values ('Pia Deux'::text, 'psychologue'::text, 'psychologie'::text, 'OPQ'::text, 'OPQ-2000'::text, array['fr']::text[],
             jsonb_build_array(jsonb_build_object('id', current_setting('test.adults'), 'key', 'adults', 'specialized', true, 'min_age', 18, 'max_age', 64)),
             array[current_setting('test.anxiete')::uuid], array['anxiete']::text[], 'unknown'::text, true) $$,
  'a directory row carries what matching needs');
select is((select d.professions from public.professionals_directory d where d.id = current_setting('test.p2')::uuid),
  jsonb_build_array(jsonb_build_object('id', (select pp.id from public.professional_professions pp where pp.professional_id = current_setting('test.p2')::uuid),
    'title_id', current_setting('test.psy'), 'title_key', 'psychologue', 'title_name', 'Psychologue', 'category_key', 'psychologie',
    'order_acronym', 'OPQ', 'licence_number', 'OPQ-2000', 'is_primary', true)),
  'the directory lists every profession');
select is((select d.specialties from public.professionals_directory d where d.id = current_setting('test.p2')::uuid),
  jsonb_build_array(jsonb_build_object('id', current_setting('test.cbt'), 'key', 'cbt', 'specialized', false)),
  'the directory lists the approaches');
select ok((select d.updated_at >= p.updated_at from public.professionals_directory d join public.professionals p on p.id = d.id
            where d.id = current_setting('test.p2')::uuid), 'the directory updated_at is at least the record''s');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.professionals_list), 0, 'the provider lists nothing (no professionals.view)');
select is((select count(*)::int from public.professionals_directory), 0, 'the provider sees no directory');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_eq($$ select l.id from public.professionals_list l $$, array[current_setting('test.p3')::uuid], 'admin B lists org B only');
select set_eq($$ select d.id from public.professionals_directory d $$, array[current_setting('test.p3')::uuid], 'admin B''s directory is org B only');

-- =============================================================================
-- list_professionals: filters, sorts, keyset pages (conseillère A)
-- Names: Cinq (P5), Deux (P2), Quatre (P4), Un (P1). P4 adds English; P5 stops accepting.
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_professional_languages(current_setting('test.p4')::uuid, array[current_setting('test.fr')::uuid, current_setting('test.en')::uuid]);
update public.professional_matching_profiles set accepting_new_clients = false where professional_id = current_setting('test.p5')::uuid;

select results_eq($$ select l.id from public.list_professionals() l $$,
  $$ values (current_setting('test.p5')::uuid), (current_setting('test.p2')::uuid), (current_setting('test.p4')::uuid), (current_setting('test.p1')::uuid) $$,
  'no filter: every professional by last name');
select results_eq($$ select l.id from public.list_professionals(p_limit => 2) l $$,
  $$ values (current_setting('test.p5')::uuid), (current_setting('test.p2')::uuid) $$, 'first page of two');
select results_eq($$ select l.id from public.list_professionals(p_after_last_name => 'Deux', p_after_first_name => 'Pia',
                                                                 p_after_id => current_setting('test.p2')::uuid, p_limit => 2) l $$,
  $$ values (current_setting('test.p4')::uuid), (current_setting('test.p1')::uuid) $$, 'the next page starts after the cursor');
select results_eq($$ select l.id from public.list_professionals(p_sort => 'recent') l $$,
  $$ select l.id from public.professionals_list l order by l.status_changed_at desc, l.id desc $$,
  'recent: last status change first');
select results_eq($$ select l.id from public.list_professionals(p_sort => 'recent', p_limit => 1,
                       p_after_status_changed_at => (select x.status_changed_at from public.professionals_list x where x.id = current_setting('test.p5')::uuid),
                       p_after_id => current_setting('test.p5')::uuid) l $$,
  $$ select l.id from public.professionals_list l
      where (l.status_changed_at, l.id) < ((select x.status_changed_at from public.professionals_list x where x.id = current_setting('test.p5')::uuid),
                                           current_setting('test.p5')::uuid)
      order by l.status_changed_at desc, l.id desc limit 1 $$,
  'recent: the next page starts after the cursor');
select set_eq($$ select l.id from public.list_professionals(p_statuses => array['active']) l $$,
  array[current_setting('test.p1')::uuid, current_setting('test.p2')::uuid], 'status filter');
select set_eq($$ select l.id from public.list_professionals(p_title_ids => array[current_setting('test.naturo')::uuid]) l $$,
  array[current_setting('test.p5')::uuid], 'profession filter');
select set_eq($$ select l.id from public.list_professionals(p_language_ids => array[current_setting('test.en')::uuid]) l $$,
  array[current_setting('test.p4')::uuid], 'language filter');
select set_eq($$ select l.id from public.list_professionals(p_clientele_ids => array[current_setting('test.couples')::uuid]) l $$,
  array[current_setting('test.p1')::uuid], 'clientèle filter');
select set_eq($$ select l.id from public.list_professionals(p_motif_ids => array[current_setting('test.anxiete')::uuid, current_setting('test.adoption')::uuid]) l $$,
  array[current_setting('test.p2')::uuid, current_setting('test.p5')::uuid], 'motif filter: any of the motifs');
select set_eq($$ select l.id from public.list_professionals(p_accepting_new_clients => false) l $$,
  array[current_setting('test.p5')::uuid], 'accepting filter');
select set_eq($$ select l.id from public.list_professionals(p_title_ids => array[current_setting('test.psy')::uuid],
                                                            p_motif_ids => array[current_setting('test.anxiete')::uuid]) l $$,
  array[current_setting('test.p2')::uuid], 'filters combine with and');
select is((select count(*)::int from public.list_professionals(p_statuses => '{}', p_motif_ids => '{}')), 4,
  'an empty filter is no filter');
select is((select count(*)::int from public.list_professionals(p_limit => 0)), 1, 'the page size is at least 1');
select throws_ok($$ select * from public.list_professionals(p_sort => 'email') $$,
  '22023', null, 'an unknown sort is refused');
select throws_ok($$ select * from public.list_professionals(p_statuses => array['archived']) $$,
  '22023', null, 'an unknown status is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professionals()), 0, 'the provider pages nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_eq($$ select l.id from public.list_professionals() l $$, array[current_setting('test.p3')::uuid], 'admin B pages org B only');

-- =============================================================================
-- get_professional_record
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.set_professional_payer_number(current_setting('test.p2')::uuid, 'ivac', 'IV-123');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_professional_record(current_setting('test.p1')::uuid)) k),
  array['clienteles', 'language_ids', 'matching_profile', 'motif_ids', 'payer_numbers', 'professional', 'professions',
        'public_profile', 'readiness', 'specialties'],
  'the record bundles the professional, its 1:1 rows, its sets and readiness');
select ok(not (public.get_professional_record(current_setting('test.p1')::uuid) -> 'professional' ? 'org_id')
          and not (public.get_professional_record(current_setting('test.p1')::uuid) -> 'public_profile' ? 'org_id')
          and not (public.get_professional_record(current_setting('test.p1')::uuid) -> 'matching_profile' ? 'org_id'),
  'no org_id in the record');
select results_eq($$ select r -> 'professional' ->> 'first_name', r -> 'motif_ids', r -> 'language_ids', r -> 'clienteles', r -> 'specialties',
                            r -> 'payer_numbers', r -> 'public_profile' ->> 'bio', r -> 'matching_profile' -> 'accepting_new_clients'
                       from public.get_professional_record(current_setting('test.p2')::uuid) r $$,
  $$ values ('Pia'::text, jsonb_build_array(current_setting('test.anxiete')), jsonb_build_array(current_setting('test.fr')),
             jsonb_build_array(jsonb_build_object('id', current_setting('test.adults'), 'specialized', true)),
             jsonb_build_array(jsonb_build_object('id', current_setting('test.cbt'), 'specialized', false)),
             '[{"payer_type": "ivac", "number": "IV-123"}]'::jsonb, 'Accompagne les adultes.'::text, 'true'::jsonb) $$,
  'the record carries the sets as ids');
select is(public.get_professional_record(current_setting('test.p2')::uuid) -> 'professions',
  jsonb_build_array(jsonb_build_object('id', (select pp.id from public.professional_professions pp where pp.professional_id = current_setting('test.p2')::uuid),
    'profession_title_id', current_setting('test.psy'), 'licence_number', 'OPQ-2000', 'is_primary', true)),
  'the record lists the professions');
select is(public.get_professional_record(current_setting('test.p2')::uuid) -> 'readiness',
  public.get_professional_readiness(current_setting('test.p2')::uuid), 'the record embeds the readiness');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(public.get_professional_record(current_setting('test.p1')::uuid) is null, 'admin B reads no org A record');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.get_professional_record(current_setting('test.p2')::uuid) is not null, 'the provider reads their own record');
select ok(public.get_professional_record(current_setting('test.p1')::uuid) is null, 'the provider reads no other record');

-- =============================================================================
-- get_professional_public_profile (P2: anxiété in « Vie intérieure », deuil without a category,
-- adoption whose category is archived)
-- =============================================================================
reset role;
update public.motifs set category_id = null where id = current_setting('test.deuil')::uuid;
update public.motif_categories set is_active = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'relationships';
insert into public.professional_motifs (org_id, professional_id, motif_id) values
  ('b0000000-0000-0000-0000-00000000000a', current_setting('test.p2')::uuid, current_setting('test.deuil')::uuid),
  ('b0000000-0000-0000-0000-00000000000a', current_setting('test.p2')::uuid, current_setting('test.adoption')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_public_profile(current_setting('test.p2')::uuid) -> 'motif_groups',
  '[{"category_key": "inner_life", "category_name": "Vie intérieure", "icon": "Brain", "motifs": ["Anxiété"]},
    {"category_key": "autres", "category_name": "Autres", "icon": null, "motifs": ["Adoption", "Deuil"]}]'::jsonb,
  'motifs grouped by active category, « Autres » last');
select is(public.get_professional_public_profile(current_setting('test.p2')::uuid) - 'motif_groups',
  jsonb_build_object('first_name', 'Pia', 'last_name', 'Deux', 'bio', 'Accompagne les adultes.', 'approach', null,
    'public_email', 'pia@clinique.ca', 'public_phone', null, 'primary_title_name', 'Psychologue', 'order_acronym', 'OPQ',
    'licence_number', 'OPQ-2000',
    'clienteles', jsonb_build_array(jsonb_build_object('name', 'Adultes', 'min_age', 18, 'max_age', 64, 'specialized', true)),
    'approaches', jsonb_build_array(jsonb_build_object('name', 'Thérapie cognitivo-comportementale (TCC)', 'specialized', false))),
  'portrait, public contact, clientèles and approaches with names');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.get_professional_public_profile(current_setting('test.p2')::uuid) is not null, 'the provider reads their own public profile');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(public.get_professional_public_profile(current_setting('test.p2')::uuid) is null, 'admin B reads no org A public profile');

-- =============================================================================
-- list_professional_history (P1)
-- =============================================================================
-- The adjointe swaps P1's psychologue for sexologue (the psychologue row is deleted) and sets a
-- phone (redacted).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.set_professional_professions(current_setting('test.p1')::uuid,
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', 'S-100')));
update public.professionals set personal_phone = '+15145550101' where id = current_setting('test.p1')::uuid;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select array_agg(distinct h.table_name order by h.table_name) from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h),
  array['professional_clienteles', 'professional_languages', 'professional_matching_profiles', 'professional_motifs',
        'professional_professions', 'professional_public_profiles', 'professionals']::text[],
  'the history holds the record and its child rows');
select ok((select bool_and(left(h.record_id, 36) = current_setting('test.p1')) from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h),
  'only P1''s rows');
select ok((select array_agg(h.id) = array_agg(h.id order by h.id desc) from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h),
  'newest first');
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_professions' and h.action = 'delete'
              and h.changed_fields ->> 'profession_title_id' = current_setting('test.psy')),
  1, 'the deleted profession row still shows (its delete row)');
select is((select h.changed_fields -> 'personal_phone' from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professionals' and h.action = 'update' and h.changed_fields ? 'personal_phone'),
  '"[redacted]"'::jsonb, 'redacted fields stay redacted');
select is((select h.actor_name from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professionals' and h.changed_fields -> 'status' ->> 'after' = 'inactive'),
  'Adjointe A', 'the actor is named');
select set_config('test.page1_last', (select min(h.id)::text from public.list_professional_history(current_setting('test.p1')::uuid, null, 3) h), true);
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 3)), 3, 'a page holds p_limit rows');
select results_eq($$ select h.id from public.list_professional_history(current_setting('test.p1')::uuid, current_setting('test.page1_last')::bigint, 3) h $$,
  $$ select h.id from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
      where h.id < current_setting('test.page1_last')::bigint order by h.id desc limit 3 $$,
  'p_before_id gives the next page');
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 0)), 1, 'at least one row per page');

reset role;
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields)
select 'b0000000-0000-0000-0000-00000000000a', 'professionals', current_setting('test.p1'), 'update', '{"years_experience": {"before": 1, "after": 2}}'
  from generate_series(1, 210);
set local role authenticated;
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 500)), 200, 'at most 200 rows per page');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid)), 0, 'admin B sees no org A history');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_professional_history(current_setting('test.p2')::uuid) $$,
  '42501', null, 'the provider has no history (professionals.view)');

select * from finish();
rollback;
