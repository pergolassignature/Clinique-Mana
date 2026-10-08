-- Professionnels reference data (migration *_professionals_reference_data.sql, plan Phase 4 Task 4a.1).
-- Covers: the 7 new professionals permissions and their role defaults (template and a new org's
-- copy), their effect per role; the 8 per-clinic lists (privileges, seeding of new orgs with the
-- website catalogue of P4-241–P4-244, no approaches (P4-240), D7 rows left out, idempotent
-- reseeding, audit source,
-- reseeding onto a row that holds a seeded name under another key); read access by role and by
-- any professionals key, org isolation, disabled users and the module gate; key, name, icon and
-- age checks, tidy labels, NFKC unique names, frozen keys and the composite (org_id, id) foreign
-- keys.
begin;
create extension if not exists pgtap with schema extensions;
select plan(102);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider, a conseillère, K and S in
-- a custom role without any professionals key (S holds professionals.settings by override) and a
-- disabled admin; org B with an admin. Both orgs are created after the migration, so the seeding trigger runs, with a
-- known audit source set first (the seed must restore it).
-- =============================================================================
select set_config('app.audit_source', 'test:fixtures', true);

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

select is(current_setting('app.audit_source', true), 'test:fixtures',
  'seeding a new org restores the audit source it found');

insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',         'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',      'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',      'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A',   'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',         'admin@b.test',       'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'K (sans clé)',    'k@a.test',           'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'S (settings)',    's@a.test',           'active'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'Admin désactivé', 'x@a.test',           'disabled');
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
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'custom_0000000a'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'professionals.settings', true);

-- The eight lists' row counts as the caller sees them (RLS), in one row.
select set_config('test.list_counts', $q$
  select (select count(*) from public.professional_orders)::int, (select count(*) from public.profession_categories)::int,
         (select count(*) from public.profession_titles)::int, (select count(*) from public.clienteles)::int,
         (select count(*) from public.motif_categories)::int,
         (select count(*) from public.motifs)::int, (select count(*) from public.languages)::int,
         (select count(*) from public.deactivation_reasons)::int
$q$, true);

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
  array['professionals.activate_override', 'professionals.compensation', 'professionals.invite', 'professionals.manage',
        'professionals.matching', 'professionals.private', 'professionals.review', 'professionals.self', 'professionals.settings',
        'professionals.view'],
  'template: admin holds every professionals permission (4b.1 adds invite and review)');
select results_eq($$ select permission_key from public.role_permissions
                      where role = 'admin_assistant' and permission_key like 'professionals.%' order by 1 $$,
  array['professionals.invite', 'professionals.manage', 'professionals.matching', 'professionals.review', 'professionals.view'],
  'template: the adjointe manages records and matching (4b.1: invites and reviews too)');
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
select hasnt_table('public', 'specialties',         'there is no approaches table (P4-240)');
select has_table('public', 'motif_categories',      'motif_categories exists');
select has_table('public', 'motifs',                'motifs exists');
select has_table('public', 'languages',             'languages exists');
select has_table('public', 'deactivation_reasons',  'deactivation_reasons exists');

select table_privs_are('public', 'professional_orders',   'anon', array[]::text[], 'anon: nothing on professional_orders');
select table_privs_are('public', 'profession_categories', 'anon', array[]::text[], 'anon: nothing on profession_categories');
select table_privs_are('public', 'profession_titles',     'anon', array[]::text[], 'anon: nothing on profession_titles');
select table_privs_are('public', 'clienteles',            'anon', array[]::text[], 'anon: nothing on clienteles');
select table_privs_are('public', 'motif_categories',      'anon', array[]::text[], 'anon: nothing on motif_categories');
select table_privs_are('public', 'motifs',                'anon', array[]::text[], 'anon: nothing on motifs');
select table_privs_are('public', 'languages',             'anon', array[]::text[], 'anon: nothing on languages');
select table_privs_are('public', 'deactivation_reasons',  'anon', array[]::text[], 'anon: nothing on deactivation_reasons');
select table_privs_are('public', 'professional_orders',   'authenticated', array['SELECT'], 'authenticated: select only on professional_orders');
select table_privs_are('public', 'profession_categories', 'authenticated', array['SELECT'], 'authenticated: select only on profession_categories');
select table_privs_are('public', 'profession_titles',     'authenticated', array['SELECT'], 'authenticated: select only on profession_titles');
select table_privs_are('public', 'clienteles',            'authenticated', array['SELECT'], 'authenticated: select only on clienteles');
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
select function_privs_are('private', 'freeze_reference_identity', array[]::text[], 'authenticated', array[]::text[],
  'clients cannot execute the key-freeze trigger function');

-- =============================================================================
-- Seeding (orgs A and B, created after the migration)
-- =============================================================================
select results_eq($$
  select c.name, c.n from (values
      ('professional_orders',   (select count(*) from public.professional_orders   x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('profession_categories', (select count(*) from public.profession_categories x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('profession_titles',     (select count(*) from public.profession_titles     x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('clienteles',            (select count(*) from public.clienteles            x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('motif_categories',      (select count(*) from public.motif_categories      x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('motifs',                (select count(*) from public.motifs                x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('languages',             (select count(*) from public.languages             x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
      ('deactivation_reasons',  (select count(*) from public.deactivation_reasons  x where x.org_id = 'b0000000-0000-0000-0000-00000000000a'))
    ) as c(name, n)
$$, $$ values ('professional_orders'::text, 6::bigint), ('profession_categories', 9), ('profession_titles', 9),
              ('clienteles', 8), ('motif_categories', 13), ('motifs', 124),
              ('languages', 4), ('deactivation_reasons', 4) $$,
  'org A is seeded: 6 orders, 9 categories, 9 titles, 8 clientèles, 13 motif categories, 124 motifs, 4 languages, 4 reasons');
select is((select (select count(*) from public.professional_orders   x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.profession_categories x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.profession_titles     x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.clienteles            x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.motif_categories      x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.motifs                x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.languages             x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')
                + (select count(*) from public.deactivation_reasons  x where x.org_id = 'b0000000-0000-0000-0000-00000000000b')),
  177::bigint, 'org B is seeded with its own 177 rows');

select results_eq($$
  select o.key, o.acronym, o.licence_label, o.licence_pattern from public.professional_orders o
   where o.org_id = 'b0000000-0000-0000-0000-00000000000a' order by o.sort_order
$$, $$ values ('opq'::text, 'OPQ'::text, 'N° de permis'::text, null::text), ('otstcfq', 'OTSTCFQ', 'N° de permis', null),
              ('oppq', 'OPPQ', 'N° de permis', '^[0-9]{5}-[0-9]{2}$'), ('opsq', 'OPSQ', 'N° de permis', null),
              ('occoq', 'OCCOQ', 'N° de permis', null), ('odnq', 'ODNQ', 'N° de permis', null) $$,
  'the 6 orders, with acronyms, the default licence label and the OPPQ format (P4-248)');
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
$$, $$ values ('children'::text, 0, 12, true), ('adolescents', 13, 17, true), ('young_adults', 18, 25, false),
              ('adults', 18, null, true), ('couples', null, null, true), ('families', null, null, true),
              ('parents', null, null, false), ('athletes', null, null, false) $$,
  'clientèles: the website''s 8, in order; the 5 legacy keys is_system (P4-42), adults without an upper bound (P4-244)');
select results_eq($$
  select m.key, m.name from public.motifs m
   where m.org_id = 'b0000000-0000-0000-0000-00000000000a'
     and m.key in ('communication_couple', 'communication_famille', 'anxiete_de_performance', 'anxiete_performance_sexuelle',
                   'discipline_encadrement', 'vie_amoureuse_sexuelle_insatisfaisante', 'adaptation_a_l_ecole',
                   'trouble_obsessionnel_compulsif', 'transsexualite')
   order by m.sort_order
$$, $$ values
  ('trouble_obsessionnel_compulsif'::text, 'Trouble obsessionnel-compulsif (TOC)'::text),
  ('adaptation_a_l_ecole', 'Adaptation à l’école'),
  ('communication_couple', 'Communication (couple)'), ('communication_famille', 'Communication (famille)'),
  ('discipline_encadrement', 'Discipline / Encadrement'), ('anxiete_de_performance', 'Anxiété de performance'),
  ('anxiete_performance_sexuelle', 'Anxiété de performance sexuelle'),
  ('transsexualite', 'Transsexualité'), ('vie_amoureuse_sexuelle_insatisfaisante', 'Vie amoureuse / sexuelle insatisfaisante') $$,
  'the website''s wording (P4-243), the two labels under two headings told apart (P4-242), ’ and « / » tidied');
select results_eq($$
  select l.code, l.name, l.is_system from public.languages l
   where l.org_id = 'b0000000-0000-0000-0000-00000000000a' order by l.sort_order
$$, $$ values ('fr'::text, 'Français'::text, true), ('en', 'Anglais', false), ('es', 'Espagnol', false), ('ca', 'Catalan', false) $$,
  'languages: French is_system, English, Spanish and Catalan editable');
select results_eq($$
  select r.key, r.requires_note, r.disables_account, r.is_system from public.deactivation_reasons r
   where r.org_id = 'b0000000-0000-0000-0000-00000000000a' order by r.sort_order
$$, $$ values ('leave'::text, false, false, false), ('collaboration_ended', false, true, false),
              ('insurance_expired', false, false, false), ('other', true, false, true) $$,
  'reasons: collaboration_ended disables the account, other needs a note and is_system');
select results_eq($$
  select c.key, c.name, c.icon from public.motif_categories c
   where c.org_id = 'b0000000-0000-0000-0000-00000000000a' order by c.sort_order
$$, $$ values ('sante_mentale'::text, 'Santé mentale / Troubles psychologiques'::text, 'Brain'::text),
              ('personnalite', 'Personnalité et comportements', 'Compass'), ('dependances', 'Dépendances', 'AlertTriangle'),
              ('neurodiversite', 'Neurodiversité / apprentissages', 'Sparkles'), ('couple_relationnel', 'Couple et relationnel', 'Heart'),
              ('famille_parentalite', 'Famille et parentalité', 'Home'),
              ('gestion_ecrans', 'Gestion des écrans et de l’ère numérique', 'Zap'),
              ('travail_carriere', 'Travail, carrière et organisation', 'Briefcase'), ('ecole_scolarite', 'École, scolarité', 'GraduationCap'),
              ('violence_abus', 'Violence / abus / victimisation', 'Shield'), ('sante_physique', 'Santé physique et maladies', 'Activity'),
              ('sexualite_identite', 'Sexualité / identité / intimité', 'Fingerprint'), ('autres', 'Autres', 'Leaf') $$,
  'the website''s 13 motif headings, in its order, with our icons (P4-241)');
select results_eq($$
  select c.key, count(m.id)::int from public.motif_categories c
    left join public.motifs m on m.category_id = c.id
   where c.org_id = 'b0000000-0000-0000-0000-00000000000a'
   group by c.key, c.sort_order order by c.sort_order
$$, $$ values ('sante_mentale'::text, 19), ('personnalite', 7), ('dependances', 5), ('neurodiversite', 11),
              ('couple_relationnel', 8), ('famille_parentalite', 18), ('gestion_ecrans', 10), ('travail_carriere', 6),
              ('ecole_scolarite', 4), ('violence_abus', 8), ('sante_physique', 6), ('sexualite_identite', 12), ('autres', 10) $$,
  'motifs per category match the website');
select is((select c.key from public.motifs m join public.motif_categories c on c.id = m.category_id
            where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'anxiete'),
  'sante_mentale', 'anxiete is in sante_mentale');
select is((select count(*)::int from public.motifs m
            where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.category_id is null),
  0, 'every seeded motif has a category');
select is_empty($$
  select x.key from (
    select c.key from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000a'
    union all select p.key from public.profession_categories p where p.org_id = 'b0000000-0000-0000-0000-00000000000a'
  ) x where x.key in ('issue', 'modality', 'lgbtq', 'indigenous', 'newcomers')
$$, 'legacy-archived rows are not re-seeded (D7)');
select results_eq($$
  select string_agg(m.key, ',' order by m.sort_order) from public.motifs m
    join public.motif_categories c on c.id = m.category_id
   where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key in ('personnalite', 'ecole_scolarite')
   group by c.sort_order order by c.sort_order
$$, $$ values ('difficultes_comportement,difficultes_comportement_enfant,trouble_de_personnalite,trouble_personnalite_limite,trouble_personnalite_narcissique,trouble_conduites,trouble_oppositionnel_provocation'::text),
              ('anxiete_de_performance,demotivation,descolarisation,intimidation') $$,
  'motifs are in the website''s order within their heading (alphabetical, as every profile lists them)');
select is((select string_agg(m.key, ',' order by m.sort_order) from public.motifs m
            where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.is_restricted),
  null, 'no motif is restricted by default');
select is_empty($$
  select m.name from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a'
     and (m.name ~ '''' or m.name ~ E'\u202F' or (m.name ~ '[^ ]/|/[^ ]' and m.name !~ 'TDA/H'))
  union all
  select c.name from public.motif_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000a'
     and (c.name ~ '''' or c.name ~ '[^ ]/|/[^ ]')
$$, 'seeded labels use ’, no U+202F, and « / » with spaces (except the abbreviation TDA/H)');
select is((select count(*)::int from public.motif_categories c
            where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.description is not null),
  0, 'the website''s headings have no description');

-- =============================================================================
-- Idempotence and audit (as postgres)
-- =============================================================================
select lives_ok($$ select private.seed_professionals_reference('b0000000-0000-0000-0000-00000000000a') $$, 'reseeding org A runs');
select lives_ok($$ select private.seed_professionals_reference('b0000000-0000-0000-0000-00000000000a') $$, 'reseeding org A twice runs');
select is((select (select count(*) from public.professional_orders   x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.profession_categories x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.profession_titles     x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.clienteles            x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.motif_categories      x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.motifs                x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.languages             x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')
                + (select count(*) from public.deactivation_reasons  x where x.org_id = 'b0000000-0000-0000-0000-00000000000a')),
  177::bigint, 'reseeding adds no row');

select is((select count(*)::int from public.audit_log a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.table_name = 'motifs'
              and a.action = 'insert' and a.source = 'seed:professionals_reference'),
  124, 'each seeded motif of org A has an insert audit row from the seed');
select is((select count(*)::int from public.audit_log a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a'
              and a.table_name in ('professional_orders', 'profession_categories', 'profession_titles', 'clienteles',
                                   'motif_categories', 'motifs', 'languages', 'deactivation_reasons')),
  177, 'the seed writes one audit row per row of org A, and reseeding none');
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
    from public.motif_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000b' and c.key = 'violence_abus'
$$, '23503', null, 'a motif cannot point at another clinic''s category (composite FK, P4-40)');
select throws_ok($$
  insert into public.profession_titles (org_id, key, name, category_id, order_id)
  select 'b0000000-0000-0000-0000-00000000000a', 'cross_org', 'Titre croisé', c.id, o.id
    from public.profession_categories c, public.professional_orders o
   where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'psychologie'
     and o.org_id = 'b0000000-0000-0000-0000-00000000000b' and o.key = 'opq'
$$, '23503', null, 'a title cannot point at another clinic''s order (composite FK, P4-40)');
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

-- Look-alike names and untidy labels
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'anxiete_nfd', E'Anxie\u0301te\u0301') $$,
  '23505', null, 'a decomposed « Anxiété » (e + combining acute) collides with the seeded one (NFKC)');
select throws_ok($$ insert into public.clienteles (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'couples_wide', E'\uFF23\uFF2F\uFF35\uFF30\uFF2C\uFF25\uFF33') $$,
  '23505', null, 'a full-width « ＣＯＵＰＬＥＳ » collides with the seeded Couples (NFKC)');
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'nbsp_end', E'Soins palliatifs\u00A0') $$,
  '23514', null, 'a name ending with a no-break space is refused');
select throws_ok($$ insert into public.languages (org_id, code, name) values ('b0000000-0000-0000-0000-00000000000a', 'de', E'\u3000Allemand') $$,
  '23514', null, 'a name starting with an ideographic space is refused');
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'zwsp', E'Anxi\u200Bété') $$,
  '23514', null, 'a name holding a zero-width space is refused');
select throws_ok($$ insert into public.clienteles (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'ctrl', E'Jeunes\tadultes') $$,
  '23514', null, 'a name holding a control character is refused');
select lives_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'soins_palliatifs', E'Soins\u00A0palliatifs') $$,
  'a no-break space inside a name is allowed');
select throws_ok($$ insert into public.motifs (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'soins_palliatifs_2', 'soins palliatifs') $$,
  '23505', null, 'NFKC folds the inner no-break space: « soins palliatifs » is the same name');
select throws_ok($$ insert into public.motif_categories (org_id, key, name, description) values ('b0000000-0000-0000-0000-00000000000a', 'desc_untrimmed', 'Description', 'Un texte ') $$,
  '23514', null, 'a category description is trimmed');
select throws_ok($$ insert into public.professional_orders (org_id, key, name, acronym, licence_pattern) values ('b0000000-0000-0000-0000-00000000000a', 'pattern_untrimmed', 'Ordre test', 'OT', ' ^[0-9]{5}$') $$,
  '23514', null, 'a licence pattern is trimmed');
select throws_ok($$ insert into public.professional_orders (org_id, key, name, acronym, licence_label) values ('b0000000-0000-0000-0000-00000000000a', 'label_untrimmed', 'Ordre test', 'OT', E'N° de permis\n') $$,
  '23514', null, 'a licence label is trimmed');
delete from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'soins_palliatifs';

-- Frozen identity (key, code, org); everything else stays editable
select throws_ok($$ update public.motifs set key = 'anxiete_2' where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'anxiete' $$,
  '23514', null, 'a motif''s key never changes');
select throws_ok($$ update public.languages set code = 'de' where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 'es' $$,
  '23514', null, 'a language''s code never changes');
select throws_ok($$ update public.profession_categories set org_id = 'b0000000-0000-0000-0000-00000000000b'
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'naturopathie' $$,
  '23514', null, 'a row never moves to another clinic');
select lives_ok($$ update public.motifs set name = 'Sommeil et réveils', sort_order = 195
                    where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'troubles_du_sommeil_insomnie' $$,
  'a motif''s name and order still change');

-- Reseeding onto rows that hold a seeded name under another key: the seed adds no copy and attaches
-- its titles and motifs to them. Org A loses the « nutrition » category (and its title) and the
-- « ecole_scolarite » category (and its 4 motifs), then holds « NUTRITION » and « École, Scolarité »
-- under other keys.
delete from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'nutritionniste';
delete from public.profession_categories where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'nutrition';
delete from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a'
   and key in ('anxiete_de_performance', 'demotivation', 'descolarisation', 'intimidation');
delete from public.motif_categories where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'ecole_scolarite';
insert into public.profession_categories (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'nutrition_clinique', 'NUTRITION');
insert into public.motif_categories (org_id, key, name) values ('b0000000-0000-0000-0000-00000000000a', 'scolarite', 'École, Scolarité');
select lives_ok($$ select private.seed_professionals_reference('b0000000-0000-0000-0000-00000000000a') $$,
  'reseeding org A with seeded names held under other keys runs');
select results_eq($$
  select 'title'::text, t.key, c.key from public.profession_titles t join public.profession_categories c on c.id = t.category_id
   where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'nutritionniste'
  union all
  select 'motif', m.key, c.key from public.motifs m join public.motif_categories c on c.id = m.category_id
   where m.org_id = 'b0000000-0000-0000-0000-00000000000a'
     and m.key in ('anxiete_de_performance', 'demotivation', 'descolarisation', 'intimidation')
  order by 1 desc, 2
$$, $$ values ('title'::text, 'nutritionniste'::text, 'nutrition_clinique'::text),
              ('motif', 'anxiete_de_performance', 'scolarite'), ('motif', 'demotivation', 'scolarite'),
              ('motif', 'descolarisation', 'scolarite'), ('motif', 'intimidation', 'scolarite') $$,
  'the re-added title and motifs attach to the rows holding the seeded names');
select is_empty($$
  select c.key from public.profession_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'nutrition'
  union all
  select c.key from public.motif_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'ecole_scolarite'
$$, 'no copy of a category whose name is taken is added');

-- =============================================================================
-- Read access (RLS): staff and providers of the org, module gate
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs), 124, 'admin A reads the 124 motifs of org A');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs), 124, 'the conseillère reads the 124 motifs of org A');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.motifs), 124, 'the provider reads the 124 motifs of org A (professionals.self)');
select results_eq(current_setting('test.list_counts'), $$ values (6, 9, 9, 8, 13, 124, 4, 4) $$,
  'the provider reads every list of org A');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select results_eq(current_setting('test.list_counts'), $$ values (6, 9, 9, 8, 13, 124, 4, 4) $$,
  'S, holding only professionals.settings (override, no view), reads every list');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq(current_setting('test.list_counts'), $$ values (0, 0, 0, 0, 0, 0, 0, 0) $$,
  'K, module on but no professionals key (neither view nor self), reads no list');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select results_eq(current_setting('test.list_counts'), $$ values (0, 0, 0, 0, 0, 0, 0, 0) $$,
  'a disabled admin reads no list');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq($$ select org_id, count(*)::int from public.motifs group by org_id $$,
  $$ values ('b0000000-0000-0000-0000-00000000000b'::uuid, 124) $$, 'admin B reads only org B''s motifs');
select lives_ok($$ select public.set_module_enabled('professionals', false) $$, 'admin B disables professionals');
select results_eq(current_setting('test.list_counts'), $$ values (0, 0, 0, 0, 0, 0, 0, 0) $$,
  'with the module off, admin B reads none of the 8 lists (module gate)');

select * from finish();
rollback;
