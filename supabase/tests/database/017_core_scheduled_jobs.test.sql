-- Scheduled jobs (migration *_core_scheduled_jobs.sql, plan Phase 3 Task 3.3, P3-22).
-- Covers: pg_cron / pg_net; privileges on the three tables and every RPC; the catalogue checks
-- and seeded jobs with their cron entries; org_scheduled_jobs rows for every org × job;
-- set_scheduled_job_enabled; list_scheduled_jobs; run_scheduled_job_now (sql and function
-- kinds, rate limit, disabled job or module); private.run_sql_job failures (SQLSTATE only);
-- private.invoke_job_function (request posted, configuration_missing); list_job_orgs (local
-- hour, module gate, one cron run per clinic day); start_job_run / finish_job_run;
-- list_scheduled_job_runs (own org and database-wide rows, filters, clamp).
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(97);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A (timezone UTC, professionals on): admin A, conseillère C.
-- Org B (America/Toronto, professionals off): admin B.
-- Test jobs: core.test_business (function, at the current UTC hour), professionals.test_job
-- (function, no local hour), core.test_raises (sql, raises 22012).
-- Vault: fake project_url / internal_function_secret (replacing the seed's, if any).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',     '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'UTC'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@a.test',     'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

create function private.job_test_raises() returns text
language sql set search_path = '' as $$ select (1 / 0)::text $$;
insert into public.scheduled_jobs (key, module_key, label, description, kind, sql_function, function_name, local_hour, is_maintenance) values
  ('core.test_business', 'core', 'Test métier', 'Test', 'function', null, 'test-business',
   extract(hour from now() at time zone 'UTC')::smallint, false),
  ('professionals.test_job', 'professionals', 'Test module', 'Test', 'function', null, 'test-pro', null, false),
  ('core.test_raises', 'core', 'Test erreur', 'Test', 'sql', 'private.job_test_raises', null, null, true);

delete from vault.secrets where name in ('project_url', 'internal_function_secret');
select vault.create_secret('http://kong.test/', 'project_url');
select vault.create_secret('local-dev-test-secret', 'internal_function_secret');

-- Run ids, kept across statements (written as service_role).
create temp table runs (step text primary key, id uuid) on commit drop;
grant select, insert on runs to service_role, authenticated;

-- =============================================================================
-- Extensions and privileges
-- =============================================================================
select has_extension('pg_cron', 'pg_cron is installed');
select has_extension('extensions', 'pg_net', 'pg_net is installed in extensions');

select table_privs_are('public', 'scheduled_jobs', 'anon', array[]::text[], 'anon: nothing on scheduled_jobs');
select table_privs_are('public', 'scheduled_jobs', 'authenticated', array['SELECT'], 'authenticated: select on scheduled_jobs');
select table_privs_are('public', 'org_scheduled_jobs', 'anon', array[]::text[], 'anon: nothing on org_scheduled_jobs');
select table_privs_are('public', 'org_scheduled_jobs', 'authenticated', array['SELECT'], 'authenticated: select on org_scheduled_jobs');
select table_privs_are('public', 'scheduled_job_runs', 'anon', array[]::text[], 'anon: nothing on scheduled_job_runs');
select table_privs_are('public', 'scheduled_job_runs', 'authenticated', array['SELECT'], 'authenticated: select on scheduled_job_runs');

select function_privs_are('public', 'list_job_orgs', array['text'], 'anon', array[]::text[], 'anon cannot call list_job_orgs');
select function_privs_are('public', 'list_job_orgs', array['text'], 'authenticated', array[]::text[], 'authenticated cannot call list_job_orgs');
select function_privs_are('public', 'list_job_orgs', array['text'], 'service_role', array['EXECUTE'], 'service_role calls list_job_orgs');
select function_privs_are('public', 'start_job_run', array['text', 'uuid', 'text'], 'anon', array[]::text[], 'anon cannot call start_job_run');
select function_privs_are('public', 'start_job_run', array['text', 'uuid', 'text'], 'authenticated', array[]::text[], 'authenticated cannot call start_job_run');
select function_privs_are('public', 'start_job_run', array['text', 'uuid', 'text'], 'service_role', array['EXECUTE'], 'service_role calls start_job_run');
select function_privs_are('public', 'finish_job_run', array['uuid', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call finish_job_run');
select function_privs_are('public', 'finish_job_run', array['uuid', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot call finish_job_run');
select function_privs_are('public', 'finish_job_run', array['uuid', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role calls finish_job_run');

select function_privs_are('public', 'list_scheduled_jobs', array[]::text[], 'anon', array[]::text[], 'anon cannot call list_scheduled_jobs');
select function_privs_are('public', 'list_scheduled_jobs', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated calls list_scheduled_jobs');
select function_privs_are('public', 'list_scheduled_jobs', array[]::text[], 'service_role', array[]::text[], 'service_role cannot call list_scheduled_jobs');
select function_privs_are('public', 'list_scheduled_job_runs', array['text', 'integer', 'timestamp with time zone'], 'anon', array[]::text[],
  'anon cannot call list_scheduled_job_runs');
select function_privs_are('public', 'list_scheduled_job_runs', array['text', 'integer', 'timestamp with time zone'], 'authenticated', array['EXECUTE'],
  'authenticated calls list_scheduled_job_runs');
select function_privs_are('public', 'list_scheduled_job_runs', array['text', 'integer', 'timestamp with time zone'], 'service_role', array[]::text[],
  'service_role cannot call list_scheduled_job_runs');
select function_privs_are('public', 'set_scheduled_job_enabled', array['text', 'boolean'], 'anon', array[]::text[], 'anon cannot call set_scheduled_job_enabled');
select function_privs_are('public', 'set_scheduled_job_enabled', array['text', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated calls set_scheduled_job_enabled');
select function_privs_are('public', 'set_scheduled_job_enabled', array['text', 'boolean'], 'service_role', array[]::text[], 'service_role cannot call set_scheduled_job_enabled');
select function_privs_are('public', 'run_scheduled_job_now', array['text'], 'anon', array[]::text[], 'anon cannot call run_scheduled_job_now');
select function_privs_are('public', 'run_scheduled_job_now', array['text'], 'authenticated', array['EXECUTE'], 'authenticated calls run_scheduled_job_now');
select function_privs_are('public', 'run_scheduled_job_now', array['text'], 'service_role', array[]::text[], 'service_role cannot call run_scheduled_job_now');

select function_privs_are('private', 'run_sql_job', array['text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot call run_sql_job');
select function_privs_are('private', 'run_sql_job', array['text', 'text'], 'service_role', array[]::text[], 'service_role cannot call run_sql_job');
select function_privs_are('private', 'invoke_job_function', array['text', 'uuid', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot call invoke_job_function');
select function_privs_are('private', 'invoke_job_function', array['text', 'uuid', 'text'], 'service_role', array[]::text[],
  'service_role cannot call invoke_job_function');

-- =============================================================================
-- Catalogue, cron entries, org rows
-- =============================================================================
select results_eq(
  $$ select key, module_key, kind, sql_function, cron_job_name, is_maintenance, local_hour
       from public.scheduled_jobs where key in ('core.rate_limits_cleanup', 'core.webhook_events_purge') order by key $$,
  $$ values ('core.rate_limits_cleanup'::text, 'core'::text, 'sql'::text, 'private.job_rate_limits_cleanup'::text,
             'core.rate_limits_cleanup'::text, true, null::smallint),
            ('core.webhook_events_purge', 'core', 'sql', 'private.job_webhook_events_purge',
             'core.webhook_events_purge', true, null) $$,
  'the core maintenance jobs are seeded');
select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job
      where jobname in ('core.rate_limits_cleanup', 'core.webhook_events_purge') order by jobname $$,
  $$ values ('core.rate_limits_cleanup'::text, '7 * * * *'::text, 'select private.run_sql_job(''core.rate_limits_cleanup'')'::text),
            ('core.webhook_events_purge', '10 8 * * *', 'select private.run_sql_job(''core.webhook_events_purge'')') $$,
  'the cron entries run the SQL jobs on their schedules');
select throws_ok($$ insert into public.scheduled_jobs (key, module_key, label, description, kind, function_name)
                    values ('core.x', 'professionals', 'X', 'X', 'function', 'x') $$,
  '23514', null, 'a job key starts with its module');
select throws_ok($$ insert into public.scheduled_jobs (key, module_key, label, description, kind, sql_function, function_name)
                    values ('core.x', 'core', 'X', 'X', 'sql', 'private.job_x', 'x') $$,
  '23514', null, 'a job has exactly one target');
select throws_ok($$ insert into public.scheduled_jobs (key, module_key, label, description, kind, sql_function)
                    values ('core.x', 'core', 'X', 'X', 'sql', 'private.job_x') $$,
  '23514', null, 'a SQL job is a maintenance job');

select results_eq(
  $$ select org_id, job_key, enabled from public.org_scheduled_jobs
      where org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')
        and job_key in ('core.rate_limits_cleanup', 'core.test_business') order by org_id, job_key $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'core.rate_limits_cleanup'::text, true),
            ('b0000000-0000-0000-0000-00000000000a', 'core.test_business', false),
            ('b0000000-0000-0000-0000-00000000000b', 'core.rate_limits_cleanup', true),
            ('b0000000-0000-0000-0000-00000000000b', 'core.test_business', false) $$,
  'each org has a row per job: maintenance on, business off (new orgs and new jobs)');
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000c', 'Org C');
select is(
  (select count(*)::int from public.org_scheduled_jobs where org_id = 'b0000000-0000-0000-0000-00000000000c'),
  (select count(*)::int from public.scheduled_jobs),
  'a fresh org gets a row for every job');

-- =============================================================================
-- set_scheduled_job_enabled, list_scheduled_jobs (users)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.set_scheduled_job_enabled('core.test_business', true) $$, '42501', null,
  'the conseillère cannot switch a job');
select throws_ok($$ select * from public.list_scheduled_jobs() $$, '42501', null, 'the conseillère cannot list jobs');
select throws_ok($$ select public.run_scheduled_job_now('core.rate_limits_cleanup') $$, '42501', null,
  'the conseillère cannot run a job');
select is_empty($$ select 1 from public.org_scheduled_jobs $$, 'the conseillère sees no switch (no settings.view)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_scheduled_job_enabled('core.rate_limits_cleanup', false) $$, 'P0001',
  'Les tâches d''entretien restent toujours actives.', 'a maintenance job cannot be switched off');
select throws_ok($$ select public.set_scheduled_job_enabled('core.nope', true) $$, '22023', null, 'an unknown job is refused');
select lives_ok($$ select public.set_scheduled_job_enabled('core.test_business', true) $$, 'admin A switches a business job on');
select lives_ok($$ select public.set_scheduled_job_enabled('professionals.test_job', true) $$, 'admin A switches a module job on');
select results_eq(
  $$ select org_id, job_key, enabled, updated_by from public.org_scheduled_jobs where job_key = 'core.test_business' $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'core.test_business'::text, true,
             'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the switch is saved for org A only, with its author (admin A reads only org A)');

reset role;
select results_eq(
  $$ select action, changed_fields -> 'enabled' from public.audit_log
      where table_name = 'org_scheduled_jobs' and action = 'update'
        and record_id = 'b0000000-0000-0000-0000-00000000000a:core.test_business' $$,
  $$ values ('update'::text, '{"before": false, "after": true}'::jsonb) $$,
  'the switch is audited');
set local role authenticated;

select results_eq(
  $$ select key, kind, is_maintenance, local_hour is not null, schedule, enabled, last_status
       from public.list_scheduled_jobs()
      where key in ('core.rate_limits_cleanup', 'core.test_business', 'professionals.test_job') order by key $$,
  $$ values ('core.rate_limits_cleanup'::text, 'sql'::text, true, false, '7 * * * *'::text, true, null::text),
            ('core.test_business', 'function', false, true, null, true, null),
            ('professionals.test_job', 'function', false, false, null, true, null) $$,
  'list_scheduled_jobs returns schedule, switch and last run for org A');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq(
  $$ select key, enabled from public.list_scheduled_jobs()
      where key in ('core.test_business', 'professionals.test_job') order by key $$,
  $$ values ('core.test_business'::text, false) $$,
  'org B sees its own switch and not the jobs of a module it has disabled');

-- =============================================================================
-- run_scheduled_job_now
-- =============================================================================
select throws_ok($$ select public.run_scheduled_job_now('core.test_business') $$, 'P0001',
  'Activez d''abord cette tâche.', 'a job switched off cannot be run');
select throws_ok($$ select public.run_scheduled_job_now('professionals.test_job') $$, '22023', null,
  'a job of a disabled module is unknown to the org');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.run_scheduled_job_now('core.rate_limits_cleanup') $$, 'admin A runs a SQL job now');
select results_eq(
  $$ select org_id, trigger, status, detail ~ '^deleted=\d+$', finished_at is not null
       from public.scheduled_job_runs where job_key = 'core.rate_limits_cleanup' and trigger = 'manual' $$,
  $$ values (null::uuid, 'manual'::text, 'ok'::text, true, true) $$,
  'the manual run is logged database-wide as ok, with a count');
select throws_ok($$ select public.run_scheduled_job_now('core.rate_limits_cleanup') $$, 'P0001',
  'Cette tâche vient d''être lancée. Réessayez dans quelques minutes.', 'a second run within 5 minutes is refused');
select lives_ok($$ select public.run_scheduled_job_now('core.test_business') $$, 'admin A runs a function job now');

reset role;
select results_eq(
  $$ select q.url, q.headers ->> 'Authorization', pg_catalog.convert_from(q.body, 'UTF8')::jsonb, q.timeout_milliseconds
       from net.http_request_queue q where q.url like 'http://kong.test/%' order by q.id desc limit 1 $$,
  $$ values ('http://kong.test/functions/v1/test-business'::text, 'Bearer local-dev-test-secret'::text,
             '{"job_key": "core.test_business", "org_id": "b0000000-0000-0000-0000-00000000000a", "trigger": "manual"}'::jsonb,
             10000) $$,
  'a manual function run posts the caller''s org to the job function with the internal secret');

-- =============================================================================
-- Runners (as postgres)
-- =============================================================================
select lives_ok($$ select private.run_sql_job('core.test_raises', 'manual') $$, 'a failing SQL job does not raise');
select results_eq(
  $$ select status, detail, finished_at is not null from public.scheduled_job_runs where job_key = 'core.test_raises' $$,
  $$ values ('error'::text, '22012'::text, true) $$,
  'the failure is logged with its SQLSTATE only');
select throws_ok($$ select private.run_sql_job('core.test_business') $$, '22023', null, 'run_sql_job refuses a function job');
select throws_ok($$ select private.run_sql_job('core.rate_limits_cleanup', 'later') $$, '22023', null, 'run_sql_job refuses an unknown trigger');

-- Core job functions (fixture rows only; the seed may hold others).
insert into public.rate_limits (bucket, key_hash, window_start) values
  ('test.old', sha256('k'), now() - interval '25 hours'),
  ('test.recent', sha256('k'), now() - interval '23 hours');
select ok(private.job_rate_limits_cleanup() ~ '^deleted=\d+$', 'job_rate_limits_cleanup returns a count');
select results_eq($$ select bucket from public.rate_limits where bucket like 'test.%' order by bucket $$,
  $$ values ('test.recent'::text) $$, 'windows older than 24 h are deleted, recent ones kept');

insert into public.webhook_events (provider, event_id, org_id, event_type, status, payload, received_at) values
  ('resend', 'test-completed', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'completed',  '{"a":1}', now() - interval '1 day'),
  ('resend', 'test-failed-old', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'failed',    '{"a":1}', now() - interval '8 days'),
  ('resend', 'test-failed-new', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'failed',    '{"a":1}', now() - interval '6 days'),
  ('resend', 'test-processing', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'processing', '{"a":1}', now() - interval '8 days'),
  ('resend', 'test-expired', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'failed',       '{"a":1}', now() - interval '91 days');
select ok(private.job_webhook_events_purge() ~ '^payloads_cleared=\d+ deleted=\d+$', 'job_webhook_events_purge returns counts');
select results_eq(
  $$ select event_id, payload is null from public.webhook_events where event_id like 'test-%' order by event_id $$,
  $$ values ('test-completed'::text, true), ('test-failed-new', false), ('test-failed-old', true), ('test-processing', false) $$,
  'payloads are cleared on completed rows and on failed rows after 7 days; rows over 90 days are deleted');

select lives_ok($$ select private.invoke_job_function('core.test_business') $$, 'a cron function job is posted');
select is(
  (select pg_catalog.convert_from(q.body, 'UTF8')::jsonb from net.http_request_queue q
    where q.url = 'http://kong.test/functions/v1/test-business' order by q.id desc limit 1),
  '{"job_key": "core.test_business", "org_id": null, "trigger": "cron"}'::jsonb,
  'a cron post carries no org (the function lists them)');
select throws_ok($$ select private.invoke_job_function('core.rate_limits_cleanup') $$, '22023', null,
  'invoke_job_function refuses a SQL job');

delete from vault.secrets where name = 'internal_function_secret';
select lives_ok($$ select private.invoke_job_function('professionals.test_job') $$, 'a missing secret does not raise');
select results_eq(
  $$ select org_id, trigger, status, detail from public.scheduled_job_runs where job_key = 'professionals.test_job' $$,
  $$ values (null::uuid, 'cron'::text, 'error'::text, 'configuration_missing'::text) $$,
  'a missing secret is logged as configuration_missing');
select is(
  (select count(*)::int from net.http_request_queue q where q.url = 'http://kong.test/functions/v1/test-pro'),
  0, 'nothing is posted without the secret');

-- =============================================================================
-- Service-role RPCs
-- =============================================================================
-- Every org has every test job switched on, so only the timezone and the module gate differ.
update public.org_scheduled_jobs set enabled = true
 where job_key in ('core.test_business', 'professionals.test_job')
   and org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq($$ select * from public.list_job_orgs('core.test_business') $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'list_job_orgs keeps the org at the job''s local hour (UTC), not America/Toronto');
select results_eq(
  $$ select * from public.list_job_orgs('professionals.test_job')
      where list_job_orgs in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'list_job_orgs skips an org whose module is disabled');
select is_empty($$ select * from public.list_job_orgs('core.test_business') where list_job_orgs = 'b0000000-0000-0000-0000-00000000000c' $$,
  'list_job_orgs skips an org with the job switched off');
select throws_ok($$ select * from public.list_job_orgs('core.rate_limits_cleanup') $$, '22023', null,
  'list_job_orgs refuses a SQL job');

insert into runs select 'a_manual', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'manual');
insert into runs select 'a_cron_1', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'cron');
insert into runs select 'a_cron_2', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'cron');
insert into runs select 'b_manual', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000b', 'manual');
insert into runs select 'b_module_off', public.start_job_run('professionals.test_job', 'b0000000-0000-0000-0000-00000000000b', 'manual');
insert into runs select 'c_job_off', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000c', 'cron');
insert into runs select 'a_pro', public.start_job_run('professionals.test_job', 'b0000000-0000-0000-0000-00000000000a', 'cron');

select results_eq($$ select step, id is not null from runs order by step $$,
  $$ values ('a_cron_1'::text, true), ('a_cron_2', false), ('a_manual', true), ('a_pro', true),
            ('b_manual', true), ('b_module_off', false), ('c_job_off', false) $$,
  'start_job_run: a manual run then a cron run both run, a second cron run the same day does not, disabled job or module → null');

reset role;
select results_eq(
  $$ select x.step, r.org_id, r.trigger, r.status, r.run_local_date
       from runs x join public.scheduled_job_runs r on r.id = x.id order by x.step $$,
  $$ values ('a_cron_1'::text, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'cron'::text, 'running'::text, (now() at time zone 'UTC')::date),
            ('a_manual', 'b0000000-0000-0000-0000-00000000000a', 'manual', 'running', null),
            ('a_pro', 'b0000000-0000-0000-0000-00000000000a', 'cron', 'running', null),
            ('b_manual', 'b0000000-0000-0000-0000-00000000000b', 'manual', 'running', null) $$,
  'only a cron run of a local-hour job takes the clinic day');
set local role service_role;

select is_empty($$ select * from public.list_job_orgs('core.test_business') $$,
  'after its cron run, the org is not listed again the same clinic day');
select throws_ok($$ select public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'later') $$,
  '22023', null, 'start_job_run refuses an unknown trigger');
select throws_ok($$ select public.start_job_run('core.rate_limits_cleanup', 'b0000000-0000-0000-0000-00000000000a', 'cron') $$,
  '22023', null, 'start_job_run refuses a SQL job');
select throws_ok($$ select public.start_job_run('core.test_business', gen_random_uuid(), 'cron') $$,
  '22023', null, 'start_job_run refuses an unknown org');

select lives_ok($$ select public.finish_job_run((select id from runs where step = 'a_manual'), 'ok', 'sent=3') $$,
  'finish_job_run records an outcome');
select throws_ok($$ select public.finish_job_run((select id from runs where step = 'a_manual'), 'ok', 'sent=3') $$,
  '22023', null, 'a finished run cannot be finished again');
select throws_ok($$ select public.finish_job_run((select id from runs where step = 'b_manual'), 'running', null) $$,
  '22023', null, 'finish_job_run refuses a status that is not an outcome');
select throws_ok($$ select public.finish_job_run((select id from runs where step = 'b_manual'), 'error', repeat('x', 501)) $$,
  '22023', null, 'finish_job_run refuses a detail over 500 characters');
select lives_ok($$ select public.finish_job_run((select id from runs where step = 'b_manual'), 'error', 'timeout') $$,
  'finish_job_run records an error code');

reset role;
select results_eq(
  $$ select x.step, r.status, r.detail, r.finished_at is not null
       from runs x join public.scheduled_job_runs r on r.id = x.id where x.step in ('a_manual', 'b_manual') order by x.step $$,
  $$ values ('a_manual'::text, 'ok'::text, 'sent=3'::text, true), ('b_manual', 'error', 'timeout', true) $$,
  'finished runs keep their status and detail');

-- =============================================================================
-- list_scheduled_job_runs (RLS)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_eq(
  $$ select id from public.list_scheduled_job_runs('core.test_business', 100) $$,
  $$ select id from runs where step = 'b_manual' $$,
  'org B sees its own runs of a job, not org A''s');
select ok(
  exists (select 1 from public.list_scheduled_job_runs('core.rate_limits_cleanup') where trigger = 'manual'),
  'org B sees database-wide runs');
select results_eq(
  $$ select job_key, status, detail from public.list_scheduled_job_runs(null, 100) where job_key = 'core.test_business' $$,
  $$ values ('core.test_business'::text, 'error'::text, 'timeout'::text) $$,
  'org B sees nothing of org A''s function job runs');
select is((select count(*)::int from public.list_scheduled_job_runs(null, 0)), 1, 'p_limit is clamped to at least 1');
select is_empty($$ select 1 from public.list_scheduled_job_runs(null, 100, now()) $$, 'p_before excludes later runs');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select key, last_status, last_detail from public.list_scheduled_jobs() where key = 'core.rate_limits_cleanup' $$,
  $$ values ('core.rate_limits_cleanup'::text, 'ok'::text,
             (select detail from public.scheduled_job_runs where job_key = 'core.rate_limits_cleanup' and trigger = 'manual')) $$,
  'list_scheduled_jobs shows a database-wide last run');
select set_eq(
  $$ select id from public.list_scheduled_job_runs('core.test_business', 100) $$,
  $$ select id from runs where step in ('a_manual', 'a_cron_1') $$,
  'org A sees its own runs');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_scheduled_job_runs(null, 100) $$, 'the conseillère sees no run (no settings.view)');

select * from finish();
rollback;
