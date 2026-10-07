-- Core access schema (migration 20261007140517_core_access.sql).
-- Covers: closed-by-default privileges, private helpers, constraints,
-- RLS per role, cross-org isolation, get_my_access() for every profile state.
begin;
create extension if not exists pgtap with schema extensions;
select plan(121);

-- =============================================================================
-- Fixtures (as postgres)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disabled@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'norole@a.test',   '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'spare@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null,              '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');

insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Disabled A', 'disabled@a.test', 'disabled'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'No Role A',  'norole@a.test',   'active');

insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- Adjointe: extra grant users.manage, revoke users.view. users.view is not an
-- admin_assistant default since core_roles_split, so the fixture re-adds it as a
-- role default: the revoke must remove a real role default.
-- No-role user: a grant that must be ignored (no role = no permissions).
-- Admin B: revoke audit.view.
insert into public.role_permissions (role, permission_key) values ('admin_assistant', 'users.view');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.manage',  true),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.view',    false),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'settings.view', true),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'audit.view',    false);

insert into public.modules (key, name) values ('test_mod', 'Module test');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'test_mod', true),
  ('b0000000-0000-0000-0000-00000000000b', 'test_mod', false);

-- =============================================================================
-- Privileges: closed by default, explicit grants only
-- =============================================================================
select schema_privs_are('private', 'anon', array[]::text[], 'anon has no usage on schema private');
select schema_privs_are('private', 'authenticated', array['USAGE'], 'authenticated can use schema private');

select table_privs_are('public', 'modules',                   'anon', array[]::text[], 'anon: no privileges on modules');
select table_privs_are('public', 'module_dependencies',       'anon', array[]::text[], 'anon: no privileges on module_dependencies');
select table_privs_are('public', 'organizations',             'anon', array[]::text[], 'anon: no privileges on organizations');
select table_privs_are('public', 'roles',                     'anon', array[]::text[], 'anon: no privileges on roles');
select table_privs_are('public', 'profiles',                  'anon', array[]::text[], 'anon: no privileges on profiles');
select table_privs_are('public', 'user_roles',                'anon', array[]::text[], 'anon: no privileges on user_roles');
select table_privs_are('public', 'user_permission_overrides', 'anon', array[]::text[], 'anon: no privileges on user_permission_overrides');
select table_privs_are('public', 'permissions',               'anon', array[]::text[], 'anon: no privileges on permissions');
select table_privs_are('public', 'role_permissions',          'anon', array[]::text[], 'anon: no privileges on role_permissions');
select table_privs_are('public', 'org_modules',               'anon', array[]::text[], 'anon: no privileges on org_modules');

select table_privs_are('public', 'modules',                   'authenticated', array['SELECT'], 'authenticated: select only on modules');
select table_privs_are('public', 'module_dependencies',       'authenticated', array['SELECT'], 'authenticated: select only on module_dependencies');
select table_privs_are('public', 'organizations',             'authenticated', array['SELECT'], 'authenticated: select only on organizations (updates are column grants)');
select table_privs_are('public', 'roles',                     'authenticated', array['SELECT'], 'authenticated: select only on roles');
select table_privs_are('public', 'profiles',                  'authenticated', array['SELECT'], 'authenticated: select only on profiles (updates are column grants)');
select table_privs_are('public', 'user_roles',                'authenticated', array['SELECT'], 'authenticated: select only on user_roles');
select table_privs_are('public', 'user_permission_overrides', 'authenticated', array['SELECT'], 'authenticated: select only on user_permission_overrides');
select table_privs_are('public', 'permissions',               'authenticated', array['SELECT'], 'authenticated: select only on permissions');
select table_privs_are('public', 'role_permissions',          'authenticated', array['SELECT'], 'authenticated: select only on role_permissions');
select table_privs_are('public', 'org_modules',               'authenticated', array['SELECT'], 'authenticated: select only on org_modules');

select column_privs_are('public', 'organizations', 'name',         'authenticated', array['SELECT', 'UPDATE'], 'organizations.name is updatable');
select column_privs_are('public', 'organizations', 'id',           'authenticated', array['SELECT'],           'organizations.id is not updatable');
select column_privs_are('public', 'profiles',      'display_name', 'authenticated', array['SELECT', 'UPDATE'], 'profiles.display_name is updatable');
select column_privs_are('public', 'profiles',      'status',       'authenticated', array['SELECT'],           'profiles.status is not updatable');

select function_privs_are('private', 'has_permission', array['text'], 'authenticated', array['EXECUTE'], 'authenticated can execute private.has_permission');
select function_privs_are('private', 'has_permission', array['text'], 'anon', array[]::text[], 'anon cannot execute private.has_permission');
select function_privs_are('private', 'current_user_org_id', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can execute private.current_user_org_id');
select function_privs_are('private', 'current_user_org_id', array[]::text[], 'anon', array[]::text[], 'anon cannot execute private.current_user_org_id');
select function_privs_are('private', 'current_user_role', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can execute private.current_user_role');
select function_privs_are('private', 'current_user_role', array[]::text[], 'anon', array[]::text[], 'anon cannot execute private.current_user_role');
select function_privs_are('private', 'has_role', array['text'], 'authenticated', array['EXECUTE'], 'authenticated can execute private.has_role');
select function_privs_are('private', 'has_role', array['text'], 'anon', array[]::text[], 'anon cannot execute private.has_role');
select function_privs_are('public', 'get_my_access', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can call get_my_access');
select function_privs_are('public', 'get_my_access', array[]::text[], 'anon', array[]::text[], 'anon cannot call get_my_access');
-- service_role is a member of PUBLIC: no EXECUTE here proves PUBLIC has none either.
select function_privs_are('private', 'sync_profile_email', array[]::text[], 'service_role', array[]::text[], 'nobody can execute the email-sync trigger function');
select function_privs_are('private', 'validate_org_timezone', array[]::text[], 'authenticated', array[]::text[], 'clients cannot execute the timezone trigger function');
select function_privs_are('private', 'set_updated_at', array[]::text[], 'authenticated', array[]::text[], 'clients cannot execute set_updated_at');
select function_privs_are('private', 'profiles_email_from_auth', array[]::text[], 'service_role', array[]::text[], 'nobody can execute the profile email trigger function');
select function_privs_are('private', 'module_dependencies_no_cycle', array[]::text[], 'service_role', array[]::text[], 'nobody can execute the cycle-check trigger function');

-- Default privileges: a table/function created later by a migration starts closed.
create table public.zz_probe (id int primary key);
create function public.zz_probe_fn() returns int language sql as 'select 1';
select table_privs_are('public', 'zz_probe', 'anon', array[]::text[], 'new tables start closed for anon');
select table_privs_are('public', 'zz_probe', 'authenticated', array[]::text[], 'new tables start closed for authenticated');
select function_privs_are('public', 'zz_probe_fn', array[]::text[], 'anon', array[]::text[], 'new functions start closed for anon');
select function_privs_are('public', 'zz_probe_fn', array[]::text[], 'authenticated', array[]::text[], 'new functions start closed for authenticated');

-- =============================================================================
-- Constraints and triggers (as postgres)
-- =============================================================================
select results_eq($$ select key, is_system from public.roles order by key $$,
  $$ values ('admin'::text, true), ('admin_assistant'::text, true), ('counselor'::text, true), ('provider'::text, true) $$,
  'system roles are seeded');
select throws_ok($$ update public.organizations set timezone = 'Mars/Olympus' where id = 'b0000000-0000-0000-0000-00000000000b' $$,
  '22023', null, 'unknown timezone is rejected');
select lives_ok($$ update public.organizations set timezone = 'America/Vancouver' where id = 'b0000000-0000-0000-0000-00000000000b' $$,
  'valid timezone is accepted');
select throws_ok($$ update public.organizations set currency = 'cad' where id = 'b0000000-0000-0000-0000-00000000000b' $$,
  '23514', null, 'currency must be an ISO code');
select throws_ok($$ update public.organizations set default_locale = 'fr_CA' where id = 'b0000000-0000-0000-0000-00000000000b' $$,
  '23514', null, 'default_locale must be a supported locale');
select throws_ok($$ insert into public.modules (key, name) values ('settings', 'x') $$,
  '23514', null, 'core permission prefixes are reserved module keys');

-- profiles.email always comes from auth.users.
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Spare', 'ADMIN@a.test');
select is((select email from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000007'),
  'spare@a.test', 'profile email is copied from auth.users, whatever the insert says');
delete from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000007';
select throws_ok($$ insert into public.profiles (user_id, org_id, display_name, email) values ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'No mail', 'x@a.test') $$,
  '22023', null, 'a user without an auth email cannot get a profile');
select throws_ok($$ update auth.users set email = 'ADJOINTE@a.test' where id = 'a0000000-0000-0000-0000-000000000003' $$,
  '23505', null, 'an auth email clashing case-insensitively with another profile is refused');

-- Module dependency graph stays acyclic and never mentions core.
insert into public.modules (key, name) values
  ('cyc_a', 'A'), ('cyc_b', 'B'), ('cyc_c', 'C'), ('cyc_d', 'D'),
  ('dia_top', 'Top'), ('dia_left', 'Left'), ('dia_right', 'Right'), ('dia_base', 'Base');
insert into public.module_dependencies (module_key, depends_on) values ('cyc_a', 'cyc_b');
select throws_ok($$ insert into public.module_dependencies (module_key, depends_on) values ('cyc_b', 'cyc_a') $$,
  '23514', null, 'a 2-module cycle is rejected');
insert into public.module_dependencies (module_key, depends_on) values ('cyc_b', 'cyc_c');
select throws_ok($$ insert into public.module_dependencies (module_key, depends_on) values ('cyc_c', 'cyc_a') $$,
  '23514', null, 'a 3-module cycle is rejected');
insert into public.module_dependencies (module_key, depends_on) values ('cyc_c', 'cyc_d');
select throws_ok($$ update public.module_dependencies set depends_on = 'cyc_a' where module_key = 'cyc_c' and depends_on = 'cyc_d' $$,
  '23514', null, 'a cycle created by an update is rejected');
select lives_ok($$ insert into public.module_dependencies (module_key, depends_on) values
    ('dia_top', 'dia_left'), ('dia_top', 'dia_right'), ('dia_left', 'dia_base'), ('dia_right', 'dia_base') $$,
  'a diamond (shared dependency) is allowed');
select throws_ok($$ insert into public.module_dependencies (module_key, depends_on) values ('cyc_d', 'core') $$,
  '23514', null, 'a dependency on core is rejected');
select throws_ok($$ insert into public.module_dependencies (module_key, depends_on) values ('core', 'cyc_d') $$,
  '23514', null, 'core cannot have dependencies');
select throws_ok($$ insert into public.permissions (key, module_key, description) values ('other.view', 'test_mod', 'x') $$,
  '23514', null, 'permission key prefix must match its module');
select throws_ok($$ insert into public.permissions (key, module_key, description) values ('nope.view', 'nope', 'x') $$,
  '23503', null, 'permission module must exist');
select throws_ok($$ insert into public.module_dependencies (module_key, depends_on) values ('test_mod', 'test_mod') $$,
  '23514', null, 'a module cannot depend on itself');
select throws_ok($$ insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'owner') $$,
  '23503', null, 'role must exist in roles');
select throws_ok($$ insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin_assistant') $$,
  '23503', null, 'user_roles.org_id must match the profile org');

update auth.users set email = 'provider.new@a.test' where id = 'a0000000-0000-0000-0000-000000000003';
select is((select email from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000003'),
  'provider.new@a.test', 'auth email change is synced to the profile');

-- =============================================================================
-- RLS and helpers as authenticated
-- =============================================================================
set local role authenticated;

-- Admin A ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(private.has_permission('settings.manage'), 'admin has settings.manage by role default');
select ok(private.has_role('admin'), 'has_role recognises the admin');
select ok(not private.has_permission('nope.view'), 'an unknown permission key returns false');
select is(private.current_user_role(), 'admin', 'current_user_role returns text');
select results_eq('select count(*)::int from public.profiles', array[5], 'admin sees the 5 profiles of their own org only');
select results_eq('select id from public.organizations', array['b0000000-0000-0000-0000-00000000000a'::uuid], 'admin sees only their own organization');
select results_eq('select count(*)::int from public.user_roles', array[4], 'admin sees the roles of their own org only');
select results_eq('select count(*)::int from public.user_permission_overrides', array[3], 'admin sees the overrides of their own org only');
update public.profiles set display_name = 'Renamed by admin' where user_id = 'a0000000-0000-0000-0000-000000000002';
select is((select display_name from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000002'),
  'Adjointe A', 'profile self-update policy does not let admins rename others');
update public.organizations set name = 'Org A renamed' where id = 'b0000000-0000-0000-0000-00000000000a';
select is((select name from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'Org A renamed', 'admin with settings.manage can rename the org');

-- Adjointe A (override grant users.manage, override revoke users.view) --------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(private.has_permission('settings.view'), 'adjointe has settings.view by role default');
select ok(not private.has_permission('settings.manage'), 'adjointe lacks settings.manage');
select ok(private.has_permission('users.manage'), 'override grant adds users.manage');
select ok(not private.has_permission('users.view'), 'override revoke removes users.view');
select is(private.current_user_org_id(), 'b0000000-0000-0000-0000-00000000000a'::uuid, 'current_user_org_id returns own org');
select is(public.get_my_access() ->> 'role', 'admin_assistant', 'get_my_access returns the role');
select ok((public.get_my_access() -> 'permissions') ? 'users.manage', 'get_my_access includes granted override');
select ok(not ((public.get_my_access() -> 'permissions') ? 'users.view'), 'get_my_access excludes revoked permission');
select is(public.get_my_access() ->> 'org_timezone', 'America/Toronto', 'get_my_access returns the org timezone');
select is(public.get_my_access() ->> 'org_name', 'Org A renamed', 'get_my_access returns the org name');
select is(public.get_my_access() -> 'modules', '["test_mod"]'::jsonb, 'get_my_access returns enabled module keys');
select results_eq('select count(*)::int from public.profiles', array[1], 'adjointe without users.view sees only own profile');
select results_eq('select count(*)::int from public.user_roles', array[1], 'adjointe without users.view sees only own role');
update public.organizations set name = 'Hacked' where id = 'b0000000-0000-0000-0000-00000000000a';
select is((select name from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'Org A renamed', 'adjointe cannot rename the org');

-- Provider A ------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.has_permission('settings.view'), 'provider has no settings access');
select lives_ok($$ update public.profiles set display_name = 'Dr Provider' where user_id = auth.uid() $$, 'provider can rename themselves');
select is((select display_name from public.profiles where user_id = auth.uid()), 'Dr Provider', 'rename is applied');
select throws_ok($$ update public.profiles set status = 'disabled' where user_id = auth.uid() $$, '42501', null, 'provider cannot change own status');
select throws_ok($$ insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'admin') $$,
  '42501', null, 'clients cannot write roles');
select throws_ok($$ truncate public.permissions cascade $$, '42501', null, 'clients cannot truncate the permission catalogue');
select throws_ok($$ delete from public.role_permissions $$, '42501', null, 'clients cannot delete role defaults');
select throws_ok($$ insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'test_mod', true) $$,
  '42501', null, 'clients cannot write org_modules directly');

-- Disabled admin A ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(not private.has_permission('settings.manage'), 'disabled admin has no permissions');
select is(private.current_user_org_id(), null::uuid, 'disabled user has no current org');
select is(public.get_my_access() ->> 'status', 'disabled', 'get_my_access reports the disabled status');
select is(public.get_my_access() -> 'permissions', '[]'::jsonb, 'disabled user gets an empty permission list');
select is(public.get_my_access() -> 'modules', '[]'::jsonb, 'disabled user gets an empty module list');
select results_eq('select count(*)::int from public.profiles', array[0], 'disabled user sees no profiles');
update public.profiles set display_name = 'Still here' where user_id = auth.uid();
reset role;
select is((select display_name from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000004'),
  'Disabled A', 'disabled user cannot rename themselves');
set local role authenticated;

-- Active user without a role --------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(not private.has_permission('settings.view'), 'override grant is ignored without a role');
select is(public.get_my_access() -> 'permissions', '[]'::jsonb, 'role-less user gets an empty permission list');
select is(public.get_my_access() ->> 'role', null, 'role-less user has a null role');
select is(public.get_my_access() -> 'modules', '["test_mod"]'::jsonb, 'role-less active user still gets enabled modules');

-- Admin B (cross-org isolation) -----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq('select count(*)::int from public.profiles', array[1], 'org B admin sees only org B profiles');
select results_eq('select count(*)::int from public.user_roles', array[1], 'org B admin sees only org B roles');
select results_eq('select count(*)::int from public.user_permission_overrides', array[1], 'org B admin sees only org B overrides');
select results_eq('select id from public.organizations', array['b0000000-0000-0000-0000-00000000000b'::uuid], 'org B admin sees only org B');
select results_eq('select count(*)::int from public.org_modules where enabled', array[0], 'org B admin does not see org A enabled modules');
select ok(not private.has_permission('audit.view'), 'override revoke applies to admins too');
select is(public.get_my_access() -> 'modules', '[]'::jsonb, 'org B has no enabled modules');
update public.organizations set name = 'Hacked' where id = 'b0000000-0000-0000-0000-00000000000a';
reset role;
select is((select name from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'Org A renamed', 'org B admin cannot rename org A');
set local role authenticated;

-- No user ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select ok(not private.has_permission('settings.view'), 'no user means no permission');
select is(public.get_my_access(), null::jsonb, 'get_my_access returns null without a profile');

-- Anon ------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select count(*) from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select count(*) from public.permissions', '42501', null, 'anon cannot read the permission catalogue');

select * from finish();
rollback;
