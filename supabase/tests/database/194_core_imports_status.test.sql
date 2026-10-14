-- Migration *_core_imports_status.sql: `get_imports_status()` (Paramètres → Modules,
-- « Importation GOrendezvous »). modules.manage only (checked first), the caller's clinic only;
-- open by default with no change known; after a close, the time and who closed it; after a
-- reopen, the last change is the reopen (by whom), the last close time kept.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select function_privs_are('public', 'get_imports_status', array[]::text[], 'authenticated', array['EXECUTE'], 'get_imports_status: authenticated');
select function_privs_are('public', 'get_imports_status', array[]::text[], 'anon', array[]::text[], 'get_imports_status: never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@is.test'), ('a0000000-0000-0000-0000-000000000002', 'admin2@is.test'),
               ('a0000000-0000-0000-0000-000000000004', 'cons@is.test'), ('a0000000-0000-0000-0000-000000000009', 'adminb@is.test')) as v(u, e);
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@is.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Admin Deux', 'admin2@is.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@is.test', 'active'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'adminb@is.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'admin');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_imports_status() $$, '42501', 'Permission refusée : modules.manage', 'the conseillère cannot read the switch');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select imports_open, imports_closed_at, changed_at, changed_by_name from public.get_imports_status() $$,
  $$ values (true, null::timestamptz, null::timestamptz, null::text) $$, 'open by default, no change known');

select public.set_imports_open(false);
select ok((select not imports_open from public.get_imports_status()), 'closed');
select ok((select imports_closed_at is not null and changed_at is not null from public.get_imports_status()), '… with the close time and the change time');
select is((select changed_by_name from public.get_imports_status()), 'Admin A', '… by Admin A');

-- Another clinic sees its own switch only.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select results_eq($$ select imports_open, changed_by_name from public.get_imports_status() $$,
  $$ values (true, null::text) $$, 'Org B: still open, nothing of Org A');
select is((select count(*)::int from public.get_imports_status()), 1, 'Org B: one row, its own');

-- Reopened by another admin: the last change is hers; the last close time is kept.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
-- One transaction, one now(): the audit rows tie on created_at and the later id wins.
select public.set_imports_open(true);
select ok((select imports_open from public.get_imports_status()), 'opened again');
select is((select changed_by_name from public.get_imports_status()), 'Admin Deux', '… the last change is the reopen, by Admin Deux');
select ok((select imports_closed_at is not null from public.get_imports_status()), '… the last close time kept');

-- A settings change of the clinic (its name) is not a change of the switch.
reset role;
update public.organizations set name = 'Org A renommée' where id = 'b0000000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select changed_by_name from public.get_imports_status()), 'Admin Deux', 'another change of the clinic does not count');

select * from finish();
rollback;
