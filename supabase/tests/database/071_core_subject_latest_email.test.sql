-- Core: private.latest_subject_email (migration *_core_subject_latest_email.sql, P4-490).
-- Covers: no role executes it; the newest row of the given templates about the subject since the
-- date (created_at, then id); other templates, subjects, clinics and older rows are not read.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select function_privs_are('private', 'latest_subject_email', array['uuid', 'text', 'uuid', 'text[]', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'authenticated may not read the log through the helper');
select function_privs_are('private', 'latest_subject_email', array['uuid', 'text', 'uuid', 'text[]', 'timestamp with time zone'],
  'anon', array[]::text[], 'nor anon');
select function_privs_are('private', 'latest_subject_email', array['uuid', 'text', 'uuid', 'text[]', 'timestamp with time zone'],
  'service_role', array[]::text[], 'nor the service role (the module RPCs call it)');

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.email_log
  (id, org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code,
   view_permission, created_at)
values
  -- Subject 1 in org A: an old invitation, a reminder, the newest invitation (failed, unknown outcome).
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0,
   'p@a.test', 'professional', 'd0000000-0000-0000-0000-000000000001', 'delivered', null, 'professionals.view', now() - interval '3 days'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite_reminder', 0,
   'p@a.test', 'professional', 'd0000000-0000-0000-0000-000000000001', 'sent', null, 'professionals.view', now() - interval '2 hours'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0,
   'p@a.test', 'professional', 'd0000000-0000-0000-0000-000000000001', 'failed', 'provider_unavailable', 'professionals.view', now() - interval '1 hour'),
  -- Another template about the same subject, newer: not read.
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.profile_update', 0,
   'p@a.test', 'professional', 'd0000000-0000-0000-0000-000000000001', 'sent', null, 'professionals.view', now()),
  -- The same subject id in org B: not read for org A.
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'professionals', 'professionals.invite', 0,
   'p@b.test', 'professional', 'd0000000-0000-0000-0000-000000000001', 'bounced', null, 'professionals.view', now());

select results_eq($$ select id, status, error_code from private.latest_subject_email('b0000000-0000-0000-0000-00000000000a', 'professional',
                      'd0000000-0000-0000-0000-000000000001', array['professionals.invite', 'professionals.invite_reminder'], now() - interval '1 day') $$,
  $$ values ('e0000000-0000-0000-0000-000000000003'::uuid, 'failed'::text, 'provider_unavailable'::text) $$,
  'the newest row of the templates, with its status and code');
select results_eq($$ select id from private.latest_subject_email('b0000000-0000-0000-0000-00000000000a', 'professional',
                      'd0000000-0000-0000-0000-000000000001', array['professionals.invite_reminder'], now() - interval '1 day') $$,
  $$ values ('e0000000-0000-0000-0000-000000000002'::uuid) $$, 'only the templates asked for');
select is_empty($$ select 1 from private.latest_subject_email('b0000000-0000-0000-0000-00000000000a', 'professional',
                      'd0000000-0000-0000-0000-000000000001', array['professionals.invite'], now() - interval '30 minutes') $$,
  'nothing since the date: an older email is not read');
select results_eq($$ select id from private.latest_subject_email('b0000000-0000-0000-0000-00000000000a', 'professional',
                      'd0000000-0000-0000-0000-000000000001', array['professionals.invite'], now() - interval '3 days') $$,
  $$ values ('e0000000-0000-0000-0000-000000000003'::uuid) $$, 'a wider window still reads the newest row');
select results_eq($$ select id, status from private.latest_subject_email('b0000000-0000-0000-0000-00000000000b', 'professional',
                      'd0000000-0000-0000-0000-000000000001', array['professionals.invite'], now() - interval '1 day') $$,
  $$ values ('e0000000-0000-0000-0000-000000000005'::uuid, 'bounced'::text) $$, 'each clinic reads its own rows');
select is_empty($$ select 1 from private.latest_subject_email('b0000000-0000-0000-0000-00000000000a', 'staff_invitation',
                      'd0000000-0000-0000-0000-000000000001', array['professionals.invite'], now() - interval '1 day') $$,
  'another subject type reads nothing');

select * from finish();
rollback;
