-- clear_permission_overrides (migration *_core_clear_permission_overrides.sql): removes all of
-- one user's permission overrides at once (« Rétablir les permissions du rôle », decision #39).
-- Covers: privileges and definition, the guards of clear_permission_override (manage right,
-- a disabled caller, own account, other org, admin target, a revoke on a permission a
-- non-admin manager lacks),
-- atomicity (a refusal deletes nothing), the returned count, audit of each deletion.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admins A1 and A2, counselor C, adjointe D (overrides users.manage and users.view:
-- a non-admin manager; she holds settings.view and professionals.view by role), counselor F,
-- disabled admin G.
-- Org B: admin B.
-- The audit_log checks are limited to org A (the table is shared with the rest of the database).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@b.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g@a.test',  '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A1',      'a1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Admin A2',      'a2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@a.test',  'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D',    'd@a.test',  'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'b@b.test',  'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère F', 'f@a.test',  'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Admin G (désactivée)', 'g@a.test', 'disabled');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.view',   true),
  -- C: a grant and two revokes, one of them on settings.manage (D lacks it).
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'audit.view',         true),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage',    false),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view', false),
  -- F: a grant D lacks (removing it gives nothing) and a revoke on a permission D holds.
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage',    true),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view', false);

-- =============================================================================
-- Privileges and definition
-- =============================================================================
select function_privs_are('public', 'clear_permission_overrides', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated can call clear_permission_overrides');
select function_privs_are('public', 'clear_permission_overrides', array['uuid'], 'anon',          array[]::text[], 'anon cannot call clear_permission_overrides');
select function_privs_are('public', 'clear_permission_overrides', array['uuid'], 'service_role',  array[]::text[], 'service_role has no grant on clear_permission_overrides');
select function_returns('public', 'clear_permission_overrides', array['uuid'], 'integer', 'clear_permission_overrides returns the number removed');
select is_definer('public', 'clear_permission_overrides', array['uuid'], 'clear_permission_overrides is security definer');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.clear_permission_overrides(uuid)'::regprocedure),
  'clear_permission_overrides pins an empty search_path');

set local role authenticated;

-- =============================================================================
-- Refusals
-- =============================================================================
-- C (counselor) has no users.manage.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000006') $$,
  '42501', null, 'without users.manage the call is refused');

-- G: a disabled admin holds no permission (has_permission checks the status).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'a disabled manager is refused');

-- Adjointe D: a non-admin manager.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Vous ne pouvez pas accorder une permission que vous n''avez pas.',
  'a manager cannot clear a revoke on a permission she lacks (settings.manage)');
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».',
  'a manager cannot clear her own overrides');
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Seul un administrateur peut modifier un administrateur.', 'a non-admin cannot reset an admin');

-- Admin A1 on herself, admin B on org A.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».',
  'an admin cannot reset her own account');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.clear_permission_overrides('a0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Utilisateur introuvable.', 'an admin of another org cannot reset an org A user');

reset role;
select is((select count(*)::int from public.user_permission_overrides where user_id = 'a0000000-0000-0000-0000-000000000003'), 3,
  'the refusals deleted none of C''s overrides (atomic)');
select is((select count(*)::int from public.user_permission_overrides where user_id = 'a0000000-0000-0000-0000-000000000004'), 2,
  'D''s own overrides are untouched');
select ok(not exists (select 1 from public.audit_log where table_name = 'user_permission_overrides' and action = 'delete'
                        and org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'nothing was deleted (no delete in the audit log)');

-- =============================================================================
-- A manager clears what gives nothing back that she lacks
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.clear_permission_overrides('a0000000-0000-0000-0000-000000000006'), 2,
  'D resets F (a grant she lacks, a revoke she holds): 2 removed');
select is((select count(*)::int from public.user_permission_overrides where user_id = 'a0000000-0000-0000-0000-000000000006'), 0,
  'F has no overrides left');

-- =============================================================================
-- An admin clears everything
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.clear_permission_overrides('a0000000-0000-0000-0000-000000000003'), 3,
  'A1 resets C: 3 removed, revokes included');
select is((select override_count from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'C has no overrides left');
select is(public.clear_permission_overrides('a0000000-0000-0000-0000-000000000003'), 0,
  'resetting again removes nothing and returns 0');
select is(public.clear_permission_overrides('a0000000-0000-0000-0000-000000000002'), 0,
  'an admin may reset another admin (nothing to remove)');
select is((select override_count from public.list_org_users() where user_id = 'a0000000-0000-0000-0000-000000000004'), 2,
  'other users keep their overrides');

-- =============================================================================
-- Audit (as postgres): one delete row per override, with the actor
-- =============================================================================
reset role;
select is((select count(*)::int from public.audit_log
            where table_name = 'user_permission_overrides' and action = 'delete'
              and record_id like 'a0000000-0000-0000-0000-000000000003:%'
              and actor_id = 'a0000000-0000-0000-0000-000000000001'), 3,
  'each of C''s removed overrides is audited with A1 as actor');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'user_permission_overrides' and action = 'delete'
     and record_id like 'a0000000-0000-0000-0000-000000000003:%'
     and changed_fields ->> 'permission_key' = 'settings.manage'
), 'the removed revoke is audited with its permission');
select is((select count(*)::int from public.audit_log
            where table_name = 'user_permission_overrides' and action = 'delete'
              and record_id like 'a0000000-0000-0000-0000-000000000006:%'
              and actor_id = 'a0000000-0000-0000-0000-000000000004'), 2,
  'F''s removed overrides are audited with D as actor');
select is((select count(*)::int from public.audit_log
            where table_name = 'user_permission_overrides' and action = 'delete'
              and org_id = 'b0000000-0000-0000-0000-00000000000a'), 5,
  'exactly the 5 removed overrides are audited');

select * from finish();
rollback;
