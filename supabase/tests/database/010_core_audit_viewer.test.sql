-- Audit log viewer (migration *_core_audit_viewer.sql): list_audit_entries, list_audit_actors.
-- Covers: privileges, org scope (never another org, never rows without org_id), newest
-- first, filters (table, actor, dates), keyset paging, the 200-row cap, read rows,
-- actor names limited to the org, permission refusal, org isolation.
-- All rows written in this transaction share now() as created_at: date filters use
-- probe rows inserted as postgres with explicit dates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin and a counselor; org B with an admin.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- Probe rows (as postgres; audit_log is append-only, inserts are allowed):
-- * 201 rows for the cap; * three dated rows; * a read row (bank reveal);
-- * a row without org_id; * an org A row whose actor belongs to org B.
insert into public.audit_log (org_id, table_name, record_id, action)
select 'b0000000-0000-0000-0000-00000000000a', 'zz_cap', g::text, 'insert' from generate_series(1, 201) g;
insert into public.audit_log (org_id, table_name, record_id, action, created_at) values
  ('b0000000-0000-0000-0000-00000000000a', 'zz_dates', 'jan', 'insert', '2026-01-01 12:00+00'),
  ('b0000000-0000-0000-0000-00000000000a', 'zz_dates', 'feb', 'insert', '2026-02-01 12:00+00'),
  ('b0000000-0000-0000-0000-00000000000a', 'zz_dates', 'mar', 'insert', '2026-03-01 12:00+00');
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source) values
  ('b0000000-0000-0000-0000-00000000000a', 'organization_bank_details', 'b0000000-0000-0000-0000-00000000000a', 'read',
   '{"fields": ["account_number"]}', 'a0000000-0000-0000-0000-000000000001', 'admin', 'rpc:reveal_bank_account_number');
insert into public.audit_log (org_id, table_name, record_id, action) values (null, 'zz_no_org', 'x', 'insert');
insert into public.audit_log (org_id, table_name, record_id, action, actor_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'zz_foreign_actor', 'x', 'update', 'a0000000-0000-0000-0000-000000000005');

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'list_audit_entries', array['text', 'uuid', 'timestamp with time zone', 'timestamp with time zone', 'bigint', 'integer'],
  'authenticated', array['EXECUTE'], 'authenticated can call list_audit_entries');
select function_privs_are('public', 'list_audit_entries', array['text', 'uuid', 'timestamp with time zone', 'timestamp with time zone', 'bigint', 'integer'],
  'anon', array[]::text[], 'anon cannot call list_audit_entries');
select function_privs_are('public', 'list_audit_entries', array['text', 'uuid', 'timestamp with time zone', 'timestamp with time zone', 'bigint', 'integer'],
  'service_role', array[]::text[], 'service_role has no grant on list_audit_entries');
select function_privs_are('public', 'list_audit_actors', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can call list_audit_actors');
select function_privs_are('public', 'list_audit_actors', array[]::text[], 'anon', array[]::text[], 'anon cannot call list_audit_actors');
select function_privs_are('public', 'list_audit_actors', array[]::text[], 'service_role', array[]::text[], 'service_role has no grant on list_audit_actors');

-- =============================================================================
-- Generate rows: admin A renames org A three times, admin B renames org B once.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.organizations set name = 'Org A 1' where id = 'b0000000-0000-0000-0000-00000000000a';
update public.organizations set name = 'Org A 2' where id = 'b0000000-0000-0000-0000-00000000000a';
update public.organizations set name = 'Org A 3' where id = 'b0000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
update public.organizations set name = 'Org B 1' where id = 'b0000000-0000-0000-0000-00000000000b';

-- =============================================================================
-- Admin A
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select action, actor_name, changed_fields -> 'name' ->> 'after'
       from public.list_audit_entries(p_table => 'organizations', p_actor => 'a0000000-0000-0000-0000-000000000001') $$,
  $$ values ('update'::text, 'Admin A'::text, 'Org A 3'::text), ('update', 'Admin A', 'Org A 2'), ('update', 'Admin A', 'Org A 1') $$,
  'admin A''s renames, newest first, with the actor''s name');
select results_eq(
  $$ select record_id from public.list_audit_entries(p_table => 'organizations') $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::text), ('b0000000-0000-0000-0000-00000000000a'),
            ('b0000000-0000-0000-0000-00000000000a'), ('b0000000-0000-0000-0000-00000000000a') $$,
  'p_table filters, and only org A''s organization rows come back (3 updates + the insert)');
select ok((select bool_and(table_name = 'organizations') from public.list_audit_entries(p_table => 'organizations')),
  'every row matches the table filter');
select results_eq(
  $$ select id from public.list_audit_entries(p_table => 'organizations',
       p_before_id => (select id from public.list_audit_entries(p_table => 'organizations') order by id desc offset 1 limit 1)) $$,
  $$ select id from public.list_audit_entries(p_table => 'organizations') order by id desc offset 2 $$,
  'p_before_id returns the older rows (keyset paging)');
select results_eq(
  $$ select changed_fields -> 'name' ->> 'after' from public.list_audit_entries(p_table => 'organizations', p_limit => 1) $$,
  $$ values ('Org A 3'::text) $$,
  'p_limit => 1 returns only the newest row');
select is((select count(*)::int from public.list_audit_entries(p_table => 'zz_cap', p_limit => 1000)), 200, 'p_limit is capped at 200');
select is((select count(*)::int from public.list_audit_entries(p_table => 'zz_cap', p_limit => 0)), 1, 'p_limit is at least 1');
select is((select count(*)::int from public.list_audit_entries(p_table => 'zz_cap', p_limit => null)), 50, 'p_limit defaults to 50');
select is((select count(*)::int from public.list_audit_entries(p_table => 'zz_cap')), 50, 'the default page is 50 rows');
select results_eq(
  $$ select record_id from public.list_audit_entries(p_table => 'zz_dates', p_from => '2026-01-15', p_to => '2026-03-01 12:00+00') $$,
  $$ values ('feb'::text) $$,
  'p_from is inclusive and p_to exclusive');
select results_eq(
  $$ select record_id from public.list_audit_entries(p_table => 'zz_dates', p_from => '2026-02-01 12:00+00') $$,
  $$ values ('mar'::text), ('feb') $$,
  'p_from alone keeps everything from that instant');
select results_eq(
  $$ select action, changed_fields, source from public.list_audit_entries(p_table => 'organization_bank_details') $$,
  $$ values ('read'::text, '{"fields": ["account_number"]}'::jsonb, 'rpc:reveal_bank_account_number'::text) $$,
  'read rows (audited reveals) are listed');
select is_empty($$ select * from public.list_audit_entries(p_table => 'zz_no_org') $$, 'rows without org_id are never listed');
select results_eq(
  $$ select actor_id, actor_name from public.list_audit_entries(p_table => 'zz_foreign_actor') $$,
  $$ values ('a0000000-0000-0000-0000-000000000005'::uuid, null::text) $$,
  'an actor from another org is not named');
select results_eq($$ select actor_id, actor_name from public.list_audit_actors() $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'Admin A'::text) $$,
  'list_audit_actors returns admin A once (not org B''s admin)');

-- =============================================================================
-- Counselor A (no audit.view)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_audit_entries() $$, '42501', null, 'a counselor cannot list audit entries');
select throws_ok($$ select * from public.list_audit_actors() $$, '42501', null, 'a counselor cannot list audit actors');

-- =============================================================================
-- Admin B: never sees org A
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq(
  $$ select record_id, action, actor_name from public.list_audit_entries(p_table => 'organizations') $$,
  $$ values ('b0000000-0000-0000-0000-00000000000b'::text, 'update'::text, 'Admin B'::text),
            ('b0000000-0000-0000-0000-00000000000b', 'insert', null) $$,
  'org B admin sees only org B''s organization rows');
select is_empty($$ select * from public.list_audit_entries(p_table => 'zz_cap') $$, 'org B admin sees none of org A''s probe rows');
select ok(not exists (
  select 1 from public.list_audit_entries(p_limit => 200)
   where record_id in ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003')
), 'no org A record appears for org B');
select results_eq($$ select actor_id, actor_name from public.list_audit_actors() $$,
  $$ values ('a0000000-0000-0000-0000-000000000005'::uuid, 'Admin B'::text) $$,
  'list_audit_actors returns only org B actors');

select * from finish();
rollback;
