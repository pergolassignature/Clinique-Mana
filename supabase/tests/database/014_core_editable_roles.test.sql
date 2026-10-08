-- Editable roles per clinic (migration *_core_editable_roles.sql, decision #40).
-- Covers: roles.manage, org_role_permissions (privileges, RLS, seeding, template
-- propagation that never undoes an org's removal), has_permission / get_my_access reading
-- the org's defaults, custom roles (keys, names, constraints, RLS), the four role RPCs
-- (refusals and success, the hold rule for non-admin managers), set_user_role with custom
-- roles and the org-default hold check, list_org_users, other-org isolation, the audit rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(125);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admins A1 and A2, counselors C and E, adjointe D (overrides roles.manage,
-- users.manage, users.view: a non-admin manager; she holds settings.view and
-- professionals.view by role), provider P. The professionals module is on in org A.
-- Org B: admin B, counselor CB, and a custom role custom_0000000b « Rôle B ».
-- Audit checks are limited to org A (audit_log is shared with the rest of the database).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@b.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A1',       'a1@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Admin A2',       'a2@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C',  'c@a.test'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D',     'd@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',        'b@b.test'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère E',  'e@a.test'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Provider P',     'p@a.test'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000b', 'Conseillère CB', 'cb@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000b', 'counselor');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'roles.manage', true),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.view',   true);

-- =============================================================================
-- Catalogue, schema, privileges
-- =============================================================================
select results_eq($$ select module_key, description from public.permissions where key = 'roles.manage' $$,
  $$ values ('core'::text, 'Gérer les rôles'::text) $$, 'roles.manage is a core permission');
select results_eq($$ select role from public.role_permissions where permission_key = 'roles.manage' $$,
  array['admin'], 'the template gives roles.manage to admin only');

select table_privs_are('public', 'org_role_permissions', 'anon', array[]::text[], 'anon: no privileges on org_role_permissions');
select table_privs_are('public', 'org_role_permissions', 'authenticated', array['SELECT'], 'authenticated: select only on org_role_permissions');
select table_privs_are('public', 'roles', 'authenticated', array['SELECT'], 'authenticated: still select only on roles');
select col_is_null('public', 'roles', 'org_id', 'roles.org_id is nullable (null = base role)');
select fk_ok('public', 'roles', 'org_id', 'public', 'organizations', 'id', 'roles.org_id references organizations');

-- Every org (the seed's, these fixtures') starts with exactly the template.
select is_empty($$
  (select o.id, rp.role, rp.permission_key from public.organizations o cross join public.role_permissions rp
   except
   select x.org_id, x.role, x.permission_key from public.org_role_permissions x)
  union all
  (select x.org_id, x.role, x.permission_key from public.org_role_permissions x
   except
   select o.id, rp.role, rp.permission_key from public.organizations o cross join public.role_permissions rp)
$$, 'each org''s role defaults equal the template (seeded for existing orgs, copied on insert)');
select is_empty($$
  select o.id, p.key from public.organizations o cross join public.permissions p
  except
  select x.org_id, x.permission_key from public.org_role_permissions x where x.role = 'admin'
$$, 'admin holds every permission in every org');
select throws_ok($$ insert into public.modules (key, name) values ('roles', 'x') $$,
  '23514', null, 'roles is a reserved core prefix, not a module key');

select function_privs_are('public', 'set_role_permission', array['text', 'text', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated can call set_role_permission');
select function_privs_are('public', 'create_role',         array['text', 'text'],            'authenticated', array['EXECUTE'], 'authenticated can call create_role');
select function_privs_are('public', 'rename_role',         array['text', 'text'],            'authenticated', array['EXECUTE'], 'authenticated can call rename_role');
select function_privs_are('public', 'delete_role',         array['text'],                    'authenticated', array['EXECUTE'], 'authenticated can call delete_role');
select function_privs_are('public', 'set_role_permission', array['text', 'text', 'boolean'], 'anon', array[]::text[], 'anon cannot call set_role_permission');
select function_privs_are('public', 'create_role',         array['text', 'text'],            'anon', array[]::text[], 'anon cannot call create_role');
select function_privs_are('public', 'rename_role',         array['text', 'text'],            'anon', array[]::text[], 'anon cannot call rename_role');
select function_privs_are('public', 'delete_role',         array['text'],                    'anon', array[]::text[], 'anon cannot call delete_role');
select function_privs_are('public', 'set_role_permission', array['text', 'text', 'boolean'], 'service_role', array[]::text[], 'service_role has no grant on set_role_permission');
select function_privs_are('public', 'create_role',         array['text', 'text'],            'service_role', array[]::text[], 'service_role has no grant on create_role');
select function_privs_are('public', 'rename_role',         array['text', 'text'],            'service_role', array[]::text[], 'service_role has no grant on rename_role');
select function_privs_are('public', 'delete_role',         array['text'],                    'service_role', array[]::text[], 'service_role has no grant on delete_role');
select function_privs_are('private', 'assert_can_manage_roles',            array[]::text[],          'authenticated', array[]::text[], 'clients cannot call assert_can_manage_roles');
select function_privs_are('private', 'valid_role_name',                    array['uuid', 'text', 'text'], 'authenticated', array[]::text[], 'clients cannot call valid_role_name');
select function_privs_are('private', 'check_role_org',                     array[]::text[],          'service_role',  array[]::text[], 'nobody can execute the role-org trigger function');
select function_privs_are('private', 'seed_org_role_permissions',          array[]::text[],          'service_role',  array[]::text[], 'nobody can execute the org seeding trigger function');
select function_privs_are('private', 'propagate_template_role_permission', array[]::text[],          'service_role',  array[]::text[], 'nobody can execute the template propagation trigger function');
select ok(
  (select bool_and(p.prosrc ~ 'for no key update') from pg_proc p
    where p.oid in ('private.assert_can_manage_roles()'::regprocedure, 'public.set_user_role(uuid, text)'::regprocedure)),
  'the role RPCs and set_user_role lock the org row (FOR NO KEY UPDATE)');

-- =============================================================================
-- Constraints (as postgres)
-- =============================================================================
select throws_ok($$ insert into public.roles (key, name, org_id) values ('custom_zzzzzzzz', 'X', 'b0000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'a custom key is custom_ + 8 hex characters');
select throws_ok($$ insert into public.roles (key, name, org_id) values ('extra_role', 'X', 'b0000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'an org role must have a custom_ key');
select throws_ok($$ insert into public.roles (key, name) values ('custom_0123abcd', 'X') $$,
  '23514', null, 'a custom_ key needs an org');
select throws_ok($$ insert into public.roles (key, name, org_id) values ('custom_0123abcd', ' X', 'b0000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'a role name is stored trimmed');
select throws_ok($$ insert into public.roles (key, name, is_system, org_id) values ('custom_0123abcd', 'X', true, 'b0000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'a custom role is never a system role');

insert into public.roles (key, name, org_id) values ('custom_0000000b', 'Rôle B', 'b0000000-0000-0000-0000-00000000000b');
select throws_ok($$ update public.user_roles set role = 'custom_0000000b' where user_id = 'a0000000-0000-0000-0000-000000000006' $$,
  '23514', null, 'a user cannot hold another org''s custom role');
select throws_ok($$ insert into public.org_role_permissions (org_id, role, permission_key) values ('b0000000-0000-0000-0000-00000000000a', 'custom_0000000b', 'audit.view') $$,
  '23514', null, 'an org cannot hold defaults for another org''s custom role');
select throws_ok($$ insert into public.role_permissions (role, permission_key) values ('custom_0000000b', 'audit.view') $$,
  '23514', null, 'the template holds base roles only');
select throws_ok($$ insert into public.roles (key, name, org_id) values ('custom_0000000c', 'rôle b', 'b0000000-0000-0000-0000-00000000000b') $$,
  '23505', null, 'role names are unique per org, case-insensitively');

-- =============================================================================
-- RLS and refusals without roles.manage: counselor C (org A)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select results_eq($$ select key from public.roles order by key $$,
  array['admin', 'admin_assistant', 'counselor', 'provider'], 'C sees the base roles, not org B''s custom role');
select ok(
  (select count(*) filter (where org_id = 'b0000000-0000-0000-0000-00000000000a') > 0
      and count(*) filter (where org_id <> 'b0000000-0000-0000-0000-00000000000a') = 0
     from public.org_role_permissions),
  'C sees her own org''s role defaults only');
select throws_ok($$ insert into public.org_role_permissions (org_id, role, permission_key) values ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'audit.view') $$,
  '42501', null, 'clients cannot write role defaults directly');
select throws_ok($$ update public.roles set name = 'X' where key = 'counselor' $$,
  '42501', null, 'clients cannot rename roles directly');
select throws_ok($$ select public.create_role('X') $$, '42501', null, 'without roles.manage, create_role is refused');
select throws_ok($$ select public.set_role_permission('counselor', 'audit.view', true) $$, '42501', null, 'without roles.manage, set_role_permission is refused');
select throws_ok($$ select public.rename_role('counselor', 'X') $$, '42501', null, 'without roles.manage, rename_role is refused');
select throws_ok($$ select public.delete_role('counselor') $$, '42501', null, 'without roles.manage, delete_role is refused');

-- =============================================================================
-- Admin A1: create_role
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select matches(public.create_role(E'  Stagiaire \t'), '^custom_[0-9a-f]{8}$', 'create_role returns a custom_ + 8 hex key');
select set_config('test.k1', (select key from public.roles where name = 'Stagiaire'), true);
select results_eq($$ select name, org_id, is_system from public.roles where key = current_setting('test.k1') $$,
  $$ values ('Stagiaire'::text, 'b0000000-0000-0000-0000-00000000000a'::uuid, false) $$,
  'the new role belongs to org A, its name trimmed');
select is_empty($$ select 1 from public.org_role_permissions where role = current_setting('test.k1') $$,
  'a new role starts with no permissions');
select throws_ok($$ select public.create_role('STAGIAIRE') $$,
  'P0001', 'Un rôle porte déjà ce nom.', 'names are unique in the org, case-insensitively');
select throws_ok($$ select public.create_role('administrateur') $$,
  'P0001', 'Un rôle porte déjà ce nom.', 'a custom role cannot take a base role''s name');
select lives_ok($$ select public.create_role('Rôle B') $$, 'another org''s role name is free in org A');
select throws_ok($$ select public.create_role(E' \t ') $$,
  'P0001', 'Le nom du rôle est requis.', 'a blank name is refused');
select throws_ok($$ select public.create_role(null) $$,
  'P0001', 'Le nom du rôle est requis.', 'a null name is refused');
select throws_ok($$ select public.create_role(repeat('x', 61)) $$,
  'P0001', 'Le nom du rôle ne peut pas dépasser 60 caractères.', 'a name over 60 characters is refused');
select matches(public.create_role('Copie adjointe', 'admin_assistant'), '^custom_[0-9a-f]{8}$', 'create_role copies another role');
select set_config('test.k2', (select key from public.roles where name = 'Copie adjointe'), true);
select results_eq($$ select permission_key from public.org_role_permissions where role = current_setting('test.k2') order by 1 $$,
  array['professionals.view', 'settings.view'], 'the copy starts with the adjointe''s permissions');
select throws_ok($$ select public.create_role('X', 'nope') $$, '22023', null, 'copying an unknown role is a technical error');
select throws_ok($$ select public.create_role('X', 'custom_0000000b') $$, '22023', null, 'another org''s role cannot be copied');

-- =============================================================================
-- Admin A1: set_role_permission
-- =============================================================================
select lives_ok(format($$ select public.set_role_permission(%L, 'audit.view', true) $$, current_setting('test.k1')),
  'A1 gives audit.view to the custom role');
select lives_ok(format($$ select public.set_role_permission(%L, 'audit.view', true) $$, current_setting('test.k1')),
  'giving it again is a no-op');
select results_eq($$ select permission_key from public.org_role_permissions where role = current_setting('test.k1') $$,
  array['audit.view'], 'the custom role has audit.view');
select throws_ok($$ select public.set_role_permission('admin', 'audit.view', false) $$,
  'P0001', 'L''administrateur a toujours toutes les permissions.', 'the admin role cannot be edited');
select throws_ok(format($$ select public.set_role_permission(%L, 'nope.view', true) $$, current_setting('test.k1')),
  '22023', null, 'an unknown permission is a technical error');
select throws_ok($$ select public.set_role_permission('nope', 'audit.view', true) $$,
  '22023', null, 'an unknown role is a technical error');
select throws_ok($$ select public.set_role_permission('custom_0000000b', 'audit.view', true) $$,
  '22023', null, 'another org''s custom role is unknown');
select throws_ok(format($$ select public.set_role_permission(%L, 'audit.view', null) $$, current_setting('test.k1')),
  '22023', null, 'the granted flag is required');

-- A base role, for org A only.
select lives_ok($$ select public.set_role_permission('counselor', 'settings.view', true) $$, 'A1 gives settings.view to counselors');
select lives_ok($$ select public.set_role_permission('counselor', 'professionals.view', false) $$, 'A1 removes professionals.view from counselors');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.has_permission('settings.view'), 'has_permission follows the org change at once (grant)');
select ok(not private.has_permission('professionals.view'), 'has_permission follows the org change at once (removal)');
select is(public.get_my_access() -> 'permissions', '["settings.view"]'::jsonb, 'get_my_access reads the org''s defaults');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select ok(not private.has_permission('settings.view'), 'org B''s counselors are unaffected');
reset role;
select results_eq($$ select permission_key from public.role_permissions where role = 'counselor' $$,
  array['professionals.view'], 'the template is unaffected');
set local role authenticated;

-- =============================================================================
-- Admin A1: rename_role
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(format($$ select public.rename_role(%L, '  Stagiaire senior ') $$, current_setting('test.k1')), 'A1 renames the custom role');
select is((select name from public.roles where key = current_setting('test.k1')), 'Stagiaire senior', 'the new name is stored trimmed');
select lives_ok(format($$ select public.rename_role(%L, 'stagiaire SENIOR') $$, current_setting('test.k1')),
  'a role may change the case of its own name');
select throws_ok(format($$ select public.rename_role(%L, 'copie ADJOINTE') $$, current_setting('test.k1')),
  'P0001', 'Un rôle porte déjà ce nom.', 'renaming onto another role''s name is refused');
select throws_ok($$ select public.rename_role('counselor', 'Intervenante') $$,
  'P0001', 'Les rôles de base ne peuvent pas être renommés.', 'base roles cannot be renamed');
select throws_ok($$ select public.rename_role('custom_0000000b', 'X') $$, '22023', null, 'another org''s role cannot be renamed');
select throws_ok(format($$ select public.rename_role(%L, '') $$, current_setting('test.k1')),
  'P0001', 'Le nom du rôle est requis.', 'renaming to a blank name is refused');

-- =============================================================================
-- Admin A1: set_user_role with custom roles, list_org_users
-- =============================================================================
select lives_ok(format($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', %L) $$, current_setting('test.k1')),
  'A1 gives E the custom role');
select results_eq($$ select role, role_name from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000006' $$,
  format($$ values (%L::text, 'stagiaire SENIOR'::text) $$, current_setting('test.k1')),
  'list_org_users returns the custom role''s name');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', 'custom_0000000b') $$,
  '22023', null, 'another org''s custom role cannot be given');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', 'provider') $$,
  'P0001', 'Le rôle Professionnel se gère dans le module Professionnels.', 'the provider role is still refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(private.has_permission('audit.view') and not private.has_permission('settings.view'),
  'E holds exactly the custom role''s defaults');

-- =============================================================================
-- Admin A1: delete_role
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(format($$ select public.delete_role(%L) $$, current_setting('test.k1')),
  'P0001', 'Ce rôle est attribué à 1 personne(s).', 'an assigned role cannot be deleted');
select throws_ok($$ select public.delete_role('counselor') $$,
  'P0001', 'Les rôles de base ne peuvent pas être supprimés.', 'base roles cannot be deleted');
select throws_ok($$ select public.delete_role('admin') $$,
  'P0001', 'Les rôles de base ne peuvent pas être supprimés.', 'the admin role cannot be deleted');
select throws_ok($$ select public.delete_role('custom_0000000b') $$, '22023', null, 'another org''s role cannot be deleted');
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', 'counselor') $$, 'E goes back to counselor');
select lives_ok(format($$ select public.delete_role(%L) $$, current_setting('test.k1')), 'an unassigned custom role can be deleted');
select is_empty($$ select 1 from public.roles where key = current_setting('test.k1') $$, 'the role is gone');
reset role;
select is_empty($$ select 1 from public.org_role_permissions where role = current_setting('test.k1') $$, 'its defaults are gone too');

-- =============================================================================
-- Non-admin manager D: the hold rule
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(format($$ select public.set_role_permission(%L, 'settings.manage', true) $$, current_setting('test.k2')),
  'A1 gives settings.manage (which D lacks) to « Copie adjointe »');
select lives_ok($$ select public.set_role_permission('counselor', 'audit.view', true) $$,
  'A1 gives audit.view (which D lacks) to org A''s counselors');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_role_permission(%L, 'audit.view', true) $$, current_setting('test.k2')),
  'P0001', 'Vous ne pouvez pas accorder une permission que vous n''avez pas.', 'D cannot give a role a permission she lacks');
select lives_ok(format($$ select public.set_role_permission(%L, 'users.view', true) $$, current_setting('test.k2')),
  'D gives a role a permission she holds (by override)');
select throws_ok($$ select public.set_role_permission('admin', 'audit.view', true) $$,
  'P0001', 'L''administrateur a toujours toutes les permissions.', 'D cannot edit the admin role either');
select throws_ok(format($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', %L) $$, current_setting('test.k2')),
  'P0001', 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.',
  'set_user_role: D cannot give a custom role carrying a permission she lacks');
select throws_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000003', 'counselor') $$,
  'P0001', 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.',
  'set_user_role reads the org''s defaults: counselor carries audit.view in org A (not in the template)');
select lives_ok(format($$ select public.set_role_permission(%L, 'settings.manage', false) $$, current_setting('test.k2')),
  'D may remove a permission she lacks from a role');
select lives_ok(format($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', %L) $$, current_setting('test.k2')),
  'D now gives E « Copie adjointe »');
select throws_ok($$ select public.create_role('Copie admin', 'admin') $$,
  'P0001', 'Vous ne pouvez pas copier un rôle qui donne des permissions que vous n''avez pas.',
  'D cannot copy a role carrying permissions she lacks');
select lives_ok($$ select public.create_role('Copie conseillère') $$, 'D creates an empty role');
select lives_ok($$ select public.rename_role((select key from public.roles where name = 'Copie conseillère'), 'Accueil') $$,
  'D renames it');
select lives_ok($$ select public.delete_role((select key from public.roles where name = 'Accueil')) $$, 'D deletes it');

-- Lock-out: admins keep everything, whatever managers did.
reset role;
select is_empty($$
  select p.key from public.permissions p
  except
  select x.permission_key from public.org_role_permissions x
   where x.org_id = 'b0000000-0000-0000-0000-00000000000a' and x.role = 'admin'
$$, 'org A''s admins still hold every permission');

-- =============================================================================
-- Admin B: org A's roles are out of reach
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq($$ select key from public.roles where org_id is not null $$,
  array['custom_0000000b'], 'admin B sees only org B''s custom role');
select ok(private.has_permission('roles.manage'), 'admin B holds roles.manage');
select throws_ok(format($$ select public.rename_role(%L, 'X') $$, current_setting('test.k2')),
  '22023', null, 'admin B cannot rename an org A role');
select throws_ok(format($$ select public.set_role_permission(%L, 'audit.view', true) $$, current_setting('test.k2')),
  '22023', null, 'admin B cannot edit an org A role');
select throws_ok(format($$ select public.delete_role(%L) $$, current_setting('test.k2')),
  '22023', null, 'admin B cannot delete an org A role');

-- =============================================================================
-- Template propagation (as postgres, as a module migration would)
-- =============================================================================
reset role;
insert into public.modules (key, name) values ('test_roles', 'Module test');
insert into public.permissions (key, module_key, description) values ('test_roles.view', 'test_roles', 'Voir');
insert into public.role_permissions (role, permission_key) values ('admin', 'test_roles.view'), ('counselor', 'test_roles.view');
select is_empty($$
  select o.id from public.organizations o
   where not exists (select 1 from public.org_role_permissions x
                      where x.org_id = o.id and x.role = 'counselor' and x.permission_key = 'test_roles.view')
      or not exists (select 1 from public.org_role_permissions x
                      where x.org_id = o.id and x.role = 'admin' and x.permission_key = 'test_roles.view')
$$, 'a new template row reaches every existing org');
select lives_ok($$ insert into public.role_permissions (role, permission_key) values ('counselor', 'professionals.view') on conflict do nothing $$,
  'a later migration re-inserts an existing template row');
select ok(not exists (select 1 from public.org_role_permissions
                       where org_id = 'b0000000-0000-0000-0000-00000000000a' and role = 'counselor' and permission_key = 'professionals.view'),
  'an org''s removal survives it');
select lives_ok($$ insert into public.role_permissions (role, permission_key) values ('counselor', 'settings.view') $$,
  'a new template row that an org already added is accepted');
select ok(exists (select 1 from public.org_role_permissions
                   where org_id = 'b0000000-0000-0000-0000-00000000000b' and role = 'counselor' and permission_key = 'settings.view'),
  'and reaches the orgs that lacked it');

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000c', 'Org C');
select is_empty($$
  (select rp.role, rp.permission_key from public.role_permissions rp
   except
   select x.role, x.permission_key from public.org_role_permissions x where x.org_id = 'b0000000-0000-0000-0000-00000000000c')
  union all
  (select x.role, x.permission_key from public.org_role_permissions x where x.org_id = 'b0000000-0000-0000-0000-00000000000c'
   except
   select rp.role, rp.permission_key from public.role_permissions rp)
$$, 'a new org starts with the current template');

-- =============================================================================
-- Audit (as postgres, org A only)
-- =============================================================================
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'roles' and action = 'insert' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = current_setting('test.k2') and actor_id = 'a0000000-0000-0000-0000-000000000001'
     and changed_fields ->> 'name' = 'Copie adjointe'
), 'creating a role is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'roles' and action = 'update' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = current_setting('test.k1')
     and changed_fields -> 'name' = '{"before": "Stagiaire", "after": "Stagiaire senior"}'::jsonb
), 'renaming a role is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'roles' and action = 'delete' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = current_setting('test.k1') and actor_id = 'a0000000-0000-0000-0000-000000000001'
), 'deleting a role is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'org_role_permissions' and action = 'insert' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = 'b0000000-0000-0000-0000-00000000000a:counselor:settings.view'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
), 'giving a role a permission is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'org_role_permissions' and action = 'delete' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = 'b0000000-0000-0000-0000-00000000000a:counselor:professionals.view'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
), 'removing a permission from a role is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'org_role_permissions' and action = 'delete' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = 'b0000000-0000-0000-0000-00000000000a:' || current_setting('test.k1') || ':audit.view'
), 'deleting a role audits the removal of its defaults');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'org_role_permissions' and action = 'insert' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and record_id = 'b0000000-0000-0000-0000-00000000000a:' || current_setting('test.k2') || ':users.view'
     and actor_id = 'a0000000-0000-0000-0000-000000000004'
), 'a change by a non-admin manager names her as actor');

select * from finish();
rollback;
