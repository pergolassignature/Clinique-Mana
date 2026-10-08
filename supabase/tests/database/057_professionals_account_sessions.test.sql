-- A disabled account's sessions (migration *_professionals_account_sessions.sql, plan Phase 4 Task
-- 4b.6, P4-380, P4-381).
-- Covers: privileges (get_professional_account_status: authenticated only; the trigger function:
-- no API role; its owner may delete from auth.sessions); any update that disables a profile, by
-- hand included, deletes its sessions and their refresh tokens, and nobody else's; an update that
-- leaves the status (or keeps it disabled) and re-enabling delete nothing; the module's
-- deactivation « Fin de collaboration » ends them too; get_professional_account_status: the linked
-- provider account and its status, for professionals.manage only, nothing for a file without an
-- account, a staff account or another clinic's file, and the module gate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'get_professional_account_status', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may call get_professional_account_status');
select function_privs_are('public', 'get_professional_account_status', array['uuid'], 'anon', array[]::text[],
  'anon may not call get_professional_account_status');
select function_privs_are('public', 'get_professional_account_status', array['uuid'], 'service_role', array[]::text[],
  'service_role may not call get_professional_account_status (the function reads it as the caller)');
select function_privs_are('private', 'end_sessions_of_disabled_profile', array[]::text[], 'authenticated', array[]::text[],
  'no client role may call the trigger function');
select function_privs_are('private', 'end_sessions_of_disabled_profile', array[]::text[], 'service_role', array[]::text[],
  'service_role may not call the trigger function');
select ok((select p.prosecdef and has_table_privilege(p.proowner, 'auth.sessions', 'delete')
             from pg_proc p where p.oid = 'private.end_sessions_of_disabled_profile()'::regprocedure),
  'the trigger function is definer and its owner may delete from auth.sessions');

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a conseillère, two providers (P1 is
-- linked to provider 1; provider 2 has no file) and a staff member linked to P3 (never a
-- provider); org B with an admin. P2 has no account. Sessions with refresh tokens for provider 1,
-- provider 2 and the admin.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider1@a.test',   '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider2@a.test',   '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider 1',    'provider1@a.test',   'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Provider 2',    'provider2@a.test',   'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Staff A',       'staff@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Un', 'provider1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Deux', 'p2@exemple.ca', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000007', 'Sam', 'Trois', 'staff@a.test', 'active');

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('f0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000003', now(), now(), 'aal1'),
  ('f0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000003', now(), now(), 'aal1'),
  ('f0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-000000000006', now(), now(), 'aal1'),
  ('f0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', now(), now(), 'aal1');
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, session_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-p1a', 'a0000000-0000-0000-0000-000000000003', false, 'f0000000-0000-0000-0000-000000000031', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-p1b', 'a0000000-0000-0000-0000-000000000003', false, 'f0000000-0000-0000-0000-000000000032', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-p2',  'a0000000-0000-0000-0000-000000000006', false, 'f0000000-0000-0000-0000-000000000061', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-a',   'a0000000-0000-0000-0000-000000000001', false, 'f0000000-0000-0000-0000-000000000011', now(), now());

-- =============================================================================
-- Any disable ends the sessions (P4-380)
-- =============================================================================
-- An update that does not change the status ends nothing.
update public.profiles set display_name = 'Provider deux' where user_id = 'a0000000-0000-0000-0000-000000000006';
update public.profiles set status = 'active' where user_id = 'a0000000-0000-0000-0000-000000000006';
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000006'), 1,
  'an update that leaves the status active keeps the session');

-- Disabled by hand (no RPC): the sessions and their refresh tokens go, nobody else's.
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000006';
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000006'), 0,
  'a profile disabled by hand loses its sessions in the same statement');
select is((select count(*)::int from auth.refresh_tokens where user_id = 'a0000000-0000-0000-0000-000000000006'), 0,
  'its refresh tokens went with them');
select is((select count(*)::int from auth.sessions where user_id in ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001')), 3,
  'the other users keep their sessions');

-- Still disabled, another column changes: a session created meanwhile is not the trigger's (the
-- RPCs' own delete handles a repeated « Désactiver »).
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('f0000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-000000000006', now(), now(), 'aal1');
update public.profiles set display_name = 'Provider 2' where user_id = 'a0000000-0000-0000-0000-000000000006';
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000006'), 1,
  'an update of a profile already disabled does not fire the trigger');
update public.profiles set status = 'active' where user_id = 'a0000000-0000-0000-0000-000000000006';
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000006'), 1,
  're-enabling deletes nothing');

-- Disabled through set_user_status (core): ended too (the function's own delete and the trigger).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000006', 'disabled') $$, 'the admin disables provider 2 in « Utilisateurs »');
reset role;
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000006'), 0,
  'set_user_status ends the sessions');

-- =============================================================================
-- get_professional_account_status (P4-381) and the deactivation
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000001') $$,
  $$ values ('a0000000-0000-0000-0000-000000000003'::uuid, 'active'::text) $$, 'the adjointe reads P1''s provider account: active');
select is_empty($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000002') $$,
  'a file without an account: no row');
select is_empty($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000003') $$,
  'a file linked to a staff account: no row (the module never bans staff)');
select is_empty($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-0000000000ff') $$,
  'an unknown file: no row');

select results_eq($$ select * from public.deactivate_professional('c0000000-0000-0000-0000-000000000001',
                       (select r.id from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'collaboration_ended')) $$,
  $$ values ('inactive'::text, 'disabled'::text, 'a0000000-0000-0000-0000-000000000003'::uuid) $$,
  '« Fin de collaboration » disables P1''s account and says so (the function then bans it)');
select results_eq($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000001') $$,
  $$ values ('a0000000-0000-0000-0000-000000000003'::uuid, 'disabled'::text) $$, 'the account now reads disabled');
reset role;
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000003')
          + (select count(*)::int from auth.refresh_tokens where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'the deactivation ended the provider''s sessions and refresh tokens');
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000001'), 1,
  'the adjointe''s action left the admin''s session alone');

set local role authenticated;
-- The conseillère (no professionals.manage) and another clinic.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000001') $$,
  '42501', 'Permission refusée : professionals.manage', 'the conseillère may not read it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000001') $$,
  'another clinic''s admin reads nothing');
reset role;

-- The module gate: with the module off, nobody holds professionals.manage.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_professional_account_status('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'module off: refused, even to the admin');
reset role;

select * from finish();
rollback;
