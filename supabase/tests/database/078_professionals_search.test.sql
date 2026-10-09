-- Professionnels: the global search (⌘K) reads search_professionals (migration
-- *_professionals_search.sql). Covers: privileges and the returned columns (no email, no private
-- data); name search accent- and case-insensitive (« genevieve » finds Geneviève), several words,
-- email, any licence (not only the primary's, spaces and dashes ignored), the IVAC number; the
-- LIKE wildcards taken literally; under two characters nothing; the limit (8 by default, clamped);
-- the displayed status (« En préparation », P4-43); the conseillère allowed; the provider, another
-- clinic and a disabled module refused or isolated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03), org B (admin 04).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u4@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null,
   'Geneviève', 'Tremblay', 'gtremblay@exemple.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Olivier', 'Bergeron', 'olivier.b@exemple.test', 'in_review', 'male'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null,
   'Geneviève', 'Autre', 'g.autre@exemple.test', 'active', 'female');
-- Ten Martin in org A, for the limit.
insert into public.professionals (org_id, first_name, last_name, email)
select 'b0000000-0000-0000-0000-00000000000a', 'Martin' || n, 'Lafleur', 'martin' || n || '@exemple.test'
  from generate_series(1, 10) n;

-- Geneviève: psychologue (primary, OPQ) and travailleuse sociale (TS-04518, secondary); IVAC.
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, v.licence, v.is_primary
  from (values ('psychologue', '12345-08', true), ('travailleur_social', 'TS-04518', false)) v(key, licence, is_primary)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = v.key;
insert into public.professional_payer_numbers (org_id, professional_id, payer_type, number)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'ivac', 'IVAC-20417');

-- Olivier: in_review with an approved onboarding questionnaire and nothing waiting → « En préparation ».
insert into public.professional_submissions (org_id, professional_id, kind, status, requested_sections, submitted_at, reviewed_at, applied_fields)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'onboarding', 'approved',
        array['personal'], now(), now(), '{}');

create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.ids(p_query text, p_limit integer default 8) returns uuid[] language sql as $$
  select coalesce(array_agg(s.id order by s.id), '{}') from public.search_professionals(p_query, p_limit) s
$$;
grant execute on function pg_temp.as_user(text), pg_temp.ids(text, integer) to authenticated;

-- =============================================================================
-- Privileges and shape (as postgres)
-- =============================================================================
select function_privs_are('public', 'search_professionals', array['text', 'integer'], 'authenticated', array['EXECUTE'],
  'authenticated may search');
select function_privs_are('public', 'search_professionals', array['text', 'integer'], 'anon', array[]::text[],
  'anon may not search');
select is(pg_catalog.pg_get_function_result('public.search_professionals(text, integer)'::regprocedure),
  'TABLE(id uuid, first_name text, last_name text, status text, display_status text, title_label text, order_acronym text, licence_number text)',
  'only the name, the status and the primary profession come back (no email, no private data)');

-- =============================================================================
-- The admin of org A
-- =============================================================================
set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');

select is(pg_temp.ids('genevieve'), array['c0000000-0000-0000-0000-000000000001']::uuid[], '« genevieve » finds Geneviève (accents ignored), only in this clinic');
select is(pg_temp.ids('GENEVIÈVE'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'case ignored');
select is(pg_temp.ids('  olivier   berg '), array['c0000000-0000-0000-0000-000000000002']::uuid[], 'several words: each must match');
select is(pg_temp.ids('olivier tremblay'), '{}'::uuid[], 'words matching two different people: nobody');
select is(pg_temp.ids('Bergeron Olivier'), array['c0000000-0000-0000-0000-000000000002']::uuid[], 'last name first');
select is(pg_temp.ids('gtremblay@exemple'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'by email');
select is(pg_temp.ids('TS04518'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'by a secondary licence, the dash ignored');
select is(pg_temp.ids('ts-04518'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'by a licence typed with its dash, lower case');
select is(pg_temp.ids('1234508'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'by the primary licence');
select is(pg_temp.ids('ivac-20417'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'by the IVAC number');
select is(pg_temp.ids('20417'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'by part of the IVAC number');
select is(pg_temp.ids('%%'), '{}'::uuid[], '« % » is a character, not a wildcard');
select is(pg_temp.ids('_'), '{}'::uuid[], 'one character: nothing');
select is(pg_temp.ids(''), '{}'::uuid[], 'empty: nothing');
select is(pg_temp.ids(null), '{}'::uuid[], 'null: nothing');
select is(cardinality(pg_temp.ids('lafleur')), 8, '8 results by default');
select is(cardinality(pg_temp.ids('lafleur', 3)), 3, 'the limit asked for');
select is(cardinality(pg_temp.ids('lafleur', 500)), 10, 'a limit above 20 is clamped (here all 10)');

select results_eq(
  $$ select s.display_status, s.title_label, s.order_acronym, s.licence_number from public.search_professionals('tremblay', 8) s $$,
  $$ values ('active'::text, 'Psychologue'::text, 'OPQ'::text, '12345-08'::text) $$,
  'the primary profession, its order and licence, the feminine title');
select is((select s.display_status from public.search_professionals('olivier', 8) s), 'preparing',
  'in_review with the onboarding approved and nothing waiting: « En préparation » (P4-43)');

-- =============================================================================
-- The conseillère, the provider, another clinic, the module off
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select is(pg_temp.ids('genevieve'), array['c0000000-0000-0000-0000-000000000001']::uuid[], 'the conseillère finds her');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select throws_ok($$ select * from public.search_professionals('olivier', 8) $$, '42501', null,
  'the provider (professionals.self) is refused, her own file included');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select is(pg_temp.ids('genevieve'), array['c0000000-0000-0000-0000-000000000003']::uuid[], 'org B finds only its own Geneviève');
select is(pg_temp.ids('TS04518'), '{}'::uuid[], 'nor another clinic''s licence');

reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.search_professionals('genevieve', 8) $$, '42501', null,
  'the module off: refused');

select * from finish();
rollback;
