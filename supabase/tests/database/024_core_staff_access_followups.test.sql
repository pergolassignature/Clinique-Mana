-- Staff access follow-ups (migration *_core_staff_access_followups.sql, plan Phase 3 Task 3.20b,
-- P3-32). create_staff_invitation's new return (id, expires_at) and list_staff_invitations'
-- last_email_error_code are tested with the other invitation tests in 021_core_staff_invitations.
-- Covers: set_user_status keeps its grants and definer; its owner and the job's may delete from
-- auth.sessions / auth.users; disabling deletes the user's sessions (refresh tokens cascade), and
-- nobody else's; re-enabling restores nothing; disabling an already disabled user still ends a
-- session left; a refused call deletes nothing; core.invite_orphans_purge is a catalogued hourly
-- maintenance SQL job whose function no client role may call; it deletes the marked auth users
-- with no profile older than 1 hour (their identities and sessions cascade) and keeps a recent
-- one, one with a profile and an unmarked one; run_sql_job logs its run.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- =============================================================================
-- Privileges, owners, job
-- =============================================================================
select results_eq($$
  select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef
    from pg_proc p where p.oid = 'public.set_user_status(uuid, text)'::regprocedure
$$, $$ values (false, true, false, true) $$, 'set_user_status: still authenticated only, definer');
select results_eq($$
  select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p where p.oid = 'private.job_invite_orphans_purge()'::regprocedure
$$, $$ values (false, false, false) $$, 'job_invite_orphans_purge: callable by no client role');
select ok((select has_table_privilege(p.proowner, 'auth.sessions', 'delete')
             from pg_proc p where p.oid = 'public.set_user_status(uuid, text)'::regprocedure),
  'set_user_status''s owner may delete from auth.sessions');
select ok((select has_table_privilege(p.proowner, 'auth.users', 'delete')
             from pg_proc p where p.oid = 'private.job_invite_orphans_purge()'::regprocedure),
  'the purge''s owner may delete from auth.users');
select results_eq($$
  select j.key, j.module_key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'core.invite_orphans_purge'
$$, $$ values ('core.invite_orphans_purge'::text, 'core'::text, 'sql'::text, 'private.job_invite_orphans_purge'::text,
               true, '17 * * * *'::text, 'select private.run_sql_job(''core.invite_orphans_purge'')'::text) $$,
  'core.invite_orphans_purge is a maintenance SQL job, hourly at minute 17');

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A, counselor C, counselor E. Sessions: C two (with refresh tokens), A one.
-- Orphan candidates (auth users): O1 marked, no profile, 2 h old; O2 marked, no profile, 30 min
-- old; O3 marked, with a profile, 2 h old; O4 unmarked, no profile, 2 h old.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',     '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@a.test',     '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o1@a.test', '', null,
   '{"provider":"email","invite_link_id":"c0000000-0000-0000-0000-000000000001"}', '{}', now() - interval '2 hours', now() - interval '2 hours'),
  ('a0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o2@a.test', '', null,
   '{"provider":"email","invite_link_id":"c0000000-0000-0000-0000-000000000002"}', '{}', now() - interval '30 minutes', now()),
  ('a0000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o3@a.test', '', now(),
   '{"provider":"email","invite_link_id":"c0000000-0000-0000-0000-000000000003"}', '{}', now() - interval '2 hours', now()),
  ('a0000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o4@a.test', '', null,
   '{"provider":"email"}', '{}', now() - interval '2 hours', now());
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values ('a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1',
        '{"sub":"a0000000-0000-0000-0000-0000000000e1","email":"o1@a.test"}', 'email', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@a.test',     'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseiller E',  'e@a.test',     'active'),
  ('a0000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-00000000000a', 'Accepté O3',    'o3@a.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-00000000000a', 'counselor');

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('f0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000003', now(), now(), 'aal1'),
  ('f0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000003', now(), now(), 'aal1'),
  ('f0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', now(), now(), 'aal1'),
  ('f0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', now(), now(), 'aal1');
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, session_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-c1', 'a0000000-0000-0000-0000-000000000003', false, 'f0000000-0000-0000-0000-000000000031', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-c2', 'a0000000-0000-0000-0000-000000000003', false, 'f0000000-0000-0000-0000-000000000032', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'test-refresh-a1', 'a0000000-0000-0000-0000-000000000001', false, 'f0000000-0000-0000-0000-000000000011', now(), now());

-- =============================================================================
-- set_user_status ends the sessions of a disabled user (P3-32)
-- =============================================================================
set local role authenticated;
-- A refused call (counselor E has no users.manage) deletes nothing.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'disabled') $$,
  '42501', null, 'a counselor cannot disable a user');
reset role;
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000003'), 2,
  'a refused call leaves the sessions');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'disabled') $$, 'admin A disables C');
reset role;
select is((select status from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000003'), 'disabled', 'C is disabled');
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'C''s sessions are deleted in the same transaction');
select is((select count(*)::int from auth.refresh_tokens where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'C''s refresh tokens went with their sessions');
select results_eq($$ select s.id, (select count(*)::int from auth.refresh_tokens r where r.session_id = s.id)
                       from auth.sessions s where s.user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('f0000000-0000-0000-0000-000000000011'::uuid, 1) $$, 'the admin''s own session and refresh token are untouched');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'active') $$, 'admin A re-enables C');
reset role;
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000003')
          + (select count(*)::int from auth.refresh_tokens where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  're-enabling restores no session and no refresh token');

-- « Désactiver » on a user already disabled still ends a session left (e.g. created in between).
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000003';
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('f0000000-0000-0000-0000-000000000033', 'a0000000-0000-0000-0000-000000000003', now(), now(), 'aal1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_user_status('a0000000-0000-0000-0000-000000000003', 'disabled');
reset role;
select is((select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000000003'), 0,
  'disabling an already disabled user still deletes its sessions');

-- =============================================================================
-- core.invite_orphans_purge (as postgres)
-- =============================================================================
select is(private.job_invite_orphans_purge(), 'deleted=1', 'the purge reports how many auth users it deleted');
select results_eq($$
  select u.id from auth.users u
   where u.id in ('a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e2',
                  'a0000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e4')
   order by u.id
$$, $$ values ('a0000000-0000-0000-0000-0000000000e2'::uuid), ('a0000000-0000-0000-0000-0000000000e3'::uuid),
              ('a0000000-0000-0000-0000-0000000000e4'::uuid) $$,
  'the marked user with no profile older than 1 hour is deleted; a recent one, one with a profile and an unmarked one are kept');
select is((select count(*)::int from auth.identities where user_id = 'a0000000-0000-0000-0000-0000000000e1')
          + (select count(*)::int from auth.sessions where user_id = 'a0000000-0000-0000-0000-0000000000e1'), 0,
  'the orphan''s identity and session cascade');
select is((select count(*)::int from public.profiles where user_id = 'a0000000-0000-0000-0000-0000000000e3'), 1,
  'an accepted invitee keeps her account and profile');

select lives_ok($$ select private.run_sql_job('core.invite_orphans_purge', 'manual') $$, 'run_sql_job runs the purge');
select results_eq($$
  select r.status, r.detail, r.org_id from public.scheduled_job_runs r
   where r.job_key = 'core.invite_orphans_purge' and r.trigger = 'manual'
$$, $$ values ('ok'::text, 'deleted=0'::text, null::uuid) $$, 'the run is logged ok, database-wide, with its count');

select * from finish();
rollback;
