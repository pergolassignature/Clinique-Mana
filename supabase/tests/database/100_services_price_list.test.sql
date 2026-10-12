-- Services et tarifs: list_service_prices (migration *_services_price_list.sql, plan S3.2).
-- Covers: privileges; one row per grid service and title, one title-less row per other active
-- service; the grid, fixed, free and entered prices; the student and reduced prices in force;
-- archived services left out; the provider reads; another clinic sees only its own; the module
-- off and a missing permission refuse.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select function_privs_are('public', 'list_service_prices', array['date'], 'anon', array[]::text[], 'anon cannot call it');
select function_privs_are('public', 'list_service_prices', array['date'], 'authenticated', array['EXECUTE'], 'authenticated may call it');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.list_service_prices(date)'::regprocedure), true, 'definer (the grids stay hidden)');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'services', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
select set_config('test.org_a', 'b0000000-0000-0000-0000-00000000000a', true);
select set_config('test.psy', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.s10150', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10150), true);
select set_config('test.s10100', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10100), true);
select set_config('test.s50400', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 50400), true);
-- A general reduced rate of 20 % on the 50 min session.
insert into public.service_rate_variants (org_id, service_id, variant, discount_kind, percent, effective_from)
values (current_setting('test.org_a')::uuid, current_setting('test.s10150')::uuid, 'reduced', 'percent', 20, date '2026-07-01');

-- A grid service offered by no title yet.
insert into public.services (org_id, family_id, code, key, name, kind, duration_minutes, price_source, grid_duration)
select f.org_id, f.id, 60999, 'grid_no_title', 'Atelier selon la grille', 'workshop', 50, 'grid', 50
  from public.service_families f where f.org_id = current_setting('test.org_a')::uuid and f.code = 60;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select p.title_id, p.price_cents, p.source from public.list_service_prices(date '2026-11-01') p
                       join public.services s on s.id = p.service_id where s.key = 'grid_no_title' $$,
  $$ values (null::uuid, null::int, 'grid') $$, 'a grid service offered by no title: one title-less row, no price');
select throws_ok($$ select * from public.list_service_prices(null) $$, '22023', 'La date est requise.', 'the date is required');
select is((select count(*)::int from public.list_service_prices(date '2026-11-01') p where p.service_id = current_setting('test.s10150')::uuid), 7,
  'the 50 min session: one row per title that offers it');
select results_eq($$ select p.price_cents, p.student_price_cents, p.reduced_price_cents, p.tax_rule, p.source
                       from public.list_service_prices(date '2026-11-01') p
                      where p.service_id = current_setting('test.s10150')::uuid and p.title_id = current_setting('test.psy')::uuid $$,
  $$ values (17500, 12000, 14000, 'exempt', 'grid') $$, 'Psychologue: 175 $, student 120 $, reduced 140 $');
select results_eq($$ select p.title_id, p.price_cents, p.student_price_cents, p.tax_rule, p.source
                       from public.list_service_prices(date '2026-11-01') p where p.service_id = current_setting('test.s10100')::uuid $$,
  $$ values (null::uuid, 3783, null::int, 'taxable', 'fixed') $$, 'the file opening: one title-less row, no variant');
select results_eq($$ select p.price_cents, p.source from public.list_service_prices(date '2026-11-01') p where p.service_id = current_setting('test.s50400')::uuid $$,
  $$ values (null::int, 'entered') $$, 'report writing: no price, entered');
select is_empty($$ select 1 from public.list_service_prices(date '2026-11-01') p join public.services s on s.id = p.service_id where not s.is_active $$,
  'archived services (naturopathie) are left out');
select is((select count(*)::int from public.list_service_prices(date '2026-11-01') p
            where p.service_id = current_setting('test.s10150')::uuid and p.price_cents is null), 0,
  '… every title offering the 50 min session has a grid');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.list_service_prices(date '2026-11-01') p where p.service_id = current_setting('test.s10150')::uuid), 7,
  'the provider reads the same prices');
select is((select count(*)::int from public.retention_grid_prices), 0, '… without reading the grids');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_service_prices(date '2026-11-01') $$, '42501', 'Permission refusée : services.view', 'org B (module off): refused');

reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000b' and module_key = 'services';
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000b', 'services', true) on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_service_prices(date '2026-11-01') p where p.service_id = current_setting('test.s10150')::uuid $$,
  'org B (module on): none of A''s services');
select is((select count(*)::int from public.list_service_prices(date '2026-11-01') p),
  (select count(*)::int from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000b' and s.is_active and s.price_source <> 'grid')
  + (select count(*)::int from public.service_titles st join public.services s on s.id = st.service_id
      where s.org_id = 'b0000000-0000-0000-0000-00000000000b' and s.price_source = 'grid' and s.is_active),
  '… its own catalogue: a title-less row per non-grid service, a row per title of each grid service');

select * from finish();
rollback;
