-- Professionals module registration (migration 20261007140859_professionals_module.sql).
-- The module's tables arrive in Phase 4; this checks the registry entries only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select results_eq($$ select name from public.modules where key = 'professionals' $$,
  array['Professionnels'], 'module professionals is registered with its French label');
select results_eq($$ select module_key from public.permissions where key = 'professionals.view' $$,
  array['professionals'], 'professionals.view belongs to the professionals module');
select results_eq($$ select role from public.role_permissions where permission_key = 'professionals.view' order by role $$,
  array['admin', 'admin_assistant', 'counselor'], 'admin, adjointe and conseillère get professionals.view by default, provider does not');
select is((select count(*)::int from public.module_dependencies where module_key = 'professionals'), 0, 'professionals has no dependencies');

-- Behaviour in a fresh org.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
-- Provider gets professionals.view by override (not a role default).
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select ok(not public.module_enabled('professionals'), 'professionals starts disabled in a new org');
select results_eq($$ select key, depends_on, enabled from public.list_modules() $$,
  $$ values ('professionals'::text, array[]::text[], false) $$, 'list_modules shows professionals, disabled');

-- Module gate: a disabled module grants nothing.
select ok(not private.has_permission('professionals.view'), 'disabled module: role default does not apply');
select ok(not ((public.get_my_access() -> 'permissions') ? 'professionals.view'), 'disabled module: get_my_access omits its permissions');
select ok(private.has_permission('settings.manage'), 'core permissions are unaffected by module state');
select ok((public.get_my_access() -> 'permissions') ? 'settings.manage', 'get_my_access keeps core permissions');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.has_permission('professionals.view'), 'disabled module: an override grant does not apply');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_module_enabled('professionals', true) $$, 'admin enables professionals');
select ok(private.has_permission('professionals.view'), 'enabled module: role default applies');
select ok((public.get_my_access() -> 'permissions') ? 'professionals.view', 'enabled module: get_my_access includes professionals.view');
select is(public.get_my_access() -> 'modules', '["professionals"]'::jsonb, 'get_my_access lists professionals once enabled');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.has_permission('professionals.view'), 'enabled module: the override grant applies');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_module_enabled('professionals', false) $$, 'admin disables professionals');
select ok(not ((public.get_my_access() -> 'permissions') ? 'professionals.view'), 'disabling a module removes its permissions from get_my_access');
select is(public.get_my_access() -> 'modules', '[]'::jsonb, 'and from the module list');

select * from finish();
rollback;
