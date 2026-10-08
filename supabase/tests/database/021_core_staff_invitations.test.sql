-- Staff invitations (migration *_core_staff_invitations.sql, plan Phase 3 Task 3.18, design §4,
-- P3-7, P3-8, P3-16, inconsistency #15).
-- Covers: privileges (staff_invitations select-only for authenticated, nothing for anon and
-- service_role; create / renew for service_role only, so the inviter never learns the token;
-- revoke / list for authenticated only; the purpose handlers for service_role only; all definer;
-- the private helpers for no client role); permission_keys_for(u) = current_permission_keys() as
-- u, for every fixture user; create_staff_invitation as the service with p_actor (returns the
-- id and the link's expiry, Task 3.20b; address and
-- name normalisation, the link it issues, invited_by and created_by = the actor, every guard and
-- its French message: provider, missing or another org's role, admin by a non-admin actor, the
-- hold rule for the actor, an existing member, a pending duplicate, bad input; an org custom role
-- accepted; an address with an account elsewhere accepted like any other: nothing reveals it);
-- the actor is p_actor, never the JWT's user; refusals (42501) for a counselor, a disabled admin,
-- a null or unknown actor; an actor of another org works in her own org only;
-- list_staff_invitations (fields, is_expired, the last email and its error code); renew (old
-- link revoked by the
-- actor, new link live, expiry moved; the admin and hold guards apply again); revoke;
-- resolve_staff_invitation; accept_staff_invitation (profile, role, accepted; single use; after a
-- revoke, an expired link or an unknown hash answers link_used / link_invalid / link_expired as
-- peek would; an address mismatch rolls back and leaves the link usable; the new user's access);
-- delete_role refusing a role with pending invitations; lock before checks (create, renew and
-- revoke lock the org, then check the actor: the source order, and the reviewer's probe run
-- serially); renew's hold rule and « déjà un accès »; the hold rule with a disabled module; the
-- inviter's standing at acceptance (P3-31: disabled, without users.manage, without a permission
-- the role carries → link_invalid, nothing written, the link still valid; in good standing →
-- accepted; the orphan marker removed from the accepted account only); audit rows (the service RPCs name the actor and their source, and restore
-- app.audit_actor, also after an error; a service JWT's sub never outranks app.audit_actor; accept
-- is attributed to the new account; app.audit_actor never overrides an authenticated user).
-- The whole file is one transaction, so now() is constant. Token hashes are computed as
-- _shared/links.ts does: SHA-256 over the token string's UTF-8 bytes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(124);

-- =============================================================================
-- Privileges, purpose, indexes
-- =============================================================================
select table_privs_are('public', 'staff_invitations', 'anon', array[]::text[], 'anon: nothing on staff_invitations');
select table_privs_are('public', 'staff_invitations', 'authenticated', array['SELECT'], 'authenticated: select only');
select table_privs_are('public', 'staff_invitations', 'service_role', array[]::text[], 'service_role: nothing on staff_invitations (RPCs only)');

select results_eq($$
  select p.oid::regprocedure::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'),
         p.prosecdef
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_staff_invitation', 'renew_staff_invitation', 'revoke_staff_invitation',
                       'list_staff_invitations', 'resolve_staff_invitation', 'accept_staff_invitation')
   order by 1
$$, $$ values
  ('accept_staff_invitation(bytea,uuid,jsonb)'::text, false, false, true, true),
  ('create_staff_invitation(uuid,text,text,text,bytea)', false, false, true, true),
  ('list_staff_invitations()', false, true, false, true),
  ('renew_staff_invitation(uuid,uuid,bytea)', false, false, true, true),
  ('resolve_staff_invitation(uuid)', false, false, true, true),
  ('revoke_staff_invitation(uuid)', false, true, false, true)
$$, 'create / renew and the purpose handlers for service_role only, revoke / list for authenticated only, all definer');
select function_privs_are('public', 'create_staff_invitation', array['uuid', 'text', 'text', 'text', 'bytea'],
  'authenticated', array[]::text[], 'authenticated cannot create an invitation (it would choose the token)');
select function_privs_are('public', 'renew_staff_invitation', array['uuid', 'uuid', 'bytea'],
  'authenticated', array[]::text[], 'authenticated cannot renew an invitation (it would choose the token)');
select results_eq($$
  select p.proname::text collate "default" from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('assert_can_invite_to_role', 'staff_inviter', 'permission_keys_for')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')
     and p.prosecdef
   order by 1
$$, array['assert_can_invite_to_role', 'permission_keys_for', 'staff_inviter'],
  'the private invitation helpers and permission_keys_for are definer and callable by no client role');
select results_eq($$
  select l.lanname::text collate "default", p.provolatile::text collate "default", p.prosecdef,
         p.prosrc ~ 'permission_keys_for\(auth\.uid\(\)\)'
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'private.current_permission_keys()'::regprocedure
$$, $$ values ('plpgsql'::text, 's'::text, true, true) $$,
  'current_permission_keys is a stable definer plpgsql wrapper over permission_keys_for(auth.uid())');

select results_eq($$
  select key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account,
         resolve_rpc, accept_rpc, view_permission
    from public.secure_link_purposes where key = 'staff_invite'
$$, $$ values ('staff_invite'::text, 'core'::text, interval '7 days', interval '14 days', 1, false, true,
               'resolve_staff_invitation'::text, 'accept_staff_invitation'::text, 'users.view'::text) $$,
  'the staff_invite purpose is seeded with its handlers');

select results_eq($$
  select indexname::text collate "default" from pg_indexes
   where schemaname = 'public' and tablename = 'staff_invitations'
   order by 1
$$, array['staff_invitations_accepted_user_id_idx', 'staff_invitations_invited_by_idx', 'staff_invitations_org_created_idx',
          'staff_invitations_pending_email_key', 'staff_invitations_pkey', 'staff_invitations_role_idx',
          'staff_invitations_secure_link_id_key'],
  'pending-address, list, link and FK indexes exist');
select ok(
  (select p.prosrc ~ 'for no key update.*consume_secure_link' from pg_proc p
    where p.oid = 'public.accept_staff_invitation(bytea, uuid, jsonb)'::regprocedure),
  'accept locks the org before consuming the link (lock order org, link, invitation)');
-- Lock before checks: the actor's permissions and guards are evaluated after the org lock, so a
-- change committed while the RPC waited for it is seen (the reviewer's two-session probe).
select ok(
  (select bool_and(p.prosrc ~ 'for no key update.*private\.staff_inviter\(' and p.prosrc !~ 'staff_inviter\(.*for no key update'
                   and p.prosrc !~ 'has_permission\(')
     from pg_proc p
    where p.oid in ('public.create_staff_invitation(uuid, text, text, text, bytea)'::regprocedure,
                    'public.renew_staff_invitation(uuid, uuid, bytea)'::regprocedure,
                    'public.revoke_staff_invitation(uuid)'::regprocedure)),
  'create, renew and revoke lock the org row, then check the actor (staff_inviter), never before');
select ok(
  (select p.prosrc ~ 'consume_secure_link\(.*for update.*private\.staff_inviter\(v_inv\.invited_by\).*assert_can_invite_to_role\(.*exception\s+when insufficient_privilege or raise_exception'
     from pg_proc p
    where p.oid = 'public.accept_staff_invitation(bytea, uuid, jsonb)'::regprocedure),
  'accept re-checks the inviter after consuming the link, in a block that rolls the consumption back');

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A, adjointe D (users.manage and users.view by override: a non-admin manager),
-- counselor C, provider P, disabled admin X. Org B: admin B. An auth account without a profile
-- (O). Org A has the professionals module on (D holds professionals.view and settings.view).
-- Custom roles: A « Accueil » (settings.view), A « Gestion des rôles » (roles.manage, which D
-- lacks), A « Temporaire » (empty), B « Rôle B ».
-- Table t: token name → hash.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orphan@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D', 'd@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Provider P', 'p@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Admin X', 'x@a.test', 'disabled'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.view', true);
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.roles (key, name, is_system, org_id) values
  ('custom_0000000a', 'Accueil', false, 'b0000000-0000-0000-0000-00000000000a'),
  ('custom_0000000c', 'Gestion des rôles', false, 'b0000000-0000-0000-0000-00000000000a'),
  ('custom_0000000d', 'Temporaire', false, 'b0000000-0000-0000-0000-00000000000a'),
  ('custom_0000000b', 'Rôle B', false, 'b0000000-0000-0000-0000-00000000000b');
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'custom_0000000a', 'settings.view'),
  ('b0000000-0000-0000-0000-00000000000a', 'custom_0000000c', 'roles.manage');

-- permission_keys_for(u) is current_permission_keys() as u: overrides (D), a module on (C), no
-- role default (P), disabled (X), another org (B), no profile (O), unknown, null.
create temp table keys_mismatches (user_id uuid) on commit drop;
do $$
declare
  v_user uuid;
begin
  foreach v_user in array array[
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-0000000000ff', null]::uuid[]
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    if private.permission_keys_for(v_user) is distinct from private.current_permission_keys() then
      insert into keys_mismatches values (v_user);
    end if;
  end loop;
end $$;
select is_empty('select * from keys_mismatches', 'permission_keys_for(u) equals current_permission_keys() as u, for every fixture user');
select ok(private.permission_keys_for('a0000000-0000-0000-0000-000000000002') @> array['users.manage', 'users.view']
          and not ('roles.manage' = any (private.permission_keys_for('a0000000-0000-0000-0000-000000000002')))
          and private.permission_keys_for(null) = '{}',
  'permission_keys_for: D holds users.manage by override but not roles.manage; a null user holds nothing');

create temp table t (name text primary key, hash bytea not null) on commit drop;
grant select on t to authenticated, service_role;
insert into t (name, hash)
select n, extensions.digest(convert_to(n, 'UTF8'), 'sha256')
  from unnest(array['inv1', 'custom', 'neutral_b', 'orphan', 'adm', 'by_d', 'temp', 'refused',
                    'renew1', 'renew_refused', 'unknown', 'by_b', 'rm', 'later', 'pv']) n;

-- =============================================================================
-- create_staff_invitation by the service, for actor A
-- As the staff-invite function's service client: a service-role JWT, no user.
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select set_config('test.inv1', r.id::text, true), set_config('test.inv1_expires', r.expires_at::text, true)
  from public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  '  Nouvelle@Mana.TEST ', E' Marie Tremblay\t', 'counselor', (select hash from t where name = 'inv1')) r;
select is(coalesce(current_setting('app.audit_actor', true), ''), '', 'create restores app.audit_actor');

reset role;
select results_eq($$
  select org_id, email, display_name, role, status, invited_by, accepted_user_id, accepted_at
    from public.staff_invitations where id = current_setting('test.inv1')::uuid
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'nouvelle@mana.test'::text, 'Marie Tremblay'::text,
               'counselor'::text, 'pending'::text, 'a0000000-0000-0000-0000-000000000001'::uuid,
               null::uuid, null::timestamptz) $$,
  'for A: A''s org, the address trimmed and lowercased, the name trimmed, pending, invited_by A');
select results_eq($$
  select l.org_id, l.purpose, l.subject_type, l.subject_id, l.token_hash, l.expires_at, l.max_uses, l.created_by
    from public.secure_links l join public.staff_invitations i on i.secure_link_id = l.id
   where i.id = current_setting('test.inv1')::uuid
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'staff_invite'::text, 'staff_invitation'::text,
               current_setting('test.inv1')::uuid, (select hash from t where name = 'inv1'), now() + interval '7 days', 1,
               'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the invitation''s link: staff_invite, its subject is the invitation, 7 days, single use, created by A');
select is(current_setting('test.inv1_expires')::timestamptz, now() + interval '7 days',
  'create returns the invitation id and its link''s expiry (staff-invite needs no second read)');
select is(pg_get_function_result('public.create_staff_invitation(uuid, text, text, text, bytea)'::regprocedure),
  'TABLE(id uuid, expires_at timestamp with time zone)', 'create_staff_invitation returns (id, expires_at), like renew');
set local role service_role;

select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'pro@mana.test', 'Pro', 'provider', (select hash from t where name = 'refused')) $$,
  'P0001', 'Le rôle Professionnel est attribué par le module Professionnels.', 'provider is refused');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'x1@mana.test', 'X', 'nope', (select hash from t where name = 'refused')) $$,
  'P0001', 'Ce rôle n''existe plus.', 'an unknown role: « Ce rôle n''existe plus. »');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'x1@mana.test', 'X', 'custom_0000000b', (select hash from t where name = 'refused')) $$,
  'P0001', 'Ce rôle n''existe plus.', 'another org''s custom role: the same answer');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', ' C@A.Test  ', 'C', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Cette personne a déjà un accès.', 'a member''s address (mixed case, spaces): « Cette personne a déjà un accès. »');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'x@a.test', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Cette personne a déjà un accès.', 'a disabled member''s address too');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', ' NOUVELLE@mana.test', 'Autre nom', 'admin_assistant', (select hash from t where name = 'refused')) $$,
  'P0001', 'Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».', 'a pending duplicate: the « Renvoyer » message');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'pas-un-courriel', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Adresse courriel invalide.', 'a malformed address');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', null, 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Adresse courriel invalide.', 'a missing address');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'x1@mana.test', E' \t ', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Le nom doit contenir de 1 à 80 caractères.', 'a blank name');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'x1@mana.test', repeat('n', 81), 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Le nom doit contenir de 1 à 80 caractères.', 'a name over 80 characters');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'x2@mana.test', 'X', 'counselor', (select hash from t where name = 'inv1')) $$,
  '23505', null, 'a token hash is never reused');
select is(coalesce(current_setting('app.audit_actor', true), ''), '',
  'an error inside create after it set app.audit_actor (the reused hash) leaves app.audit_actor empty');

-- Claims naming counselor C (no users.manage) change nothing: the RPC acts for p_actor only.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"service_role"}', true);
select set_config('test.inv_custom', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'accueil@mana.test', 'Accueil', 'custom_0000000a', (select hash from t where name = 'custom'))).id::text, true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
reset role;
select is((select role from public.staff_invitations where id = current_setting('test.inv_custom')::uuid), 'custom_0000000a',
  'an org custom role can be invited to (#40), whatever user the JWT names');
select is((select actor_id from public.audit_log
            where table_name = 'staff_invitations' and record_id = current_setting('test.inv_custom') and action = 'insert'),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'audited as the actor A, not as the sub (C) of a service JWT: app.audit_actor wins outside an authenticated session');
set local role service_role;
-- Neutral (P3-8, decision #38): an address with an account elsewhere is invited like any other.
select lives_ok($$ select set_config('test.inv_neutral_b', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'admin@b.test', 'B', 'counselor', (select hash from t where name = 'neutral_b'))).id::text, true) $$,
  'another org''s member''s address is accepted: nothing reveals the account');
select lives_ok($$ select set_config('test.inv_orphan', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'orphan@a.test', 'O', 'admin_assistant', (select hash from t where name = 'orphan'))).id::text, true) $$,
  'an address with an auth account but no profile is accepted too');
select lives_ok($$ select set_config('test.inv_admin', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'adm@mana.test', 'Adm', 'admin', (select hash from t where name = 'adm'))).id::text, true) $$,
  'an admin actor invites an admin');

-- =============================================================================
-- Other actors (still the service): the non-admin manager D, the counselor C, the disabled
-- admin X, no actor, an unknown actor, org B's admin
-- =============================================================================
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000002', 'adm2@mana.test', 'Adm', 'admin', (select hash from t where name = 'refused')) $$,
  'P0001', 'Seul un administrateur peut inviter un administrateur.', 'actor D cannot invite an admin');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000002', 'rm@mana.test', 'RM', 'custom_0000000c', (select hash from t where name = 'refused')) $$,
  'P0001', 'Vous ne pouvez pas inviter à un rôle qui donne des permissions que vous n''avez pas.',
  'hold rule for the actor: D cannot invite to a role carrying roles.manage, which she lacks');
select lives_ok($$ select set_config('test.inv_d', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000002',
  'd-invite@mana.test', 'Par D', 'custom_0000000a', (select hash from t where name = 'by_d'))).id::text, true) $$,
  'actor D invites to a role whose permissions she holds');
select throws_ok(format($$ select public.renew_staff_invitation('a0000000-0000-0000-0000-000000000002', %L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv_admin')),
  'P0001', 'Seul un administrateur peut inviter un administrateur.', 'actor D cannot renew an admin''s invitation');
reset role;
select is((select invited_by from public.staff_invitations where id = current_setting('test.inv_d')::uuid),
  'a0000000-0000-0000-0000-000000000002'::uuid, 'D''s invitation: invited_by D');
set local role service_role;

select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000003', 'c2@mana.test', 'C', 'counselor', (select hash from t where name = 'refused')) $$,
  '42501', 'Permission refusée : users.manage', 'an actor without users.manage (counselor C) cannot invite');
select throws_ok(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000003', %L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv1')), '42501', null, 'an actor without users.manage cannot renew');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000005', 'x3@mana.test', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  '42501', null, 'a disabled admin actor cannot invite');
select throws_ok(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000005', %L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv1')), '42501', null, 'a disabled admin actor cannot renew');
select throws_ok($$ select public.create_staff_invitation(null, 'x4@mana.test', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  '42501', null, 'no actor: refused');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000007', 'x5@mana.test', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  '42501', null, 'an actor without a profile: refused');

-- Org B's admin: her own org only. Org A's invitation is not hers to renew, org A's role is not
-- hers to use, and her invitation lands in org B.
select throws_ok(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000006', %L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv1')),
  'P0001', 'Cette invitation n''est plus en attente.', 'actor B cannot renew org A''s invitation');
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000006', 'x6@mana.test', 'X', 'custom_0000000a', (select hash from t where name = 'refused')) $$,
  'P0001', 'Ce rôle n''existe plus.', 'actor B cannot invite to org A''s custom role');
select set_config('test.inv_b', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000006',
  'nouvelle@mana.test', 'Pour B', 'counselor', (select hash from t where name = 'by_b'))).id::text, true);
reset role;
select results_eq($$
  select i.org_id, i.invited_by, l.org_id from public.staff_invitations i join public.secure_links l on l.id = i.secure_link_id
   where i.id = current_setting('test.inv_b')::uuid
$$, $$ values ('b0000000-0000-0000-0000-00000000000b'::uuid, 'a0000000-0000-0000-0000-000000000006'::uuid,
               'b0000000-0000-0000-0000-00000000000b'::uuid) $$,
  'actor B''s invitation (an address pending in org A too) and its link are org B''s: the org is the actor''s');
select is((select count(*)::int from public.staff_invitations where org_id = 'b0000000-0000-0000-0000-00000000000a'), 6,
  'org A still has its 6 invitations');

-- =============================================================================
-- The user RPCs: D lists, C is refused, org B sees only its own
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.list_staff_invitations()), 6, 'D (users.view by override) lists the 6 pending invitations');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv1')),
  '42501', null, 'a counselor cannot revoke');
select throws_ok($$ select * from public.list_staff_invitations() $$, '42501', null, 'a counselor cannot list invitations');
select is_empty($$ select 1 from public.staff_invitations $$, 'a counselor reads no invitation row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_eq($$ select id from public.list_staff_invitations() $$, array[current_setting('test.inv_b')]::uuid[],
  'org B lists its own invitation and none of org A''s');
select set_eq($$ select id from public.staff_invitations $$, array[current_setting('test.inv_b')]::uuid[],
  'org B reads none of org A''s invitation rows');
select throws_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv1')),
  'P0001', 'Cette invitation n''est plus en attente.', 'org B cannot revoke org A''s invitation');

-- =============================================================================
-- list_staff_invitations as admin A
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_eq($$ select id from public.list_staff_invitations() $$,
  array[current_setting('test.inv1'), current_setting('test.inv_custom'), current_setting('test.inv_neutral_b'),
        current_setting('test.inv_orphan'), current_setting('test.inv_admin'), current_setting('test.inv_d')]::uuid[],
  'A lists exactly org A''s 6 pending invitations');
select results_eq($$
  select email, display_name, role, role_name, status, expires_at, is_expired, invited_by_name, created_at,
         last_email_status, last_email_at
    from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid
$$, $$ values ('nouvelle@mana.test'::text, 'Marie Tremblay'::text, 'counselor'::text, 'Conseillère'::text, 'pending'::text,
               now() + interval '7 days', false, 'Admin A'::text, now(), null::text, null::timestamptz) $$,
  'a pending invitation''s fields, before any email');
select is((select role_name from public.list_staff_invitations() where id = current_setting('test.inv_d')::uuid), 'Accueil',
  'a custom role''s name is listed');

-- Emails (as the send path logs them) and an expired link, as postgres.
reset role;
insert into public.email_log
  (org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, view_permission, created_at)
values
  ('b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'nouvelle@mana.test', 'staff_invitation',
   current_setting('test.inv1')::uuid, 'delivered', 'users.view', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'nouvelle@mana.test', 'staff_invitation',
   current_setting('test.inv1')::uuid, 'bounced', 'users.view', now() - interval '10 minutes');
insert into public.email_log
  (org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code, view_permission, created_at)
values
  ('b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'accueil@mana.test', 'staff_invitation',
   current_setting('test.inv_custom')::uuid, 'failed', 'provider_unavailable', 'users.view', now() - interval '5 minutes');
update public.secure_links l set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
  from public.staff_invitations i
 where i.id = current_setting('test.inv1')::uuid and l.id = i.secure_link_id;
set local role authenticated;

select results_eq($$
  select expires_at, is_expired, last_email_status, last_email_at, last_email_error_code
    from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid
$$, $$ values (now() - interval '1 day', true, 'bounced'::text, now() - interval '10 minutes', null::text) $$,
  'is_expired once the link has expired; the last email''s status and date, no error code unless it failed');
select results_eq($$
  select last_email_status, last_email_error_code
    from public.list_staff_invitations() where id = current_setting('test.inv_custom')::uuid
$$, $$ values ('failed'::text, 'provider_unavailable'::text) $$,
  'a failed last email carries its error code (« Résultat inconnu » for provider_unavailable, Task 3.20b)');

-- =============================================================================
-- renew_staff_invitation as admin A (the expired invitation)
-- =============================================================================
reset role;
select set_config('test.inv1_old_link', (select secure_link_id::text from public.staff_invitations
  where id = current_setting('test.inv1')::uuid), true);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000001', %L,
  (select hash from t where name = 'renew1')) $$, current_setting('test.inv1')),
  $$ values ('nouvelle@mana.test'::text, 'Marie Tremblay'::text, now() + interval '7 days') $$,
  'renew for actor A returns what the email needs, with the new expiry');
select is(coalesce(current_setting('app.audit_actor', true), ''), '', 'renew restores app.audit_actor');

reset role;
select results_eq($$
  select l.revoked_at, l.revoked_by from public.secure_links l where l.id = current_setting('test.inv1_old_link')::uuid
$$, $$ values (now(), 'a0000000-0000-0000-0000-000000000001'::uuid) $$, 'renew revokes the old link, by A');
select results_eq($$
  select l.token_hash, l.revoked_at, l.use_count, l.expires_at, l.subject_id
    from public.secure_links l join public.staff_invitations i on i.secure_link_id = l.id
   where i.id = current_setting('test.inv1')::uuid
$$, $$ values ((select hash from t where name = 'renew1'), null::timestamptz, 0, now() + interval '7 days',
               current_setting('test.inv1')::uuid) $$,
  'the invitation points at a new live link');
set local role service_role;
select is(public.peek_secure_link((select hash from t where name = 'inv1'), false), '{"state": "invalid"}'::jsonb,
  'the old token is invalid');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select is_expired from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid), false,
  'the renewed invitation is no longer expired');

-- =============================================================================
-- revoke_staff_invitation as admin A
-- =============================================================================
-- A stray app.audit_actor never overrides the JWT's user in the audit log.
select set_config('app.audit_actor', 'a0000000-0000-0000-0000-000000000002', true);
select lives_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv_orphan')),
  'A revokes an invitation');
select set_config('app.audit_actor', '', true);
select is((select status from public.staff_invitations where id = current_setting('test.inv_orphan')::uuid), 'revoked',
  'the invitation is revoked');
select ok(not exists (select 1 from public.list_staff_invitations() where id = current_setting('test.inv_orphan')::uuid),
  'a revoked invitation is no longer listed');
reset role;
set local role service_role;
select is(public.peek_secure_link((select hash from t where name = 'orphan'), true), '{"state": "invalid"}'::jsonb,
  'its link is revoked: peek answers invalid');
reset role;
set local role authenticated;
select throws_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv_orphan')),
  'P0001', 'Cette invitation n''est plus en attente.', 'revoking twice: « Cette invitation n''est plus en attente. »');
reset role;
select is((select actor_id from public.audit_log
            where table_name = 'staff_invitations' and record_id = current_setting('test.inv_orphan') and action = 'update'),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'the revoke is audited as A (the JWT), not as a stray app.audit_actor');
set local role service_role;
select throws_ok(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000001', %L,
  (select hash from t where name = 'renew_refused')) $$, current_setting('test.inv_orphan')),
  'P0001', 'Cette invitation n''est plus en attente.', 'a revoked invitation cannot be renewed');

-- =============================================================================
-- resolve_staff_invitation and accept_staff_invitation (as service_role)
-- =============================================================================
reset role;
select set_config('test.inv1_link', (select secure_link_id::text from public.staff_invitations
  where id = current_setting('test.inv1')::uuid), true);
select set_config('test.inv_custom_link', (select secure_link_id::text from public.staff_invitations
  where id = current_setting('test.inv_custom')::uuid), true);
-- What accept-invite's auth.admin.createUser leaves behind, for the invited address and others.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nouvelle@mana.test', '', now(),
   '{"provider": "email", "invite_link_id": "c0000000-0000-0000-0000-0000000000aa"}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'second@mana.test', '', now(),
   '{"provider": "email", "invite_link_id": "c0000000-0000-0000-0000-0000000000bb"}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'autre@mana.test', '', now(), '{}', '{}', now(), now());
-- As the accept function's service client: no user in the claims.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(public.resolve_staff_invitation(current_setting('test.inv1_link')::uuid),
  jsonb_build_object('clinic_name', 'Org A', 'display_name', 'Marie Tremblay', 'email', 'nouvelle@mana.test',
                     'expires_at', now() + interval '7 days'),
  'resolve answers the clinic, the invitee''s name and address, and the expiry');
select is(public.resolve_staff_invitation(current_setting('test.inv1_old_link')::uuid), null,
  'resolve answers null for a link that is no longer the invitation''s');

select throws_ok($$ select public.accept_staff_invitation((select hash from t where name = 'custom'),
  'a0000000-0000-0000-0000-000000000012', '{}') $$,
  '22023', null, 'an account whose address is not the invitation''s is refused');
select is(public.peek_secure_link((select hash from t where name = 'custom'), false) ->> 'state', 'valid',
  'the refusal rolled back: the link was not consumed');

select is(public.accept_staff_invitation((select hash from t where name = 'renew1'), 'a0000000-0000-0000-0000-000000000010', '{}'),
  '{"status": "accepted", "org_id": "b0000000-0000-0000-0000-00000000000a"}'::jsonb, 'accept answers accepted and the org');
reset role;
select results_eq($$
  select p.org_id, p.display_name, p.email, p.status, r.role, r.org_id
    from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.user_id = 'a0000000-0000-0000-0000-000000000010'
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'Marie Tremblay'::text, 'nouvelle@mana.test'::text, 'active'::text,
               'counselor'::text, 'b0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'accept creates the active profile with the invited name, and the invited role');
select results_eq($$
  select status, accepted_user_id, accepted_at from public.staff_invitations where id = current_setting('test.inv1')::uuid
$$, $$ values ('accepted'::text, 'a0000000-0000-0000-0000-000000000010'::uuid, now()) $$, 'the invitation is accepted');
select is((select source from public.audit_log
            where table_name = 'profiles' and action = 'insert' and record_id = 'a0000000-0000-0000-0000-000000000010'),
  'rpc:accept_staff_invitation', 'the new profile''s audit row names the accepting RPC');
select is((select raw_app_meta_data from auth.users where id = 'a0000000-0000-0000-0000-000000000010'),
  '{"provider": "email"}'::jsonb, 'accepting removes the orphan marker (and only it) from the new account');
set local role service_role;

select is(public.accept_staff_invitation((select hash from t where name = 'renew1'), 'a0000000-0000-0000-0000-000000000011', '{}'),
  '{"status": "link_used"}'::jsonb, 'a second accept with the same token: link_used');
select is(public.accept_staff_invitation((select hash from t where name = 'orphan'), 'a0000000-0000-0000-0000-000000000011', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accepting a revoked invitation: link_invalid');
select is(public.accept_staff_invitation((select hash from t where name = 'inv1'), 'a0000000-0000-0000-0000-000000000011', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accepting with a renewed (revoked) token: link_invalid');
select is(public.accept_staff_invitation((select hash from t where name = 'unknown'), 'a0000000-0000-0000-0000-000000000011', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'an unknown token: link_invalid');
select is(public.accept_staff_invitation(null, 'a0000000-0000-0000-0000-000000000011', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'a null token: link_invalid');
reset role;
update public.secure_links l set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
  from public.staff_invitations i
 where i.id = current_setting('test.inv_neutral_b')::uuid and l.id = i.secure_link_id;
set local role service_role;
select is(public.accept_staff_invitation((select hash from t where name = 'neutral_b'), 'a0000000-0000-0000-0000-000000000011', '{}'),
  '{"status": "link_expired"}'::jsonb, 'an expired invitation (expired between peek and submit): link_expired');
reset role;
select is_empty($$ select 1 from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000011' $$,
  'the refused accepts created no profile');
select is((select raw_app_meta_data ->> 'invite_link_id' from auth.users where id = 'a0000000-0000-0000-0000-000000000011'),
  'c0000000-0000-0000-0000-0000000000bb', 'the refused accepts leave the marker (the orphan purge may still remove the account)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
-- Permissions checked on core keys plus professionals.view, so later module defaults leave it alone.
select results_eq($$
  select public.get_my_access() ->> 'role',
         (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_array_elements_text(public.get_my_access() -> 'permissions') k
            join public.permissions pm on pm.key = k where pm.module_key = 'core' or pm.key = 'professionals.view')
$$, $$ values ('counselor'::text, '["professionals.view"]'::jsonb) $$,
  'the new user''s access lists the role and its permissions');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not exists (select 1 from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid),
  'an accepted invitation is no longer listed');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'Nouvelle@mana.test', 'M', 'counselor',
  (select hash from t where name = 'refused')) $$,
  'P0001', 'Cette personne a déjà un accès.', 'the accepted address now has access');

-- =============================================================================
-- delete_role and pending invitations (inconsistency #15), as admin A
-- =============================================================================
select set_config('test.inv_temp', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'temp@mana.test', 'Temp', 'custom_0000000d', (select hash from t where name = 'temp'))).id::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.delete_role('custom_0000000d') $$,
  'P0001', 'Ce rôle est utilisé par 1 invitation(s) en attente.', 'a role with a pending invitation cannot be deleted');
select lives_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv_temp')),
  'the invitation is revoked');
select lives_ok($$ select public.delete_role('custom_0000000d') $$, 'the role can be deleted once no invitation is pending');
select results_eq($$ select status, role from public.staff_invitations where id = current_setting('test.inv_temp')::uuid $$,
  $$ values ('revoked'::text, null::text) $$, 'the revoked invitation keeps its history without the deleted role');

-- =============================================================================
-- Lock before checks, serially: the reviewer's probe in one session. Session 1 (admin A) removes
-- D's users.manage and commits; session 2 (the service, for D) then creates. The RPC must see the
-- change; the two-session run (session 2 blocked on the org lock meanwhile) is in the commit.
-- =============================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000002', 'users.manage', false) $$,
  'A removes D''s users.manage');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000002', 'probe@mana.test', 'Probe', 'custom_0000000a', (select hash from t where name = 'refused')) $$,
  '42501', 'Permission refusée : users.manage', 'D, who just lost users.manage, can no longer invite');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_permission_override('a0000000-0000-0000-0000-000000000002', 'users.manage', true) $$,
  'A gives D users.manage back');

-- =============================================================================
-- More guards: renew's hold rule and « déjà un accès », the hold rule with a disabled module
-- =============================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv_rm', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'rm@mana.test', 'RM', 'custom_0000000c', (select hash from t where name = 'rm'))).id::text, true);
select throws_ok(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000002', %L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv_rm')),
  'P0001', 'Vous ne pouvez pas inviter à un rôle qui donne des permissions que vous n''avez pas.',
  'hold rule on renew: D cannot renew A''s invitation to a role carrying roles.manage');

select set_config('test.inv_later', (public.create_staff_invitation('a0000000-0000-0000-0000-000000000001',
  'later@mana.test', 'Later', 'counselor', (select hash from t where name = 'later'))).id::text, true);
reset role;
-- The address gains access another way (added by hand) while the invitation is pending.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'later@mana.test', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, org_id, display_name, email, status)
values ('a0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-00000000000a', 'Later', 'later@mana.test', 'active');
set local role service_role;
select throws_ok(format($$ select * from public.renew_staff_invitation('a0000000-0000-0000-0000-000000000001', %L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv_later')),
  'P0001', 'Cette personne a déjà un accès.', 'renew refuses an address that has gained access since');

-- A role carrying professionals.view (the module is on; D holds it), then the module off.
reset role;
insert into public.roles (key, name, is_system, org_id) values
  ('custom_0000000e', 'Lecture professionnels', false, 'b0000000-0000-0000-0000-00000000000a');
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'custom_0000000e', 'professionals.view');
update public.org_modules set enabled = false
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role service_role;
select throws_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000002', 'pv@mana.test', 'PV', 'custom_0000000e', (select hash from t where name = 'refused')) $$,
  'P0001', 'Vous ne pouvez pas inviter à un rôle qui donne des permissions que vous n''avez pas.',
  'hold rule with the Professionnels module off: its permissions count as lacking, so D cannot invite to the role');
select lives_ok($$ select public.create_staff_invitation('a0000000-0000-0000-0000-000000000001', 'pv@mana.test', 'PV', 'custom_0000000e', (select hash from t where name = 'pv')) $$,
  'an admin is not bound by the hold rule');
reset role;
update public.org_modules set enabled = true
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- The inviter's standing at acceptance (P3-31): D's invitation (« Accueil », settings.view)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-invite@mana.test', '', now(), '{}', '{}', now(), now());

-- D disabled.
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role service_role;
select is(public.accept_staff_invitation((select hash from t where name = 'by_d'), 'a0000000-0000-0000-0000-000000000013', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'an inviter disabled since: link_invalid');
select is(public.peek_secure_link((select hash from t where name = 'by_d'), false) ->> 'state', 'valid',
  'the refusal rolled the consumption back: the link is still valid');
reset role;
select results_eq($$
  select i.status, l.use_count, (select count(*)::int from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000013')
    from public.staff_invitations i join public.secure_links l on l.id = i.secure_link_id
   where i.id = current_setting('test.inv_d')::uuid
$$, $$ values ('pending'::text, 0, 0) $$,
  'nothing written: the invitation stays pending, the link unused, no profile');
update public.profiles set status = 'active' where user_id = 'a0000000-0000-0000-0000-000000000002';

-- D without users.manage.
update public.user_permission_overrides set granted = false
 where user_id = 'a0000000-0000-0000-0000-000000000002' and permission_key = 'users.manage';
set local role service_role;
select is(public.accept_staff_invitation((select hash from t where name = 'by_d'), 'a0000000-0000-0000-0000-000000000013', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'an inviter who lost users.manage since: link_invalid');
reset role;
update public.user_permission_overrides set granted = true
 where user_id = 'a0000000-0000-0000-0000-000000000002' and permission_key = 'users.manage';

-- D without settings.view, which « Accueil » carries.
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'settings.view', false);
set local role service_role;
select is(public.accept_staff_invitation((select hash from t where name = 'by_d'), 'a0000000-0000-0000-0000-000000000013', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'an inviter who lost a permission the role carries (hold rule): link_invalid');
reset role;
delete from public.user_permission_overrides
 where user_id = 'a0000000-0000-0000-0000-000000000002' and permission_key = 'settings.view';

-- D in good standing again.
set local role service_role;
select is(public.accept_staff_invitation((select hash from t where name = 'by_d'), 'a0000000-0000-0000-0000-000000000013', '{}'),
  '{"status": "accepted", "org_id": "b0000000-0000-0000-0000-00000000000a"}'::jsonb, 'a still-valid inviter: accepted');
select is(coalesce(current_setting('app.audit_actor', true), ''), '', 'accept restores app.audit_actor');
reset role;
select results_eq($$
  select l.table_name, l.action, l.actor_id, l.source from public.audit_log l
   where (l.table_name in ('profiles', 'user_roles') and l.record_id = 'a0000000-0000-0000-0000-000000000013')
      or (l.table_name = 'staff_invitations' and l.record_id = current_setting('test.inv_d') and l.action = 'update')
   order by l.id
$$, $$ values ('profiles'::text, 'insert'::text, 'a0000000-0000-0000-0000-000000000013'::uuid, 'rpc:accept_staff_invitation'::text),
              ('user_roles', 'insert', 'a0000000-0000-0000-0000-000000000013'::uuid, 'rpc:accept_staff_invitation'),
              ('staff_invitations', 'update', 'a0000000-0000-0000-0000-000000000013'::uuid, 'rpc:accept_staff_invitation') $$,
  'accept''s writes are audited as the new account');

-- =============================================================================
-- Constraints (as postgres)
-- =============================================================================
reset role;
select throws_ok($$ insert into public.staff_invitations (org_id, email, display_name, role)
  values ('b0000000-0000-0000-0000-00000000000a', 'Upper@mana.test', 'X', 'counselor') $$,
  '23514', null, 'a stored address is lower-case and trimmed');
select throws_ok($$ insert into public.staff_invitations (org_id, email, display_name, role)
  values ('b0000000-0000-0000-0000-00000000000a', 'b1@mana.test', 'X', 'custom_0000000b') $$,
  '23514', null, 'an invitation cannot name another org''s role');
select throws_ok($$ insert into public.staff_invitations (org_id, email, display_name, role)
  values ('b0000000-0000-0000-0000-00000000000a', 'accueil@mana.test', 'X', 'counselor') $$,
  '23505', null, 'one pending invitation per address and org');
select throws_ok($$ insert into public.staff_invitations (org_id, email, display_name, role, status)
  values ('b0000000-0000-0000-0000-00000000000a', 'b2@mana.test', 'X', null, 'pending') $$,
  '23514', null, 'a pending invitation names a role');
select throws_ok($$ insert into public.staff_invitations (org_id, email, display_name, role, status)
  values ('b0000000-0000-0000-0000-00000000000a', 'b3@mana.test', 'X', 'counselor', 'accepted') $$,
  '23514', null, 'an accepted invitation has its date');

-- =============================================================================
-- Audit
-- =============================================================================
select results_eq($$
  select action, coalesce(changed_fields -> 'status' ->> 'after', changed_fields ->> 'status'),
         changed_fields ? 'secure_link_id', actor_id, actor_role, source
    from public.audit_log
   where table_name = 'staff_invitations' and record_id = current_setting('test.inv1')
   order by id
$$, $$ values ('insert'::text, 'pending'::text, true, 'a0000000-0000-0000-0000-000000000001'::uuid, 'admin'::text,
               'rpc:create_staff_invitation'::text),
              ('update', null, true, 'a0000000-0000-0000-0000-000000000001'::uuid, 'admin', 'rpc:renew_staff_invitation'),
              ('update', 'accepted', false, 'a0000000-0000-0000-0000-000000000010'::uuid, 'counselor',
               'rpc:accept_staff_invitation') $$,
  'create and renew (the service, for actor A) are audited as A with their RPC; accept as the new account');
select results_eq($$
  select l.action, l.actor_id, l.source
    from public.audit_log l
   where l.table_name = 'secure_links' and l.action = 'insert'
     and l.record_id = (select secure_link_id::text from public.staff_invitations where id = current_setting('test.inv_d')::uuid)
$$, $$ values ('insert'::text, 'a0000000-0000-0000-0000-000000000002'::uuid, 'rpc:create_staff_invitation'::text) $$,
  'the link issued for actor D is audited as D');
select ok(exists (select 1 from public.audit_log where table_name = 'user_roles' and action = 'insert'
                   and record_id = 'a0000000-0000-0000-0000-000000000010'),
  'the new role assignment is audited');

select * from finish();
rollback;
