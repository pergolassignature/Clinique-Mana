-- Scheduled jobs health (migration *_core_jobs_health.sql, P3-36 – P3-38). Covers:
-- * public.jobs_health_report(): service role only (definer); the private helpers: no role.
-- * private.cron_interval: the schedule forms in use; every active job has an active cron entry
--   and a schedule the watchdog understands (a new job with another form fails here).
-- * The report: healthy when every watched job ran a moment ago; its shape carries keys, counts,
--   codes and times only (no org id, no free-text detail); periods and thresholds (2.5 × the
--   period, 26 h for a daily or local-hour job).
-- * job_failing: the last 3 finished runs all `error` (2 are not enough, a `running` run does not
--   end the streak, an `ok` run does); a non-code detail reads `other`.
-- * A function job's scope: the org's runs, plus database-wide dispatch errors unless a later
--   dispatch got a 2xx answer; the org's own errors always count.
-- * configuration_missing (last 2 hours only); job_stale (thresholds, the switch-on grace);
--   a switched-off job or a disabled module is not watched; no_recent_runs and cron_silent;
--   cron_entry_missing; a retired job is not watched.
-- * The in-app notice (core.scheduled_jobs_reconcile, step 4): one important core notice per org,
--   job and incident for settings.manage, linked to « Tâches planifiées », plain French with the
--   job's label and the code's reading; never twice; expired once the job succeeds (or is no
--   longer watched); the next incident is keyed on the previous notice; a SQL job's notice goes
--   to every org. The reconcile's detail and the job's description.
-- The whole file is one transaction, so now() is constant. The local stack's pg_cron keeps
-- committing runs meanwhile: they start after now(), and every read here stops at now().
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

-- =============================================================================
-- Privileges and helpers
-- =============================================================================
select results_eq($$
  select has_function_privilege('anon', 'public.jobs_health_report()', 'execute'),
         has_function_privilege('authenticated', 'public.jobs_health_report()', 'execute'),
         has_function_privilege('service_role', 'public.jobs_health_report()', 'execute'),
         (select prosecdef from pg_proc where oid = 'public.jobs_health_report()'::regprocedure)
$$, $$ values (false, false, true, true) $$, 'jobs_health_report: definer, service role only');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.oid in ('private.cron_interval(text)'::regprocedure, 'private.scheduled_job_health(timestamptz)'::regprocedure,
                   'private.jobs_health_report_at(timestamptz)'::regprocedure, 'private.job_error_label(text)'::regprocedure)
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private helpers: no role may call them');

select results_eq($$
  select private.cron_interval(u.s)
    from unnest(array['*/15 * * * *', '7 * * * *', '10 8 * * *', '* * * * *', '5,35 * * * *', '0 9 * * 1', null])
         with ordinality as u (s, i)
   order by u.i
$$, $$ values (interval '15 minutes'), (interval '1 hour'), (interval '1 day'), (interval '1 minute'),
              (null::interval), (null), (null) $$,
  'cron_interval: every 15 minutes, hourly, daily, every minute; any other form has no period');
select is_empty($$
  select j.key from public.scheduled_jobs j
   where j.is_active and not exists (select 1 from cron.job c where c.jobname = j.cron_job_name and c.active)
$$, 'every active job has an active cron entry');
select is_empty($$
  select j.key from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.is_active and j.local_hour is null and private.cron_interval(c.schedule) is null
$$, 'every active job has a schedule the watchdog understands');

select results_eq($$
  select private.job_error_label(u.c)
    from unnest(array['configuration_missing', 'abandoned', 'timeout', 'network', 'no_response', 'http_503',
                      'http_unknown', '42P01', 'provider_error', 'other', null]) with ordinality as u (c, i)
   order by u.i
$$, $$ values ('configuration manquante'), ('interrompue, aucune fin après 15 minutes'), ('délai dépassé'),
              ('service injoignable'), ('aucune réponse du service'), ('erreur technique, HTTP 503'),
              ('erreur technique, HTTP inconnu'), ('erreur technique, code 42P01'),
              ('erreur technique, provider_error'), ('erreur technique'), ('erreur technique') $$,
  'job_error_label: the wording of « Tâches planifiées », for the middle of a sentence');

-- =============================================================================
-- Fixtures (as postgres): a clean slate, rolled back at the end
-- =============================================================================
delete from public.notifications where kind = 'core.scheduled_job_failing';
delete from public.scheduled_job_runs;
delete from public.scheduled_job_dispatches;
delete from cron.job_run_details;

-- Every job and switch has existed for 30 days (so none is in its grace period).
update public.scheduled_jobs set created_at = now() - interval '30 days';
alter table public.org_scheduled_jobs disable trigger org_scheduled_jobs_set_updated_at;
update public.org_scheduled_jobs set updated_at = now() - interval '30 days';

-- Org T: Professionnels on, « Rappels d'invitation » switched on 30 days ago.
insert into public.organizations (id, name, timezone)
values ('b0000000-0000-0000-0000-0000000000f1', 'Org T', 'America/Toronto');
insert into public.org_modules (org_id, module_key, enabled)
values ('b0000000-0000-0000-0000-0000000000f1', 'professionals', true);
update public.org_scheduled_jobs
   set enabled = true, updated_at = now() - interval '30 days'
 where org_id = 'b0000000-0000-0000-0000-0000000000f1';

create function pg_temp.report(p_at timestamptz default now()) returns jsonb
language sql as $$ select private.jobs_health_report_at(p_at) $$;
create function pg_temp.problems(p_at timestamptz default now()) returns setof text
language sql as $$
  select p ->> 'code' || coalesce(':' || (p ->> 'job_key'), '')
    from jsonb_array_elements(pg_temp.report(p_at) -> 'problems') p
   order by 1
$$;
create function pg_temp.job(p_key text) returns jsonb
language sql as $$
  select j from jsonb_array_elements(pg_temp.report() -> 'jobs') j where j ->> 'job_key' = p_key
$$;
create function pg_temp.t_notices(p_job text) returns setof public.notifications
language sql as $$
  select * from public.notifications n
   where n.org_id = 'b0000000-0000-0000-0000-0000000000f1' and n.kind = 'core.scheduled_job_failing'
     and split_part(n.dedupe_key, ':', 1) = p_job
   order by n.created_at, n.expires_at is null, n.id
$$;

-- Every watched job and scope ran `ok` 5 minutes ago; pg_cron ran a job 5 minutes ago.
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
select h.job_key, h.org_id, 'cron', now() - interval '5 minutes', now() - interval '4 minutes', 'ok', 'deleted=0'
  from private.scheduled_job_health(now()) h;
insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
values ((select jobid from cron.job where jobname = 'core.scheduled_jobs_reconcile'), 999999101, 'postgres',
        current_user, 'test', 'succeeded', now() - interval '5 minutes', now() - interval '5 minutes');

-- =============================================================================
-- A healthy database, and the report's shape
-- =============================================================================
select is(pg_temp.report() -> 'problems', '[]'::jsonb, 'every job ran a moment ago: no problem');
select is((pg_temp.report() ->> 'healthy')::boolean, true, '… healthy');
select is_empty($$
  select k from jsonb_object_keys(pg_temp.report()) k
   where k not in ('healthy', 'checked_at', 'last_run_started_at', 'runs_last_hour', 'errors_last_2h',
                   'configuration_missing_last_2h', 'cron_last_started_at', 'cron_runs_last_hour',
                   'cron_failed_last_2h', 'problems', 'jobs')
$$, 'the report: a verdict, counts and times');
select is_empty($$
  select k from jsonb_array_elements(pg_temp.report() -> 'jobs') j, jsonb_object_keys(j) k
   where k not in ('job_key', 'kind', 'scopes', 'cron_scheduled', 'period_minutes', 'threshold_minutes',
                   'last_success_at', 'consecutive_errors', 'last_error_code', 'failing_scopes', 'stale_scopes')
$$, 'a job entry: its key, counts, codes and times (no org id, no detail)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.report() -> 'jobs') j where j ->> 'kind' = 'sql'),
          (select count(*)::int from public.scheduled_jobs where is_active and kind = 'sql'),
  'every active SQL job is watched');
select results_eq($$
  select j ->> 'job_key', (j ->> 'period_minutes')::int, (j ->> 'threshold_minutes')::int
    from jsonb_array_elements(pg_temp.report() -> 'jobs') j
   where j ->> 'job_key' in ('core.email_log_stale_queued', 'core.rate_limits_cleanup', 'core.webhook_events_purge',
                             'professionals.invitation_reminders')
   order by 1
$$, $$ values ('core.email_log_stale_queued'::text, 15, 38), ('core.rate_limits_cleanup', 60, 150),
              ('core.webhook_events_purge', 1440, 1560), ('professionals.invitation_reminders', 1440, 1560) $$,
  'thresholds: 2.5 × the period; a daily job and a local-hour job: 26 hours');
select is((pg_temp.report() ->> 'runs_last_hour')::int > 0 and (pg_temp.report() ->> 'cron_runs_last_hour')::int = 1,
          true, 'runs and pg_cron runs of the last hour are counted');

-- =============================================================================
-- A SQL job that keeps failing (core.rate_limits_cleanup, database-wide)
-- =============================================================================
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '270 seconds', now() - interval '269 seconds', 'error', '42P01'),
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '240 seconds', now() - interval '239 seconds', 'error', '42P01');
select is_empty($$ select * from pg_temp.problems() $$, 'two errors after a success: not failing yet');

insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '210 seconds', now() - interval '209 seconds', 'error',
   'Échec pour Jeanne Exemple'),
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '180 seconds', null, 'running', null);
select results_eq($$ select * from pg_temp.problems() $$, $$ values ('job_failing:core.rate_limits_cleanup'::text) $$,
  'three errors in a row: job_failing (a running run does not end the streak)');
select results_eq($$
  select p ->> 'consecutive_errors', p ->> 'error_code', p ->> 'scopes'
    from jsonb_array_elements(pg_temp.report() -> 'problems') p
$$, $$ values ('3'::text, 'other'::text, '1'::text) $$, '… with the streak, and `other` for a detail that is not a code');
select ok(pg_temp.report()::text !~ 'Jeanne', 'the report never carries a run''s free-text detail');
select is((pg_temp.report() ->> 'healthy')::boolean, false, '… not healthy');

-- The in-app notice.
select matches(private.job_scheduled_jobs_reconcile(),
  '^abandoned=\d+ reconciled=\d+ failed=\d+ deleted=\d+ failing_notified=\d+ failing_cleared=\d+$',
  'the reconcile''s detail adds the notices posted and cleared');
select results_eq($$
  select module_key, importance, recipient_permission, recipient_user_id, link_path, subject_type, subject_id,
         dedupe_key, expires_at, title, body
    from pg_temp.t_notices('core.rate_limits_cleanup')
$$, $$ values ('core'::text, 'important'::text, 'settings.manage'::text, null::uuid, '/parametres/taches-planifiees'::text,
               null::text, null::uuid, 'core.rate_limits_cleanup:first'::text, null::timestamptz,
               'La tâche « Nettoyage des limites de fréquence » échoue'::text,
               'La tâche « Nettoyage des limites de fréquence » échoue depuis 3 exécutions (erreur technique). '
                 || 'Tant qu''elle échoue, son travail n''est pas fait. Son historique est dans « Tâches planifiées ». '
                 || 'Cet avis disparaîtra dès qu''elle réussira de nouveau.') $$,
  'one important core notice for settings.manage, linked to « Tâches planifiées », naming the job and the reason');
select is((select count(distinct n.org_id)::int from public.notifications n
            where n.kind = 'core.scheduled_job_failing' and n.dedupe_key = 'core.rate_limits_cleanup:first'),
          (select count(*)::int from public.organizations),
  'a SQL job''s notice goes to every org');
select matches(private.job_scheduled_jobs_reconcile(), ' failing_notified=0 failing_cleared=0$',
  'a second pass posts nothing');
select is((select count(*)::int from pg_temp.t_notices('core.rate_limits_cleanup')), 1, '… never twice for one incident');

-- It succeeds again: the notice ends.
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '150 seconds', now() - interval '149 seconds', 'ok', 'deleted=0');
select is_empty($$ select * from pg_temp.problems() $$, 'a success ends the streak');
select matches(private.job_scheduled_jobs_reconcile(), ' failing_notified=0 failing_cleared=\d+$', 'the reconcile clears…');
select is((select expires_at from pg_temp.t_notices('core.rate_limits_cleanup')), now(), '… the notice, at once');

-- A new incident: a new notice, keyed on the previous one.
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '140 seconds', now() - interval '139 seconds', 'error', 'abandoned'),
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '130 seconds', now() - interval '129 seconds', 'error', 'abandoned'),
  ('core.rate_limits_cleanup', null, 'cron', now() - interval '120 seconds', now() - interval '119 seconds', 'error', 'abandoned');
select private.job_scheduled_jobs_reconcile();
select results_eq($$ select dedupe_key, expires_at is null from pg_temp.t_notices('core.rate_limits_cleanup') $$,
  $$ values ('core.rate_limits_cleanup:first'::text, false),
            ('core.rate_limits_cleanup:after:' || (select id from pg_temp.t_notices('core.rate_limits_cleanup')
                                                    where dedupe_key = 'core.rate_limits_cleanup:first'), true) $$,
  'the next incident is a new notice, keyed on the previous one');
select ok((select body like '%depuis 3 exécutions (interrompue, aucune fin après 15 minutes).%'
             from pg_temp.t_notices('core.rate_limits_cleanup') where expires_at is null),
  '… with this incident''s reason');

delete from public.scheduled_job_runs
 where job_key = 'core.rate_limits_cleanup' and started_at > now() - interval '5 minutes';
select private.job_scheduled_jobs_reconcile();

-- =============================================================================
-- A function job (core.signing_reconcile, per org): dispatch errors, then the org's own
-- =============================================================================
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
select 'core.signing_reconcile', null, 'cron', now() - x * interval '1 minute', now() - x * interval '1 minute',
       'error', 'configuration_missing'
  from unnest(array[4, 3, 2]) x;
select results_eq($$ select * from pg_temp.problems() $$,
  $$ values ('configuration_missing'::text), ('job_failing:core.signing_reconcile') $$,
  'three database-wide dispatch errors: the function job fails for every org, and configuration_missing is named');
select is((select p ->> 'runs' from jsonb_array_elements(pg_temp.report() -> 'problems') p
            where p ->> 'code' = 'configuration_missing'), '3', '… with its count');
select private.job_scheduled_jobs_reconcile();
select results_eq($$ select dedupe_key, title, body like '%échoue depuis 3 exécutions (configuration manquante).%'
                      from pg_temp.t_notices('core.signing_reconcile') $$,
  $$ values ('core.signing_reconcile:first'::text, 'La tâche « Suivi des signatures électroniques » échoue'::text, true) $$,
  'the org''s notice: « … échoue depuis 3 exécutions (configuration manquante). »');

-- The function answers again (a 2xx dispatch): the dispatch errors before it no longer count.
insert into public.scheduled_job_dispatches (job_key, org_id, trigger, request_id, dispatched_at, reconciled_at, outcome)
values ('core.signing_reconcile', null, 'cron', 999999201, now() - interval '1 minute', now() - interval '30 seconds', 'ok');
select results_eq($$ select * from pg_temp.problems() $$, $$ values ('configuration_missing'::text) $$,
  'a later 2xx dispatch ends a streak of dispatch errors (the code stays named for 2 hours)');
select private.job_scheduled_jobs_reconcile();
select is((select expires_at from pg_temp.t_notices('core.signing_reconcile')), now(), '… and its notice');

-- The org's own errors always count.
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
select 'core.signing_reconcile', 'b0000000-0000-0000-0000-0000000000f1', 'cron', now() - x * interval '1 second',
       now() - x * interval '1 second', 'error', 'timeout'
  from unnest(array[50, 40, 30]) x;
select results_eq($$
  select p ->> 'code', p ->> 'job_key', p ->> 'scopes', p ->> 'error_code'
    from jsonb_array_elements(pg_temp.report() -> 'problems') p where p ->> 'code' = 'job_failing'
$$, $$ values ('job_failing'::text, 'core.signing_reconcile'::text, '1'::text, 'timeout'::text) $$,
  'the org''s own errors fail the job for that org only');
select private.job_scheduled_jobs_reconcile();
select results_eq($$ select dedupe_key, expires_at is null, body like '%(délai dépassé).%'
                      from pg_temp.t_notices('core.signing_reconcile') order by created_at, expires_at is null $$,
  $$ values ('core.signing_reconcile:first'::text, false, false),
            ('core.signing_reconcile:after:' || (select id from pg_temp.t_notices('core.signing_reconcile')
                                                  where dedupe_key = 'core.signing_reconcile:first'), true, true) $$,
  '… a new notice for the org');

delete from public.scheduled_job_runs
 where job_key = 'core.signing_reconcile' and started_at > now() - interval '5 minutes' and status = 'error';
delete from public.scheduled_job_dispatches where request_id = 999999201;

-- configuration_missing only counts for 2 hours.
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('professionals.invitation_reminders', null, 'cron', now() - interval '3 hours', now() - interval '3 hours', 'error',
   'configuration_missing');
select is_empty($$ select * from pg_temp.problems() $$, 'configuration_missing 3 hours ago is not named');
select private.job_scheduled_jobs_reconcile();
select is((select count(*)::int from pg_temp.t_notices('core.signing_reconcile') where expires_at is null), 0,
  'once the job succeeds again, no notice is left open');

-- =============================================================================
-- Stale jobs
-- =============================================================================
delete from public.scheduled_job_runs where job_key in ('core.webhook_events_purge', 'core.email_log_stale_queued');
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('core.webhook_events_purge', null, 'cron', now() - interval '25 hours', now() - interval '25 hours', 'ok', 'deleted=0'),
  ('core.email_log_stale_queued', null, 'cron', now() - interval '35 minutes', now() - interval '35 minutes', 'ok', 'failed=0');
select is_empty($$ select * from pg_temp.problems() $$, 'a daily job 25 hours ago, a 15-minute job 35 minutes ago: in time');

delete from public.scheduled_job_runs where job_key in ('core.webhook_events_purge', 'core.email_log_stale_queued');
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail) values
  ('core.webhook_events_purge', null, 'cron', now() - interval '27 hours', now() - interval '27 hours', 'ok', 'deleted=0'),
  ('core.email_log_stale_queued', null, 'cron', now() - interval '40 minutes', now() - interval '40 minutes', 'ok', 'failed=0'),
  ('core.email_log_stale_queued', null, 'cron', now() - interval '20 minutes', now() - interval '20 minutes', 'error', '57014');
select results_eq($$ select * from pg_temp.problems() $$,
  $$ values ('job_stale:core.email_log_stale_queued'::text), ('job_stale:core.webhook_events_purge') $$,
  'no success in 26 hours (daily) or 2.5 periods (every 15 minutes): job_stale');
select results_eq($$
  select p ->> 'threshold_minutes', p ->> 'last_success_at'
    from jsonb_array_elements(pg_temp.report() -> 'problems') p where p ->> 'job_key' = 'core.webhook_events_purge'
$$, $$ values ('1560'::text, to_jsonb(now() - interval '27 hours') #>> '{}') $$, '… with its threshold and last success');
delete from public.scheduled_job_runs where job_key in ('core.webhook_events_purge', 'core.email_log_stale_queued');
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
select k, null, 'cron', now() - interval '5 minutes', now() - interval '4 minutes', 'ok', 'deleted=0'
  from unnest(array['core.webhook_events_purge', 'core.email_log_stale_queued']) k;

-- A business job (local hour): never ran for org T since its switch-on 30 days ago → stale;
-- switched on an hour ago → in its grace period.
delete from public.scheduled_job_runs
 where job_key = 'professionals.invitation_reminders' and org_id = 'b0000000-0000-0000-0000-0000000000f1';
select results_eq($$ select * from pg_temp.problems() $$,
  $$ values ('job_stale:professionals.invitation_reminders'::text) $$, 'a local-hour job with no run in 26 hours: stale');
update public.org_scheduled_jobs set updated_at = now() - interval '1 hour'
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key = 'professionals.invitation_reminders';
select is_empty($$ select * from pg_temp.problems() $$, 'switched on an hour ago: not stale yet');

-- Switched off, or its module disabled: not watched for the org.
update public.org_scheduled_jobs set enabled = false
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key = 'professionals.invitation_reminders';
select is_empty($$ select 1 from private.scheduled_job_health(now())
                    where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key = 'professionals.invitation_reminders' $$,
  'a job switched off is not watched for the org');
update public.org_scheduled_jobs set enabled = true
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key = 'professionals.invitation_reminders';
update public.org_modules set enabled = false
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and module_key = 'professionals';
select is_empty($$ select 1 from private.scheduled_job_health(now())
                    where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key like 'professionals.%' and kind = 'function' $$,
  'nor one of a module disabled for the org');

-- … and its open notice ends.
update public.org_modules set enabled = true
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and module_key = 'professionals';
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
select 'professionals.invitation_reminders', 'b0000000-0000-0000-0000-0000000000f1', 'cron',
       now() - x * interval '1 minute', now() - x * interval '1 minute', 'error', 'internal'
  from unnest(array[3, 2, 1]) x;
select private.job_scheduled_jobs_reconcile();
select is((select count(*)::int from pg_temp.t_notices('professionals.invitation_reminders') where expires_at is null), 1,
  'a business job failing for the org: a notice');
select ok((select body like 'La tâche « Rappels d''invitation » échoue depuis 3 exécutions (erreur technique, internal).%'
             from pg_temp.t_notices('professionals.invitation_reminders')),
  '… « La tâche « Rappels d''invitation » échoue depuis 3 exécutions (…) »');
update public.org_scheduled_jobs set enabled = false
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key = 'professionals.invitation_reminders';
select private.job_scheduled_jobs_reconcile();
select is((select count(*)::int from pg_temp.t_notices('professionals.invitation_reminders') where expires_at is null), 0,
  'switched off: its notice ends');
update public.org_scheduled_jobs set enabled = true
 where org_id = 'b0000000-0000-0000-0000-0000000000f1' and job_key = 'professionals.invitation_reminders';
delete from public.scheduled_job_runs
 where job_key = 'professionals.invitation_reminders' and org_id = 'b0000000-0000-0000-0000-0000000000f1';
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
values ('professionals.invitation_reminders', 'b0000000-0000-0000-0000-0000000000f1', 'cron',
        now() - interval '5 minutes', now() - interval '4 minutes', 'ok', 'listed=0');

-- =============================================================================
-- Silence, and a job without a cron entry
-- =============================================================================
select ok((select array_agg(x) from pg_temp.problems(now() + interval '2 hours') x)
            @> array['cron_silent', 'no_recent_runs'],
  'nothing ran in the last hour (pg_cron stopped): no_recent_runs and cron_silent');
delete from cron.job_run_details;
select results_eq($$ select * from pg_temp.problems() $$, $$ values ('cron_silent'::text) $$,
  'no pg_cron run in the last hour: cron_silent');
select is((pg_temp.report() -> 'cron_last_started_at'), 'null'::jsonb, '… and no last pg_cron run');
insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
values ((select jobid from cron.job where jobname = 'core.scheduled_jobs_reconcile'), 999999102, 'postgres',
        current_user, 'test', 'failed', now() - interval '5 minutes', now() - interval '5 minutes');
select is_empty($$ select * from pg_temp.problems() $$, 'a failed pg_cron run still shows pg_cron is alive…');
select is(pg_temp.report() ->> 'cron_failed_last_2h', '1', '… and is counted');

insert into public.scheduled_jobs (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values ('core.test_health', 'core', 'Test', 'Test', 'sql', 'private.job_rate_limits_cleanup', 'core.test_health', true);
select results_eq($$ select * from pg_temp.problems() $$, $$ values ('cron_entry_missing:core.test_health'::text) $$,
  'an active job without a cron entry: cron_entry_missing (and, created a moment ago, not stale)');
update public.scheduled_jobs set is_active = false where key = 'core.test_health';
select is_empty($$ select * from pg_temp.problems() $$, 'a retired job is not watched');

-- =============================================================================
-- As the service role; the job's description
-- =============================================================================
set local role service_role;
select is((public.jobs_health_report() ->> 'healthy')::boolean, true, 'the service role reads the verdict');
reset role;
-- No call as `authenticated`: a permission-denied function call inside throws_ok crashes the local
-- Postgres (signal 11, seen 2026-10-10 with any service-role RPC); the privileges are tested above.

select ok((select description like '%avertit les administrateurs dans « À surveiller » quand une tâche échoue trois fois de suite%'
             from public.scheduled_jobs where key = 'core.scheduled_jobs_reconcile'),
  'the reconcile''s description names the notice');

select * from finish();
rollback;
