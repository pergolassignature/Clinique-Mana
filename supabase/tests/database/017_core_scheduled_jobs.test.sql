-- Scheduled jobs (migration *_core_scheduled_jobs.sql, plan Phase 3 Task 3.3, P3-22).
-- Covers: pg_cron / pg_net; privileges on the four tables and every RPC and helper; the
-- catalogue checks and seeded jobs with their cron entries; org_scheduled_jobs rows for every
-- org × job; set_scheduled_job_enabled; list_scheduled_jobs; run_scheduled_job_now (sql and
-- function kinds, rate limit, disabled job or module); private.run_sql_job failures (SQLSTATE
-- only); private.invoke_job_function (signed post, no raw secret, dispatch row, 150 s timeout,
-- configuration_missing); list_job_orgs (local hour, module gate, one cron run per clinic day);
-- start_job_run (overlap guard) / finish_job_run; list_scheduled_job_runs (own org and
-- database-wide rows, disabled modules hidden, keyset ties, clamp); job_due across DST and a
-- missed tick, with the time-taking bodies of list_job_orgs / start_job_run (midnight crossing);
-- retired (inactive) jobs; the reconcile job (HTTP outcomes, abandoned runs, dispatch purge);
-- the run-log purge job.
-- The whole file is one transaction, so now() is constant. Nothing depends on the time of day
-- the suite runs at: local-hour checks take an explicit instant (pg_temp.t0(), a fixed past
-- noon UTC) through the private *_at bodies, and the run log and dispatches start empty, so
-- real cron rows committed since the reset never show.
begin;
create extension if not exists pgtap with schema extensions;
select plan(153);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A (timezone UTC, professionals on): admin A, conseillère C.
-- Org B (America/Toronto, professionals off): admin B.
-- Test jobs: core.test_business (function, local hour 12), professionals.test_job
-- (function, no local hour), core.test_raises (sql, raises 22012), core.test_dispatch
-- (function, reconcile cases), core.test_dst (function, 1:00) and core.test_late (function,
-- 23:00) for the explicit-time cases, core.test_page (sql, keyset rows), core.test_retired and
-- core.test_retired_sql (inactive).
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
insert into public.scheduled_jobs (key, module_key, label, description, kind, sql_function, function_name, local_hour, is_maintenance, is_active) values
  ('core.test_business', 'core', 'Test métier', 'Test', 'function', null, 'test-business',
   12, false, true),
  ('professionals.test_job', 'professionals', 'Test module', 'Test', 'function', null, 'test-pro', null, false, true),
  ('core.test_raises', 'core', 'Test erreur', 'Test', 'sql', 'private.job_test_raises', null, null, true, true),
  ('core.test_dispatch', 'core', 'Test envoi', 'Test', 'function', null, 'test-dispatch', null, false, true),
  ('core.test_dst', 'core', 'Test heure 1', 'Test', 'function', null, 'test-dst', 1, false, true),
  ('core.test_late', 'core', 'Test heure 23', 'Test', 'function', null, 'test-late', 23, false, true),
  ('core.test_page', 'core', 'Test pages', 'Test', 'sql', 'private.job_test_raises', null, null, true, true),
  ('core.test_retired', 'core', 'Test retirée', 'Test', 'function', null, 'test-retired', null, false, false),
  ('core.test_retired_sql', 'core', 'Test retirée SQL', 'Test', 'sql', 'private.job_test_raises', null, null, true, false);

-- Real cron runs and dispatches committed since the reset (rolled back with the rest).
delete from public.scheduled_job_runs;
delete from public.scheduled_job_dispatches;

-- The instant of the local-hour checks: 12:00 in org A (UTC), 7:00 in org B (EST, UTC−5).
create function pg_temp.t0() returns timestamptz language sql immutable as $$ select '2026-01-15 12:00Z'::timestamptz $$;

delete from vault.secrets where name in ('project_url', 'internal_function_secret');
select vault.create_secret('http://kong.test/', 'project_url');
select vault.create_secret('local-dev-test-secret', 'internal_function_secret');

-- Run ids, kept across statements (written as service_role).
create temp table runs (step text primary key, id uuid) on commit drop;
grant select, insert on runs to service_role, authenticated;

-- Replays job_due over a list of cron ticks, updating the last local date after each due tick;
-- returns the ticks that ran.
create function pg_temp.due_ticks(p_tz text, p_hour int, p_ticks timestamptz[], p_last date)
returns setof timestamptz
language plpgsql
as $$
declare
  v_at timestamptz;
  v_last date := p_last;
begin
  foreach v_at in array p_ticks loop
    if private.job_due(p_tz, p_hour, v_at, v_last) then
      v_last := (v_at at time zone p_tz)::date;
      return next v_at;
    end if;
  end loop;
end;
$$;

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
select table_privs_are('public', 'scheduled_job_dispatches', 'anon', array[]::text[], 'anon: nothing on scheduled_job_dispatches');
select table_privs_are('public', 'scheduled_job_dispatches', 'authenticated', array[]::text[], 'authenticated: nothing on scheduled_job_dispatches');
select is_empty($$ select 1 from pg_policies where schemaname = 'public' and tablename = 'scheduled_job_dispatches' $$,
  'scheduled_job_dispatches has no policy (service role only)');

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
select function_privs_are('public', 'list_scheduled_job_runs', array['text', 'integer', 'timestamp with time zone', 'uuid'], 'anon', array[]::text[],
  'anon cannot call list_scheduled_job_runs');
select function_privs_are('public', 'list_scheduled_job_runs', array['text', 'integer', 'timestamp with time zone', 'uuid'], 'authenticated', array['EXECUTE'],
  'authenticated calls list_scheduled_job_runs');
select function_privs_are('public', 'list_scheduled_job_runs', array['text', 'integer', 'timestamp with time zone', 'uuid'], 'service_role', array[]::text[],
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
select function_privs_are('private', 'job_due', array['text', 'integer', 'timestamp with time zone', 'date'], 'service_role', array[]::text[],
  'service_role cannot call job_due');
select function_privs_are('private', 'list_job_orgs_at', array['text', 'timestamp with time zone'], 'service_role', array[]::text[],
  'service_role cannot call list_job_orgs_at (only through list_job_orgs)');
select function_privs_are('private', 'start_job_run_at', array['text', 'uuid', 'text', 'timestamp with time zone'], 'service_role', array[]::text[],
  'service_role cannot call start_job_run_at (only through start_job_run)');
select function_privs_are('private', 'job_scheduled_jobs_reconcile', array[]::text[], 'service_role', array[]::text[],
  'service_role cannot call job_scheduled_jobs_reconcile');
select function_privs_are('private', 'job_scheduled_job_runs_purge', array[]::text[], 'service_role', array[]::text[],
  'service_role cannot call job_scheduled_job_runs_purge');

-- =============================================================================
-- Catalogue, cron entries, org rows
-- =============================================================================
select results_eq(
  $$ select key, module_key, kind, sql_function, cron_job_name, is_maintenance, local_hour, is_active
       from public.scheduled_jobs where key in ('core.rate_limits_cleanup', 'core.webhook_events_purge',
                                                'core.scheduled_jobs_reconcile', 'core.scheduled_job_runs_purge') order by key $$,
  $$ values ('core.rate_limits_cleanup'::text, 'core'::text, 'sql'::text, 'private.job_rate_limits_cleanup'::text,
             'core.rate_limits_cleanup'::text, true, null::smallint, true),
            ('core.scheduled_job_runs_purge', 'core', 'sql', 'private.job_scheduled_job_runs_purge',
             'core.scheduled_job_runs_purge', true, null, true),
            ('core.scheduled_jobs_reconcile', 'core', 'sql', 'private.job_scheduled_jobs_reconcile',
             'core.scheduled_jobs_reconcile', true, null, true),
            ('core.webhook_events_purge', 'core', 'sql', 'private.job_webhook_events_purge',
             'core.webhook_events_purge', true, null, true) $$,
  'the core maintenance jobs are seeded');
select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job
      where jobname in ('core.rate_limits_cleanup', 'core.webhook_events_purge',
                        'core.scheduled_jobs_reconcile', 'core.scheduled_job_runs_purge') order by jobname $$,
  $$ values ('core.rate_limits_cleanup'::text, '7 * * * *'::text, 'select private.run_sql_job(''core.rate_limits_cleanup'')'::text),
            ('core.scheduled_job_runs_purge', '20 8 * * *', 'select private.run_sql_job(''core.scheduled_job_runs_purge'')'),
            ('core.scheduled_jobs_reconcile', '*/15 * * * *', 'select private.run_sql_job(''core.scheduled_jobs_reconcile'')'),
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

-- The retired job is switched on in org A, so only is_active hides it below.
update public.org_scheduled_jobs set enabled = true
 where job_key = 'core.test_retired' and org_id = 'b0000000-0000-0000-0000-00000000000a';

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
select throws_ok($$ select public.set_scheduled_job_enabled('core.test_business', null) $$, '22023',
  'Valeur manquante.', 'a null value is refused');
select throws_ok($$ select public.set_scheduled_job_enabled('core.test_retired', false) $$, '22023', null,
  'a retired job is unknown');
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
select is_empty($$ select 1 from public.list_scheduled_jobs() where key like 'core.test_retired%' $$,
  'list_scheduled_jobs hides retired jobs');
select throws_ok($$ select public.run_scheduled_job_now('core.test_retired') $$, '22023', null,
  'a retired job cannot be run now');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq(
  $$ select key, enabled from public.list_scheduled_jobs()
      where key in ('core.test_business', 'professionals.test_job') order by key $$,
  $$ values ('core.test_business'::text, false) $$,
  'org B sees its own switch and not the jobs of a module it has disabled');
select throws_ok($$ select public.set_scheduled_job_enabled('professionals.test_job', true) $$, '22023', null,
  'a job of a disabled module cannot be switched (unknown to the org)');

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

-- =============================================================================
-- Signed dispatch (as postgres)
-- =============================================================================
reset role;
create temp table posted on commit drop as
  select q.id, q.url, q.headers, pg_catalog.convert_from(q.body, 'UTF8')::jsonb as body, q.timeout_milliseconds,
         substring(q.headers ->> 'X-Job-Signature' from '^t=(\d+),')::bigint as t,
         substring(q.headers ->> 'X-Job-Signature' from ',v1=([0-9a-f]+)$') as v1
    from net.http_request_queue q where q.url like 'http://kong.test/%';
select results_eq(
  $$ select url, body, timeout_milliseconds, headers ->> 'Content-Type' from posted $$,
  $$ values ('http://kong.test/functions/v1/test-business'::text,
             '{"job_key": "core.test_business", "org_id": "b0000000-0000-0000-0000-00000000000a", "trigger": "manual"}'::jsonb,
             150000, 'application/json'::text) $$,
  'a manual function run posts the caller''s org to the job function, with the 150 s timeout');
select ok((select headers ->> 'X-Job-Signature' ~ '^t=\d+,v1=[0-9a-f]{64}$' from posted),
  'the post carries X-Job-Signature: t=<unix seconds>,v1=<64 hex>');
select is((select v1 from posted),
  (select encode(extensions.hmac(convert_to(t::text || '.core.test_business.b0000000-0000-0000-0000-00000000000a.manual', 'UTF8'),
                                 convert_to('local-dev-test-secret', 'UTF8'), 'sha256'), 'hex') from posted),
  'v1 is HMAC-SHA256(internal secret, t.job_key.org_id.trigger)');
select ok((select abs(t - extract(epoch from clock_timestamp())) < 60 from posted), 't is the current unix time');
select is_empty(
  $$ select 1 from posted p, jsonb_each_text(p.headers) h
      where h.value like '%local-dev-test-secret%' or lower(h.key) = 'authorization' $$,
  'no header carries the raw secret, and there is no Authorization header');
select results_eq(
  $$ select d.job_key, d.org_id, d.trigger, d.request_id = (select id from posted), d.reconciled_at is null
       from public.scheduled_job_dispatches d where d.job_key = 'core.test_business' $$,
  $$ values ('core.test_business'::text, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'manual'::text, true, true) $$,
  'the dispatch is recorded with pg_net''s request id');

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
select lives_ok($$ select private.run_sql_job('core.test_retired_sql') $$, 'run_sql_job accepts a retired job');
select is_empty($$ select 1 from public.scheduled_job_runs where job_key = 'core.test_retired_sql' $$,
  'a retired SQL job does not run');

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
  ('resend', 'test-expired', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'failed',       '{"a":1}', now() - interval '91 days');
-- A processing row holds a token and a lease (webhook_events_lease_check).
insert into public.webhook_events (provider, event_id, org_id, event_type, status, payload, received_at, claim_token, lease_expires_at)
values ('resend', 'test-processing', 'b0000000-0000-0000-0000-00000000000a', 'email.sent', 'processing', '{"a":1}', now() - interval '8 days',
        gen_random_uuid(), now() + interval '5 minutes');
select ok(private.job_webhook_events_purge() ~ '^payloads_cleared=\d+ deleted=\d+$', 'job_webhook_events_purge returns counts');
select results_eq(
  $$ select event_id, payload is null from public.webhook_events where event_id like 'test-%' order by event_id $$,
  $$ values ('test-completed'::text, true), ('test-failed-new', false), ('test-failed-old', true), ('test-processing', false) $$,
  'payloads are cleared on completed rows and on failed rows after 7 days; rows over 90 days are deleted');

select lives_ok($$ select private.invoke_job_function('core.test_business') $$, 'a cron function job is posted');
select results_eq(
  $$ select pg_catalog.convert_from(q.body, 'UTF8')::jsonb,
            substring(q.headers ->> 'X-Job-Signature' from ',v1=([0-9a-f]+)$')
              = encode(extensions.hmac(convert_to(substring(q.headers ->> 'X-Job-Signature' from '^t=(\d+),') || '.core.test_business..cron', 'UTF8'),
                                       convert_to('local-dev-test-secret', 'UTF8'), 'sha256'), 'hex')
       from net.http_request_queue q
      where q.url = 'http://kong.test/functions/v1/test-business' order by q.id desc limit 1 $$,
  $$ values ('{"job_key": "core.test_business", "org_id": null, "trigger": "cron"}'::jsonb, true) $$,
  'a cron post carries no org (the function lists them) and signs an empty org');
select is((select count(*)::int from public.scheduled_job_dispatches where job_key = 'core.test_business' and org_id is null and trigger = 'cron'),
  1, 'the cron dispatch is recorded');
select throws_ok($$ select private.invoke_job_function('core.rate_limits_cleanup') $$, '22023', null,
  'invoke_job_function refuses a SQL job');
select lives_ok($$ select private.invoke_job_function('core.test_retired') $$, 'invoke_job_function accepts a retired job');
select is((select count(*)::int from net.http_request_queue q where q.url = 'http://kong.test/functions/v1/test-retired')
          + (select count(*)::int from public.scheduled_job_dispatches where job_key = 'core.test_retired'),
  0, 'a retired job is not posted');

delete from vault.secrets where name = 'internal_function_secret';
select lives_ok($$ select private.invoke_job_function('professionals.test_job') $$, 'a missing secret does not raise');
select results_eq(
  $$ select org_id, trigger, status, detail from public.scheduled_job_runs where job_key = 'professionals.test_job' $$,
  $$ values (null::uuid, 'cron'::text, 'error'::text, 'configuration_missing'::text) $$,
  'a missing secret is logged as configuration_missing');
select is(
  (select count(*)::int from net.http_request_queue q where q.url = 'http://kong.test/functions/v1/test-pro')
  + (select count(*)::int from public.scheduled_job_dispatches where job_key = 'professionals.test_job'),
  0, 'nothing is posted (nor recorded) without the secret');

-- =============================================================================
-- Service-role RPCs
-- =============================================================================
-- Every org has every test job switched on, so only the timezone and the module gate differ.
update public.org_scheduled_jobs set enabled = true
 where job_key in ('core.test_business', 'professionals.test_job', 'core.test_dst', 'core.test_late', 'core.test_dispatch')
   and org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

-- The local-hour job at t0, through the time-taking bodies (as postgres): 12:00 in org A,
-- 7:00 in org B. The public wrappers only add now() (privileges above).
select results_eq($$ select * from private.list_job_orgs_at('core.test_business', pg_temp.t0()) $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'list_job_orgs keeps the org at the job''s local hour (12:00 UTC), not the one at 7:00 America/Toronto');
insert into runs select 'a_manual', private.start_job_run_at('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'manual', pg_temp.t0());
-- Overlap guard: a_manual is still running.
insert into runs select 'a_overlap', private.start_job_run_at('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'cron', pg_temp.t0());
select lives_ok($$ select public.finish_job_run((select id from runs where step = 'a_manual'), 'ok', 'sent=3') $$,
  'finish_job_run records an outcome');
insert into runs select 'a_cron_1', private.start_job_run_at('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'cron', pg_temp.t0());
select lives_ok($$ select public.finish_job_run((select id from runs where step = 'a_cron_1'), 'ok', 'sent=1') $$,
  'the cron run finishes');
-- The next hourly tick, the same clinic day.
insert into runs select 'a_cron_2', private.start_job_run_at('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'cron', pg_temp.t0() + interval '1 hour');
select is_empty($$ select * from private.list_job_orgs_at('core.test_business', pg_temp.t0() + interval '1 hour') $$,
  'after its cron run, the org is not listed again the same clinic day (and org B is still before 12:00)');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$ select * from public.list_job_orgs('professionals.test_job')
      where list_job_orgs in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'list_job_orgs skips an org whose module is disabled');
select is_empty($$ select * from public.list_job_orgs('core.test_business') where list_job_orgs = 'b0000000-0000-0000-0000-00000000000c' $$,
  'list_job_orgs skips an org with the job switched off');
select is_empty($$ select * from public.list_job_orgs('core.test_retired') $$, 'list_job_orgs lists no org for a retired job');
select throws_ok($$ select * from public.list_job_orgs('core.rate_limits_cleanup') $$, '22023', null,
  'list_job_orgs refuses a SQL job');

insert into runs select 'b_manual', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000b', 'manual');
insert into runs select 'b_module_off', public.start_job_run('professionals.test_job', 'b0000000-0000-0000-0000-00000000000b', 'manual');
insert into runs select 'c_job_off', public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000c', 'cron');
insert into runs select 'a_pro', public.start_job_run('professionals.test_job', 'b0000000-0000-0000-0000-00000000000a', 'cron');
insert into runs select 'a_retired', public.start_job_run('core.test_retired', 'b0000000-0000-0000-0000-00000000000a', 'manual');

select results_eq($$ select step, id is not null from runs order by step $$,
  $$ values ('a_cron_1'::text, true), ('a_cron_2', false), ('a_manual', true), ('a_overlap', false), ('a_pro', true),
            ('a_retired', false), ('b_manual', true), ('b_module_off', false), ('c_job_off', false) $$,
  'start_job_run: overlap → null; a manual run then a cron run both run; a second cron run the same day, a disabled job or module, a retired job → null');

reset role;
select results_eq(
  $$ select x.step, r.org_id, r.trigger, r.status, r.run_local_date
       from runs x join public.scheduled_job_runs r on r.id = x.id order by x.step $$,
  $$ values ('a_cron_1'::text, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'cron'::text, 'ok'::text, '2026-01-15'::date),
            ('a_manual', 'b0000000-0000-0000-0000-00000000000a', 'manual', 'ok', null),
            ('a_pro', 'b0000000-0000-0000-0000-00000000000a', 'cron', 'running', null),
            ('b_manual', 'b0000000-0000-0000-0000-00000000000b', 'manual', 'running', null) $$,
  'only a cron run of a local-hour job takes the clinic day');
-- The overlap window is 15 minutes (a_pro started at now() and is still running).
select ok(private.start_job_run_at('professionals.test_job', 'b0000000-0000-0000-0000-00000000000a', 'manual', now() + interval '14 minutes') is null,
  'a run 14 minutes after a running one is refused');
select ok(private.start_job_run_at('professionals.test_job', 'b0000000-0000-0000-0000-00000000000a', 'manual', now() + interval '16 minutes') is not null,
  'a run 16 minutes after a running one starts');
delete from public.scheduled_job_runs where job_key = 'professionals.test_job' and started_at > now();
set local role service_role;

select throws_ok($$ select public.start_job_run('core.test_business', 'b0000000-0000-0000-0000-00000000000a', 'later') $$,
  '22023', null, 'start_job_run refuses an unknown trigger');
select throws_ok($$ select public.start_job_run('core.rate_limits_cleanup', 'b0000000-0000-0000-0000-00000000000a', 'cron') $$,
  '22023', null, 'start_job_run refuses a SQL job');
select throws_ok($$ select public.start_job_run('core.test_business', gen_random_uuid(), 'cron') $$,
  '22023', null, 'start_job_run refuses an unknown org');

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
-- A retired job's run, visible to nobody.
insert into public.scheduled_job_runs (job_key, org_id, trigger, status) values ('core.test_retired', null, 'cron', 'ok');

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
select is_empty($$ select 1 from public.list_scheduled_job_runs(null, 100) where job_key = 'professionals.test_job' $$,
  'org B does not see the database-wide runs of a module it has disabled');
select is((select count(*)::int from public.list_scheduled_job_runs(null, 0)), 1, 'p_limit is clamped to at least 1');
-- Filtered by the test's job: real cron runs (committed before this transaction) would show.
select is_empty($$ select 1 from public.list_scheduled_job_runs('core.test_business', 100, now()) $$, 'p_before excludes later runs');

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
select results_eq(
  $$ select detail from public.list_scheduled_job_runs('professionals.test_job', 100) where trigger = 'cron' and status = 'error' $$,
  $$ values ('configuration_missing'::text) $$,
  'org A (module on) sees the database-wide runs of that module');
select is_empty($$ select 1 from public.list_scheduled_job_runs(null, 100) where job_key = 'core.test_retired' $$,
  'runs of a retired job are hidden');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_scheduled_job_runs(null, 100) $$, 'the conseillère sees no run (no settings.view)');

-- Keyset ties: five runs share started_at; pages of 2 cross the ties.
reset role;
insert into public.scheduled_job_runs (id, job_key, org_id, trigger, status, started_at) values
  ('c0000000-0000-0000-0000-000000000001', 'core.test_page', null, 'cron', 'ok', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000002', 'core.test_page', null, 'cron', 'ok', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000003', 'core.test_page', null, 'cron', 'ok', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000004', 'core.test_page', null, 'cron', 'ok', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000005', 'core.test_page', null, 'cron', 'ok', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000006', 'core.test_page', null, 'cron', 'ok', now() - interval '2 days');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select id from public.list_scheduled_job_runs('core.test_page', 2) $$,
  $$ values ('c0000000-0000-0000-0000-000000000005'::uuid), ('c0000000-0000-0000-0000-000000000004') $$,
  'keyset page 1: newest first, ties by id desc');
select results_eq(
  $$ select id from public.list_scheduled_job_runs('core.test_page', 2, now() - interval '1 day', 'c0000000-0000-0000-0000-000000000004') $$,
  $$ values ('c0000000-0000-0000-0000-000000000003'::uuid), ('c0000000-0000-0000-0000-000000000002') $$,
  'keyset page 2 continues inside the tie');
select results_eq(
  $$ select id from public.list_scheduled_job_runs('core.test_page', 2, now() - interval '1 day', 'c0000000-0000-0000-0000-000000000002') $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000006') $$,
  'keyset page 3 ends the tie and moves to older rows');
select results_eq(
  $$ select id from public.list_scheduled_job_runs('core.test_page', 100, now() - interval '1 day') $$,
  $$ values ('c0000000-0000-0000-0000-000000000006'::uuid) $$,
  'p_before without an id keeps rows strictly older');
reset role;

-- =============================================================================
-- job_due and the time-taking bodies (P3-22, explicit timestamps, as postgres)
-- =============================================================================
select ok(not private.job_due('America/Toronto', 8, '2026-10-08 11:59:59Z', null), 'not due before the local hour (7:59 EDT)');
select ok(private.job_due('America/Toronto', 8, '2026-10-08 12:00:00Z', null), 'due at the local hour (8:00 EDT)');
select ok(not private.job_due('America/Toronto', 8, '2026-10-08 13:00:00Z', '2026-10-08'), 'not due once run that local date');
select ok(not private.job_due('America/Toronto', null, '2026-10-08 13:00:00Z', null), 'a null hour is never due');

-- 2026-11-01, America/Toronto: 25 hourly ticks from 0:00 EDT (04:00Z); 1:00 happens twice
-- (05:00Z EDT, 06:00Z EST).
select results_eq(
  $$ select * from pg_temp.due_ticks('America/Toronto', 1,
       array(select generate_series('2026-11-01 04:00Z'::timestamptz, '2026-11-02 04:00Z', interval '1 hour')), '2026-10-31') $$,
  $$ values ('2026-11-01 05:00Z'::timestamptz) $$,
  'fall back (25 h day): local_hour 1 runs once, at the first 1:00');
-- 2027-03-14, America/Toronto: 23 hourly ticks from 0:00 EST (05:00Z); 2:00 does not exist.
select results_eq(
  $$ select * from pg_temp.due_ticks('America/Toronto', 2,
       array(select generate_series('2027-03-14 05:00Z'::timestamptz, '2027-03-15 03:00Z', interval '1 hour')), '2027-03-13') $$,
  $$ values ('2027-03-14 07:00Z'::timestamptz) $$,
  'spring forward (23 h day): local_hour 2 still runs, at 3:00 EDT');
-- A missed tick: 8:00 EDT (12:00Z) never fires; the 9:00 tick catches up, once.
select results_eq(
  $$ select * from pg_temp.due_ticks('America/Toronto', 8,
       array['2026-10-08 11:00Z', '2026-10-08 13:00Z', '2026-10-08 14:00Z', '2026-10-09 03:00Z']::timestamptz[], '2026-10-07') $$,
  $$ values ('2026-10-08 13:00Z'::timestamptz) $$,
  'a missed tick catches up at the next tick the same day, once');

-- The same rule through list_job_orgs / start_job_run's bodies (org B, America/Toronto).
select ok('b0000000-0000-0000-0000-00000000000b' in (select private.list_job_orgs_at('core.test_dst', '2026-11-01 05:00Z')),
  'fall back: org B is listed at the first 1:00');
insert into runs select 'dst_first', private.start_job_run_at('core.test_dst', 'b0000000-0000-0000-0000-00000000000b', 'cron', '2026-11-01 05:00Z');
update public.scheduled_job_runs set status = 'ok', finished_at = started_at where id = (select id from runs where step = 'dst_first');
select is((select run_local_date from public.scheduled_job_runs where id = (select id from runs where step = 'dst_first')),
  '2026-11-01'::date, 'the first 1:00 run takes 2026-11-01');
select ok('b0000000-0000-0000-0000-00000000000b' not in (select private.list_job_orgs_at('core.test_dst', '2026-11-01 06:00Z')),
  'fall back: org B is not listed at the second 1:00');
select ok(private.start_job_run_at('core.test_dst', 'b0000000-0000-0000-0000-00000000000b', 'cron', '2026-11-01 06:00Z') is null,
  'fall back: start_job_run refuses the second 1:00');

-- Midnight crossing: listed at 23:59:50 EDT on 2026-10-08, started at 0:00:05 on 2026-10-09.
select ok('b0000000-0000-0000-0000-00000000000b' in (select private.list_job_orgs_at('core.test_late', '2026-10-09 03:59:50Z')),
  'org B is listed at 23:59:50 for a 23:00 job');
select ok(private.start_job_run_at('core.test_late', 'b0000000-0000-0000-0000-00000000000b', 'cron', '2026-10-09 04:00:05Z') is null,
  'a start after midnight is refused rather than stamped with the next day');
select is_empty($$ select 1 from public.scheduled_job_runs where job_key = 'core.test_late' $$,
  'no run is stamped 2026-10-09 for the 23:00 job');
delete from public.scheduled_job_runs where job_key in ('core.test_dst', 'core.test_late');

-- =============================================================================
-- core.scheduled_jobs_reconcile (as postgres; fake pg_net responses)
-- =============================================================================
insert into public.scheduled_job_dispatches (job_key, org_id, trigger, request_id, dispatched_at, reconciled_at, outcome) values
  ('core.test_dispatch', null,                                   'cron',   900000001, now() - interval '2 minutes',  null, null),  -- 200
  ('core.test_dispatch', null,                                   'cron',   900000002, now() - interval '2 minutes',  null, null),  -- 500
  ('core.test_dispatch', 'b0000000-0000-0000-0000-00000000000a', 'manual', 900000003, now() - interval '2 minutes',  null, null),  -- timeout
  ('core.test_dispatch', 'b0000000-0000-0000-0000-00000000000a', 'manual', 900000004, now() - interval '2 minutes',  null, null),  -- network
  ('core.test_dispatch', null,                                   'cron',   900000005, now() - interval '30 seconds', null, null),  -- 500, too recent
  ('core.test_dispatch', null,                                   'cron',   900000006, now() - interval '10 minutes', null, null),  -- no response yet
  ('core.test_late',     null,                                   'cron',   900000007, now() - interval '2 hours',    null, null),  -- no response, lost (a job with no run since)
  ('core.test_dispatch', 'b0000000-0000-0000-0000-00000000000b', 'manual', 900000008, now() - interval '4 minutes',  null, null),  -- 500, run logged
  ('core.test_dispatch', null,                                   'cron',   900000009, now() - interval '8 days',     now() - interval '8 days', 'ok'); -- purged
insert into net._http_response (id, status_code, timed_out, error_msg, created) values
  (900000001, 200,  false, null, now()),
  (900000002, 500,  false, null, now()),
  (900000003, null, true,  'Timeout of 150000 ms reached', now()),
  (900000004, null, false, 'Couldn''t resolve host name', now()),
  (900000005, 500,  false, null, now()),
  (900000008, 500,  false, null, now());
-- The function logged a run for org B after dispatch 8 (and before the org-less dispatch 2).
insert into public.scheduled_job_runs (job_key, org_id, trigger, status, detail, started_at, finished_at) values
  ('core.test_dispatch', 'b0000000-0000-0000-0000-00000000000b', 'manual', 'error', 'internal', now() - interval '3 minutes', now() - interval '3 minutes');
-- Running runs: one 16 minutes old, one 14 minutes old, and a local-hour cron run 20 minutes old.
insert into public.scheduled_job_runs (id, job_key, org_id, trigger, status, started_at, run_local_date) values
  ('d0000000-0000-0000-0000-000000000001', 'professionals.test_job', 'b0000000-0000-0000-0000-00000000000a', 'cron', 'running', now() - interval '16 minutes', null),
  ('d0000000-0000-0000-0000-000000000002', 'professionals.test_job', 'b0000000-0000-0000-0000-00000000000a', 'cron', 'running', now() - interval '14 minutes', null),
  ('d0000000-0000-0000-0000-000000000003', 'core.test_business', 'b0000000-0000-0000-0000-00000000000b', 'cron', 'running', now() - interval '20 minutes', '2026-01-01');

-- Since *_core_jobs_health.sql the detail ends with the « failing » notices' counts (091).
select matches(private.job_scheduled_jobs_reconcile(),
  '^abandoned=\d+ reconciled=\d+ failed=\d+ deleted=\d+ failing_notified=\d+ failing_cleared=\d+$',
  'job_scheduled_jobs_reconcile returns counts');
select results_eq(
  $$ select request_id, outcome from public.scheduled_job_dispatches where request_id between 900000001 and 900000009 order by request_id $$,
  $$ values (900000001::bigint, 'ok'::text), (900000002, 'http_500'), (900000003, 'timeout'), (900000004, 'network'),
            (900000005, null), (900000006, null), (900000007, 'no_response'), (900000008, 'http_500') $$,
  'dispatches older than a minute are reconciled from their response (none after an hour → no_response); recent or unanswered ones wait; old reconciled ones are deleted');
select results_eq(
  $$ select r.org_id, r.trigger, r.detail, r.started_at, r.finished_at is not null
       from public.scheduled_job_runs r
      where r.job_key in ('core.test_dispatch', 'core.test_late') and r.status = 'error' and r.detail <> 'internal'
      order by r.started_at, r.detail $$,
  $$ values (null::uuid, 'cron'::text, 'no_response'::text, now() - interval '2 hours', true),
            (null, 'cron', 'http_500', now() - interval '2 minutes', true),
            ('b0000000-0000-0000-0000-00000000000a', 'manual', 'network', now() - interval '2 minutes', true),
            ('b0000000-0000-0000-0000-00000000000a', 'manual', 'timeout', now() - interval '2 minutes', true) $$,
  'each failure becomes an error run at the dispatch time, except where the function logged a run after the dispatch');
select results_eq(
  $$ select id, status, detail, run_local_date from public.scheduled_job_runs where id::text like 'd0000000%' order by id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'error'::text, 'abandoned'::text, null::date),
            ('d0000000-0000-0000-0000-000000000002', 'running', null, null),
            ('d0000000-0000-0000-0000-000000000003', 'error', 'abandoned', '2026-01-01') $$,
  'runs still running after 15 minutes are abandoned; a local-hour run keeps its clinic day');
select is(private.job_scheduled_jobs_reconcile(), 'abandoned=0 reconciled=0 failed=0 deleted=0 failing_notified=0 failing_cleared=0',
  'a second pass changes nothing');

-- =============================================================================
-- core.scheduled_job_runs_purge (as postgres)
-- =============================================================================
insert into public.scheduled_job_runs (job_key, org_id, trigger, status, detail, started_at) values
  ('core.test_raises', null, 'cron', 'ok', 'test-purge-old', now() - interval '91 days'),
  ('core.test_raises', null, 'cron', 'ok', 'test-purge-new', now() - interval '89 days');
-- Explicit runids: postgres may not use pg_cron's runid_seq.
insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time) values
  (999999, 999999001, 'postgres', current_user, 'test-purge-old', 'succeeded', now() - interval '15 days', now() - interval '15 days'),
  (999999, 999999002, 'postgres', current_user, 'test-purge-new', 'succeeded', now() - interval '13 days', now() - interval '13 days');
select matches(private.job_scheduled_job_runs_purge(), '^deleted=\d+ cron_details_deleted=\d+$',
  'job_scheduled_job_runs_purge returns counts (postgres may trim cron history locally)');
select results_eq($$ select detail from public.scheduled_job_runs where detail like 'test-purge-%' $$,
  $$ values ('test-purge-new'::text) $$, 'runs older than 90 days are deleted');
select results_eq($$ select command from cron.job_run_details where jobid = 999999 $$,
  $$ values ('test-purge-new'::text) $$, 'cron history older than 14 days is deleted');

select * from finish();
rollback;
