-- Professionals module registration (migration 20261007140859_professionals_module.sql).
-- The module's tables arrive in Phase 4; this checks the registry entries only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select results_eq($$ select name from public.modules where key = 'professionals' $$,
  array['Professionnels'], 'module professionals is registered with its French label');
select results_eq($$ select module_key from public.permissions where key = 'professionals.view' $$,
  array['professionals'], 'professionals.view belongs to the professionals module');
select results_eq($$ select role from public.role_permissions where permission_key = 'professionals.view' order by role $$,
  array['admin', 'staff'], 'admin and staff get professionals.view by default, provider does not');
select is((select count(*)::int from public.module_dependencies where module_key = 'professionals'), 0, 'professionals has no dependencies');

-- Behaviour in a fresh org.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select ok(not public.module_enabled('professionals'), 'professionals starts disabled in a new org');
select ok((public.get_my_access() -> 'permissions') ? 'professionals.view', 'admin effective permissions include professionals.view');
select results_eq($$ select key, depends_on, enabled from public.list_modules() $$,
  $$ values ('professionals'::text, array[]::text[], false) $$, 'list_modules shows professionals, disabled');
select lives_ok($$ select public.set_module_enabled('professionals', true) $$, 'admin enables professionals');
select is(public.get_my_access() -> 'modules', '["professionals"]'::jsonb, 'get_my_access lists professionals once enabled');

select * from finish();
rollback;
