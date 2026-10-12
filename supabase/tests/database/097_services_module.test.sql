-- Services et tarifs (migration *_services_module.sql, plan S1–S2). Covers: the registry (module,
-- dependency, permissions, role defaults, disabled at start); privileges (tables read-only for
-- clients, RPCs for authenticated only, helpers for no role); every policy carries the
-- services.view gate; audit triggers; the seeded catalogue (families, codes, prices, taxes,
-- titles, the psychologie student rates, the policy); checks (code in its family's range, fixed
-- price, grid duration, overlap of variants and policies); the published view; the price per
-- source (grid, fixed, free, entered), with a variant (per title first, general, dated) and the
-- client's tax exemption; the RPCs (create, update with immutable key and
-- code, archive, titles, variants, policy) and their French refusals on the right field; RLS per
-- role (provider reads, cannot write; another clinic sees nothing; the module off hides all).
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

-- =============================================================================
-- Registry
-- =============================================================================
select results_eq($$ select name from public.modules where key = 'services' $$, array['Services et tarifs'], 'module services is registered with its French label');
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'services' $$, array['professionals'], 'services depends on professionals');
select results_eq($$ select key from public.permissions where module_key = 'services' order by key $$, array['services.manage', 'services.view'], 'two permissions');
select results_eq($$ select role from public.role_permissions where permission_key = 'services.view' order by role $$,
  array['admin', 'admin_assistant', 'counselor', 'provider'], 'services.view: every role by default');
select results_eq($$ select role from public.role_permissions where permission_key = 'services.manage' order by role $$,
  array['admin', 'admin_assistant'], 'services.manage: admin and adjointe by default');

-- =============================================================================
-- Privileges and catalog shape
-- =============================================================================
select table_privs_are('public', t.name, 'anon', array[]::text[], t.name || ': anon has nothing')
  from (values ('service_families'), ('services'), ('service_titles'), ('service_rate_variants'), ('billing_policies')) as t(name);
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': authenticated reads only')
  from (values ('service_families'), ('services'), ('service_titles'), ('service_rate_variants'), ('billing_policies')) as t(name);
select table_privs_are('public', 'services_catalog', 'authenticated', array['SELECT'], 'services_catalog: authenticated reads');
select is_empty($$
  select p.tablename || '.' || p.policyname from pg_policies p
   where p.schemaname = 'public' and p.tablename in ('service_families', 'services', 'service_titles', 'service_rate_variants', 'billing_policies')
     and p.qual not like '%has_permission(''services.view''%'
$$, 'every policy of the module carries the services.view gate');
select is_empty($$
  select c.relname from pg_class c
   where c.relname in ('service_families', 'services', 'service_titles', 'service_rate_variants', 'billing_policies')
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = c.oid and p.proname = 'audit_trigger')
$$, 'every table of the module is audited');
select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': authenticated may call it')
  from (values
    ('get_service_price', array['uuid', 'uuid', 'text', 'date', 'boolean']),
    ('billing_policy_on', array['date']),
    ('save_service', array['uuid', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'integer', 'integer', 'boolean', 'text', 'integer', 'integer', 'text', 'text', 'integer']),
    ('set_service_active', array['uuid', 'boolean']),
    ('set_service_titles', array['uuid', 'uuid[]']),
    ('add_service_rate_variant', array['uuid', 'text', 'uuid', 'text', 'integer', 'numeric', 'date']),
    ('end_service_rate_variant', array['uuid', 'date']),
    ('add_billing_policy', array['date', 'integer', 'numeric', 'numeric', 'uuid', 'text']),
    ('delete_billing_policy', array['uuid'])
  ) as f(name, args);
select function_privs_are('public', 'save_service', array['uuid', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'integer', 'integer', 'boolean', 'text', 'integer', 'integer', 'text', 'text', 'integer'],
  'anon', array[]::text[], 'anon cannot call save_service');
select function_privs_are('private', f.name, f.args, r.role, array[]::text[], f.name || ': no EXECUTE for ' || r.role)
  from (values
    ('service_price', array['uuid', 'uuid', 'uuid', 'text', 'date', 'boolean']),
    ('seed_services_catalogue', array['uuid']),
    ('assert_services_manage', array[]::text[])
  ) as f(name, args)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- =============================================================================
-- Fixtures (as postgres): orgs A and B (the seeds create their titles, grids and catalogue);
-- in A an admin, an adjointe, a conseillère and a provider; in B an admin. Both modules on.
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

-- The module starts disabled: nothing is readable, then both clinics switch it on.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not public.module_enabled('services'), 'services starts disabled in a new org');
select is((select count(*)::int from public.services), 0, 'disabled: the admin reads no service');
reset role;
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'services', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'services', true);

-- The seeded rows were created in this transaction: dated back, so the 24-hour correction
-- window of the deletions is closed for them.
update public.service_rate_variants set created_at = now() - interval '2 days';
update public.billing_policies set created_at = now() - interval '2 days';
select set_config('test.org_a', 'b0000000-0000-0000-0000-00000000000a', true);
select set_config('test.psy', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.ts', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'travailleur_social'), true);
select set_config('test.sexo', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'sexologue'), true);
select set_config('test.nutri', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'nutritionniste'), true);
select set_config('test.s10150', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10150), true);
select set_config('test.s10130', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10130), true);
select set_config('test.s10100', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10100), true);
select set_config('test.s50400', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 50400), true);
select set_config('test.s50600', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 50600), true);
select set_config('test.s10157', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10157), true);
select set_config('test.fam10', (select f.id::text from public.service_families f where f.org_id = 'b0000000-0000-0000-0000-00000000000a' and f.code = 10), true);
select set_config('test.fam50', (select f.id::text from public.service_families f where f.org_id = 'b0000000-0000-0000-0000-00000000000a' and f.code = 50), true);
select set_config('test.s10150_b', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000b' and s.code = 10150), true);

-- =============================================================================
-- The seeded catalogue (as postgres)
-- =============================================================================
select is((select count(*)::int from public.service_families f where f.org_id = current_setting('test.org_a')::uuid), 8, '8 families');
select is((select count(*)::int from public.services s where s.org_id = current_setting('test.org_a')::uuid), 27, '27 coded services');
select results_eq($$ select s.code from public.services s where s.org_id = current_setting('test.org_a')::uuid and not s.is_active $$,
  array[10157], 'naturopathie is the only inactive service');
select is_empty($$ select s.code from public.services s where s.org_id = current_setting('test.org_a')::uuid and s.code in (10131, 10151, 10152, 10154, 10155, 20151, 20161) $$,
  'student, reduced and PRÉSENTIEL codes are not services');
select results_eq($$ select s.code from public.services s where s.org_id = current_setting('test.org_a')::uuid and s.tax_rule = 'taxable' order by s.code $$,
  array[10100, 10157, 20100, 20102, 20170, 30100, 50100, 50602, 80100], 'taxable: file openings, naturopathie, couple 30, waitlist, supervision, travel');
select results_eq($$ select s.code, s.fixed_price_cents from public.services s where s.org_id = current_setting('test.org_a')::uuid and s.price_source = 'fixed' order by s.code $$,
  $$ values (10100, 3783), (20100, 3783), (20102, 3783), (30100, 3783), (50100, 1891) $$, 'fixed prices: 37,83 $ openings, 18,91 $ waitlist');
select results_eq($$ select s.code, s.grid_duration::int from public.services s where s.org_id = current_setting('test.org_a')::uuid and s.price_source = 'grid' order by s.code $$,
  $$ values (10130, 30), (10150, 50), (10157, 50), (20150, 60), (20160, 60), (20170, 30) $$, 'grid services and their column');
select is((select s.buffer_after_minutes::int from public.services s where s.id = current_setting('test.s10150')::uuid), 10, 'a 50 min session has a 10 min pause after (R-13)');
select results_eq($$ select s.code from public.services s where s.org_id = current_setting('test.org_a')::uuid and s.for_two order by s.code $$,
  array[20160, 20170, 40160], 'couple services are for two');
select is_empty($$ select 1 from public.service_titles st where st.org_id = current_setting('test.org_a')::uuid and st.profession_title_id = current_setting('test.psy')::uuid
                     and st.service_id in (select s.id from public.services s where s.code / 10000 in (2, 3, 4)) $$,
  'psychologie offers no couple, IVAC or PAE service');
select ok(exists (select 1 from public.service_titles st where st.service_id = current_setting('test.s10150')::uuid and st.profession_title_id = current_setting('test.sexo')::uuid),
  'sexologie offers the 50 min session');
select is((select count(*)::int from public.service_titles st where st.org_id = current_setting('test.org_a')::uuid and st.service_id in (select s.id from public.services s where s.code in (50100, 50600, 50601))),
  0, 'the counsellor''s services have no title');
select results_eq($$ select s.code, v.amount_cents from public.service_rate_variants v join public.services s on s.id = v.service_id
                     where v.org_id = current_setting('test.org_a')::uuid order by s.code $$,
  $$ values (10130, 9600), (10150, 12000) $$, 'student prices of psychologie: 96 $ and 120 $');
select results_eq($$ select b.late_notice_hours::int, b.first_fee_percent, b.next_fee_percent, b.fee_mode, b.file_opening_service_id = current_setting('test.s10100')::uuid
                       from public.billing_policies b where b.org_id = current_setting('test.org_a')::uuid $$,
  $$ values (24, 50.00::numeric, 100.00::numeric, 'confirm', true) $$, 'one policy: 24 h, 50 % then 100 %, confirm mode, the individual file opening');
select is((select count(*)::int from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000b'), 27, 'org B got its own catalogue');
select lives_ok($$ select private.seed_services_catalogue('b0000000-0000-0000-0000-00000000000a') $$, 'seeding again is harmless');
select is((select count(*)::int from public.services s where s.org_id = current_setting('test.org_a')::uuid), 27, '… nothing duplicated');

-- =============================================================================
-- Checks (as postgres)
-- =============================================================================
select throws_ok($$ insert into public.services (org_id, family_id, code, key, name, kind, price_source) values (current_setting('test.org_a')::uuid, current_setting('test.fam10')::uuid, 50999, 'wrong_family', 'X', 'admin', 'free') $$,
  'P0001', 'Le code 50999 n''est pas dans la plage de sa famille (10 000 à 10 999).', 'a code outside its family''s range is refused');
select throws_ok($$ insert into public.services (org_id, family_id, code, key, name, kind, price_source) values (current_setting('test.org_a')::uuid, current_setting('test.fam10')::uuid, 10999, 'no_price', 'X', 'fee', 'fixed') $$,
  '23514', null, 'fixed without a price is refused');
select throws_ok($$ insert into public.services (org_id, family_id, code, key, name, kind, price_source, fixed_price_cents) values (current_setting('test.org_a')::uuid, current_setting('test.fam10')::uuid, 10999, 'free_price', 'X', 'fee', 'free', 100) $$,
  '23514', null, 'a price on a free service is refused');
select throws_ok($$ insert into public.services (org_id, family_id, code, key, name, kind, price_source) values (current_setting('test.org_a')::uuid, current_setting('test.fam10')::uuid, 10999, 'no_grid', 'X', 'session', 'grid') $$,
  '23514', null, 'grid without its column is refused');
select throws_ok($$ insert into public.services (org_id, family_id, code, key, name, kind, price_source) values (current_setting('test.org_a')::uuid, current_setting('test.fam10')::uuid, 10150, 'dup_code', 'X', 'admin', 'free') $$,
  '23505', null, 'a duplicate code is refused by the table');
select throws_ok($$ insert into public.service_rate_variants (org_id, service_id, variant, profession_title_id, discount_kind, amount_cents, effective_from)
                     values (current_setting('test.org_a')::uuid, current_setting('test.s10150')::uuid, 'student', current_setting('test.psy')::uuid, 'price', 11000, date '2026-09-01') $$,
  '23P01', null, 'overlapping variants of a series are refused');
select throws_ok($$ insert into public.billing_policies (org_id, effective_from) values (current_setting('test.org_a')::uuid, date '2026-09-01') $$,
  '23P01', null, 'overlapping policies are refused');
select throws_ok($$ insert into public.service_rate_variants (org_id, service_id, variant, discount_kind, amount_cents, percent, effective_from)
                     values (current_setting('test.org_a')::uuid, current_setting('test.s10150')::uuid, 'reduced', 'percent', 100, 10, date '2026-09-01') $$,
  '23514', null, 'a percent variant carries no amount');

-- =============================================================================
-- Admin A: the published view and the price
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.services_catalog), 26, 'the catalogue view lists the 26 active services of the clinic');
select results_eq($$ select c.family_code::int, c.family_name, c.title_keys from public.services_catalog c where c.code = 10150 $$,
  $$ values (10, 'Individuel', array['psychologue', 'psychotherapeute', 'travailleur_social', 'psychoeducateur', 'sexologue', 'conseiller_orientation', 'coach_professionnel']) $$,
  'with its family and the titles that offer it, in the titles'' order');

select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, null, date '2026-11-01') $$,
  $$ values (17500, 'exempt', 'grid', false) $$, 'Psychologue 50 min: the grid''s 175 $, untaxed');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, 'student', date '2026-11-01') $$,
  $$ values (12000, 'exempt', 'grid', true) $$, '… student rate: 120 $');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10130')::uuid, current_setting('test.psy')::uuid, 'student', date '2026-11-01') $$,
  $$ values (9600, 'exempt', 'grid', true) $$, '… 30 min student rate: 96 $');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, 'student', date '2026-06-01') $$,
  $$ values (null::int, 'exempt', 'grid', false) $$, 'before the grid: no price, nothing applied');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.ts')::uuid, 'student', date '2026-11-01') $$,
  $$ values (12000, 'exempt', 'grid', false) $$, 'Travail social 50 min: 120 $, no student rate of its own');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.sexo')::uuid, null, date '2026-11-01') $$,
  $$ values (15000, 'exempt', 'grid', false) $$, 'Sexologue 50 min: 150 $, untaxed (R-64)');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.nutri')::uuid, null, date '2026-11-01') $$,
  $$ values (null::int, 'exempt', 'grid', false) $$, 'a title without a grid: no price (« À confirmer »)');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, null, null, date '2026-11-01') $$,
  $$ values (null::int, 'exempt', 'grid', false) $$, 'no title: no grid price');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10100')::uuid, current_setting('test.psy')::uuid, null, date '2026-11-01') $$,
  $$ values (3783, 'taxable', 'fixed', false) $$, 'file opening: 37,83 $ taxable');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10100')::uuid, current_setting('test.psy')::uuid, 'student', date '2026-11-01') $$,
  $$ values (3783, 'taxable', 'fixed', false) $$, '… a variant without a row changes nothing');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10100')::uuid, current_setting('test.psy')::uuid, null, date '2026-11-01', true) $$,
  $$ values (3783, 'exempt', 'fixed', false) $$, '… a tax-exempt client: exempt');
select results_eq($$ select * from public.get_service_price(current_setting('test.s50400')::uuid, current_setting('test.psy')::uuid, null, date '2026-11-01') $$,
  $$ values (null::int, 'exempt', 'entered', false) $$, 'report writing: the amount is typed on the invoice');
select results_eq($$ select * from public.get_service_price(current_setting('test.s50600')::uuid, null, null, date '2026-11-01') $$,
  $$ values (0, 'exempt', 'free', false) $$, 'file transfer: free');
select throws_ok($$ select * from public.get_service_price(current_setting('test.s10150_b')::uuid, null, null, date '2026-11-01') $$,
  'P0001', 'Service introuvable.', 'another clinic''s service: not found');
select throws_ok($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, null, 'vip', date '2026-11-01') $$,
  '22023', null, 'an unknown variant is a developer error');
select results_eq($$ select b.late_notice_hours::int, b.fee_mode from public.billing_policy_on(date '2026-11-01') b $$,
  $$ values (24, 'confirm') $$, 'billing_policy_on: the policy in force');
select is_empty($$ select 1 from public.billing_policy_on(date '2026-01-01') $$, '… none before it');

-- =============================================================================
-- Admin A: the catalogue RPCs
-- =============================================================================
select lives_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50700, 'coaching_session', 'Séance de coaching', null, 'session', 50, 10, false, 'grid', null, 50, 'exempt', '#1A2B3C', 0) $$,
  'admin creates a service');
select set_config('test.new', (select s.id::text from public.services s where s.org_id = current_setting('test.org_a')::uuid and s.code = 50700), true);
select results_eq($$ select s.key, s.colour, s.grid_duration::int, s.created_by from public.services s where s.id = current_setting('test.new')::uuid $$,
  $$ values ('coaching_session', '#1a2b3c', 50, 'a0000000-0000-0000-0000-000000000001'::uuid) $$, '… stored as given, colour lowered, actor recorded');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50700, 'another_key', 'Doublon', null, 'admin', 0, 0, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'Le code 50700 est déjà utilisé par un autre service.', 'a duplicate code is refused in French');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50701, 'coaching_session', 'Doublon', null, 'admin', 0, 0, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'La clé « coaching_session » est déjà utilisée par un autre service.', 'a duplicate key is refused in French');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 10999, 'bad_range', 'Hors plage', null, 'admin', 0, 0, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'Le code 10999 n''est pas dans la plage de sa famille (50 000 à 50 999).', 'a code outside the family is refused');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50702, 'no_price', 'Sans prix', null, 'fee', 0, 0, false, 'fixed', null, null, 'exempt', null, 0) $$,
  'P0001', 'Un prix fixe est compris entre 0,01 $ et 10 000 $.', 'a fixed source needs its price');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50702, 'no_grid', 'Sans colonne', null, 'session', 50, 10, false, 'grid', null, 45, 'exempt', null, 0) $$,
  'P0001', 'Un prix selon la grille indique sa durée : 60, 50 ou 30 minutes.', 'a grid source needs a real column');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50702, 'Bad Key', 'Clé', null, 'admin', 0, 0, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'La clé commence par une lettre minuscule et compte des lettres minuscules, des chiffres et des _ (50 caractères au plus).', 'a bad key is refused');
select lives_ok($$ select public.save_service(current_setting('test.new')::uuid, null, null, null, 'Séance de coaching 50 min', 'Pour les coachs.', 'session', 50, 10, false, 'fixed', 9000, null, 'taxable', null, 5) $$,
  'admin updates it (key and code left null)');
select results_eq($$ select s.name, s.description, s.price_source, s.fixed_price_cents, s.grid_duration::int, s.tax_rule, s.sort_order, s.updated_by from public.services s where s.id = current_setting('test.new')::uuid $$,
  $$ values ('Séance de coaching 50 min', 'Pour les coachs.', 'fixed', 9000, null::int, 'taxable', 5, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  '… the grid column is cleared when the source changes');
select throws_ok($$ select public.save_service(current_setting('test.new')::uuid, null, 50701, null, 'Séance', null, 'session', 50, 10, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'Le code d''un service ne change pas une fois créé.', 'the code is immutable');
select throws_ok($$ select public.save_service(current_setting('test.new')::uuid, null, null, 'other', 'Séance', null, 'session', 50, 10, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'La clé d''un service ne change pas une fois créée.', 'the key is immutable');
select throws_ok($$ select public.save_service(current_setting('test.new')::uuid, current_setting('test.fam10')::uuid, null, null, 'Séance', null, 'session', 50, 10, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'La famille d''un service ne change pas une fois créé (son code en fait partie).', 'the family is immutable');
select throws_ok($$ select public.save_service(current_setting('test.s10150_b')::uuid, null, null, null, 'Séance', null, 'session', 50, 10, false, 'free', null, null, 'exempt', null, 0) $$,
  'P0001', 'Service introuvable.', 'another clinic''s service cannot be updated');

select lives_ok($$ select public.set_service_active(current_setting('test.new')::uuid, false) $$, 'admin archives it');
select is((select count(*)::int from public.services_catalog c where c.id = current_setting('test.new')::uuid), 0, '… it leaves the published catalogue');
select lives_ok($$ select public.set_service_active(current_setting('test.new')::uuid, true) $$, 'admin restores it');
select throws_ok($$ select public.set_service_active(current_setting('test.s10150_b')::uuid, false) $$, 'P0001', 'Service introuvable.', 'another clinic''s service cannot be archived');

select lives_ok($$ select public.set_service_titles(current_setting('test.new')::uuid, array[current_setting('test.psy')::uuid, current_setting('test.sexo')::uuid]) $$,
  'admin sets the titles');
select results_eq($$ select c.title_keys from public.services_catalog c where c.id = current_setting('test.new')::uuid $$,
  $$ values (array['psychologue', 'sexologue']) $$, '… the view lists them');
select lives_ok($$ select public.set_service_titles(current_setting('test.new')::uuid, array[current_setting('test.sexo')::uuid]) $$,
  'admin removes a title');
select results_eq($$ select st.profession_title_id from public.service_titles st where st.service_id = current_setting('test.new')::uuid $$,
  array[current_setting('test.sexo')::uuid], '… only the other stays');
select throws_ok($$ select public.set_service_titles(current_setting('test.new')::uuid, array['d0000000-0000-0000-0000-000000000009'::uuid]) $$,
  'P0001', 'Un des titres choisis n''existe pas.', 'an unknown title is refused');
select lives_ok($$ select public.set_service_titles(current_setting('test.new')::uuid, '{}') $$, 'no title at all is allowed (the counsellor''s services)');
select is((select count(*)::int from public.service_titles st where st.service_id = current_setting('test.new')::uuid), 0, '… and clears them');

-- Variants: a general reduced rate of 20 % on the 50 min session, then a dated change.
select lives_ok($$ select public.add_service_rate_variant(current_setting('test.s10150')::uuid, 'reduced', null, 'percent', null, 20, date '2026-10-01') $$,
  'admin adds a general reduced rate');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, 'reduced', date '2026-11-01') $$,
  $$ values (14000, 'exempt', 'grid', true) $$, '… 175 $ less 20 % = 140 $');
select lives_ok($$ select public.add_service_rate_variant(current_setting('test.s10150')::uuid, 'reduced', null, 'amount', 2500, null, date '2027-01-01') $$,
  'admin dates a new reduced rate (25 $ off)');
select results_eq($$ select v.effective_to from public.service_rate_variants v where v.service_id = current_setting('test.s10150')::uuid and v.variant = 'reduced' and v.percent = 20 $$,
  array[date '2027-01-01'], '… the previous one closes the day before');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, 'reduced', date '2027-02-01') $$,
  $$ values (15000, 'exempt', 'grid', true) $$, '… 175 $ less 25 $ = 150 $ from then on');
select throws_ok($$ select public.add_service_rate_variant(current_setting('test.s10150')::uuid, 'reduced', null, 'percent', null, 10, date '2026-12-01') $$,
  'P0001', 'La date doit être postérieure au début du tarif en vigueur, le 1 janv. 2027.', 'a start before the open row is refused');
select throws_ok($$ select public.add_service_rate_variant(current_setting('test.s10150')::uuid, 'reduced', null, 'percent', null, 150, date '2027-06-01') $$,
  'P0001', 'Le pourcentage est compris entre 0,01 % et 100 %.', 'a percent over 100 is refused');
select throws_ok($$ select public.add_service_rate_variant(current_setting('test.s10150')::uuid, 'student', current_setting('test.psy')::uuid, 'price', 11500, null, date '2026-05-01') $$,
  'P0001', 'La date doit être postérieure au début du tarif en vigueur, le 1 juil. 2026.', 'a title''s series is its own');
select lives_ok($$ select public.add_service_rate_variant(current_setting('test.s10150')::uuid, 'student', current_setting('test.psy')::uuid, 'price', 11500, null, date '2027-06-01') $$,
  'admin dates a new student price for psychologie');
select set_config('test.v_new', (select v.id::text from public.service_rate_variants v where v.service_id = current_setting('test.s10150')::uuid and v.variant = 'student' and v.effective_to is null), true);
select lives_ok($$ select public.end_service_rate_variant(current_setting('test.v_new')::uuid, null) $$, 'admin deletes it (not in force yet)');
select results_eq($$ select v.effective_to from public.service_rate_variants v where v.service_id = current_setting('test.s10150')::uuid and v.variant = 'student' $$,
  array[null::date], '… the previous student price opens again');
select set_config('test.v_open', (select v.id::text from public.service_rate_variants v where v.service_id = current_setting('test.s10150')::uuid and v.variant = 'student' and v.effective_to is null), true);
select throws_ok($$ select public.end_service_rate_variant(current_setting('test.v_open')::uuid, null) $$,
  'P0001', 'Un tarif déjà en vigueur ne peut pas être supprimé : terminez-le à une date.', 'a rate in force for more than 24 h cannot be deleted');
select throws_ok($$ select public.end_service_rate_variant(current_setting('test.v_open')::uuid, date '2026-06-01') $$,
  'P0001', 'La fin doit être postérieure au début du tarif, le 1 juil. 2026.', '… nor ended before its start');
select lives_ok($$ select public.end_service_rate_variant(current_setting('test.v_open')::uuid, date '2027-01-01') $$, '… but it can be ended');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, 'student', date '2027-02-01') $$,
  $$ values (17500, 'exempt', 'grid', false) $$, '… after which the student rate no longer applies');

-- Policy: a new dated one, then its deletion.
select lives_ok($$ select public.add_billing_policy(date '2027-01-01', 48, 50, 100, null, 'confirm') $$, 'admin dates a new policy');
select results_eq($$ select b.late_notice_hours::int, b.file_opening_service_id from public.billing_policy_on(date '2027-01-01') b $$,
  $$ values (48, null::uuid) $$, '… in force from its date');
select results_eq($$ select b.late_notice_hours::int from public.billing_policy_on(date '2026-12-31') b $$, array[24], '… the previous one until the day before');
select throws_ok($$ select public.add_billing_policy(date '2026-12-01', 24, 50, 100, null, 'confirm') $$,
  'P0001', 'La date doit être postérieure au début de la politique en vigueur, le 1 janv. 2027.', 'a start before the open policy is refused');
select throws_ok($$ select public.add_billing_policy(date '2027-06-01', 24, 50, 100, current_setting('test.s10150_b')::uuid, 'confirm') $$,
  'P0001', 'Le service d''ouverture de dossier choisi n''existe pas ou est archivé.', 'another clinic''s service cannot be the file opening');
select throws_ok($$ select public.add_billing_policy(date '2027-06-01', 24, 50, 100, null, 'later') $$,
  'P0001', 'Le mode des frais est « À confirmer » ou « Automatique ».', 'an unknown fee mode is refused');
select set_config('test.pol_new', (select b.id::text from public.billing_policies b where b.org_id = current_setting('test.org_a')::uuid and b.effective_to is null), true);
select set_config('test.pol_first', (select b.id::text from public.billing_policies b where b.org_id = current_setting('test.org_a')::uuid and b.effective_to is not null), true);
select throws_ok($$ select public.delete_billing_policy(current_setting('test.pol_first')::uuid) $$,
  'P0001', 'Seule la dernière politique peut être supprimée.', 'a closed policy cannot be deleted');
select lives_ok($$ select public.delete_billing_policy(current_setting('test.pol_new')::uuid) $$, 'admin deletes the coming policy');
select results_eq($$ select b.effective_to from public.billing_policies b where b.org_id = current_setting('test.org_a')::uuid $$, array[null::date], '… the first one opens again');
select throws_ok($$ select public.delete_billing_policy(current_setting('test.pol_first')::uuid) $$,
  'P0001', 'La première politique de la clinique ne peut pas être supprimée.', '… and stays');

-- Audit: the RPC writes name the admin.
select ok(exists (select 1 from public.audit_log l where l.table_name = 'services' and l.record_id = current_setting('test.new') and l.action = 'insert' and l.actor_id = 'a0000000-0000-0000-0000-000000000001'),
  'the service''s creation is audited with its actor');
select ok(exists (select 1 from public.audit_log l where l.table_name = 'service_rate_variants' and l.org_id = current_setting('test.org_a')::uuid and l.action = 'delete'),
  'a variant''s deletion is audited');

-- =============================================================================
-- The adjointe manages, the conseillère and the provider read, another clinic sees nothing
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_service_active(current_setting('test.new')::uuid, false) $$, 'the adjointe archives a service (services.manage by default)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.services_catalog), 26, 'the conseillère reads the catalogue');
select throws_ok($$ select public.set_service_active(current_setting('test.new')::uuid, true) $$, '42501', 'Permission refusée : services.manage', '… and cannot change it');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.services_catalog), 26, 'the provider reads the catalogue');
select results_eq($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, null, date '2026-11-01') $$,
  $$ values (17500, 'exempt', 'grid', false) $$, '… and her prices (the grid stays hidden)');
select is((select count(*)::int from public.retention_grid_prices), 0, '… without reading the grids themselves');
select throws_ok($$ select public.save_service(null, current_setting('test.fam50')::uuid, 50800, 'mine', 'Mon service', null, 'admin', 0, 0, false, 'free', null, null, 'exempt', null, 0) $$,
  '42501', 'Permission refusée : services.manage', '… and cannot write');
select throws_ok($$ select public.add_billing_policy(date '2028-01-01', 24, 50, 100, null, 'confirm') $$, '42501', 'Permission refusée : services.manage', '… nor the policy');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.services s where s.org_id = current_setting('test.org_a')::uuid), 0, 'org B sees none of A''s services');
select is((select count(*)::int from public.service_titles st where st.org_id = current_setting('test.org_a')::uuid), 0, '… nor its titles');
select is((select count(*)::int from public.billing_policies b where b.org_id = current_setting('test.org_a')::uuid), 0, '… nor its policy');

-- The module switched off: everything disappears, the RPCs refuse.
reset role;
update public.org_modules set enabled = false where org_id = current_setting('test.org_a')::uuid and module_key = 'services';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.services_catalog), 0, 'module off: the admin reads nothing');
select throws_ok($$ select * from public.get_service_price(current_setting('test.s10150')::uuid, current_setting('test.psy')::uuid, null, date '2026-11-01') $$,
  '42501', 'Permission refusée : services.view', '… and no price');
select throws_ok($$ select public.set_service_active(current_setting('test.new')::uuid, true) $$, '42501', 'Permission refusée : services.manage', '… nor a write');

select * from finish();
rollback;
