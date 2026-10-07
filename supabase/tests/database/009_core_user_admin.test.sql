-- User administration (migration *_core_user_admin.sql): list_org_users, set_user_role,
-- set_user_status, set_permission_override, clear_permission_override, and the
-- « at least one active admin » triggers.
-- Covers: privileges (private helpers only through function_privs_are), every guard
-- and its French message, a non-admin manager, the last-admin rule on every write
-- path, audit of override changes, org isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(94);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admins A1 and A2, counselor C, adjointe D (overrides users.manage and
-- users.view: a non-admin manager), provider P, profile E without a role.
-- Org B: admin B. Org A has the professionals module on (D holds professionals.view).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@b.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@a.test',  '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A1',   'a1@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Admin A2',   'a2@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@a.test'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D', 'd@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'b@b.test'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Provider P', 'p@a.test'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Sans rôle E', 'e@a.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.view',   true);
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'list_org_users',            array[]::text[],                    'authenticated', array['EXECUTE'], 'authenticated can call list_org_users');
select function_privs_are('public', 'set_user_role',             array['uuid', 'text'],              'authenticated', array['EXECUTE'], 'authenticated can call set_user_role');
select function_privs_are('public', 'set_user_status',           array['uuid', 'text'],              'authenticated', array['EXECUTE'], 'authenticated can call set_user_status');
select function_privs_are('public', 'set_permission_override',   array['uuid', 'text', 'boolean'],   'authenticated', array['EXECUTE'], 'authenticated can call set_permission_override');
select function_privs_are('public', 'clear_permission_override', array['uuid', 'text'],              'authenticated', array['EXECUTE'], 'authenticated can call clear_permission_override');
select function_privs_are('public', 'list_org_users',            array[]::text[],                    'anon', array[]::text[], 'anon cannot call list_org_users');
select function_privs_are('public', 'set_user_role',             array['uuid', 'text'],              'anon', array[]::text[], 'anon cannot call set_user_role');
select function_privs_are('public', 'set_user_status',           array['uuid', 'text'],              'anon', array[]::text[], 'anon cannot call set_user_status');
select function_privs_are('public', 'set_permission_override',   array['uuid', 'text', 'boolean'],   'anon', array[]::text[], 'anon cannot call set_permission_override');
select function_privs_are('public', 'clear_permission_override', array['uuid', 'text'],              'anon', array[]::text[], 'anon cannot call clear_permission_override');
select function_privs_are('public', 'list_org_users',            array[]::text[],                    'service_role', array[]::text[], 'service_role has no grant on list_org_users');
select function_privs_are('public', 'set_user_role',             array['uuid', 'text'],              'service_role', array[]::text[], 'service_role has no grant on set_user_role');
select function_privs_are('public', 'set_user_status',           array['uuid', 'text'],              'service_role', array[]::text[], 'service_role has no grant on set_user_status');
select function_privs_are('public', 'set_permission_override',   array['uuid', 'text', 'boolean'],   'service_role', array[]::text[], 'service_role has no grant on set_permission_override');
select function_privs_are('public', 'clear_permission_override', array['uuid', 'text'],              'service_role', array[]::text[], 'service_role has no grant on clear_permission_override');
select function_privs_are('private', 'ensure_active_admin',    array[]::text[], 'authenticated', array[]::text[], 'clients cannot execute the last-admin trigger function');
select function_privs_are('private', 'ensure_active_admin',    array[]::text[], 'service_role',  array[]::text[], 'service_role cannot execute the last-admin trigger function');
select function_privs_are('private', 'assert_can_manage_user', array['uuid'],   'authenticated', array[]::text[], 'clients cannot call assert_can_manage_user directly');
select function_privs_are('private', 'assert_can_manage_user', array['uuid'],   'service_role',  array[]::text[], 'service_role cannot call assert_can_manage_user');

-- =============================================================================
-- list_org_users
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.list_org_users()), 6, 'A1 lists the 6 users of org A');
select ok(not exists (select 1 from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000005'),
  'org B users are not listed');
select results_eq(
  $$ select role, role_name, status from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000003' $$,
  $$ values ('counselor'::text, 'Conseillère'::text, 'active'::text) $$,
  'list_org_users returns the role key, its French name and the status');
select is((select override_count from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000004'), 2,
  'list_org_users counts D''s overrides');
select is((select role from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000007'), null,
  'a profile without a role is listed with a null role');
select ok((select bool_and(last_sign_in_at is null) from public.list_org_users()),
  'last_sign_in_at comes from auth.users (null in fixtures)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_org_users() $$, '42501', null, 'a counselor cannot list users');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000007', 'counselor') $$,
  '42501', null, 'a counselor cannot change roles');

-- =============================================================================
-- set_user_role as admin A1
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'admin_assistant') $$,
  'A1 makes C an adjointe');
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000007', 'counselor') $$,
  'A1 gives E (no role) a role');
select is((select role from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000007'), 'counselor',
  'E now has the counselor role');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000001', 'counselor') $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».', 'nobody changes their own role');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', 'counselor') $$,
  'P0001', 'Le rôle Professionnel se gère dans le module Professionnels.', 'the provider role cannot be removed here');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'provider') $$,
  'P0001', 'Le rôle Professionnel se gère dans le module Professionnels.', 'the provider role cannot be given here');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'staff') $$,
  '22023', null, 'unknown role is a technical error');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000005', 'counselor') $$,
  'P0001', 'Utilisateur introuvable.', 'a user of another org is not found');

-- =============================================================================
-- Adjointe D: manages non-admins only, grants only what she holds
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000002', 'counselor') $$,
  'P0001', 'Seul un administrateur peut modifier un administrateur.', 'a non-admin cannot change an admin');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'admin') $$,
  'P0001', 'Seul un administrateur peut modifier un administrateur.', 'a non-admin cannot make someone admin');
select throws_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000001', 'disabled') $$,
  'P0001', 'Seul un administrateur peut modifier un administrateur.', 'a non-admin cannot disable an admin');
select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000003', 'settings.manage', true) $$,
  'P0001', 'Vous ne pouvez pas accorder une permission que vous n''avez pas.', 'a non-admin cannot grant a permission she lacks');
select lives_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000003', 'professionals.view', true) $$,
  'a non-admin grants a permission she holds');
select is((select override_count from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000003'), 1,
  'C now has one override');
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'counselor') $$,
  'a non-admin manager changes a non-admin''s role');
select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000004', 'settings.view', true) $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».', 'nobody changes their own overrides');

-- =============================================================================
-- Admin A1: promoting clears overrides
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'admin') $$, 'A1 makes C admin');
select is((select override_count from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'becoming admin clears the overrides');
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'counselor') $$, 'A1 makes C counselor again');

-- =============================================================================
-- set_user_status
-- =============================================================================
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'disabled') $$, 'A1 disables C');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_my_access() -> 'permissions', '[]'::jsonb, 'a disabled user has no permissions');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'active') $$,
  'P0001', 'Seul un administrateur peut réactiver un compte.', 'a non-admin manager cannot re-enable an account');
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000007', 'disabled') $$, 'a non-admin manager disables a non-admin');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000001', 'disabled') $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».', 'nobody disables themselves');
select throws_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'archived') $$,
  '22023', null, 'unknown status is a technical error');
-- Account access is core: an admin may disable a provider (the professional's lifecycle is separate).
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000006', 'disabled') $$, 'an admin disables a provider''s account');
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000006', 'active') $$, 'an admin re-enables a provider''s account');
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000002', 'disabled') $$,
  'A1 disables A2 (A1 is still an active admin)');

-- =============================================================================
-- Last active admin: every write path (as postgres). A2 is disabled, A1 is the last one.
-- =============================================================================
reset role;
select throws_ok($$ update public.user_roles set role = 'counselor' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'the last active admin cannot be demoted');
select throws_ok($$ delete from public.user_roles where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'the last active admin''s role cannot be deleted');
select throws_ok($$ update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'the last active admin cannot be disabled');
select throws_ok($$ delete from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'the last active admin''s profile cannot be deleted');
select throws_ok($$ update public.user_roles set role = 'counselor' where user_id = 'a0000000-0000-0000-0000-000000000005' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'org B''s only admin cannot be demoted either');
select throws_ok($$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000000005' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'deleting the last admin''s auth user is refused (cascade)');
select lives_ok($$ update public.user_roles set role = 'counselor' where user_id = 'a0000000-0000-0000-0000-000000000002' $$,
  'a disabled admin can be demoted while an active admin remains');
update public.user_roles set role = 'admin' where user_id = 'a0000000-0000-0000-0000-000000000002';

set local role authenticated;
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000002', 'active') $$, 'A1 re-enables A2');
select is((select status from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000002'), 'active',
  'A2 is active again');
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'active') $$, 'A1 re-enables C');
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000007', 'active') $$, 'A1 re-enables E (admin re-enable works)');
reset role;
select throws_ok($$ update public.user_roles set role = 'counselor' where user_id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'demoting both admins in one statement is refused');
set local role authenticated;

-- =============================================================================
-- Permission overrides
-- =============================================================================
select lives_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000003', 'audit.view', true) $$,
  'A1 grants C audit.view');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.has_permission('audit.view'), 'C now has audit.view');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.clear_permission_override('a0000000-0000-0000-0000-000000000003', 'audit.view') $$,
  'A1 clears the override');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.has_permission('audit.view'), 'C no longer has audit.view');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000002', 'audit.view', true) $$,
  'P0001', 'Un administrateur a déjà toutes les permissions.', 'no overrides on an admin');
select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000003', 'nope.view', true) $$,
  '22023', null, 'unknown permission is a technical error');
select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000003', 'audit.view', null) $$,
  '22023', null, 'the granted flag is required');
select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000001', 'audit.view', false) $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».', 'nobody changes their own overrides (admin)');
select throws_ok($$ select public.clear_permission_override('a0000000-0000-0000-0000-000000000001', 'audit.view') $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».', 'nobody clears their own overrides');

-- =============================================================================
-- No overrides on admins, at the table level (as postgres)
-- =============================================================================
reset role;
select throws_ok($$ insert into public.user_permission_overrides (user_id, org_id, permission_key, granted)
                    values ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'audit.view', false) $$,
  'P0001', 'Un administrateur a déjà toutes les permissions.', 'an override on an admin is refused by the table trigger');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted)
values ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'audit.view', true);
select lives_ok($$ update public.user_roles set role = 'admin' where user_id = 'a0000000-0000-0000-0000-000000000007' $$, 'E is promoted directly in SQL');
select is((select count(*)::int from public.user_permission_overrides where user_id = 'a0000000-0000-0000-0000-000000000007'), 0,
  'becoming admin by any write path deletes the overrides');
update public.user_roles set role = 'counselor' where user_id = 'a0000000-0000-0000-0000-000000000007';

-- =============================================================================
-- Non-admin managers never give what they do not hold
-- =============================================================================
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage', false),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view', false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.clear_permission_override('a0000000-0000-0000-0000-000000000003', 'settings.manage') $$,
  'P0001', 'Vous ne pouvez pas accorder une permission que vous n''avez pas.', 'D cannot clear a revoke on a permission she lacks');
select lives_ok($$ select public.clear_permission_override('a0000000-0000-0000-0000-000000000003', 'professionals.view') $$,
  'D clears a revoke on a permission she holds');
select throws_ok($$ select public.clear_permission_override('a0000000-0000-0000-0000-000000000002', 'audit.view') $$,
  'P0001', 'Seul un administrateur peut modifier un administrateur.', 'a non-admin cannot clear an admin''s overrides');

-- C (counselor) becomes a manager by override: she lacks settings.view, an adjointe default.
reset role;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted)
values ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000007', 'admin_assistant') $$,
  'P0001', 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.',
  'a counselor-manager cannot give the adjointe role (settings.view)');
-- E is an adjointe (set as postgres) so the next call really changes the role.
reset role;
update public.user_roles set role = 'admin_assistant' where user_id = 'a0000000-0000-0000-0000-000000000007';
set local role authenticated;
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000007', 'counselor') $$,
  'a counselor-manager may give a role whose permissions she holds');
reset role;  -- C has no users.view: read E's role as postgres
select is((select r.role from public.user_roles r where r.user_id = 'a0000000-0000-0000-0000-000000000007'), 'counselor',
  'E changed from adjointe to counselor');
set local role authenticated;

-- =============================================================================
-- Admin B: org A is out of reach
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select results_eq($$ select user_id from public.list_org_users() $$,
  array['a0000000-0000-0000-0000-000000000005'::uuid], 'org B admin lists only org B');
select throws_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'disabled') $$,
  'P0001', 'Utilisateur introuvable.', 'org B admin cannot disable an org A user');
select throws_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000003', 'audit.view', true) $$,
  'P0001', 'Utilisateur introuvable.', 'org B admin cannot add an override in org A');

-- =============================================================================
-- Audit (as postgres)
-- =============================================================================
reset role;

select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_roles' and action = 'update'
     and record_id = 'a0000000-0000-0000-0000-000000000003'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
     and changed_fields -> 'role' = '{"before": "counselor", "after": "admin_assistant"}'::jsonb
), 'a role change is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_permission_overrides' and action = 'insert'
     and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and changed_fields ->> 'permission_key' = 'audit.view'
     and changed_fields ->> 'created_by' = 'a0000000-0000-0000-0000-000000000001'
), 'granting an override is audited with created_by');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_permission_overrides' and action = 'insert'
     and changed_fields ->> 'permission_key' = 'professionals.view'
     and changed_fields ->> 'created_by' = 'a0000000-0000-0000-0000-000000000004'
), 'an override granted by the adjointe records her as created_by');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_permission_overrides' and action = 'delete'
     and changed_fields ->> 'permission_key' = 'audit.view'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
), 'clearing an override is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_permission_overrides' and action = 'delete'
     and changed_fields ->> 'permission_key' = 'professionals.view'
     and record_id like 'a0000000-0000-0000-0000-000000000003:%'
), 'overrides cleared by a promotion to admin are audited');

select ok(exists (
  select 1 from public.audit_log
   where table_name = 'profiles' and action = 'update' and record_id = 'a0000000-0000-0000-0000-000000000003'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
     and changed_fields -> 'status' = '{"before": "active", "after": "disabled"}'::jsonb
), 'a status change is audited on profiles');

select * from finish();
rollback;
