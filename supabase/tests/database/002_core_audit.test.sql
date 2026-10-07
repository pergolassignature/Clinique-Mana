-- Append-only audit log (migration 20261007140623_core_audit.sql).
-- Covers: privileges, diff content, source default, composite record ids,
-- org_id on child tables, redaction, immutability for every role, RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- =============================================================================
-- Fixtures (as postgres; no app.audit_source → source 'system')
-- The local seed may already have rows in audit_log: always filter by fixture ids.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Staff A', 'staff@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'staff'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.modules (key, name) values ('test_mod', 'Module test');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'test_mod', true);

-- A probe table audited with redaction, as a future module would do.
create table public.zz_audit_probe (
  id int primary key,
  org_id uuid,
  sin text,
  note text
);
create trigger zz_audit_probe_audit
  after insert or update or delete on public.zz_audit_probe
  for each row execute function private.audit_trigger('sin');

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'audit_log', 'anon', array[]::text[], 'anon: no privileges on audit_log');
select table_privs_are('public', 'audit_log', 'authenticated', array['SELECT'], 'authenticated: select only on audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'UPDATE'), 'service_role cannot update audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'DELETE'), 'service_role cannot delete from audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE'), 'service_role cannot truncate audit_log');
select sequence_privs_are('public', 'audit_log_id_seq', 'authenticated', array[]::text[], 'authenticated: no privileges on the audit sequence');
select function_privs_are('private', 'audit_trigger', array[]::text[], 'service_role', array[]::text[], 'nobody can execute audit_trigger directly');
select function_privs_are('private', 'audit_log_immutable', array[]::text[], 'service_role', array[]::text[], 'nobody can execute audit_log_immutable directly');

-- =============================================================================
-- Content of the log (fixtures and triggers fired above)
-- =============================================================================
select is((select source from public.audit_log where table_name = 'organizations' and action = 'insert' and record_id = 'b0000000-0000-0000-0000-00000000000a'),
  'system', 'source defaults to system outside an API request');
select is((select org_id from public.audit_log where table_name = 'profiles' and record_id = 'a0000000-0000-0000-0000-000000000002'),
  'b0000000-0000-0000-0000-00000000000a'::uuid, 'org_id is captured for profiles');
select is((select record_id from public.audit_log where table_name = 'org_modules' and action = 'insert' and org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'b0000000-0000-0000-0000-00000000000a:test_mod', 'record_id joins composite primary keys with ":"');

delete from public.user_roles where user_id = 'a0000000-0000-0000-0000-000000000002';
select is((select org_id from public.audit_log where table_name = 'user_roles' and action = 'delete' and record_id = 'a0000000-0000-0000-0000-000000000002'),
  'b0000000-0000-0000-0000-00000000000a'::uuid, 'deleted user_roles rows keep their org_id');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'staff');

-- Redaction ---------------------------------------------------------------------
insert into public.zz_audit_probe values (1, 'b0000000-0000-0000-0000-00000000000a', '123 456 789', 'first');
update public.zz_audit_probe set sin = '987 654 321', note = 'second' where id = 1;
select is((select changed_fields -> 'sin' from public.audit_log where table_name = 'zz_audit_probe' and action = 'insert'),
  '"[redacted]"'::jsonb, 'redacted column is masked on insert');
select is((select changed_fields -> 'sin' from public.audit_log where table_name = 'zz_audit_probe' and action = 'update'),
  '"[redacted]"'::jsonb, 'redacted column is masked on update');
select is((select changed_fields -> 'note' ->> 'after' from public.audit_log where table_name = 'zz_audit_probe' and action = 'update'),
  'second', 'other columns keep their before/after diff');
select is((select count(*)::int from public.audit_log where table_name = 'zz_audit_probe' and (changed_fields::text like '%456%' or changed_fields::text like '%654%')),
  0, 'redacted values appear nowhere in the log');

-- =============================================================================
-- As the admin of org A (API request)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('app.audit_source', 'pgtap', true);

update public.organizations set name = 'Clinique A' where id = 'b0000000-0000-0000-0000-00000000000a';

select results_eq(
  $$ select action, source, actor_role, actor_id from public.audit_log where table_name = 'organizations' and action = 'update' $$,
  $$ values ('update'::text, 'pgtap'::text, 'admin'::text, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'update is logged with actor, role and explicit source');
select is(
  (select changed_fields -> 'name' from public.audit_log where table_name = 'organizations' and action = 'update'),
  '{"before": "Org A", "after": "Clinique A"}'::jsonb, 'changed_fields holds before/after');
select ok(
  (select not (changed_fields ? 'updated_at') from public.audit_log where table_name = 'organizations' and action = 'update'),
  'updated_at noise is not logged');
select is(
  (select record_id from public.audit_log where table_name = 'organizations' and action = 'update'),
  'b0000000-0000-0000-0000-00000000000a', 'record_id is the primary key');

-- A no-op update writes nothing.
update public.organizations set name = 'Clinique A' where id = 'b0000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.audit_log where table_name = 'organizations' and action = 'update'),
  1, 'updates that change nothing are not logged');

-- Without app.audit_source, an API request is tagged `app`.
select set_config('app.audit_source', '', true);
update public.profiles set display_name = 'Admin Alpha' where user_id = auth.uid();
select is((select source from public.audit_log where table_name = 'profiles' and action = 'update'),
  'app', 'source defaults to app for authenticated requests');

select ok((select count(*) from public.audit_log) > 0, 'admin with audit.view reads the org log');
select is((select count(*)::int from public.audit_log where org_id is distinct from 'b0000000-0000-0000-0000-00000000000a'),
  0, 'admin sees only their own org rows');

select throws_ok($$ delete from public.audit_log $$, '42501', null, 'clients cannot delete audit rows');
select throws_ok($$ update public.audit_log set source = 'x' $$, '42501', null, 'clients cannot update audit rows');
select throws_ok($$ insert into public.audit_log (table_name, record_id, action) values ('x', 'x', 'insert') $$, '42501', null, 'clients cannot forge audit rows');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'clients cannot truncate the log');

-- Staff (no audit.view) ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log), 0, 'staff without audit.view sees nothing');

-- Admin of org B ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, 'org B admin cannot read org A rows');

-- =============================================================================
-- Service role (edge functions)
-- =============================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.organizations set name = 'Clinique A (service)' where id = 'b0000000-0000-0000-0000-00000000000a';
select is((select source from public.audit_log where table_name = 'organizations' and action = 'update' order by id desc limit 1),
  'service', 'source defaults to service for the service role');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'service_role cannot delete audit rows');
select throws_ok($$ update public.audit_log set source = 'x' $$, '42501', null, 'service_role cannot update audit rows');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'service_role cannot truncate the log');

-- =============================================================================
-- Owner (postgres): blocked by the immutability triggers unless purging
-- =============================================================================
reset role;
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'even the owner cannot delete without the purge switch');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'even the owner cannot truncate without the purge switch');
select set_config('app.audit_purge', 'on', true);
delete from public.audit_log where table_name = 'zz_audit_probe';
select is((select count(*)::int from public.audit_log where table_name = 'zz_audit_probe'), 0, 'the purge switch lets the owner delete rows');

select * from finish();
rollback;
