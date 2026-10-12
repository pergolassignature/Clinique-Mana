-- Core: modules reserved for testers (migration *_core_module_testers.sql, R-72). Covers:
-- privileges; the flag defaults to false (nothing changes); reserved, a module grants its
-- permissions, its menu entry (get_my_access) and module_enabled only to the listed testers, an
-- admin included only when listed; opened again, everyone as before; disabling keeps the flag
-- and the testers; module_open_to_all_for_org for the functions that reach clients; the RPCs'
-- permission, refusals and audit; another clinic untouched.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

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

-- Fixtures: in A an admin, a conseillère (tester), an adjointe, a disabled adjointe (tester);
-- in B an admin. Professionnels
-- and Services et tarifs on in both (services.view is in every staff role's defaults).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ancienne@a.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Ancienne A',    'ancienne@a.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
-- A grant override never opens a reserved module to a non-tester.
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'services.view', true);
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

select throws_ok($$ select public.set_module_testers_only('services', false) $$,
  '42501', 'Permission refusée : modules.manage', 'a tester cannot open the module');
select throws_ok($$ select public.remove_module_tester('services', 'a0000000-0000-0000-0000-000000000002') $$,
  '42501', 'Permission refusée : modules.manage', '… nor remove a tester');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_module_testers_only('core', true) $$, '22023', 'Module inconnu : core', 'core is never reserved');
-- Dependencies: Professionnels cannot be reserved while Services et tarifs (enabled, depends on it)
-- is reserved only... Services is reserved here, so Professionnels may be; an open dependent refuses.
reset role;
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_module_testers_only('professionals', true) $$,
  'P0001', 'Réservez d''abord aux testeurs : Clients', 'a dependency is not reserved while an open module needs it');
select public.set_module_enabled('clients', false);
select lives_ok($$ select public.set_module_testers_only('professionals', true) $$, '… once that module is off, it may be');
select throws_ok($$ select public.set_module_enabled('clients', true) $$,
  'P0001', 'Réservez d''abord ce module aux testeurs, comme : Professionnels', 'an open module is not enabled on a reserved dependency');
select throws_ok($$ select public.set_module_testers_only('services', false) $$,
  'P0001', 'Ouvrez d''abord à tous : Professionnels', 'a module is not opened while its dependency stays reserved');
select lives_ok($$ select public.set_module_testers_only('professionals', false) $$, 'Professionnels opened again');

-- A disabled profile listed as a tester gets nothing.
select public.add_module_tester('services', 'a0000000-0000-0000-0000-000000000006');
reset role;
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000006';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(not private.has_permission('services.view'), 'a disabled tester gets nothing');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not private.has_permission('services.view'), 'a non-tester loses it, despite her role''s defaults and an override');
select is((select count(*)::int from public.services), 0, '… and reads no row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(private.has_permission('services.view'), 'another clinic is untouched');

reset role;
set local role service_role;
select ok(not public.module_open_to_all_for_org('b0000000-0000-0000-0000-00000000000a', 'services'), 'reserved: not open to all (no client sends)');
select ok(public.module_open_to_all_for_org('b0000000-0000-0000-0000-00000000000b', 'services'), 'clinic B: open to all');
select ok(public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000a', 'services'), 'module_enabled_for_org stays org-level');

-- Texts (P3-40): while Communications is reserved, a typed text is refused, an automatic one is
-- not queued, the test and the « ARRÊT » acknowledgement go on to the usual checks.
reset role;
insert into public.org_modules (org_id, module_key, enabled, testers_only) values ('b0000000-0000-0000-0000-00000000000a', 'communications', true, true);
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Bonjour', 'reply') $$,
  'P0001', 'Les textos aux clients sont suspendus : le module Communications est réservé aux testeurs.', 'reserved: a reply is refused');
select is(private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Rappel', 'reminder'), null, 'reserved: a reminder is not queued');
select is((select count(*)::int from public.sms_messages where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing waits to leave at the go-live');
select ok(private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Test', 'test') is not null, 'reserved: the test still goes');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Bonjour', 'reply') $$,
  'P0001', null, 'open: a reply goes to the usual consent check');

reset role;
select is((select a.source from public.audit_log a where a.table_name = 'org_module_testers' and a.action = 'insert'
            and a.record_id = 'b0000000-0000-0000-0000-00000000000a:services:a0000000-0000-0000-0000-000000000002'), 'app', 'adding a tester is audited');

-- Disabling keeps the flag and the testers; the admin lists herself; opening restores everyone.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_module_enabled('services', false);
select public.set_module_enabled('services', true);
select results_eq($$ select testers_only, cardinality(tester_ids) from public.list_module_testers() where module_key = 'services' $$,
  $$ values (true, 2) $$, 'disabling and enabling keeps the flag and the testers');
select public.add_module_tester('services', 'a0000000-0000-0000-0000-000000000001');
select ok(private.has_permission('services.view'), 'the admin, once listed, gets it');
select public.set_module_testers_only('services', false);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.has_permission('services.view'), 'opened to all: the adjointe holds it again');

select * from finish();
rollback;
