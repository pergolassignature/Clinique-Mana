-- « Supprimer le compte » (migrations *_core_delete_staff_account.sql and
-- *_professionals_account_deletion_guard.sql): delete_staff_account, the module guard catalogue,
-- the audit redaction it asks for, and the orphan purge's new branch.
-- Covers: privileges; users.manage; oneself; another clinic; disabled first; the last active
-- admin; only an admin deletes an admin; an account linked to a professional file (refused while
-- the collaboration lasts, allowed once the file is inactive); what goes and what stays; the
-- audit trace without identifiers; idempotence; the purge of the Auth user left behind.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admins A1 (active) and A3 (disabled), counselor C (disabled, with an override, a
-- preference, a notification and its read, an accepted invitation and a pending one to her
-- address), counselor E (active), adjointe D (users.manage by override: a non-admin manager),
-- providers P (disabled, active file) and Q (disabled, inactive file).
-- Org B: admin B, counselor B2 (disabled).
-- X: an auth user whose profile delete_staff_account removed two hours ago (purge).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('d0000000-0000-0000-0000-0000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e || '@del.test', '', now(), '{}', '{}', now(), now()
  from (values ('01', 'a1'), ('03', 'a3'), ('04', 'c'), ('05', 'e'), ('06', 'd'), ('07', 'p'), ('08', 'q'),
               ('11', 'b'), ('12', 'b2'), ('99', 'x')) v(n, e);
insert into public.organizations (id, name) values
  ('d1000000-0000-0000-0000-00000000000a', 'Org A'),
  ('d1000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'Admin A1', 'a1@del.test', 'active'),
  ('d0000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'Admin A3', 'a3@del.test', 'disabled'),
  ('d0000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@del.test', 'disabled'),
  ('d0000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000000a', 'Conseillère E', 'e@del.test', 'active'),
  ('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a', 'Adjointe D', 'd@del.test', 'active'),
  ('d0000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-00000000000a', 'Pro P', 'p@del.test', 'disabled'),
  ('d0000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-00000000000a', 'Pro Q', 'q@del.test', 'disabled'),
  ('d0000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-00000000000b', 'Admin B', 'b@del.test', 'active'),
  ('d0000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-00000000000b', 'Conseillère B2', 'b2@del.test', 'disabled');
insert into public.user_roles (user_id, org_id, role) values
  ('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'admin'),
  ('d0000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'admin'),
  ('d0000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a', 'counselor'),
  ('d0000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000000a', 'counselor'),
  ('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('d0000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-00000000000a', 'provider'),
  ('d0000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-00000000000a', 'provider'),
  ('d0000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-00000000000b', 'admin'),
  ('d0000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-00000000000b', 'counselor');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a', 'users.view', true),
  ('d0000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a', 'users.view', true);
insert into public.user_preferences (user_id, org_id, key, value) values
  ('d0000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a', 'professionals.list', '{"q": "x"}');
insert into public.notifications (id, org_id, module_key, kind, title, recipient_permission) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'core', 'core.test', 'Avis', 'users.view');
insert into public.notification_reads (notification_id, user_id, org_id) values
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a');
insert into public.staff_invitations (id, org_id, email, display_name, role, status, invited_by, accepted_user_id, accepted_at) values
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'c@del.test', 'Conseillère C', 'counselor',
   'accepted', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', now()),
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'c@del.test', 'Conseillère C', 'counselor',
   'pending', 'd0000000-0000-0000-0000-000000000001', null, null),
  ('d3000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'other@del.test', 'Autre', 'counselor',
   'pending', 'd0000000-0000-0000-0000-000000000001', null, null);
insert into public.org_modules (org_id, module_key, enabled) values
  ('d1000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('d4000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000007',
   'Paule', 'Pro', 'p@del.test', 'active');
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, deactivation_reason_id) values
  ('d4000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000008',
   'Quentin', 'Pro', 'q@del.test', 'inactive',
   (select r.id from public.deactivation_reasons r where r.org_id = 'd1000000-0000-0000-0000-00000000000a' and r.key = 'leave'));
-- X: deleted by delete_staff_account two hours ago, its Auth deletion never done.
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, source, created_at) values
  ('d1000000-0000-0000-0000-00000000000a', 'profiles', 'd0000000-0000-0000-0000-000000000099', 'delete', '{}',
   'd0000000-0000-0000-0000-000000000001', 'rpc:delete_staff_account', now() - interval '2 hours');

-- =============================================================================
-- Privileges and the guard catalogue
-- =============================================================================
select function_privs_are('public', 'delete_staff_account', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated can call delete_staff_account');
select function_privs_are('public', 'delete_staff_account', array['uuid'], 'anon', array[]::text[], 'anon cannot call delete_staff_account');
select function_privs_are('public', 'delete_staff_account', array['uuid'], 'service_role', array[]::text[], 'service_role has no grant on delete_staff_account');
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.delete_staff_account(uuid)'::regprocedure), 'delete_staff_account is security definer');
select table_privs_are('public', 'account_deletion_guards', 'anon', array[]::text[], 'anon: nothing on account_deletion_guards');
select table_privs_are('public', 'account_deletion_guards', 'authenticated', array[]::text[], 'authenticated: nothing on account_deletion_guards');
select table_privs_are('public', 'account_deletion_guards', 'service_role', array[]::text[], 'service_role: nothing on account_deletion_guards');
select results_eq($$ select module_key, guard_function from public.account_deletion_guards order by module_key $$,
  $$ values ('professionals'::text, 'private.professionals_account_deletion_guard'::text) $$,
  'Professionnels registers its guard');
-- The guard contract: private.<name>(uuid, uuid) returns text, invoker, callable by no client role.
select is_empty($$
  select g.guard_function from public.account_deletion_guards g
   where pg_catalog.to_regprocedure(g.guard_function || '(uuid, uuid)') is null
      or exists (select 1 from pg_proc p where p.oid = pg_catalog.to_regprocedure(g.guard_function || '(uuid, uuid)')
                  and (p.prorettype <> 'text'::regtype or p.prosecdef
                       or has_function_privilege('authenticated', p.oid, 'execute')
                       or has_function_privilege('service_role', p.oid, 'execute')))
$$, 'every guard is private.<name>(uuid, uuid) returns text, invoker, granted to no client role');
select throws_ok($$ insert into public.account_deletion_guards (module_key, guard_function) values ('core', 'public.list_org_users') $$,
  '23514', null, 'a guard must be a private function');

-- =============================================================================
-- Refusals (nothing changes)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000004') $$,
  '42501', 'Permission refusée : users.manage', 'without users.manage: refused');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Vous ne pouvez pas supprimer votre propre compte.', 'nobody deletes their own account');
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000012') $$,
  'P0001', 'Utilisateur introuvable.', 'another clinic''s account reads as unknown');
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-0000000000ff') $$,
  'P0001', 'Utilisateur introuvable.', 'an unknown id is refused the same way');
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Désactivez d''abord le compte.', 'an active account is disabled first');
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000007') $$,
  'P0001', 'Ce compte est lié au dossier professionnel de Paule Pro. Désactivez d''abord ce dossier dans Professionnels (fin de la collaboration).',
  'an account linked to a professional file still in collaboration is refused, the file named');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Seul un administrateur peut supprimer un administrateur.', 'a non-admin manager does not delete an admin');

-- The last active admin: B is org B's only one; she cannot delete herself, and nobody else in her
-- clinic may manage users. An active admin is never deletable (disabled first), and the last one
-- cannot be disabled; the last-admin trigger stays the backstop for any write path.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000011') $$,
  'P0001', 'Vous ne pouvez pas supprimer votre propre compte.', 'the last active admin cannot delete herself');
reset role;
select throws_ok($$ delete from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000011' $$,
  'P0001', 'La clinique doit garder au moins un administrateur actif.', 'the last-admin trigger still guards any other path');
select is((select count(*)::int from public.profiles where user_id in ('d0000000-0000-0000-0000-000000000003',
             'd0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000011',
             'd0000000-0000-0000-0000-000000000012')), 5, 'the refused calls deleted nothing');

-- =============================================================================
-- Deleting C
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.delete_staff_account('d0000000-0000-0000-0000-000000000004'), 'deleted', 'A1 deletes the disabled counselor C');
reset role;
select is((select count(*)::int from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000004'), 0, 'her profile is gone');
select is((select count(*)::int from public.user_roles where user_id = 'd0000000-0000-0000-0000-000000000004')
          + (select count(*)::int from public.user_permission_overrides where user_id = 'd0000000-0000-0000-0000-000000000004'), 0,
  'her role and her permission overrides are gone');
select is((select count(*)::int from public.user_preferences where user_id = 'd0000000-0000-0000-0000-000000000004')
          + (select count(*)::int from public.notification_reads where user_id = 'd0000000-0000-0000-0000-000000000004'), 0,
  'her preferences and notification reads are gone');
select is((select count(*)::int from public.staff_invitations where id in ('d3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000002')), 0,
  'the invitations to her address (accepted and pending) are gone');
select is((select count(*)::int from public.staff_invitations where id = 'd3000000-0000-0000-0000-000000000003'), 1,
  'another person''s invitation stays');
select is((select count(*)::int from public.notifications where id = 'd2000000-0000-0000-0000-000000000001'), 1,
  'the shared notification stays (only her read goes)');
select is((select count(*)::int from auth.users where id = 'd0000000-0000-0000-0000-000000000004'), 1,
  'the Auth user is left to users-delete (service role)');

-- The audit trace: who deleted which account, without her identifiers.
select results_eq($$
  select a.actor_id, a.source, a.changed_fields ->> 'email', a.changed_fields ->> 'display_name', a.org_id
    from public.audit_log a
   where a.table_name = 'profiles' and a.record_id = 'd0000000-0000-0000-0000-000000000004' and a.action = 'delete'
$$, $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'rpc:delete_staff_account'::text, '[redacted]'::text, '[redacted]'::text,
               'd1000000-0000-0000-0000-00000000000a'::uuid) $$,
  'one audit row names the actor and the account id, the email and name redacted');
select is_empty($$
  select a.id from public.audit_log a
   where a.source = 'rpc:delete_staff_account' and a.created_at = now()
     and (a.changed_fields::text like '%c@del.test%' or a.changed_fields::text like '%Conseillère C%')
$$, 'no audit row of the deletion holds her address or her name');
select ok(exists (select 1 from public.audit_log a
                   where a.table_name = 'staff_invitations' and a.record_id = 'd3000000-0000-0000-0000-000000000001' and a.action = 'delete'
                     and a.changed_fields ->> 'email' = '[redacted]'),
  'the invitation''s delete row is redacted too');
select is(coalesce(current_setting('app.audit_redact', true), ''), '', 'the redaction setting is put back after the call');

-- Idempotent: a retry answers already_deleted; another clinic still cannot see it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.delete_staff_account('d0000000-0000-0000-0000-000000000004'), 'already_deleted', 'a second call answers already_deleted');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.delete_staff_account('d0000000-0000-0000-0000-000000000004'), 'already_deleted', '… for any manager of the clinic');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Utilisateur introuvable.', 'another clinic never learns about it');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.delete_staff_account('d0000000-0000-0000-0000-000000000004') $$,
  '42501', 'Permission refusée : users.manage', 'the retry still needs users.manage');
reset role;
select is((select count(*)::int from public.audit_log a
            where a.table_name = 'profiles' and a.record_id = 'd0000000-0000-0000-0000-000000000004' and a.action = 'delete'), 1,
  'the retries wrote nothing');

-- =============================================================================
-- A disabled admin; a provider whose file is inactive
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.delete_staff_account('d0000000-0000-0000-0000-000000000003'), 'deleted', 'an admin deletes a disabled admin');
select is(public.delete_staff_account('d0000000-0000-0000-0000-000000000008'), 'deleted',
  'an account whose professional file is inactive (collaboration ended) is deleted');
reset role;
select results_eq($$ select profile_id, status from public.professionals where id = 'd4000000-0000-0000-0000-000000000008' $$,
  $$ values (null::uuid, 'inactive'::text) $$, 'the inactive file stays, unlinked');
select results_eq($$ select profile_id from public.professionals where id = 'd4000000-0000-0000-0000-000000000007' $$,
  $$ values ('d0000000-0000-0000-0000-000000000007'::uuid) $$, 'the active file keeps its account');
select is((select count(*)::int from public.user_roles r join public.profiles p on p.user_id = r.user_id
            where r.org_id = 'd1000000-0000-0000-0000-00000000000a' and r.role = 'admin' and p.status = 'active'), 1,
  'org A keeps its active admin');

-- =============================================================================
-- core.invite_orphans_purge also deletes the Auth users delete_staff_account left behind
-- =============================================================================
select is(private.job_invite_orphans_purge(), 'deleted=1', 'the purge deletes one account');
select is((select count(*)::int from auth.users where id = 'd0000000-0000-0000-0000-000000000099'), 0,
  'the Auth user of a profile deleted more than an hour ago is deleted');
select is((select count(*)::int from auth.users where id in ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000003')), 2,
  'one deleted just now is left to users-delete for an hour');
select is((select count(*)::int from auth.users where id = 'd0000000-0000-0000-0000-000000000012'), 1,
  'an account with a profile is never touched');
select results_eq($$ select label from public.scheduled_jobs where key = 'core.invite_orphans_purge' $$,
  $$ values ('Purge des comptes de connexion orphelins'::text) $$, 'the job''s label says what it now does');

select * from finish();
rollback;
