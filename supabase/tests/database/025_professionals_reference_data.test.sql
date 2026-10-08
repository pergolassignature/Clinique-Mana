-- Professionnels reference data (migration *_professionals_reference_data.sql, plan Phase 4 Task 4a.1).
-- Covers: the 7 new professionals permissions and their role defaults (template and a new org's
-- copy), their effect per role; the 9 per-clinic lists (privileges, seeding of new orgs with the
-- legacy-v1 lists, D7 rows left out, idempotent reseeding, audit source); read access by role,
-- org isolation and the module gate; key, name, icon and age checks, case-insensitive unique
-- names and the composite (org_id, id) foreign keys.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a conseillère; org B
-- with an admin. Both orgs are created after the migration, so the seeding trigger runs, with a
-- known audit source set first (the seed must restore it).
-- =============================================================================
select set_config('app.audit_source', 'test:fixtures', true);

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

select is(current_setting('app.audit_source', true), 'test:fixtures',
  'seeding a new org restores the audit source it found');

insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

-- =============================================================================
-- Permissions and role defaults
-- =============================================================================
select results_eq($$
  select key, module_key from public.permissions
   where key in ('professionals.manage', 'professionals.matching', 'professionals.activate_override',
                 'professionals.settings', 'professionals.compensation', 'professionals.private',
                 'professionals.self')
   order by key
$$, $$ values ('professionals.activate_override'::text, 'professionals'::text),
              ('professionals.compensation', 'professionals'), ('professionals.manage', 'professionals'),
              ('professionals.matching', 'professionals'), ('professionals.private', 'professionals'),
              ('professionals.self', 'professionals'), ('professionals.settings', 'professionals') $$,
  'the 7 new keys belong to the professionals module');

select results_eq($$ select permission_key from public.role_permissions
                      where role = 'admin' and permission_key like 'professionals.%' order by 1 $$,
  array['professionals.activate_override', 'professionals.compensation', 'professionals.manage', 'professionals.matching',
        'professionals.private', 'professionals.self', 'professionals.settings', 'professionals.view'],
  'template: admin holds every professionals permission');
select results_eq($$ select permission_key from public.role_permissions
                      where role = 'admin_assistant' and permission_key like 'professionals.%' order by 1 $$,
  array['professionals.manage', 'professionals.matching', 'professionals.view'],
  'template: the adjointe manages records and matching');
select results_eq($$ select permission_key from public.role_permissions
                      where role = 'counselor' and permission_key like 'professionals.%' order by 1 $$,
  array['professionals.matching', 'professionals.view'],
  'template: the conseillère edits matching data (P4-10)');
select results_eq($$ select permission_key from public.role_permissions
                      where role = 'provider' and permission_key like 'professionals.%' order by 1 $$,
  array['professionals.self'],
  'template: the provider reaches only their own record');
select set_eq($$ select role, permission_key from public.org_role_permissions
                  where org_id = 'b0000000-0000-0000-0000-00000000000a' and permission_key like 'professionals.%' $$,
  $$ select role, permission_key from public.role_permissions where permission_key like 'professionals.%' $$,
  'a new org starts with the template''s professionals defaults');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(private.has_permission('professionals.matching'), 'the conseillère holds professionals.matching');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.has_permission('professionals.matching'), 'the provider does not hold professionals.matching');
select ok(private.has_permission('professionals.self'), 'the provider holds professionals.self');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(not private.has_permission('professionals.settings'), 'the adjointe does not hold professionals.settings');
reset role;

-- =============================================================================
-- Tables and privileges
-- =============================================================================
select has_table('public', 'professional_orders',   'professional_orders exists');
select has_table('public', 'profession_categories', 'profession_categories exists');
select has_table('public', 'profession_titles',     'profession_titles exists');
select has_table('public', 'clienteles',            'clienteles exists');
select has_table('public', 'specialties',           'specialties exists');
select has_table('public', 'motif_categories',      'motif_categories exists');
select has_table('public', 'motifs',                'motifs exists');
select has_table('public', 'languages',             'languages exists');
select has_table('public', 'deactivation_reasons',  'deactivation_reasons exists');

select table_privs_are('public', 'professional_orders',   'anon', array[]::text[], 'anon: nothing on professional_orders');
select table_privs_are('public', 'profession_categories', 'anon', array[]::text[], 'anon: nothing on profession_categories');
select table_privs_are('public', 'profession_titles',     'anon', array[]::text[], 'anon: nothing on profession_titles');
select table_privs_are('public', 'clienteles',            'anon', array[]::text[], 'anon: nothing on clienteles');
select table_privs_are('public', 'specialties',           'anon', array[]::text[], 'anon: nothing on specialties');
select table_privs_are('public', 'motif_categories',      'anon', array[]::text[], 'anon: nothing on motif_categories');
select table_privs_are('public', 'motifs',                'anon', array[]::text[], 'anon: nothing on motifs');
select table_privs_are('public', 'languages',             'anon', array[]::text[], 'anon: nothing on languages');
select table_privs_are('public', 'deactivation_reasons',  'anon', array[]::text[], 'anon: nothing on deactivation_reasons');
select table_privs_are('public', 'professional_orders',   'authenticated', array['SELECT'], 'authenticated: select only on professional_orders');
select table_privs_are('public', 'profession_categories', 'authenticated', array['SELECT'], 'authenticated: select only on profession_categories');
select table_privs_are('public', 'profession_titles',     'authenticated', array['SELECT'], 'authenticated: select only on profession_titles');
select table_privs_are('public', 'clienteles',            'authenticated', array['SELECT'], 'authenticated: select only on clienteles');
select table_privs_are('public', 'specialties',           'authenticated', array['SELECT'], 'authenticated: select only on specialties');
select table_privs_are('public', 'motif_categories',      'authenticated', array['SELECT'], 'authenticated: select only on motif_categories');
select table_privs_are('public', 'motifs',                'authenticated', array['SELECT'], 'authenticated: select only on motifs');
select table_privs_are('public', 'languages',             'authenticated', array['SELECT'], 'authenticated: select only on languages');
select table_privs_are('public', 'deactivation_reasons',  'authenticated', array['SELECT'], 'authenticated: select only on deactivation_reasons');

select function_privs_are('private', 'can_read_professionals_reference', array[]::text[], 'authenticated', array['EXECUTE'],
  'policies may call can_read_professionals_reference as authenticated');
select function_privs_are('private', 'seed_professionals_reference', array['uuid'], 'authenticated', array[]::text[],
  'clients cannot seed the lists');
select function_privs_are('private', 'seed_professionals_reference', array['uuid'], 'service_role', array[]::text[],
  'service_role cannot seed the lists');
select function_privs_are('private', 'seed_professionals_reference_on_org', array[]::text[], 'authenticated', array[]::text[],
  'clients cannot execute the seeding trigger function');

-- =============================================================================
-- Seeding (orgs A and B, created after the migration)
-- =============================================================================
select results_eq($$
  select c.name, c.n from (values
      ('professional_orders',   (select count(*) from public.professional_orders   x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('profession_categories', (select count(*) from public.profession_categories x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('profession_titles',     (select count(*) from public.profession_titles     x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('clienteles',            (select count(*) from public.clienteles            x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('specialties',           (select count(*) from public.specialties           x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('motif_categories',      (select count(*) from public.motif_categories      x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('motifs',                (select count(*) from public.motifs                x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('languages',             (select count(*) from public.languages             x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('deactivation_reasons',  (select count(*) from public.deactivation_reasons  x where x.org_id = 'b0000000-0000-0000-0000-00000000000a'))
    ) as c(name, n)
$$, $$ values ('professional_orders'::text, 6::bigint), ('profession_categories', 9), ('profession_titles', 9),
              ('clienteles', 7), ('specialties', 10), ('motif_categories', 8), ('motifs', 72),
              ('languages', 3), ('deactivation_reasons', 4) $$,
  'org A is seeded: 6 orders, 9 categories, 9 titles, 7 clientèles, 10 approaches, 8 motif categories, 72 motifs, 3 languages, 4 reasons');
select is((select (select count(*) from public.professional_orders   x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.profession_categories x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.profession_titles     x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.clienteles            x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.specialties           x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.motif_categories      x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.motifs                x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.languages             x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.deactivation_reasons  x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')),
  128::bigint, 'org B is seeded with its own 128 rows');

select results_eq($$
  select o.key, o.acronym, o.licence_label from public.professional_orders o
   where o.org_id = 'b0000000-0000-0000-0000-00000000000a' order by o.sort_order
$$, $$ values ('opq'::text, 'OPQ'::text, 'N° de permis'::text), ('otstcfq', 'OTSTCFQ', 'N° de permis'),
              ('oppq', 'OPPQ', 'N° de permis'), ('opsq', 'OPSQ', 'N° de permis'), ('occoq', 'OCCOQ', 'N° de permis'),
              ('odnq', 'ODNQ', 'N° de permis') $$,
  'the 6 orders, with acronyms and the default licence label');
select results_eq($$
  select t.key, c.key, o.key from public.profession_titles t
    join public.profession_categories c on c.id = t.category_id
    left join public.professional_orders o on o.id = t.order_id
   where t.org_id = 'b0000000-0000-0000-0000-00000000000a' order by t.sort_order
$$, $$ values ('psychologue'::text, 'psychologie'::text, 'opq'::text), ('psychotherapeute', 'psychotherapie', 'opq'),
              ('travailleur_social', 'travail_social', 'otstcfq'), ('psychoeducateur', 'psychoeducation', 'oppq'),
              ('sexologue', 'sexologie', 'opsq'), ('naturopathe', 'naturopathie', null),
              ('conseiller_orientation', 'orientation', 'occoq'), ('coach_professionnel', 'coaching_professionnel', null),
              ('nutritionniste', 'nutrition', 'odnq') $$,
  'titles: psychologue → OPQ, naturopathe and coach without an order, nutritionniste → ODNQ / nutrition (P4-6)');
select results_eq($$
  select c.key, c.min_age::int, c.max_age::int, c.is_system from public.clienteles c
   where c.org_id = 'b0000000-0000-0000-0000-00000000000a' order by c.sort_order
$$, $$ values ('children'::text, 0, 12, true), ('adolescents', 13, 17, true), ('adults', 18, 64, true),
              ('seniors', 65, null, true), ('couples', null, null, true), ('families', null, null, true),
              ('groups', null, null, true) $$,
  'clientèles: age bounds, all 7 is_system (P4-42)');
select results_eq($$
  select s.key from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' order by s.sort_order
$$, array['cbt', 'psychodynamic', 'humanistic', 'systemic', 'gestalt', 'emdr', 'act', 'dbt', 'art_therapy', 'play_therapy'],
  'approaches: the 10 legacy therapy_type keys, in their order');
select results_eq($$
  select l.code, l.name, l.is_system from public.languages l
   where l.org_id = 'b0000000-0000-0000-0000-00000000000a' order by l.sort_order
$$, $$ values ('fr'::text, 'Français'::text, true), ('en', 'Anglais', false), ('es', 'Espagnol', false) $$,
  'languages: French is_system, English and Spanish editable');
select results_eq($$
  select r.key, r.requires_note, r.disables_account, r.is_system from public.deactivation_reasons r
   where r.org_id = 'b0000000-0000-0000-0000-00000000000a' order by r.sort_order
$$, $$ values ('leave'::text, false, false, false), ('collaboration_ended', false, true, false),
              ('insurance_expired', false, false, false), ('other', true, false, true) $$,
  'reasons: collaboration_ended disables the account, other needs a note and is_system');
select results_eq($$
  select c.key, c.name, c.icon from public.motif_categories c
   where c.org_id = 'b0000000-0000-0000-0000-00000000000a' order by c.sort_order
$$, $$ values ('inner_life'::text, 'Vie intérieure'::text, 'Brain'::text), ('relationships', 'Relations et famille', 'Users'),
              ('dependencies', 'Dépendances', 'AlertTriangle'), ('work', 'Vie professionnelle', 'Briefcase'),
              ('development', 'Développement', 'GraduationCap'), ('identity', 'Identité', 'Fingerprint'),
              ('trauma', 'Trauma', 'Shield'), ('life_changes', 'Changements de vie', 'Leaf') $$,
  'the 8 legacy motif categories, in order, with their icons');
select results_eq($$
  select c.key, count(m.id)::int from public.motif_categories c
    left join public.motifs m on m.category_id = c.id
   where c.org_id = 'b0000000-0000-0000-0000-00000000000a'
   group by c.key, c.sort_order order by c.sort_order
$$, $$ values ('inner_life'::text, 16), ('relationships', 13), ('dependencies', 10), ('work', 5),
              ('development', 13), ('identity', 6), ('trauma', 7), ('life_changes', 2) $$,
  'motifs per category match the legacy assignments');
select is((select c.key from public.motifs m join public.motif_categories c on c.id = m.category_id
            where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'anxiete'),
  'inner_life', 'anxiete is in inner_life');
select is((select count(*)::int from public.motifs m
            where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.category_id is null),
  0, 'every legacy motif has a category (legacy assigned all 72)');
select is_empty($$
  select x.key from (
    select s.key from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000a'
    union all select c.key from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000a'
    union all select p.key from public.profession_categories p where p.org_id = 'b0000000-0000-0000-0000-00000000000a'
  ) x where x.key in ('issue', 'modality', 'lgbtq', 'indigenous', 'newcomers')
$$, 'legacy-archived rows are not re-seeded (D7)');

-- =============================================================================
-- Idempotence and audit (as postgres)
-- =============================================================================
select lives_ok($$ select private.seed_professionals_reference('b0000000-0000-0000-0000-00000000000a') $$, 'reseeding org A runs');
select lives_ok($$ select private.seed_professionals_reference('b0000000-0000-0000-0000-00000000000a') $$, 'reseeding org A twice runs');
select is((select (select count(*) from public.professional_orders   x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.profession_categories x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.profession_titles     x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.clienteles            x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.specialties           x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.motif_categories      x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.motifs                x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.languages             x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.deactivation_reasons  x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
  128::bigint, 'reseeding adds no row');

select is((select count(*)::int from public.audit_log a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.table_name = 'motifs'
              and a.action = 'insert' and a.source = 'seed:professionals_reference'),
  72, 'each seeded motif of org A has an insert audit row from the seed');
select is((select count(*)::int from public.audit_log a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a'
              and a.table_name in ('professional_orders', 'profession_categories', 'profession_titles', 'clienteles',
                                   'specialties', 'motif_categories', 'motifs', 'languages', 'deactivation_reasons')),
  128, 'the seed writes one audit row per row of org A, and reseeding none');
select is((select count(*)::int from public.audit_log a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.table_name = 'organizations'
              and a.source = 'test:fixtures'),
  1, 'the org insert itself keeps the caller''s audit source');

-- =============================================================================
-- Integrity (as postgres)
-- =============================================================================
select throws_ok($$
  insert into public.profession_titles (org_id, key, name, category_id)
  select 'b0000000-0000-0000-0000-00000000000a', 'cross_org', 'Titre croisé', c.id
    from public.profession_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000b' and c.key = 'psychologie'
$$, '23503', null, 'a title cannot point at another clinic''s category (composite FK, P4-40)');
select throws_ok($$
  insert into public.motifs (org_id, key, name, category_id)
  select 'b0000000-0000-0000-0000-00000000000a', 'cross_org', 'Motif croisé', c.id
    from public.motif_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000b' and c.key = 'trauma'
$$, '23503', null, 'a motif cannot point at another clinic''s category (composite FK, P4-40)');
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'Bad Key', 'Clé invalide') $$,
  '23514', null, 'keys are ASCII snake_case');
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'untrimmed', ' Espaces') $$,
  '23514', null, 'names are trimmed');
select throws_ok($$ insert into public.motif_categories (org_id, key, name, icon) values ('b0000000-0000-0000-0000-00000000000a', 'skull', 'Crâne', 'Skull') $$,
  '23514', null, 'category icons come from the 20-icon set');
select throws_ok($$ insert into public.clienteles (org_id, key, name, min_age, max_age) values ('b0000000-0000-0000-0000-00000000000a', 'bad_range', 'Mauvais intervalle', 13, 12) $$,
  '23514', null, 'a clientèle''s max age is not below its min age');
select throws_ok($$ insert into public.clienteles (org_id, key, name, max_age) values ('b0000000-0000-0000-0000-00000000000a', 'no_min', 'Sans minimum', 30) $$,
  '23514', null, 'a clientèle with a max age has a min age');
select throws_ok($$ insert into public.languages (org_id, code, name) values ('b0000000-0000-0000-0000-00000000000a', 'FRA', 'Français (bis)') $$,
  '23514', null, 'language codes are two lower-case letters (ISO 639-1)');
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'anxiete_bis', 'ANXIÉTÉ') $$,
  '23505', null, 'motif names are unique per clinic, ignoring case');

-- =============================================================================
-- Read access (RLS): staff and providers of the org, module gate
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs), 72, 'admin A reads the 72 motifs of org A');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs), 72, 'the conseillère reads the 72 motifs of org A');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs), 72, 'the provider reads the 72 motifs of org A (professionals.self)');
select results_eq($$
  select (select count(*) from public.professional_orders)::int, (select count(*) from public.profession_categories)::int,
         (select count(*) from public.profession_titles)::int, (select count(*) from public.clienteles)::int,
         (select count(*) from public.specialties)::int, (select count(*) from public.motif_categories)::int,
         (select count(*) from public.languages)::int, (select count(*) from public.deactivation_reasons)::int
$$, $$ values (6, 9, 9, 7, 10, 8, 3, 4) $$, 'the provider reads every list of org A');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq($$ select org_id, count(*)::int from public.motifs group by org_id $$,
  $$ values ('b0000000-0000-0000-0000-00000000000b'::uuid, 72) $$, 'admin B reads only org B''s motifs');
select lives_ok($$ select public.set_module_enabled('professionals', false) $$, 'admin B disables professionals');
select is((select count(*)::int from public.motifs), 0, 'with the module off, admin B reads no motif (module gate)');

select * from finish();
rollback;
