-- Professionnels reference settings (migration *_professionals_reference_settings.sql, plan Phase 4 Task 4a.2).
-- Covers: privileges of the settings RPCs, the catalogue and the catalogue views; key generation
-- (private.reference_key); the eight save RPCs, none for approaches (P4-240) (tidy names, NFKC
-- duplicates with friendly messages, generated and frozen keys, each list's own rules, the
-- per-list cap); archive / restore with the
-- system and dependency rules; reorder; the cached catalogue (one payload, no org_id, org isolation,
-- module gate, disabled users); the published views; module settings (defaults, the per-key
-- validator, collect_sin needs professionals.private, audit); system clientèle kinds, the reason
-- « Autre » and unique acronyms; no-op writes without audit rows; permissions per role; audit rows
-- of a rename.
begin;
create extension if not exists pgtap with schema extensions;
select plan(188);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider, a conseillère, K in a
-- custom role without any professionals key, S, an adjointe holding professionals.settings by
-- override (but not professionals.private), and a disabled admin; org B with an admin. Both orgs are created after the
-- migrations, so the reference lists are seeded.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'k@a.test',           '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's@a.test',           '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test',           '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'K (sans clé)',  'k@a.test',           'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'S (settings)',  's@a.test',           'active'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'Admin désactivé', 'x@a.test',         'disabled');
insert into public.roles (key, name, org_id) values ('custom_0000000a', 'Lecture seule', 'b0000000-0000-0000-0000-00000000000a');
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'custom_0000000a', 'settings.view');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'custom_0000000a'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'professionals.settings', true);

-- Org B's ids, read now (as postgres) for the cross-org checks below.
select set_config('test.b_trauma', (select c.id::text from public.motif_categories c
  where c.org_id = 'b0000000-0000-0000-0000-00000000000b' and c.key = 'violence_abus'), true);
select set_config('test.b_anxiete', (select m.id::text from public.motifs m
  where m.org_id = 'b0000000-0000-0000-0000-00000000000b' and m.key = 'anxiete'), true);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'save_professional_order', array['uuid', 'text', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call save_professional_order');
select function_privs_are('public', 'save_professional_order', array['uuid', 'text', 'text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call save_professional_order');
select function_privs_are('public', 'save_profession_category', array['uuid', 'text'], 'anon', array[]::text[], 'anon cannot call save_profession_category');
select function_privs_are('public', 'save_profession_category', array['uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call save_profession_category');
select function_privs_are('public', 'save_profession_title', array['uuid', 'text', 'uuid', 'uuid', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call save_profession_title');
select function_privs_are('public', 'save_profession_title', array['uuid', 'text', 'uuid', 'uuid', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call save_profession_title');
select function_privs_are('public', 'save_clientele', array['uuid', 'text', 'integer', 'integer'], 'anon', array[]::text[], 'anon cannot call save_clientele');
select function_privs_are('public', 'save_clientele', array['uuid', 'text', 'integer', 'integer'], 'authenticated', array['EXECUTE'], 'authenticated may call save_clientele');
select hasnt_function('public', 'save_specialty', 'there is no save RPC for approaches (P4-240)');
select function_privs_are('public', 'save_motif_category', array['uuid', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call save_motif_category');
select function_privs_are('public', 'save_motif_category', array['uuid', 'text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call save_motif_category');
select function_privs_are('public', 'save_motif', array['uuid', 'text', 'uuid', 'boolean'], 'anon', array[]::text[], 'anon cannot call save_motif');
select function_privs_are('public', 'save_motif', array['uuid', 'text', 'uuid', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated may call save_motif');
select function_privs_are('public', 'save_language', array['uuid', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call save_language');
select function_privs_are('public', 'save_language', array['uuid', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call save_language');
select function_privs_are('public', 'save_deactivation_reason', array['uuid', 'text', 'boolean', 'boolean'], 'anon', array[]::text[], 'anon cannot call save_deactivation_reason');
select function_privs_are('public', 'save_deactivation_reason', array['uuid', 'text', 'boolean', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated may call save_deactivation_reason');
select function_privs_are('public', 'set_professionals_reference_active', array['text', 'uuid', 'boolean'], 'anon', array[]::text[], 'anon cannot archive');
select function_privs_are('public', 'set_professionals_reference_active', array['text', 'uuid', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professionals_reference_active');
select function_privs_are('public', 'reorder_professionals_reference', array['text', 'uuid[]'], 'anon', array[]::text[], 'anon cannot reorder');
select function_privs_are('public', 'reorder_professionals_reference', array['text', 'uuid[]'], 'authenticated', array['EXECUTE'], 'authenticated may call reorder_professionals_reference');
select function_privs_are('public', 'get_professionals_catalog', array[]::text[], 'anon', array[]::text[], 'anon cannot read the catalogue');
select function_privs_are('public', 'get_professionals_catalog', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated may call get_professionals_catalog');
select function_privs_are('public', 'get_professionals_settings', array[]::text[], 'anon', array[]::text[], 'anon cannot read the module settings');
select function_privs_are('public', 'get_professionals_settings', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated may call get_professionals_settings');
select function_privs_are('public', 'set_professionals_settings', array['jsonb'], 'anon', array[]::text[], 'anon cannot change the module settings');
select function_privs_are('public', 'set_professionals_settings', array['jsonb'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professionals_settings');
select function_privs_are('private', 'reference_key', array['text'], 'authenticated', array[]::text[], 'clients cannot call private.reference_key');
select function_privs_are('private', 'reference_key', array['text'], 'service_role', array[]::text[], 'service_role cannot call private.reference_key');
select function_privs_are('private', 'professionals_setting', array['uuid', 'text'], 'authenticated', array[]::text[], 'clients cannot call private.professionals_setting');
select function_privs_are('private', 'professionals_setting', array['uuid', 'text'], 'service_role', array[]::text[], 'service_role cannot call private.professionals_setting');
select function_privs_are('private', 'validate_professionals_setting', array['text', 'jsonb'], 'authenticated', array[]::text[], 'clients cannot call private.validate_professionals_setting');

select table_privs_are('public', 'motifs_catalog',     'anon', array[]::text[], 'anon: nothing on motifs_catalog');
select table_privs_are('public', 'clienteles_catalog', 'anon', array[]::text[], 'anon: nothing on clienteles_catalog');
select table_privs_are('public', 'languages_catalog',  'anon', array[]::text[], 'anon: nothing on languages_catalog');
select table_privs_are('public', 'motifs_catalog',     'authenticated', array['SELECT'], 'authenticated: select only on motifs_catalog');
select table_privs_are('public', 'clienteles_catalog', 'authenticated', array['SELECT'], 'authenticated: select only on clienteles_catalog');
select table_privs_are('public', 'languages_catalog',  'authenticated', array['SELECT'], 'authenticated: select only on languages_catalog');

-- =============================================================================
-- Keys from names (as postgres)
-- =============================================================================
select is(private.reference_key('Thérapie d''impact'), 'therapie_d_impact', 'accents and punctuation fold to snake_case');
select is(private.reference_key('  Œuvre  sociale '), 'oeuvre_sociale', '« Œ » becomes « oe », outer and inner spaces fold');
select is(private.reference_key('2e ligne'), 'k_2e_ligne', 'a key starting with a digit gets the k_ prefix');
select is(private.reference_key('!!!'), 'item', 'a name without a letter or digit gives « item »');
select is(private.reference_key('Accompagnement des personnes proches aidantes ado et jeunes adultes'),
  'accompagnement_des_personnes_proches_aidantes_ado', 'a 70-character name gives at most 50 characters, no trailing _');

-- =============================================================================
-- save_motif (admin A), the representative save RPC
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select set_config('test.motif', public.save_motif(null, 'Soutien scolaire',
  (select c.id from public.motif_categories c where c.key = 'sante_mentale'), false)::text, true);
select results_eq($$ select m.key, m.name, c.key, m.is_restricted, m.is_active from public.motifs m
                      join public.motif_categories c on c.id = m.category_id
                     where m.id = current_setting('test.motif')::uuid $$,
  $$ values ('soutien_scolaire'::text, 'Soutien scolaire'::text, 'sante_mentale'::text, false, true) $$,
  'save_motif creates a motif with a key generated from its name');
select ok((select m.sort_order > (select max(x.sort_order) from public.motifs x where x.id <> m.id)
             from public.motifs m where m.id = current_setting('test.motif')::uuid),
  'a new motif goes to the end of the list');
select set_config('test.motif2', public.save_motif(null, 'Soutien-scolaire', null, null)::text, true);
select results_eq($$ select m.key, m.category_id, m.is_restricted from public.motifs m where m.id = current_setting('test.motif2')::uuid $$,
  $$ values ('soutien_scolaire_2'::text, null::uuid, false) $$,
  'a different name with the same key base gets the next free key (« Soutien-scolaire » → soutien_scolaire_2)');
select throws_ok($$ select public.save_motif(null, 'SOUTIEN SCOLAIRE', null, false) $$,
  'P0001', 'Un motif porte déjà ce nom (il est peut-être archivé).', 'names are unique ignoring case');
select throws_ok($$ select public.save_motif(null, E'Soutien\u00A0scolaire', null, false) $$,
  'P0001', 'Un motif porte déjà ce nom (il est peut-être archivé).', 'names are unique ignoring look-alike spaces (a no-break space, NFKC)');
select throws_ok($$ select public.save_motif(null, E'Anxie\u0301te\u0301', null, false) $$,
  'P0001', 'Un motif porte déjà ce nom (il est peut-être archivé).', 'a decomposed « Anxiété » is the seeded one (NFKC)');
select lives_ok($$ select public.save_motif(current_setting('test.motif')::uuid, 'Soutien scolaire et devoirs',
                    (select c.id from public.motif_categories c where c.key = 'sante_mentale'), null) $$,
  'admin A renames a motif');
select results_eq($$ select m.key, m.name, m.is_restricted from public.motifs m where m.id = current_setting('test.motif')::uuid $$,
  $$ values ('soutien_scolaire'::text, 'Soutien scolaire et devoirs'::text, false) $$,
  'renaming keeps the key; a null flag keeps its value');
select lives_ok($$ select public.save_motif(current_setting('test.motif')::uuid, 'SOUTIEN SCOLAIRE ET DEVOIRS',
                    (select c.id from public.motif_categories c where c.key = 'sante_mentale'), true) $$,
  'a motif may change the case of its own name');
select is((select m.is_restricted from public.motifs m where m.id = current_setting('test.motif')::uuid), true,
  'the restricted flag is stored');
select set_config('test.motif3', public.save_motif(null, E'\u00A0Deuil   animalier\u3000', null, false)::text, true);
select results_eq($$ select m.key, m.name from public.motifs m where m.id = current_setting('test.motif3')::uuid $$,
  $$ values ('deuil_animalier'::text, 'Deuil animalier'::text) $$,
  'Unicode spaces (no-break, ideographic) are stripped at both ends and inner runs fold to one space');
select throws_ok($$ select public.save_motif(null, '  ', null, false) $$,
  'P0001', 'Le nom est obligatoire.', 'a blank name is refused');
select throws_ok($$ select public.save_motif(null, repeat('a', 121), null, false) $$,
  'P0001', 'Le nom ne peut pas dépasser 120 caractères.', 'a 121-character name is refused');
select throws_ok($$ select public.save_motif(null, E'Anxi\u200Bété sociale', null, false) $$,
  'P0001', 'Le nom contient des caractères invisibles ou non permis.', 'a zero-width space is refused with a message');
select throws_ok($$ select public.save_motif(null, 'Motif croisé', current_setting('test.b_trauma')::uuid, false) $$,
  'P0001', 'Catégorie introuvable ou archivée.', 'a category of org B is refused');
select throws_ok($$ select public.save_motif(current_setting('test.b_anxiete')::uuid, 'Anxiété B', null, false) $$,
  'P0001', 'Motif introuvable.', 'a motif of org B cannot be renamed from org A');
select throws_ok($$ select public.save_motif(gen_random_uuid(), 'Inconnu', null, false) $$,
  'P0001', 'Motif introuvable.', 'an unknown id is refused');

-- =============================================================================
-- The other save RPCs (admin A): create, update with a frozen key, own rules
-- =============================================================================
-- Orders
select set_config('test.order', public.save_professional_order(null, 'Ordre des testeurs', 'ot', null, null)::text, true);
select results_eq($$ select o.key, o.acronym, o.licence_label, o.licence_pattern from public.professional_orders o
                     where o.id = current_setting('test.order')::uuid $$,
  $$ values ('ordre_des_testeurs'::text, 'OT'::text, 'N° de permis'::text, null::text) $$,
  'save_professional_order: key generated, acronym upper-cased, default licence label');
select lives_ok($$ select public.save_professional_order(current_setting('test.order')::uuid, 'Ordre des testeuses', 'OTQ',
                    'N° de membre', '^[0-9]{5}$') $$, 'save_professional_order updates an order');
select results_eq($$ select o.key, o.name, o.acronym, o.licence_label, o.licence_pattern from public.professional_orders o
                     where o.id = current_setting('test.order')::uuid $$,
  $$ values ('ordre_des_testeurs'::text, 'Ordre des testeuses'::text, 'OTQ'::text, 'N° de membre'::text, '^[0-9]{5}$'::text) $$,
  'the order keeps its key; label and pattern are stored');
select throws_ok($$ select public.save_professional_order(null, 'Ordre sans sigle', 'O1', null, null) $$,
  'P0001', 'Sigle : 2 à 10 lettres majuscules.', 'an acronym with a digit is refused');
select throws_ok($$ select public.save_professional_order(null, 'Ordre au format cassé', 'OFC', null, '[') $$,
  'P0001', 'Format de permis invalide.', 'an invalid licence pattern is refused');
select throws_ok($$ select public.save_professional_order(null, 'ordre des psychologues du québec', 'OPQ', null, null) $$,
  'P0001', 'Un ordre porte déjà ce nom (il est peut-être archivé).', 'order names are unique');
select throws_ok($$ select public.save_professional_order(null, 'Ordre bis des psychologues', 'opq', null, null) $$,
  'P0001', 'Un ordre porte déjà ce sigle (il est peut-être archivé).', 'acronyms are unique per clinic, ignoring case');

-- Profession categories
select set_config('test.category', public.save_profession_category(null, 'Art-thérapie')::text, true);
select is((select c.key from public.profession_categories c where c.id = current_setting('test.category')::uuid),
  'art_therapie', 'save_profession_category creates a category');
select lives_ok($$ select public.save_profession_category(current_setting('test.category')::uuid, 'Arts thérapeutiques') $$,
  'save_profession_category renames a category');
select results_eq($$ select c.key, c.name from public.profession_categories c where c.id = current_setting('test.category')::uuid $$,
  $$ values ('art_therapie'::text, 'Arts thérapeutiques'::text) $$, 'the category keeps its key');

-- Profession titles
select set_config('test.title', public.save_profession_title(null, 'Art-thérapeute',
  current_setting('test.category')::uuid, null, null, null)::text, true);
select results_eq($$ select t.key, t.category_id, t.order_id, t.name_feminine, t.name_masculine
                      from public.profession_titles t where t.id = current_setting('test.title')::uuid $$,
  $$ select 'art_therapeute'::text, current_setting('test.category')::uuid, null::uuid, null::text, null::text $$,
  'save_profession_title creates an unregulated title, without forms (the name is shown, P4-340)');
select lives_ok($$ select public.save_profession_title(current_setting('test.title')::uuid, 'Art-thérapeute certifiée ou certifié',
                    current_setting('test.category')::uuid, current_setting('test.order')::uuid,
                    E'  Art-thérapeute\u00A0 certifiée ', 'Art-thérapeute certifié') $$,
  'save_profession_title updates a title, attaches an order and sets its forms');
select results_eq($$ select t.key, t.name, t.order_id, t.name_feminine, t.name_masculine
                      from public.profession_titles t where t.id = current_setting('test.title')::uuid $$,
  $$ select 'art_therapeute'::text, 'Art-thérapeute certifiée ou certifié'::text, current_setting('test.order')::uuid,
            'Art-thérapeute certifiée'::text, 'Art-thérapeute certifié'::text $$,
  'the title keeps its key, gets the order and its forms, tidied as the name is');
select throws_ok($$ select public.save_profession_title(current_setting('test.title')::uuid, 'Art-thérapeute',
                     current_setting('test.category')::uuid, null, repeat('x', 121), null) $$,
  'P0001', 'La forme féminine ne peut pas dépasser 120 caractères.', 'a form is at most 120 characters');
select throws_ok($$ select public.save_profession_title(current_setting('test.title')::uuid, 'Art-thérapeute',
                     current_setting('test.category')::uuid, null, null, E'Art\u200Bthérapeute') $$,
  'P0001', 'La forme masculine contient des caractères invisibles ou non permis.', 'a form is tidy text');
select throws_ok($$ select public.save_profession_title(null, 'Titre sans catégorie', null, null, null, null) $$,
  'P0001', 'Choisissez une catégorie.', 'a title needs a category');

-- Clientèles
select set_config('test.clientele', public.save_clientele(null, 'Aînés', 65, 80)::text, true);
select results_eq($$ select c.key, c.min_age::int, c.max_age::int, c.is_system from public.clienteles c
                     where c.id = current_setting('test.clientele')::uuid $$,
  $$ values ('aines'::text, 65, 80, false) $$, 'save_clientele creates an age group');
select lives_ok($$ select public.save_clientele(current_setting('test.clientele')::uuid, 'Aînés (65-90)', 65, 90) $$,
  'save_clientele updates bounds');
select results_eq($$ select c.key, c.max_age::int from public.clienteles c where c.id = current_setting('test.clientele')::uuid $$,
  $$ values ('aines'::text, 90) $$, 'the clientèle keeps its key');
select lives_ok($$ select public.save_clientele((select c.id from public.clienteles c where c.key = 'children'), 'Enfants', 0, 11) $$,
  'a system clientèle''s bounds stay editable (P4-42)');
select throws_ok($$ select public.save_clientele((select c.id from public.clienteles c where c.key = 'children'), 'Enfants', null, null) $$,
  'P0001', 'Cette clientèle garde son type (groupe d''âge ou non).', 'a system age group cannot lose its bounds');
select throws_ok($$ select public.save_clientele((select c.id from public.clienteles c where c.key = 'couples'), 'Couples', 18, null) $$,
  'P0001', 'Cette clientèle garde son type (groupe d''âge ou non).', 'a system clientèle without bounds (couples) cannot become an age group');
select lives_ok($$ select public.save_clientele((select c.id from public.clienteles c where c.key = 'couples'), 'Couples et partenaires', null, null) $$,
  'a system clientèle without bounds is renamed, still without bounds');
select lives_ok($$ select public.save_clientele(current_setting('test.clientele')::uuid, 'Aînés (65-90)', null, null) $$,
  'a clinic''s own clientèle may change kind');
select throws_ok($$ select public.save_clientele(null, 'Mauvais intervalle', 13, 12) $$,
  'P0001', 'L''âge maximum doit être supérieur ou égal à l''âge minimum.', 'max age below min age is refused');
select throws_ok($$ select public.save_clientele(null, 'Sans minimum', null, 30) $$,
  'P0001', 'Un âge maximum demande un âge minimum.', 'a max age needs a min age');
select throws_ok($$ select public.save_clientele(null, 'Centenaires', 121, null) $$,
  'P0001', 'Les âges vont de 0 à 120 ans.', 'ages stay within 0–120');
select lives_ok($$ select public.set_professionals_reference_active('clienteles', (select c.id from public.clienteles c where c.key = 'athletes'), false) $$,
  'a clientèle the clinic added from the website (athletes) can be archived (P4-244)');
select throws_ok($$ select public.save_clientele(null, E'\uFF30\uFF41\uFF52\uFF45\uFF4E\uFF54\uFF53', null, null) $$,
  'P0001', 'Une clientèle porte déjà ce nom (elle est peut-être archivée).', 'a full-width « Ｐａｒｅｎｔｓ » is the seeded Parents (NFKC)');

-- Motif categories
select set_config('test.mcat', public.save_motif_category(null, 'Proches et soutien', 'Aidance et entourage', 'Heart')::text, true);
select results_eq($$ select c.key, c.description, c.icon from public.motif_categories c where c.id = current_setting('test.mcat')::uuid $$,
  $$ values ('proches_et_soutien'::text, 'Aidance et entourage'::text, 'Heart'::text) $$,
  'save_motif_category creates a category with its description and icon');
select lives_ok($$ select public.save_motif_category(current_setting('test.mcat')::uuid, 'Entourage', '  ', null) $$,
  'save_motif_category updates a category');
select results_eq($$ select c.key, c.name, c.description, c.icon from public.motif_categories c where c.id = current_setting('test.mcat')::uuid $$,
  $$ values ('proches_et_soutien'::text, 'Entourage'::text, null::text, 'Heart'::text) $$,
  'the category keeps its key and icon; a blank description clears it');
select throws_ok($$ select public.save_motif_category(null, 'Crâne', null, 'Skull') $$,
  'P0001', 'Icône inconnue.', 'an icon outside the 20-icon set is refused');
select throws_ok($$ select public.save_motif_category(null, 'Longue description', repeat('x', 301), null) $$,
  'P0001', 'La description ne peut pas dépasser 300 caractères.', 'a 301-character description is refused');

-- Languages
select set_config('test.language', public.save_language(null, 'Allemand', ' DE ')::text, true);
select results_eq($$ select l.code, l.name, l.is_system from public.languages l where l.id = current_setting('test.language')::uuid $$,
  $$ values ('de'::text, 'Allemand'::text, false) $$, 'save_language lower-cases the code');
select lives_ok($$ select public.save_language(current_setting('test.language')::uuid, 'Allemand (Deutsch)', 'DE') $$,
  'save_language renames a language, the same code in capitals is accepted');
select is((select l.name from public.languages l where l.id = current_setting('test.language')::uuid),
  'Allemand (Deutsch)', 'the language is renamed');
select throws_ok($$ select public.save_language(null, 'English', 'en') $$,
  'P0001', 'Cette langue existe déjà.', 'a second language with the same code is refused');
select throws_ok($$ select public.save_language(current_setting('test.language')::uuid, 'Allemand', 'nl') $$,
  'P0001', 'Le code d''une langue ne change pas.', 'a language''s code never changes');
select throws_ok($$ select public.save_language(null, 'Klingon', 'tlh') $$,
  'P0001', 'Code de langue : deux lettres (ISO 639-1).', 'a language code has two letters');

-- Deactivation reasons
select set_config('test.reason', public.save_deactivation_reason(null, 'Retraite', true, true)::text, true);
select results_eq($$ select r.key, r.requires_note, r.disables_account from public.deactivation_reasons r
                     where r.id = current_setting('test.reason')::uuid $$,
  $$ values ('retraite'::text, true, true) $$, 'save_deactivation_reason stores both flags');
select lives_ok($$ select public.save_deactivation_reason(current_setting('test.reason')::uuid, 'Départ à la retraite', false, null) $$,
  'save_deactivation_reason updates a reason');
select results_eq($$ select r.key, r.name, r.requires_note, r.disables_account from public.deactivation_reasons r
                     where r.id = current_setting('test.reason')::uuid $$,
  $$ values ('retraite'::text, 'Départ à la retraite'::text, false, true) $$,
  'the reason keeps its key; a null flag keeps its value');
select throws_ok($$ select public.save_deactivation_reason((select r.id from public.deactivation_reasons r where r.key = 'other'), 'Autre', false, null) $$,
  'P0001', 'La raison « Autre » demande toujours une note.', 'the system reason « Autre » keeps requires_note');
select lives_ok($$ select public.save_deactivation_reason((select r.id from public.deactivation_reasons r where r.key = 'other'), 'Autre raison', null, true) $$,
  'the reason « Autre » is renamed, its note requirement kept by a null flag');

-- =============================================================================
-- Archive / restore (admin A)
-- =============================================================================
select lives_ok($$ select public.set_professionals_reference_active('motifs', current_setting('test.motif3')::uuid, false) $$,
  'admin A archives a motif');
select is((select m.is_active from public.motifs m where m.id = current_setting('test.motif3')::uuid), false, 'the motif is archived');
select is_empty($$ select 1 from public.motifs_catalog c where c.id = current_setting('test.motif3')::uuid $$,
  'an archived motif leaves motifs_catalog');
select lives_ok($$ select public.set_professionals_reference_active('motifs', current_setting('test.motif3')::uuid, true) $$,
  'admin A restores the motif');
select isnt_empty($$ select 1 from public.motifs_catalog c where c.id = current_setting('test.motif3')::uuid $$,
  'a restored motif is back in motifs_catalog');
select throws_ok($$ select public.set_professionals_reference_active('clienteles', (select c.id from public.clienteles c where c.key = 'children'), false) $$,
  'P0001', 'Cet élément est utilisé par le jumelage ou la création ; il ne peut pas être archivé.', 'the clientèle children cannot be archived');
select throws_ok($$ select public.set_professionals_reference_active('languages', (select l.id from public.languages l where l.code = 'fr'), false) $$,
  'P0001', 'Cet élément est utilisé par le jumelage ou la création ; il ne peut pas être archivé.', 'French cannot be archived');
select throws_ok($$ select public.set_professionals_reference_active('deactivation_reasons', (select r.id from public.deactivation_reasons r where r.key = 'other'), false) $$,
  'P0001', 'Cet élément est utilisé par le jumelage ou la création ; il ne peut pas être archivé.', 'the reason « Autre » cannot be archived');
select throws_ok($$ select public.set_professionals_reference_active('profession_categories', current_setting('test.category')::uuid, false) $$,
  'P0001', 'Archivez d''abord les titres de cette catégorie.', 'a category with an active title cannot be archived');
select throws_ok($$ select public.set_professionals_reference_active('professional_orders', current_setting('test.order')::uuid, false) $$,
  'P0001', 'Archivez d''abord les titres de cet ordre.', 'an order with an active title cannot be archived');
select lives_ok($$ select public.set_professionals_reference_active('profession_titles', current_setting('test.title')::uuid, false) $$,
  'a title can be archived');
select lives_ok($$ select public.set_professionals_reference_active('profession_categories', current_setting('test.category')::uuid, false) $$,
  'with its title archived, the category can be archived');
select lives_ok($$ select public.set_professionals_reference_active('professional_orders', current_setting('test.order')::uuid, false) $$,
  'with its title archived, the order can be archived');
select throws_ok($$ select public.set_professionals_reference_active('profession_titles', current_setting('test.title')::uuid, true) $$,
  'P0001', 'Restaurez d''abord sa catégorie.', 'a title cannot be restored while its category is archived');
select throws_ok($$ select public.save_profession_title(null, 'Nouveau titre', current_setting('test.category')::uuid, null, null, null) $$,
  'P0001', 'Catégorie introuvable ou archivée.', 'a new title cannot use an archived category');
select lives_ok($$ select public.save_profession_title(current_setting('test.title')::uuid, 'Art-thérapeute',
                    current_setting('test.category')::uuid, current_setting('test.order')::uuid, null, null) $$,
  'an archived title can be renamed while keeping its archived category and order');
select results_eq($$ select t.name_feminine, t.name_masculine from public.profession_titles t where t.id = current_setting('test.title')::uuid $$,
  $$ values (null::text, null::text) $$, 'blank forms are cleared: the name is shown again');
select lives_ok($$ select public.set_professionals_reference_active('profession_categories', current_setting('test.category')::uuid, true) $$,
  'the category is restored');
select throws_ok($$ select public.set_professionals_reference_active('profession_titles', current_setting('test.title')::uuid, true) $$,
  'P0001', 'Restaurez d''abord son ordre.', 'a title cannot be restored while its order is archived');
select throws_ok($$ select public.save_profession_title(null, 'Autre titre', current_setting('test.category')::uuid, current_setting('test.order')::uuid, null, null) $$,
  'P0001', 'Ordre introuvable ou archivé.', 'a new title cannot use an archived order');
select throws_ok($$ select public.set_professionals_reference_active('nope', current_setting('test.motif')::uuid, false) $$,
  '22023', null, 'an unknown kind is a technical error');
select throws_ok($$ select public.set_professionals_reference_active('motifs', current_setting('test.b_anxiete')::uuid, false) $$,
  'P0001', 'Élément introuvable.', 'a motif of org B cannot be archived from org A');

-- An archived motif category: its motifs stay, shown without a category in motifs_catalog.
select lives_ok($$ select public.save_motif(current_setting('test.motif2')::uuid, 'Soutien-scolaire', current_setting('test.mcat')::uuid, null) $$,
  'a motif moves to the new category');
select lives_ok($$ select public.set_professionals_reference_active('motif_categories', current_setting('test.mcat')::uuid, false) $$,
  'a motif category with motifs can be archived');
select results_eq($$ select c.category_id, c.category_key, c.category_name from public.motifs_catalog c where c.id = current_setting('test.motif2')::uuid $$,
  $$ values (null::uuid, null::text, null::text) $$,
  'in motifs_catalog, a motif of an archived category has no category');
select lives_ok($$ select public.save_motif(current_setting('test.motif2')::uuid, 'Soutien-scolaire (devoirs)', current_setting('test.mcat')::uuid, null) $$,
  'a motif keeps its archived category when renamed');

-- =============================================================================
-- Reorder (admin A)
-- =============================================================================
select set_config('test.c1', (select c.id::text from public.motif_categories c where c.key = 'sante_mentale'), true);
select set_config('test.c2', (select c.id::text from public.motif_categories c where c.key = 'personnalite'), true);
select set_config('test.c3', (select c.id::text from public.motif_categories c where c.key = 'dependances'), true);
select lives_ok($$ select public.reorder_professionals_reference('motif_categories',
                    array[current_setting('test.c3'), current_setting('test.c1'), current_setting('test.c2')]::uuid[]) $$,
  'admin A reorders three motif categories');
select results_eq($$ select c.key, c.sort_order from public.motif_categories c
                     where c.key in ('sante_mentale', 'personnalite', 'dependances') order by c.sort_order $$,
  $$ values ('dependances'::text, 10), ('sante_mentale', 20), ('personnalite', 30) $$,
  'their sort orders become 10, 20, 30 in the given order');
select throws_ok($$ select public.reorder_professionals_reference('motif_categories',
                     array[current_setting('test.c1'), current_setting('test.motif')]::uuid[]) $$,
  '22023', 'Éléments inconnus.', 'an id of another list of the same clinic is refused');
select throws_ok($$ select public.reorder_professionals_reference('motif_categories', array[]::uuid[]) $$,
  '22023', 'Liste d''éléments invalide (vide, en double ou trop longue).', 'an empty list is refused');
select throws_ok($$ select public.reorder_professionals_reference('motif_categories',
                     array(select gen_random_uuid() from generate_series(1, 501))) $$,
  '22023', 'Liste d''éléments invalide (vide, en double ou trop longue).', 'a list of more than 500 ids is refused');

-- No-op writes leave no audit row (audit_log read as postgres).
reset role;
select set_config('test.audit_count', (select count(*)::text from public.audit_log), true);
set local role authenticated;
select lives_ok($$ select public.set_professionals_reference_active('motifs', current_setting('test.motif')::uuid, true) $$,
  'restoring an active motif is accepted');
select lives_ok($$ select public.reorder_professionals_reference('motif_categories',
                    array[current_setting('test.c3'), current_setting('test.c1'), current_setting('test.c2')]::uuid[]) $$,
  'resending the current order is accepted');
reset role;
select is((select count(*)::text from public.audit_log), current_setting('test.audit_count'),
  'a no-op archive and a no-op reorder write no audit row');
set local role authenticated;
select throws_ok($$ select public.reorder_professionals_reference('motif_categories',
                     array[current_setting('test.c1')::uuid, current_setting('test.b_trauma')::uuid]) $$,
  '22023', 'Éléments inconnus.', 'an id of org B is refused');
select throws_ok($$ select public.reorder_professionals_reference('motif_categories',
                     array[current_setting('test.c1'), current_setting('test.c1')]::uuid[]) $$,
  '22023', null, 'a repeated id is refused');
select throws_ok($$ select public.reorder_professionals_reference('nope', array[current_setting('test.c1')]::uuid[]) $$,
  '22023', null, 'an unknown kind is refused');
select lives_ok($$ select public.reorder_professionals_reference('deactivation_reasons',
                    array(select r.id from public.deactivation_reasons r order by r.name desc)) $$,
  'admin A reorders every deactivation reason');
select results_eq($$ select r.key from public.deactivation_reasons r order by r.sort_order $$,
  $$ select r.key from public.deactivation_reasons r order by r.name desc $$,
  'the reasons follow the new order');

-- =============================================================================
-- Catalogue (one payload, every list including archived rows, no org_id)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.catalog', public.get_professionals_catalog()::text, true);
select results_eq($$ select k from jsonb_object_keys(current_setting('test.catalog')::jsonb) k order by k $$,
  array['categories', 'clienteles', 'deactivation_reasons', 'languages', 'motif_categories', 'motifs', 'orders', 'titles'],
  'the catalogue holds the 8 lists');
select results_eq($$ select (select count(*)::int from jsonb_array_elements(current_setting('test.catalog')::jsonb -> 'motifs')),
                            (select count(*)::int from public.motifs) $$,
  $$ values (127, 127) $$, 'the conseillère gets every motif of org A (124 + 3 created), as RLS shows them');
select results_eq($$ select k from jsonb_object_keys((current_setting('test.catalog')::jsonb -> 'motifs') -> 0) k order by k $$,
  array['category_id', 'id', 'is_active', 'is_restricted', 'is_system', 'key', 'name', 'sort_order'],
  'a motif entry carries its id, key, name, category, flags and order');
select ok((select bool_and(jsonb_array_length(v) > 0) from jsonb_each(current_setting('test.catalog')::jsonb) e(k, v)),
  'every list is filled');
select is((select (e ->> 'is_active')::boolean from jsonb_array_elements(current_setting('test.catalog')::jsonb -> 'titles') e
            where e ->> 'id' = current_setting('test.title')), false,
  'archived rows are in the catalogue, flagged is_active false');
select ok(current_setting('test.catalog') !~ '"(org_id|created_at|updated_at)"', 'no org_id, created_at or updated_at anywhere');
select results_eq($$ select e ->> 'key' from jsonb_array_elements(current_setting('test.catalog')::jsonb -> 'motif_categories') e limit 3 $$,
  array['dependances', 'sante_mentale', 'personnalite'], 'lists come in their sort order');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_professionals_catalog() -> 'clienteles'), 9, 'the provider reads the catalogue (professionals.self)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.get_professionals_catalog(),
  '{"orders": [], "categories": [], "titles": [], "clienteles": [], "motif_categories": [], "motifs": [], "languages": [], "deactivation_reasons": []}'::jsonb,
  'K, without a professionals key, gets 8 empty lists');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.get_professionals_catalog(),
  '{"orders": [], "categories": [], "titles": [], "clienteles": [], "motif_categories": [], "motifs": [], "languages": [], "deactivation_reasons": []}'::jsonb,
  'a disabled admin gets 8 empty lists');

-- Published views (conseillère A)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs_catalog), 127, 'motifs_catalog lists the active motifs of org A');
select results_eq($$ select c.category_key, c.category_name, c.category_icon from public.motifs_catalog c
                     join public.motifs m on m.id = c.id where m.key = 'anxiete' $$,
  $$ values ('sante_mentale'::text, 'Santé mentale / Troubles psychologiques'::text, 'Brain'::text) $$, 'motifs_catalog carries the category');
select results_eq($$ select c.key, c.min_age::int, c.max_age::int from public.clienteles_catalog c where c.key in ('children', 'adults', 'athletes') order by c.sort_order $$,
  $$ values ('children'::text, 0, 11), ('adults', 18, null) $$, 'clienteles_catalog lists active clientèles with their bounds');
select results_eq($$ select l.code from public.languages_catalog l order by l.sort_order $$,
  array['fr', 'en', 'es', 'ca', 'de'], 'languages_catalog lists the active languages in order');

-- =============================================================================
-- Module settings
-- =============================================================================
select is(public.get_professionals_settings(), '{"collect_sin": false, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3, "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb, 'collect_sin is off by default (P4-7)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('app.audit_source', 'test:outer', true);
select is(public.set_professionals_settings('{"collect_sin": true}'), '{"collect_sin": true, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3, "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb,
  'admin A turns SIN collection on and gets the effective settings');
select is(current_setting('app.audit_source', true), 'test:outer', 'set_professionals_settings gives the audit source back');
select set_config('app.audit_source', '', true);
select is(public.get_professionals_settings(), '{"collect_sin": true, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3, "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb, 'the setting is stored');
select throws_ok($$ select public.set_professionals_settings('{"unknown": 1}') $$,
  '22023', 'Réglage inconnu : unknown', 'an unknown key is refused');
select throws_ok($$ select public.set_professionals_settings('{"collect_sin": "yes"}') $$,
  '22023', 'Réglage collect_sin invalide : true ou false attendu.', 'a value of the wrong type is refused');
select throws_ok($$ select public.set_professionals_settings('{"collect_sin": null}') $$,
  '22023', 'Réglage collect_sin invalide : true ou false attendu.', 'collect_sin cannot be null');
select throws_ok($$ select public.set_professionals_settings('{"collect_sin": false, "unknown": 1}') $$,
  '22023', 'Réglage inconnu : unknown', 'one bad key refuses the whole patch');
select throws_ok($$ select public.set_professionals_settings('[]') $$, '22023', null, 'a patch is a JSON object');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$ select public.set_professionals_settings('{"collect_sin": false}') $$,
  '42501', null, 'S holds professionals.settings but not professionals.private: collect_sin is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.get_professionals_settings() $$,
  '42501', 'Accès refusé aux réglages des professionnels.', 'K, without a professionals key, cannot read the settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.get_professionals_settings(), '{"collect_sin": false, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3, "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb, 'org B keeps its own default');

-- =============================================================================
-- Permissions: only professionals.settings writes the lists
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.save_motif(null, 'Motif de l''adjointe', null, false) $$, '42501', null, 'the adjointe cannot save a motif');
select throws_ok($$ select public.set_professionals_reference_active('motifs', current_setting('test.motif')::uuid, false) $$,
  '42501', null, 'the adjointe cannot archive');
select throws_ok($$ select public.reorder_professionals_reference('motif_categories', array[current_setting('test.c1')]::uuid[]) $$,
  '42501', null, 'the adjointe cannot reorder');
select throws_ok($$ select public.set_professionals_settings('{}') $$, '42501', null, 'the adjointe cannot change the module settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.save_motif(null, 'Motif de la conseillère', null, false) $$, '42501', null, 'the conseillère cannot save a motif');
select throws_ok($$ select public.save_language(null, 'Italien', 'it') $$, '42501', null, 'the conseillère cannot save a language');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok($$ select public.save_motif_category(null, 'Pleine conscience', null, null) $$, 'S saves a motif category through the professionals.settings override');

-- =============================================================================
-- Per-list cap (admin B): a list holds at most 500 rows, archived ones included
-- =============================================================================
reset role;
insert into public.clienteles (org_id, key, name, is_active)
select 'b0000000-0000-0000-0000-00000000000b', 'bulk_' || g, 'Clientèle ' || g, g % 2 = 0 from generate_series(1, 492) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.save_clientele(null, 'Une de trop', null, null) $$,
  'P0001', 'Cette liste compte déjà 500 éléments (archivés compris).', 'a list never exceeds 500 rows, so the catalogue stays bounded');
select lives_ok($$ select public.save_clientele((select c.id from public.clienteles c where c.key = 'bulk_1'), 'Clientèle un', null, null) $$,
  'a full list still accepts renames');

-- Org isolation of the catalogue: admin B gets exactly org B's rows (compared as postgres).
select set_config('test.catalog_b', public.get_professionals_catalog()::text, true);
reset role;
select bag_eq($$ select (e ->> 'id')::uuid from jsonb_each(current_setting('test.catalog_b')::jsonb) l(k, v), jsonb_array_elements(l.v) e $$,
  $$ select id from public.professional_orders where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.profession_categories where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.clienteles where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.motif_categories where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.languages where org_id = 'b0000000-0000-0000-0000-00000000000b'
     union all select id from public.deactivation_reasons where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  'admin B''s catalogue holds exactly the rows of org B');
set local role authenticated;

-- Module gate: with the module off, the catalogue is empty and the settings closed.
select lives_ok($$ select public.set_module_enabled('professionals', false) $$, 'admin B disables professionals');
select is(jsonb_array_length(public.get_professionals_catalog() -> 'motifs'), 0, 'with the module off, the catalogue is empty');
select throws_ok($$ select public.save_clientele(null, 'Après désactivation', null, null) $$, '42501', null, 'with the module off, nothing is saved');

-- =============================================================================
-- Audit (as postgres)
-- =============================================================================
reset role;
select is((select a.changed_fields -> 'name' from public.audit_log a
            where a.table_name = 'motifs' and a.record_id = current_setting('test.motif') and a.action = 'update'
            order by a.id limit 1),
  '{"before": "Soutien scolaire", "after": "Soutien scolaire et devoirs"}'::jsonb,
  'a rename writes an update row with the name before and after');
select results_eq($$ select a.action, a.source, a.actor_id, a.changed_fields -> 'settings' from public.audit_log a
                     where a.table_name = 'org_module_settings' and a.record_id = 'b0000000-0000-0000-0000-00000000000a:professionals' $$,
  $$ values ('insert'::text, 'rpc:set_professionals_settings'::text, 'a0000000-0000-0000-0000-000000000001'::uuid, '{"collect_sin": true}'::jsonb) $$,
  'set_professionals_settings writes one audit row, with its source and actor');
select is(private.professionals_setting('b0000000-0000-0000-0000-00000000000a', 'collect_sin'), 'true'::jsonb,
  'professionals_setting reads the stored value');
select is(private.professionals_setting('b0000000-0000-0000-0000-00000000000b', 'collect_sin'), 'false'::jsonb,
  'professionals_setting falls back to the default');
select lives_ok($$ select private.validate_professionals_setting(d.key, d.value) from jsonb_each(private.professionals_settings_defaults()) d $$,
  'every default passes its own rule (defaults and validator in step)');

select * from finish();
rollback;
