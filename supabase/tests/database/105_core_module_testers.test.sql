-- Core: modules reserved for testers (migration *_core_module_testers.sql, R-72). Covers:
-- privileges; the flag defaults to false (nothing changes); reserved, a module grants its
-- permissions, its menu entry (get_my_access) and module_enabled only to the listed testers, an
-- admin included only when listed; opened again, everyone as before; disabling keeps the flag
-- and the testers; module_open_to_all_for_org for the functions that reach clients; the RPCs'
-- permission, refusals and audit; another clinic untouched.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

select table_privs_are('public', 'org_module_testers', 'anon', array[]::text[], 'org_module_testers: anon has nothing');
select table_privs_are('public', 'org_module_testers', 'authenticated', array['SELECT'], 'org_module_testers: authenticated reads only');
select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': authenticated may call it')
  from (values
    ('list_module_testers', array[]::text[]),
    ('set_module_testers_only', array['text', 'boolean']),
    ('add_module_tester', array['text', 'uuid']),
    ('remove_module_tester', array['text', 'uuid'])
  ) as f(name, args);
select function_privs_are('public', 'module_open_to_all_for_org', array['uuid', 'text'], 'authenticated', array[]::text[], 'module_open_to_all_for_org: not for clients');
select function_privs_are('public', 'module_open_to_all_for_org', array['uuid', 'text'], 'service_role', array['EXECUTE'], 'module_open_to_all_for_org: service role');
select function_privs_are('private', 'ensure_org_module', array['uuid', 'text'], 'authenticated', array[]::text[], 'ensure_org_module: no role');

-- Fixtures: in A an admin, a conseillère (tester), an adjointe; in B an admin. Professionnels
-- and Services et tarifs on in both (services.view is in every staff role's defaults).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'services', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'services', true);

select is((select bool_or(testers_only) from public.org_modules), false, 'the flag defaults to false');

set local role authenticated;
-- The adjointe reads Services et tarifs as before.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.has_permission('services.view'), 'not reserved: the adjointe holds services.view');

-- The admin reserves Services et tarifs for the conseillère.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_module_testers_only('services', true) $$, 'the admin reserves the module');
select lives_ok($$ select public.add_module_tester('services', 'a0000000-0000-0000-0000-000000000002') $$, '… and adds the conseillère');
select throws_ok($$ select public.add_module_tester('services', 'a0000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Cette personne n''est pas un utilisateur actif de la clinique.', 'a user of another clinic is refused');
select throws_ok($$ select public.add_module_tester('nope', 'a0000000-0000-0000-0000-000000000002') $$,
  '22023', 'Module inconnu : nope', 'an unknown module is refused');
select ok(not private.has_permission('services.view'), 'an admin not listed gets nothing of it');
select ok(not public.module_enabled('services'), '… module_enabled says no');
select ok(not (public.get_my_access() -> 'modules') ? 'services', '… and her menu leaves it out');
select ok((public.get_my_access() -> 'modules') ? 'professionals', '… other modules unchanged');
select ok(private.has_permission('modules.manage'), '… core unchanged');
select results_eq($$ select module_key, testers_only, tester_ids from public.list_module_testers() where module_key = 'services' $$,
  $$ values ('services'::text, true, array['a0000000-0000-0000-0000-000000000002'::uuid]) $$, 'list_module_testers shows the flag and the tester');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(private.has_permission('services.view'), 'the tester keeps services.view');
select ok(public.module_enabled('services'), '… module_enabled says yes');
select ok((public.get_my_access() -> 'modules') ? 'services', '… and her menu has it');
select ok((select count(*) from public.services) > 0, '… she reads its rows');
select throws_ok($$ select public.add_module_tester('services', 'a0000000-0000-0000-0000-000000000002') $$,
  '42501', 'Permission refusée : modules.manage', 'a tester cannot manage testers');
select is((select count(*)::int from public.org_module_testers), 0, 'nor read the list');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.has_permission('services.view'), 'a non-tester loses it, despite her role''s defaults');
select is((select count(*)::int from public.services), 0, '… and reads no row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(private.has_permission('services.view'), 'another clinic is untouched');

reset role;
set local role service_role;
select ok(not public.module_open_to_all_for_org('b0000000-0000-0000-0000-00000000000a', 'services'), 'reserved: not open to all (no client sends)');
select ok(public.module_open_to_all_for_org('b0000000-0000-0000-0000-00000000000b', 'services'), 'clinic B: open to all');
select ok(public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000a', 'services'), 'module_enabled_for_org stays org-level');

reset role;
select is((select a.source from public.audit_log a where a.table_name = 'org_module_testers' and a.action = 'insert'
            and a.record_id like 'b0000000-0000-0000-0000-00000000000a:services:%'), 'app', 'adding a tester is audited');

-- Disabling keeps the flag and the testers; the admin lists herself; opening restores everyone.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_module_enabled('services', false);
select public.set_module_enabled('services', true);
select results_eq($$ select testers_only, cardinality(tester_ids) from public.list_module_testers() where module_key = 'services' $$,
  $$ values (true, 1) $$, 'disabling and enabling keeps the flag and the testers');
select public.add_module_tester('services', 'a0000000-0000-0000-0000-000000000001');
select ok(private.has_permission('services.view'), 'the admin, once listed, gets it');
select public.set_module_testers_only('services', false);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.has_permission('services.view'), 'opened to all: the adjointe holds it again');

select * from finish();
rollback;
