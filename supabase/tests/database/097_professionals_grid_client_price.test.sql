-- Professionnels: private.grid_client_price (migration *_professionals_grid_client_price.sql,
-- plan S2.1). Covers: no role executes it; the price in force at a date, per duration; none
-- before the grid, after a closed version, for an unpriced duration, for a title without a grid,
-- for another clinic's title, for a null title.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_function('private', 'grid_client_price', array['uuid', 'uuid', 'smallint', 'date'], 'private.grid_client_price exists');
select function_privs_are('private', 'grid_client_price', array['uuid', 'uuid', 'smallint', 'date'], r.role, array[]::text[],
  'grid_client_price: no EXECUTE for ' || r.role)
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role);
select is((select p.prosecdef from pg_proc p where p.oid = 'private.grid_client_price(uuid, uuid, smallint, date)'::regprocedure), false,
  'grid_client_price is security invoker (it runs inside a module''s definer RPC)');

-- =============================================================================
-- Fixtures (as postgres): orgs A and B; the reference seed creates their titles and the
-- compensation seed their grids from 2026-07-01 (Psychologue 200 / 175 / 130 $).
-- =============================================================================
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
select set_config('test.org_a', 'b0000000-0000-0000-0000-00000000000a', true);
select set_config('test.org_b', 'b0000000-0000-0000-0000-00000000000b', true);
select set_config('test.psy_a', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.nutri_a', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'nutritionniste'), true);
select set_config('test.orient_a', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'conseiller_orientation'), true);

-- A second version of the Psychologue grid from 2027-01-01: 50 min at 180 $, no 30 min.
update public.retention_grids set effective_to = date '2027-01-01'
 where org_id = current_setting('test.org_a')::uuid and title_id = current_setting('test.psy_a')::uuid and effective_from = date '2026-07-01';
insert into public.retention_grids (id, org_id, title_id, effective_from, effective_to)
values ('d0000000-0000-0000-0000-000000000002', current_setting('test.org_a')::uuid, current_setting('test.psy_a')::uuid, date '2027-01-01', null);
insert into public.retention_grid_tiers (org_id, grid_id, threshold_sessions, retention_pct)
values (current_setting('test.org_a')::uuid, 'd0000000-0000-0000-0000-000000000002', 0, 27);
insert into public.retention_grid_prices (org_id, grid_id, duration, client_price_cents)
values (current_setting('test.org_a')::uuid, 'd0000000-0000-0000-0000-000000000002', 50, 18000);

-- =============================================================================
-- The price in force
-- =============================================================================
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.psy_a')::uuid, 50::smallint, date '2026-11-01'),
  17500, 'Psychologue 50 min on 2026-11-01: the seeded grid''s 175 $');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.psy_a')::uuid, 30::smallint, date '2026-11-01'),
  13000, '… and 30 min: 130 $');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.psy_a')::uuid, 50::smallint, date '2027-01-01'),
  18000, 'on the new version''s first day: its 180 $');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.psy_a')::uuid, 30::smallint, date '2027-03-01'),
  null, 'a duration the version in force does not price: null');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.psy_a')::uuid, 50::smallint, date '2026-06-30'),
  null, 'before the first grid: null');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.nutri_a')::uuid, 50::smallint, date '2026-11-01'),
  null, 'a title without a grid (Nutritionniste): null');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, current_setting('test.orient_a')::uuid, 60::smallint, date '2026-11-01'),
  null, 'a grid without the 60 min column (Conseiller d''orientation): null');
select is(private.grid_client_price(current_setting('test.org_b')::uuid, current_setting('test.psy_a')::uuid, 50::smallint, date '2026-11-01'),
  null, 'another clinic''s title id: null (the grid belongs to A)');
select is(private.grid_client_price(current_setting('test.org_a')::uuid, null, 50::smallint, date '2026-11-01'),
  null, 'a null title: null');

select * from finish();
rollback;
