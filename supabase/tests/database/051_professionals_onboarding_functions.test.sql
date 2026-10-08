-- Professionnels onboarding functions support (migration *_professionals_onboarding_functions.sql,
-- plan Phase 4 Task 4b.2). Covers: the reminder job's catalogue row, schedule and per-clinic switch;
-- privileges of the three service-role RPCs and the private rule; which invitations are due for a
-- reminder (delay, account, status, live and unopened link, expiry, one reminder per sending, the
-- inviter's standing, the clinic's switch-off, isolation); the re-issue (new link for the original
-- inviter, the previous one revoked, the onboarding draft re-pointed, the clinic's lifetime, audit
-- as the job, null once the file no longer qualifies); the reminded link bound to the file's address
-- (4b.1's P4-300: it resolves and is accepted while the address is the file's, and is refused once
-- the address is corrected); the submission notice (the actor's submitted submission, reviewers by
-- permission, at most 20, null otherwise).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, adjointe 02, provider 03 linked to P2, conseillère 04,
-- adjointe 06 who loses professionals.invite after inviting P8), org B (admin 05).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe2@a.test',   '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe Deux', 'adjointe2@a.test',   'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

-- P1 due; P2 has an account; P5 invited yesterday; P6 opened; P7 expired; P8 invited by adjointe 06;
-- P9 already reminded; P10 inactive; P3 in org B (due there).
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', null, 'Pom', 'Cinq', 'p5@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', null, 'Pio', 'Six', 'p6@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', null, 'Pep', 'Sept', 'p7@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', null, 'Pim', 'Huit', 'p8@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', null, 'Pol', 'Neuf', 'p9@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000a', null, 'Pux', 'Dix', 'p10@exemple.test', 'draft');
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-0000000000__';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-0000000000__';

-- The invitations, as the staff function makes them (one hash byte per file), then aged.
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', decode(repeat('01', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', decode(repeat('03', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', decode(repeat('05', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', decode(repeat('06', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000007', decode(repeat('07', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000008', decode(repeat('08', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000009', decode(repeat('09', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000010', decode(repeat('10', 32), 'hex'));
update public.secure_links set created_at = now() - interval '4 days'
 where purpose = 'professional_invite' and subject_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000009',
   'c0000000-0000-0000-0000-000000000010');
update public.secure_links set created_at = now() - interval '1 day' where subject_id = 'c0000000-0000-0000-0000-000000000005';
update public.secure_links set last_opened_at = now() - interval '1 day' where subject_id = 'c0000000-0000-0000-0000-000000000006';
update public.secure_links set created_at = now() - interval '10 days', expires_at = now() - interval '3 days'
 where subject_id = 'c0000000-0000-0000-0000-000000000007';
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted, created_by)
values ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'professionals.invite', false,
        'a0000000-0000-0000-0000-000000000001');
insert into public.email_log (org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, view_permission, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite_reminder', 0, 'p9@exemple.test', 'professional',
        'c0000000-0000-0000-0000-000000000009', 'sent', 'professionals.view', now() - interval '1 day');
update public.professionals
   set status = 'inactive',
       deactivation_reason_id = (select r.id from public.deactivation_reasons r
                                  where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave')
 where id = 'c0000000-0000-0000-0000-000000000010';

-- =============================================================================
-- The job: catalogue row, schedule, per-clinic switch
-- =============================================================================
select results_eq($$
  select j.module_key, j.kind, j.function_name, j.local_hour::int, j.is_maintenance, j.is_active, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'professionals.invitation_reminders'
$$, $$ values ('professionals'::text, 'function'::text, 'professionals-invitation-reminders'::text, 8, false, true,
               '5 * * * *'::text, 'select private.invoke_job_function(''professionals.invitation_reminders'')'::text) $$,
  'the reminder job is a business function job at 08:00 clinic time, dispatched hourly');
select results_eq($$
  select org_id, enabled from public.org_scheduled_jobs
   where job_key = 'professionals.invitation_reminders'
     and org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')
   order by org_id
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, false), ('b0000000-0000-0000-0000-00000000000b'::uuid, false) $$,
  'every clinic has the switch, off until « Tâches planifiées » turns it on');

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'list_professional_invitations_to_remind_for_service', array['uuid', 'integer'], 'service_role', array['EXECUTE'], 'the job lists');
select function_privs_are('public', 'list_professional_invitations_to_remind_for_service', array['uuid', 'integer'], 'authenticated', array[]::text[], 'list: not a user');
select function_privs_are('public', 'list_professional_invitations_to_remind_for_service', array['uuid', 'integer'], 'anon', array[]::text[], 'list: not anon');
select function_privs_are('public', 'reissue_professional_invitation_for_service', array['uuid', 'uuid', 'bytea'], 'service_role', array['EXECUTE'], 'the job re-issues');
select function_privs_are('public', 'reissue_professional_invitation_for_service', array['uuid', 'uuid', 'bytea'], 'authenticated', array[]::text[], 're-issue: never a user (the token hash)');
select function_privs_are('public', 'reissue_professional_invitation_for_service', array['uuid', 'uuid', 'bytea'], 'anon', array[]::text[], 're-issue: not anon');
select function_privs_are('public', 'get_professional_submission_notice_for_service', array['uuid'], 'service_role', array['EXECUTE'], 'professionals-submit reads the notice');
select function_privs_are('public', 'get_professional_submission_notice_for_service', array['uuid'], 'authenticated', array[]::text[], 'notice: never a user (reviewers'' addresses)');
select function_privs_are('public', 'get_professional_submission_notice_for_service', array['uuid'], 'anon', array[]::text[], 'notice: not anon');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname in ('list_professional_invitations_to_remind_for_service',
            'reissue_professional_invitation_for_service', 'get_professional_submission_notice_for_service')
          and (not p.prosecdef or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)))
      or (n.nspname = 'private' and p.proname = 'professional_invitations_due_for_reminder'
          and (has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
$$, 'the RPCs are security definer without PUBLIC; the rule is granted to no API role');

-- =============================================================================
-- Which invitations are due
-- =============================================================================
set local role service_role;
select results_eq($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid) $$,
  'only P1: no account, not inactive, live and unopened, older than 3 days, not reminded, inviter still allowed');
select results_eq($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000b') $$,
  $$ values ('c0000000-0000-0000-0000-000000000003'::uuid) $$, 'each clinic lists its own files only');
select is((select count(*)::int from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a', 0)),
  1, 'the limit is at least 1');
select throws_ok($$ select public.list_professional_invitations_to_remind_for_service(null) $$, '22023', null, 'an org is required');

-- =============================================================================
-- Re-issue
-- =============================================================================
select is(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', decode(repeat('a5', 32), 'hex')),
  null, 'a file not due yet (invited yesterday) gets nothing');
select is(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000006', decode(repeat('a6', 32), 'hex')),
  null, 'nor an opened invitation');
select is(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000008', decode(repeat('a8', 32), 'hex')),
  null, 'nor one whose inviter lost professionals.invite (its acceptance would answer link_invalid)');
select is(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001', decode(repeat('a1', 32), 'hex')),
  null, 'another clinic''s file reads as nothing');
select throws_ok($$ select public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', decode(repeat('a1', 31), 'hex')) $$,
  '22023', null, 'the hash is 32 bytes');
reset role;
-- Untouched by the refusals.
select is((select count(*)::int from public.secure_links where subject_id in ('c0000000-0000-0000-0000-000000000005',
            'c0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000008') and revoked_at is null), 3,
  'a refused re-issue revokes nothing');
select set_config('test.old_link', (select id::text from public.secure_links
  where subject_id = 'c0000000-0000-0000-0000-000000000001' and revoked_at is null), true);

set local role service_role;
create temp table test_reissued on commit drop as
  select public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a',
           'c0000000-0000-0000-0000-000000000001', decode(repeat('a1', 32), 'hex')) as r;
reset role;
select is((select r - 'link_id' - 'expires_at' from test_reissued),
  '{"email": "p1@exemple.test", "first_name": "Paul", "clinic_name": "Org A"}'::jsonb, 'the re-issue answers what the email needs');
select ok((select (r ->> 'expires_at')::timestamptz between now() + interval '7 days' - interval '1 minute'
                                                         and now() + interval '7 days' + interval '1 minute' from test_reissued),
  'the new link lasts the clinic''s invitation_expiry_days (7 by default) from now');
select results_eq($$
  select l.id, l.token_hash, l.created_by, l.revoked_at is null from public.secure_links l
   where l.subject_id = 'c0000000-0000-0000-0000-000000000001' and l.revoked_at is null
$$, $$ select (r ->> 'link_id')::uuid, decode(repeat('a1', 32), 'hex'), 'a0000000-0000-0000-0000-000000000001'::uuid, true from test_reissued $$,
  'the new link is the live one, with the given hash, authored by the original inviter');
select ok((select revoked_at is not null from public.secure_links where id = current_setting('test.old_link')::uuid),
  'the previous link is revoked');
select is((select secure_link_id from public.professional_submissions
            where professional_id = 'c0000000-0000-0000-0000-000000000001' and kind = 'onboarding' and status = 'draft'),
  (select (r ->> 'link_id')::uuid from test_reissued), 'the onboarding draft follows the new link');
select results_eq($$
  select a.source, a.actor_id from public.audit_log a
   where a.table_name = 'secure_links' and a.action = 'insert'
     and a.record_id = (select r ->> 'link_id' from test_reissued)
$$, $$ values ('job:professionals.invitation_reminders'::text, null::uuid) $$, 'the audit names the job, no person');
select is((select status from public.professionals where id = 'c0000000-0000-0000-0000-000000000001'), 'invited',
  'the file stays invited');

set local role service_role;
select is(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', decode(repeat('b1', 32), 'hex')),
  null, 'a second re-issue the same day gets nothing (the new link is not old enough)');
select is_empty($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  'nothing is due any more in org A');
reset role;

-- A later reminder email for the new link's sending: still nothing once the link ages (one per sending).
update public.secure_links set created_at = now() - interval '5 days'
 where id = (select (r ->> 'link_id')::uuid from test_reissued);
insert into public.email_log (org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, view_permission, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite_reminder', 0, 'p1@exemple.test', 'professional',
        'c0000000-0000-0000-0000-000000000001', 'sent', 'professionals.view', now() - interval '4 days');
set local role service_role;
select is_empty($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  'a reminder logged after the link was made counts: one reminder per sending');
reset role;

-- =============================================================================
-- The reminded link is bound to the file's address (4b.1's P4-300): it resolves and is accepted
-- while the address is the file's; corrected after the reminder, the link is refused.
-- P11 and P12 invited by admin 01 four days ago, both reminded; P12's address then corrected.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p11@exemple.test',         '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p12-nouveau@exemple.test', '', now(), '{}', '{}', now(), now());
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Onze', 'p11@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', null, 'Pat', 'Douze', 'p12@exemple.test', 'draft');
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id in ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012');
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id in ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012');
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011', decode(repeat('11', 32), 'hex'));
select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000012', decode(repeat('12', 32), 'hex'));
update public.secure_links set created_at = now() - interval '4 days'
 where purpose = 'professional_invite' and subject_id in ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table test_bound on commit drop as
  select p.id as pid,
         public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', p.id,
           decode(repeat(case p.id when 'c0000000-0000-0000-0000-000000000011' then 'b2' else 'b3' end, 32), 'hex')) as r
    from (values ('c0000000-0000-0000-0000-000000000011'::uuid), ('c0000000-0000-0000-0000-000000000012'::uuid)) p (id);
reset role;
select results_eq($$
  select t.pid, l.scope from test_bound t join public.secure_links l on l.id = (t.r ->> 'link_id')::uuid order by t.pid
$$, $$ values ('c0000000-0000-0000-0000-000000000011'::uuid, '{"email": "p11@exemple.test"}'::jsonb),
              ('c0000000-0000-0000-0000-000000000012'::uuid, '{"email": "p12@exemple.test"}'::jsonb) $$,
  'the reminded link is bound to the file''s address, as every invitation (P4-300)');

set local role service_role;
select is(public.resolve_professional_invitation((select (r ->> 'link_id')::uuid from test_bound where pid = 'c0000000-0000-0000-0000-000000000011')) ->> 'email',
  'p11@exemple.test', 'resolve: the reminded link shows the invitation while the address is the file''s');
select is(public.link_professional_account(decode(repeat('b2', 32), 'hex'), 'a0000000-0000-0000-0000-000000000011', '{}') ->> 'status',
  'accepted', 'accept: the reminded link opens the account');
reset role;
select is((select profile_id from public.professionals where id = 'c0000000-0000-0000-0000-000000000011'),
  'a0000000-0000-0000-0000-000000000011'::uuid, '… and the file is linked to it');

-- P12's address corrected after the reminder (« Modifier le courriel », staff).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_email('c0000000-0000-0000-0000-000000000012', 'p12-nouveau@exemple.test') $$,
  'the address of a reminded file is corrected');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(public.resolve_professional_invitation((select (r ->> 'link_id')::uuid from test_bound where pid = 'c0000000-0000-0000-0000-000000000012')) is null,
  'resolve: the reminded link shows nothing once the address changed');
select is(public.link_professional_account(decode(repeat('b3', 32), 'hex'), 'a0000000-0000-0000-0000-000000000012', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: … and opens no account, even for the new address');
reset role;
select results_eq($$
  select p.status, p.profile_id, l.revoked_at is not null, l.use_count
    from public.professionals p join public.secure_links l on l.subject_id = p.id
   where p.id = 'c0000000-0000-0000-0000-000000000012'
     and l.id = (select (r ->> 'link_id')::uuid from test_bound where pid = 'c0000000-0000-0000-0000-000000000012')
$$, $$ values ('draft'::text, null::uuid, true, 0) $$,
  'the reminded link is revoked, unused; the file is « À inviter » again (no further reminder)');
select set_config('request.jwt.claims', '', true);

-- P5 ages past the delay; then the clinic switches reminders off.
update public.secure_links set created_at = now() - interval '4 days' where subject_id = 'c0000000-0000-0000-0000-000000000005' and revoked_at is null;
set local role service_role;
select results_eq($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('c0000000-0000-0000-0000-000000000005'::uuid) $$, 'a file becomes due once its link is older than the delay');
reset role;
insert into public.org_module_settings (org_id, module_key, settings)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', '{"invitation_reminder_after_days": null}')
on conflict (org_id, module_key) do update set settings = excluded.settings;
set local role service_role;
select is_empty($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  'no reminder when the clinic''s delay is null');
select is(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', decode(repeat('c5', 32), 'hex')),
  null, '… and the re-issue re-checks it');
reset role;
update public.org_module_settings set settings = '{"invitation_reminder_after_days": 5}'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role service_role;
select is_empty($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  'the clinic''s delay is read (5 days: a 4-day-old link waits)');
reset role;

-- =============================================================================
-- The submission notice
-- =============================================================================
set local role service_role;
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003'), null,
  'no submitted submission: null');
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000001'), null,
  'a staff member has no professional file: null');
select throws_ok($$ select public.get_professional_submission_notice_for_service(null) $$, '22023', null, 'the actor is required');
reset role;

insert into public.professional_submissions (id, org_id, professional_id, kind, status, requested_sections, submitted_at)
values ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
        'update', 'submitted', array['personal'], now());
set local role service_role;
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003') - 'reviewers',
  '{"org_id": "b0000000-0000-0000-0000-00000000000a", "professional_id": "c0000000-0000-0000-0000-000000000002",
    "submission_id": "d0000000-0000-0000-0000-000000000002", "kind": "update", "full_name": "Pia Deux"}'::jsonb,
  'the notice names the submission, its kind and the professional');
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003') -> 'reviewers',
  '[{"user_id": "a0000000-0000-0000-0000-000000000001", "email": "admin@a.test"},
    {"user_id": "a0000000-0000-0000-0000-000000000002", "email": "adjointe@a.test"},
    {"user_id": "a0000000-0000-0000-0000-000000000006", "email": "adjointe2@a.test"}]'::jsonb,
  'reviewers: active members of the clinic holding professionals.review (not the conseillère, not the provider, not org B)');
reset role;

insert into public.user_permission_overrides (user_id, org_id, permission_key, granted, created_by)
values ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professionals.review', false,
        'a0000000-0000-0000-0000-000000000001');
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000006';
set local role service_role;
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003') -> 'reviewers',
  '[{"user_id": "a0000000-0000-0000-0000-000000000001", "email": "admin@a.test"}]'::jsonb,
  'an override that removes professionals.review, or a disabled account, takes the reviewer out');
reset role;

-- At most 20 reviewers (P4-264; professionals-submit refuses a longer list): 22 more admins.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'admin' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 22) n;
insert into public.profiles (user_id, org_id, display_name, email, status)
select ('a1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'b0000000-0000-0000-0000-00000000000a',
       'Admin ' || n, 'admin' || n || '@a.test', 'active'
  from generate_series(1, 22) n;
insert into public.user_roles (user_id, org_id, role)
select ('a1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'b0000000-0000-0000-0000-00000000000a', 'admin'
  from generate_series(1, 22) n;
set local role service_role;
select is(pg_catalog.jsonb_array_length(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003') -> 'reviewers'),
  20, '23 reviewers: the notice lists 20');
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003') -> 'reviewers' -> 19 ->> 'user_id',
  'a1000000-0000-0000-0000-000000000019', 'the 20 are the first by user id (stable from one submission to the next)');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role service_role;
select is(public.get_professional_submission_notice_for_service('a0000000-0000-0000-0000-000000000003') -> 'reviewers',
  '[]'::jsonb, 'a disabled module has no reviewer');
reset role;

select * from finish();
rollback;
