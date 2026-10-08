-- Staff invitations (migration *_core_staff_invitations.sql, plan Phase 3 Task 3.18, design §4,
-- P3-7, P3-8, P3-16, inconsistency #15).
-- Covers: privileges (staff_invitations select-only for authenticated, nothing for anon and
-- service_role; the user RPCs for authenticated only, the purpose handlers for service_role
-- only, all definer); the staff_invite purpose seed; indexes; create_staff_invitation (address
-- and name normalisation, the link it issues, every guard and its French message: provider,
-- missing or another org's role, admin by a non-admin, the hold rule, an existing member, a
-- pending duplicate, bad input; an org custom role accepted; an address with an account elsewhere
-- accepted like any other: nothing reveals it); refusals for a counselor, a disabled admin and
-- another org; list_staff_invitations (fields, is_expired, the last email); renew (old link
-- revoked, new link live, expiry moved; the admin and hold guards apply again); revoke;
-- resolve_staff_invitation; accept_staff_invitation (profile, role, accepted; single use; after a
-- revoke, an expired link or an unknown hash answers link_used / link_invalid / link_expired as
-- peek would; an address mismatch rolls back and leaves the link usable; the new user's access); delete_role refusing a role with pending invitations; audit rows.
-- The whole file is one transaction, so now() is constant. Token hashes are computed as
-- _shared/links.ts does: SHA-256 over the token string's UTF-8 bytes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

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
  ('create_staff_invitation(text,text,text,bytea)', false, true, false, true),
  ('list_staff_invitations()', false, true, false, true),
  ('renew_staff_invitation(uuid,bytea)', false, true, false, true),
  ('resolve_staff_invitation(uuid)', false, false, true, true),
  ('revoke_staff_invitation(uuid)', false, true, false, true)
$$, 'user RPCs for authenticated only, purpose handlers for service_role only, all definer');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'assert_can_invite_to_role'
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private invitation guard is callable by no client role');

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

create temp table t (name text primary key, hash bytea not null) on commit drop;
grant select on t to authenticated, service_role;
insert into t (name, hash)
select n, extensions.digest(convert_to(n, 'UTF8'), 'sha256')
  from unnest(array['inv1', 'custom', 'neutral_b', 'orphan', 'adm', 'by_d', 'temp', 'refused',
                    'renew1', 'renew_refused', 'unknown']) n;

-- =============================================================================
-- create_staff_invitation as admin A
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select set_config('test.inv1', public.create_staff_invitation('  Nouvelle@Mana.TEST ', E' Marie Tremblay\t',
  'counselor', (select hash from t where name = 'inv1'))::text, true);
select results_eq($$
  select org_id, email, display_name, role, status, invited_by, accepted_user_id, accepted_at
    from public.staff_invitations where id = current_setting('test.inv1')::uuid
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'nouvelle@mana.test'::text, 'Marie Tremblay'::text,
               'counselor'::text, 'pending'::text, 'a0000000-0000-0000-0000-000000000001'::uuid,
               null::uuid, null::timestamptz) $$,
  'A invites: the address is trimmed and lowercased, the name trimmed, the invitation pending');

reset role;
select results_eq($$
  select l.org_id, l.purpose, l.subject_type, l.subject_id, l.token_hash, l.expires_at, l.max_uses, l.created_by
    from public.secure_links l join public.staff_invitations i on i.secure_link_id = l.id
   where i.id = current_setting('test.inv1')::uuid
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'staff_invite'::text, 'staff_invitation'::text,
               current_setting('test.inv1')::uuid, (select hash from t where name = 'inv1'), now() + interval '7 days', 1,
               'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the invitation''s link: staff_invite, its subject is the invitation, 7 days, single use, by A');
set local role authenticated;

select throws_ok($$ select public.create_staff_invitation('pro@mana.test', 'Pro', 'provider', (select hash from t where name = 'refused')) $$,
  'P0001', 'Le rôle Professionnel est attribué par le module Professionnels.', 'provider is refused');
select throws_ok($$ select public.create_staff_invitation('x1@mana.test', 'X', 'nope', (select hash from t where name = 'refused')) $$,
  'P0001', 'Ce rôle n''existe plus.', 'an unknown role: « Ce rôle n''existe plus. »');
select throws_ok($$ select public.create_staff_invitation('x1@mana.test', 'X', 'custom_0000000b', (select hash from t where name = 'refused')) $$,
  'P0001', 'Ce rôle n''existe plus.', 'another org''s custom role: the same answer');
select throws_ok($$ select public.create_staff_invitation(' C@A.Test  ', 'C', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Cette personne a déjà un accès.', 'a member''s address (mixed case, spaces): « Cette personne a déjà un accès. »');
select throws_ok($$ select public.create_staff_invitation('x@a.test', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Cette personne a déjà un accès.', 'a disabled member''s address too');
select throws_ok($$ select public.create_staff_invitation(' NOUVELLE@mana.test', 'Autre nom', 'admin_assistant', (select hash from t where name = 'refused')) $$,
  'P0001', 'Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».', 'a pending duplicate: the « Renvoyer » message');
select throws_ok($$ select public.create_staff_invitation('pas-un-courriel', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Adresse courriel invalide.', 'a malformed address');
select throws_ok($$ select public.create_staff_invitation(null, 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Adresse courriel invalide.', 'a missing address');
select throws_ok($$ select public.create_staff_invitation('x1@mana.test', E' \t ', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Le nom doit contenir de 1 à 80 caractères.', 'a blank name');
select throws_ok($$ select public.create_staff_invitation('x1@mana.test', repeat('n', 81), 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Le nom doit contenir de 1 à 80 caractères.', 'a name over 80 characters');
select throws_ok($$ select public.create_staff_invitation('x2@mana.test', 'X', 'counselor', (select hash from t where name = 'inv1')) $$,
  '23505', null, 'a token hash is never reused');

select set_config('test.inv_custom', public.create_staff_invitation('accueil@mana.test', 'Accueil', 'custom_0000000a',
  (select hash from t where name = 'custom'))::text, true);
select is((select role from public.staff_invitations where id = current_setting('test.inv_custom')::uuid), 'custom_0000000a',
  'an org custom role can be invited to (#40)');
-- Neutral (P3-8, decision #38): an address with an account elsewhere is invited like any other.
select lives_ok($$ select set_config('test.inv_neutral_b', public.create_staff_invitation('admin@b.test', 'B', 'counselor',
  (select hash from t where name = 'neutral_b'))::text, true) $$,
  'another org''s member''s address is accepted: nothing reveals the account');
select lives_ok($$ select set_config('test.inv_orphan', public.create_staff_invitation('orphan@a.test', 'O', 'admin_assistant',
  (select hash from t where name = 'orphan'))::text, true) $$,
  'an address with an auth account but no profile is accepted too');
select lives_ok($$ select set_config('test.inv_admin', public.create_staff_invitation('adm@mana.test', 'Adm', 'admin',
  (select hash from t where name = 'adm'))::text, true) $$,
  'an admin invites an admin');

-- =============================================================================
-- The non-admin manager D, the counselor C, the disabled admin X, org B
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.create_staff_invitation('adm2@mana.test', 'Adm', 'admin', (select hash from t where name = 'refused')) $$,
  'P0001', 'Seul un administrateur peut inviter un administrateur.', 'D cannot invite an admin');
select throws_ok($$ select public.create_staff_invitation('rm@mana.test', 'RM', 'custom_0000000c', (select hash from t where name = 'refused')) $$,
  'P0001', 'Vous ne pouvez pas inviter à un rôle qui donne des permissions que vous n''avez pas.',
  'hold rule: D cannot invite to a role carrying roles.manage, which she lacks');
select lives_ok($$ select set_config('test.inv_d', public.create_staff_invitation('d-invite@mana.test', 'Par D', 'custom_0000000a',
  (select hash from t where name = 'by_d'))::text, true) $$,
  'D invites to a role whose permissions she holds');
select throws_ok(format($$ select public.renew_staff_invitation(%L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv_admin')),
  'P0001', 'Seul un administrateur peut inviter un administrateur.', 'D cannot renew an admin''s invitation (she would choose its token)');
select is((select count(*)::int from public.list_staff_invitations()), 6, 'D (users.view by override) lists the 6 pending invitations');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.create_staff_invitation('c2@mana.test', 'C', 'counselor', (select hash from t where name = 'refused')) $$,
  '42501', null, 'a counselor cannot invite');
select throws_ok(format($$ select * from public.renew_staff_invitation(%L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv1')), '42501', null, 'a counselor cannot renew');
select throws_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv1')),
  '42501', null, 'a counselor cannot revoke');
select throws_ok($$ select * from public.list_staff_invitations() $$, '42501', null, 'a counselor cannot list invitations');
select is_empty($$ select 1 from public.staff_invitations $$, 'a counselor reads no invitation row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.create_staff_invitation('x3@mana.test', 'X', 'counselor', (select hash from t where name = 'refused')) $$,
  '42501', null, 'a disabled admin cannot invite');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_staff_invitations() $$, 'org B lists none of org A''s invitations');
select is_empty($$ select 1 from public.staff_invitations $$, 'org B reads none of org A''s invitation rows');
select throws_ok(format($$ select * from public.renew_staff_invitation(%L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv1')),
  'P0001', 'Cette invitation n''est plus en attente.', 'org B cannot renew org A''s invitation');
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
update public.secure_links l set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
  from public.staff_invitations i
 where i.id = current_setting('test.inv1')::uuid and l.id = i.secure_link_id;
set local role authenticated;

select results_eq($$
  select expires_at, is_expired, last_email_status, last_email_at
    from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid
$$, $$ values (now() - interval '1 day', true, 'bounced'::text, now() - interval '10 minutes') $$,
  'is_expired once the link has expired; the last email''s status and date');

-- =============================================================================
-- renew_staff_invitation as admin A (the expired invitation)
-- =============================================================================
reset role;
select set_config('test.inv1_old_link', (select secure_link_id::text from public.staff_invitations
  where id = current_setting('test.inv1')::uuid), true);
set local role authenticated;

select results_eq(format($$ select * from public.renew_staff_invitation(%L, (select hash from t where name = 'renew1')) $$,
  current_setting('test.inv1')),
  $$ values ('nouvelle@mana.test'::text, 'Marie Tremblay'::text, now() + interval '7 days') $$,
  'renew returns what the email needs, with the new expiry');

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
select is((select is_expired from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid), false,
  'the renewed invitation is no longer expired');

-- =============================================================================
-- revoke_staff_invitation as admin A
-- =============================================================================
select lives_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv_orphan')),
  'A revokes an invitation');
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
select throws_ok(format($$ select * from public.renew_staff_invitation(%L, (select hash from t where name = 'renew_refused')) $$,
  current_setting('test.inv_orphan')),
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
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nouvelle@mana.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'second@mana.test', '', now(), '{}', '{}', now(), now()),
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

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select results_eq($$ select public.get_my_access() ->> 'role', public.get_my_access() -> 'permissions' $$,
  $$ values ('counselor'::text, '["professionals.view"]'::jsonb) $$,
  'the new user''s access lists the role and its permissions');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not exists (select 1 from public.list_staff_invitations() where id = current_setting('test.inv1')::uuid),
  'an accepted invitation is no longer listed');
select throws_ok($$ select public.create_staff_invitation('Nouvelle@mana.test', 'M', 'counselor', (select hash from t where name = 'refused')) $$,
  'P0001', 'Cette personne a déjà un accès.', 'the accepted address now has access');

-- =============================================================================
-- delete_role and pending invitations (inconsistency #15), as admin A
-- =============================================================================
select set_config('test.inv_temp', public.create_staff_invitation('temp@mana.test', 'Temp', 'custom_0000000d',
  (select hash from t where name = 'temp'))::text, true);
select throws_ok($$ select public.delete_role('custom_0000000d') $$,
  'P0001', 'Ce rôle est utilisé par 1 invitation(s) en attente.', 'a role with a pending invitation cannot be deleted');
select lives_ok(format($$ select public.revoke_staff_invitation(%L) $$, current_setting('test.inv_temp')),
  'the invitation is revoked');
select lives_ok($$ select public.delete_role('custom_0000000d') $$, 'the role can be deleted once no invitation is pending');
select results_eq($$ select status, role from public.staff_invitations where id = current_setting('test.inv_temp')::uuid $$,
  $$ values ('revoked'::text, null::text) $$, 'the revoked invitation keeps its history without the deleted role');

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
         changed_fields ? 'secure_link_id', actor_id
    from public.audit_log
   where table_name = 'staff_invitations' and record_id = current_setting('test.inv1')
   order by id
$$, $$ values ('insert'::text, 'pending'::text, true, 'a0000000-0000-0000-0000-000000000001'::uuid),
              ('update', null, true, 'a0000000-0000-0000-0000-000000000001'::uuid),
              ('update', 'accepted', false, null::uuid) $$,
  'create, renew (new link, by A) and accept (by the service) are audited');
select ok(exists (select 1 from public.audit_log where table_name = 'user_roles' and action = 'insert'
                   and record_id = 'a0000000-0000-0000-0000-000000000010'),
  'the new role assignment is audited');

select * from finish();
rollback;
