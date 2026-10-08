-- organizations.province defaults to QC (migration *_core_org_province_default_qc.sql), with
-- existing nulls backfilled, so « Identité légale » shows Québec because it is stored.
-- Covers: the column default, no null left by the backfill, a new org getting QC, and the
-- column grant still letting an admin change the province (and clear it) through RLS, audited.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- =============================================================================
-- Catalog: default QC, still nullable (« Aucune » clears it), still client-updatable
-- =============================================================================
select col_has_default('public', 'organizations', 'province', 'province has a default');
select col_default_is('public', 'organizations', 'province', 'QC', 'the default is QC');
select col_is_null('public', 'organizations', 'province', 'province stays nullable (the clinic may clear it)');
select column_privs_are('public', 'organizations', 'province', 'authenticated', array['SELECT', 'UPDATE'],
  'province is still updatable by clients');

-- The backfill left no null (with or without the seed; fixtures below come after this check).
select is_empty($$ select 1 from public.organizations where province is null $$,
  'no organization is left without a province');

-- =============================================================================
-- Fixtures (as postgres): org A, inserted without a province, with an admin.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');

select is((select province from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'QC', 'a new organization gets QC');

-- =============================================================================
-- Admin A: the default is only a starting value
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select province from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'QC', 'admin reads QC');
select lives_ok($$ update public.organizations set province = 'ON' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'admin changes the province');
select is((select province from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'ON', 'admin reads the new province back');
select lives_ok($$ update public.organizations set province = null where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'admin clears the province (« Aucune »)');
select ok((select province is null from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'a cleared province stays null (the default applies on insert only)');

-- =============================================================================
-- As postgres: the change is audited
-- =============================================================================
reset role;

select ok(exists (
  select 1 from public.audit_log
   where table_name = 'organizations'
     and record_id = 'b0000000-0000-0000-0000-00000000000a'
     and action = 'update'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
     and changed_fields -> 'province' = '{"before": "QC", "after": "ON"}'::jsonb
), 'the province change is audited, from QC');

select * from finish();
rollback;
