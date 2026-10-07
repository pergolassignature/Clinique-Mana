-- Roles split (migration 20261007192359_core_roles_split.sql): counselor + admin_assistant replace staff.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select results_eq($$ select key, name from public.roles order by key $$,
  $$ values ('admin'::text, 'Administrateur'::text), ('admin_assistant', 'Adjointe administrative'),
            ('counselor', 'Conseillère'), ('provider', 'Professionnel') $$,
  'roles are admin, admin_assistant, counselor, provider');
select ok(not exists (select 1 from public.role_permissions where role = 'staff'), 'staff has no permissions left');
select results_eq($$ select permission_key from public.role_permissions where role = 'counselor' order by 1 $$,
  array['professionals.view'], 'counselor defaults');
select results_eq($$ select permission_key from public.role_permissions where role = 'admin_assistant' order by 1 $$,
  array['professionals.view', 'settings.view'], 'admin_assistant defaults');
select results_eq($$ select module_key from public.permissions where key = 'settings.bank_manage' $$,
  array['core'], 'settings.bank_manage is a core permission');
select results_eq($$ select role from public.role_permissions where permission_key = 'settings.bank_manage' $$,
  array['admin'], 'only admin gets settings.bank_manage by default');
select ok((select count(*) from public.permissions where module_key = 'core')
          = (select count(*) from public.role_permissions rp join public.permissions p on p.key = rp.permission_key
              where rp.role = 'admin' and p.module_key = 'core'),
  'admin has every core permission');

-- Behaviour (fixtures as in 004: org A with the professionals module on)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@a.test',  '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@a.test'),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adj@a.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select ok(private.has_permission('professionals.view'), 'counselor sees professionals');
select ok(not private.has_permission('settings.view'), 'counselor has no settings.view');
select ok(not private.has_permission('users.view'), 'counselor has no users.view');
select is(public.get_my_access() -> 'permissions', '["professionals.view"]'::jsonb, 'counselor access payload');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select ok(private.has_permission('settings.view'), 'admin_assistant reads settings');
select ok(not private.has_permission('settings.manage'), 'admin_assistant cannot edit settings');
select is(public.get_my_access() -> 'permissions', '["professionals.view", "settings.view"]'::jsonb, 'admin_assistant access payload');

select * from finish();
rollback;
