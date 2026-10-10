-- =============================================================================
-- Scheduled jobs health: a report for an external watchdog, and an in-app « failing » notice
-- =============================================================================
-- Incident: on production, pg_cron's launcher was stale after a reset, so no job ran at all; after
--           its restart (2026-10-10) every function job failed hourly with `configuration_missing`
--           (the Vault secrets `project_url` and `internal_function_secret` were missing). Nobody
--           was warned.
-- Decisions: P3-36, P3-37, P3-38 (docs/plans/2026-10-07-decisions-log.md).
-- Amends:  20261008040525_core_scheduled_jobs.sql (private.job_scheduled_jobs_reconcile and the
--          core.scheduled_jobs_reconcile job's description). Changed here to keep history clear.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * One health rule, two readers. private.scheduled_job_health(p_at) says, for every watched job
--   and scope, whether it is failing or stale. The external watchdog
--   (.github/workflows/jobs-health.yml, every hour, outside the database, so it still speaks when
--   pg_cron is dead) reads it through public.jobs_health_report(); the in-app notice
--   (core.scheduled_jobs_reconcile, every 15 minutes) reads it too. The bodies take the time as an
--   argument (tests), like the jobs' own `_at` functions.
-- * Watched: every active SQL job, once, database-wide (its runs have no org); every active
--   function job per org where it is switched on and its module is enabled (maintenance function
--   jobs are always on). From `watched_since`: the job's catalogue row, or for a business job the
--   later of that and its switch's last change, so a job switched on or created a moment ago is
--   neither stale nor failing on past runs.
-- * Failing = the scope's last 3 finished runs are all `error` (a `running` run does not count; an
--   `ok` or `skipped` run ends the streak). A function job's scope is the org's own runs plus the
--   database-wide error runs of its dispatches (`configuration_missing`, `http_*`, `timeout`,
--   `network`, `no_response`, logged with org null for a cron post), except those older than the
--   job's latest 2xx dispatch (cron, or a manual one of that org): once the function answers
--   again, « could not reach the function » is over, even for a local-hour job whose next real
--   run is tomorrow. The org's own errors always count.
-- * Stale = no success since `p_at - threshold` (nor since `watched_since`). The threshold follows
--   the expected time between two successes: the cron schedule's period (`*/N * * * *` → N
--   minutes, `M * * * *` → 1 hour, `M H * * *` → 1 day; a local-hour job → 1 day, P3-22) × 2.5, or
--   + 2 hours from one day up (daily jobs: 26 hours). A schedule outside those forms has no
--   period: the report names it (`unknown_schedule`) instead of watching it silently, and the
--   pgTAP test fails for any active job in that case.
-- * public.jobs_health_report() (definer, service role only; the workflow runs it as the owner
--   through `supabase db query --linked`): a jsonb verdict, `healthy` = no problem. Problems:
--   `no_recent_runs` (no scheduled_job_runs row started in the last 60 minutes: two jobs run every
--   15), `cron_silent` (no cron.job_run_details row started in the last 60 minutes),
--   `configuration_missing` (any run with that detail in the last 2 hours), `cron_entry_missing`
--   (an active, watched job without an active cron entry), `unknown_schedule`, `job_failing`,
--   `job_stale`. It carries job keys, statuses, counts, error codes and times only: never an org
--   id, never a run's detail unless it is a code (`^[A-Za-z0-9_]{1,64}$`, else `other`).
-- * In-app (P3-37): `core.scheduled_job_failing`, important, core, for `settings.manage`
--   (administrators), linked to « Tâches planifiées », no subject; one per org, job and incident;
--   a SQL job's notice goes to every org. Dedupe key = `<job key>:first`, or
--   `<job key>:after:<id of the previous notice of that job>`, posted only when that previous
--   notice has expired (or is over 90 days old, gone from « À surveiller »: a reminder), like
--   core.signing_requests_unverified. It expires as soon as the job is no longer failing for that
--   org (a success, a 2xx dispatch ending the dispatch errors), is no longer watched (switched
--   off, its module disabled) or is retired. Expiry first, then posting, in one block at the end
--   of the reconcile, after this pass's own `error` runs; a failure of the block is logged in the
--   detail by its SQLSTATE (`failing_error=…`) and never fails the reconcile. A failing
--   reconcile cannot report itself: the external watchdog covers it.
-- * No pg_cron outage can be seen from inside: that is the external watchdog's job (P3-36).
-- * Cost: a handful of jobs × orgs, each with two index range scans on
--   scheduled_job_runs_job_started_idx (the last success, then the errors after it: 90 days of
--   runs at most, purged after) and one scan of the dispatches of the job (7 days, purged after);
--   cron.job_run_details is read without an index (14 days, about 300 rows a day, trimmed daily).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_jobs_health', true);

-- -----------------------------------------------------------------------------
-- The expected period of a cron schedule (header)
-- -----------------------------------------------------------------------------
create function private.cron_interval(p_schedule text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case
    when p_schedule ~ '^\*/[1-9][0-9]? \* \* \* \*$'
      then pg_catalog.make_interval(mins => pg_catalog.substring(p_schedule, '^\*/([0-9]+)')::int)
    when p_schedule = '* * * * *' then interval '1 minute'
    when p_schedule ~ '^[0-9]{1,2} \* \* \* \*$' then interval '1 hour'
    when p_schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$' then interval '1 day'
  end
$$;

-- -----------------------------------------------------------------------------
-- The health of every watched job and scope at `p_at` (header)
-- -----------------------------------------------------------------------------
-- `org_id` is null for a SQL job (database-wide). `last_error_code` is the latest error run's
-- detail when it is a code, `other` otherwise (never free text). Invoker, granted to no role:
-- called by jobs_health_report_at and the reconcile.
create function private.scheduled_job_health(p_at timestamptz)
returns table (
  org_id uuid,
  job_key text,
  label text,
  kind text,
  period interval,
  threshold interval,
  cron_scheduled boolean,
  watched_since timestamptz,
  last_success_at timestamptz,
  consecutive_errors int,
  last_error_code text,
  failing boolean,
  stale boolean
)
language sql
stable
set search_path = ''
as $$
  with watched as (
    select null::uuid as org_id, j.key, j.label, j.kind, j.local_hour, j.cron_job_name,
           j.created_at as watched_since
      from public.scheduled_jobs j
     where j.is_active and j.kind = 'sql'
    union all
    select o.id, j.key, j.label, j.kind, j.local_hour, j.cron_job_name,
           case when j.is_maintenance then j.created_at else greatest(j.created_at, s.updated_at) end
      from public.scheduled_jobs j
      join public.org_scheduled_jobs s on s.job_key = j.key and s.enabled
      join public.organizations o on o.id = s.org_id
     where j.is_active and j.kind = 'function'
       and public.module_enabled_for_org(o.id, j.module_key)
  ),
  w as (
    select x.org_id, x.key, x.label, x.kind, x.watched_since,
           coalesce(c.active, false) as cron_scheduled,
           case when x.local_hour is not null then interval '1 day'
                else private.cron_interval(c.schedule) end as period,
           -- The latest 2xx answer of the job's function (cron, or a manual run of this org).
           (select pg_catalog.max(d.dispatched_at)
              from public.scheduled_job_dispatches d
             where x.kind = 'function' and d.job_key = x.key and d.outcome = 'ok'
               and d.dispatched_at <= p_at
               and (d.org_id is null or d.org_id = x.org_id)) as reached_at
      from watched x
      left join cron.job c on c.jobname = x.cron_job_name
  )
  select w.org_id, w.key, w.label, w.kind, w.period, th.threshold, w.cron_scheduled, w.watched_since,
         ls.started_at,
         coalesce(e.n, 0),
         case when e.code ~ '^[A-Za-z0-9_]{1,64}$' then e.code when e.n > 0 then 'other' end,
         coalesce(e.n, 0) >= 3,
         th.threshold is not null and coalesce(ls.started_at, w.watched_since) < p_at - th.threshold
    from w
   cross join lateral (
     select case when w.period is null then null
                 when w.period >= interval '1 day' then w.period + interval '2 hours'
                 else w.period * 2.5 end as threshold) th
    left join lateral (
      select r.started_at
        from public.scheduled_job_runs r
       where r.job_key = w.key and r.status in ('ok', 'skipped')
         and r.started_at >= w.watched_since and r.started_at <= p_at
         and (w.org_id is null or r.org_id = w.org_id)
       order by r.started_at desc, r.id desc
       limit 1) ls on true
    left join lateral (
      select pg_catalog.count(*)::int as n,
             (pg_catalog.array_agg(r.detail order by r.started_at desc, r.id desc))[1] as code
        from public.scheduled_job_runs r
       where r.job_key = w.key and r.status = 'error'
         and r.started_at >= w.watched_since and r.started_at <= p_at
         and r.started_at > coalesce(ls.started_at, '-infinity')
         and (w.org_id is null
              or r.org_id = w.org_id
              or (r.org_id is null and (w.reached_at is null or r.started_at >= w.reached_at)))) e on true
$$;

-- -----------------------------------------------------------------------------
-- The external watchdog's report (header)
-- -----------------------------------------------------------------------------
create function private.jobs_health_report_at(p_at timestamptz)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_last_run timestamptz;
  v_runs_1h int;
  v_cron_last timestamptz;
  v_cron_1h int;
  v_cron_failed_2h int;
  v_errors_2h int;
  v_config_missing_2h int;
  v_jobs jsonb;
  v_problems jsonb := '[]'::jsonb;
begin
  select pg_catalog.max(r.started_at) into v_last_run
    from public.scheduled_job_runs r where r.started_at <= p_at;
  select pg_catalog.count(*) filter (where r.started_at > p_at - interval '60 minutes'),
         pg_catalog.count(*) filter (where r.status = 'error'),
         pg_catalog.count(*) filter (where r.status = 'error' and r.detail = 'configuration_missing')
    into v_runs_1h, v_errors_2h, v_config_missing_2h
    from public.scheduled_job_runs r
   where r.started_at > p_at - interval '2 hours' and r.started_at <= p_at;

  select pg_catalog.max(d.start_time),
         pg_catalog.count(*) filter (where d.start_time > p_at - interval '60 minutes'),
         pg_catalog.count(*) filter (where d.start_time > p_at - interval '2 hours' and d.status = 'failed')
    into v_cron_last, v_cron_1h, v_cron_failed_2h
    from cron.job_run_details d
   where d.start_time <= p_at;

  if v_runs_1h = 0 then
    v_problems := v_problems || pg_catalog.jsonb_build_object('code', 'no_recent_runs', 'last_started_at', v_last_run);
  end if;
  if v_cron_1h = 0 then
    v_problems := v_problems || pg_catalog.jsonb_build_object('code', 'cron_silent', 'last_started_at', v_cron_last);
  end if;
  if v_config_missing_2h > 0 then
    v_problems := v_problems || pg_catalog.jsonb_build_object('code', 'configuration_missing', 'runs', v_config_missing_2h);
  end if;

  -- One entry per job: the worst of its scopes (one per org for a function job).
  with per_job as (
    select h.job_key, h.kind,
           pg_catalog.count(*)::int as scopes,
           pg_catalog.bool_and(h.cron_scheduled) as cron_scheduled,
           (extract(epoch from pg_catalog.min(h.period)) / 60)::int as period_minutes,
           (extract(epoch from pg_catalog.min(h.threshold)) / 60)::int as threshold_minutes,
           (pg_catalog.array_agg(h.last_success_at order by h.last_success_at nulls first))[1] as last_success_at,
           pg_catalog.max(h.consecutive_errors) as consecutive_errors,
           (pg_catalog.array_agg(h.last_error_code order by h.consecutive_errors desc))[1] as last_error_code,
           pg_catalog.count(*) filter (where h.failing)::int as failing_scopes,
           pg_catalog.count(*) filter (where h.stale)::int as stale_scopes
      from private.scheduled_job_health(p_at) h
     group by h.job_key, h.kind
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'job_key', p.job_key, 'kind', p.kind, 'scopes', p.scopes,
           'cron_scheduled', p.cron_scheduled, 'period_minutes', p.period_minutes,
           'threshold_minutes', p.threshold_minutes, 'last_success_at', p.last_success_at,
           'consecutive_errors', p.consecutive_errors, 'last_error_code', p.last_error_code,
           'failing_scopes', p.failing_scopes, 'stale_scopes', p.stale_scopes)
           order by p.job_key), '[]'::jsonb),
         v_problems
           || coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', 'cron_entry_missing', 'job_key', p.job_key)
                         order by p.job_key) filter (where not p.cron_scheduled), '[]'::jsonb)
           || coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', 'unknown_schedule', 'job_key', p.job_key)
                         order by p.job_key) filter (where p.cron_scheduled and p.period_minutes is null), '[]'::jsonb)
           || coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'code', 'job_failing', 'job_key', p.job_key, 'consecutive_errors', p.consecutive_errors,
                           'error_code', p.last_error_code, 'scopes', p.failing_scopes)
                         order by p.job_key) filter (where p.failing_scopes > 0), '[]'::jsonb)
           || coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'code', 'job_stale', 'job_key', p.job_key, 'last_success_at', p.last_success_at,
                           'threshold_minutes', p.threshold_minutes, 'scopes', p.stale_scopes)
                         order by p.job_key) filter (where p.stale_scopes > 0), '[]'::jsonb)
    into v_jobs, v_problems
    from per_job p;

  return pg_catalog.jsonb_build_object(
    'healthy', pg_catalog.jsonb_array_length(v_problems) = 0,
    'checked_at', p_at,
    'last_run_started_at', v_last_run,
    'runs_last_hour', v_runs_1h,
    'errors_last_2h', v_errors_2h,
    'configuration_missing_last_2h', v_config_missing_2h,
    'cron_last_started_at', v_cron_last,
    'cron_runs_last_hour', v_cron_1h,
    'cron_failed_last_2h', v_cron_failed_2h,
    'problems', v_problems,
    'jobs', v_jobs);
end;
$$;

-- Service role only (header). The owner, `postgres`, runs it from the workflow.
create function public.jobs_health_report()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.jobs_health_report_at(pg_catalog.now())
$$;

revoke all on function
  private.cron_interval(text),
  private.scheduled_job_health(timestamptz),
  private.jobs_health_report_at(timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.jobs_health_report() from public, anon, authenticated;
grant execute on function public.jobs_health_report() to service_role;

-- -----------------------------------------------------------------------------
-- The in-app notice (P3-37)
-- -----------------------------------------------------------------------------
-- A failed run's code, in plain French, for the middle of a sentence (the wording of
-- « Tâches planifiées », src/core/jobs/labels.ts `runDetailLabel`).
create function private.job_error_label(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_code = 'configuration_missing' then 'configuration manquante'
    when p_code = 'abandoned' then 'interrompue, aucune fin après 15 minutes'
    when p_code = 'timeout' then 'délai dépassé'
    when p_code = 'network' then 'service injoignable'
    when p_code = 'no_response' then 'aucune réponse du service'
    when p_code = 'http_unknown' then 'erreur technique, HTTP inconnu'
    when p_code ~ '^http_[0-9]{3}$' then 'erreur technique, HTTP ' || pg_catalog.substring(p_code, 6)
    when p_code ~ '^[0-9A-Z]{5}$' then 'erreur technique, code ' || p_code
    when p_code ~ '^[A-Za-z0-9_]{1,64}$' and p_code <> 'other' then 'erreur technique, ' || p_code
    else 'erreur technique'
  end
$$;

revoke all on function private.job_error_label(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- core.scheduled_jobs_reconcile (20261008040525's body, unchanged, then step 4)
-- -----------------------------------------------------------------------------
-- Every 15 minutes (20261008040525, « HTTP outcomes »):
-- 1. `running` runs older than 15 minutes → `error` / `abandoned` (a local-hour run keeps its
--    run_local_date: it still counts for the clinic day, so its batch is never sent twice);
-- 2. dispatches older than 1 minute with a pg_net response (or none after 1 hour) are
--    reconciled; a failure becomes an `error` run unless the function logged a run for that job
--    (and org) after the dispatch;
-- 3. reconciled dispatches older than 7 days are deleted;
-- 4. (P3-37, header) notices of jobs that keep failing: expired, then posted, in their own block.
create or replace function private.job_scheduled_jobs_reconcile()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_abandoned bigint;
  v_reconciled bigint;
  v_failed bigint;
  v_deleted bigint;
  v_cleared bigint;
  v_notified bigint;
  v_alert text;
begin
  update public.scheduled_job_runs r
     set status = 'error', detail = 'abandoned', finished_at = pg_catalog.clock_timestamp()
   where r.status = 'running' and r.started_at < pg_catalog.now() - interval '15 minutes';
  get diagnostics v_abandoned = row_count;

  with pending as (
    select d.id,
           case
             when resp.id is null then
               case when d.dispatched_at < pg_catalog.now() - interval '1 hour' then 'no_response' end
             when resp.timed_out then 'timeout'
             when resp.error_msg is not null then 'network'
             when resp.status_code between 200 and 299 then 'ok'
             else 'http_' || coalesce(resp.status_code::text, 'unknown')
           end as outcome
      from public.scheduled_job_dispatches d
      left join net._http_response resp on resp.id = d.request_id
     where d.reconciled_at is null
       and d.dispatched_at < pg_catalog.now() - interval '1 minute'
       for update of d skip locked
  ),
  marked as (
    update public.scheduled_job_dispatches d
       set reconciled_at = pg_catalog.clock_timestamp(), outcome = p.outcome
      from pending p
     where d.id = p.id and p.outcome is not null
    returning d.job_key, d.org_id, d.trigger, d.dispatched_at, d.outcome
  ),
  failed as (
    insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
    select m.job_key, m.org_id, m.trigger, m.dispatched_at, pg_catalog.clock_timestamp(), 'error', m.outcome
      from marked m
     where m.outcome <> 'ok'
       and not exists (select 1 from public.scheduled_job_runs r
                        where r.job_key = m.job_key
                          and (m.org_id is null or r.org_id = m.org_id)
                          and r.started_at >= m.dispatched_at)
    returning 1
  )
  select (select pg_catalog.count(*) from marked), (select pg_catalog.count(*) from failed)
    into v_reconciled, v_failed;

  delete from public.scheduled_job_dispatches d
   where d.reconciled_at is not null and d.dispatched_at < pg_catalog.now() - interval '7 days';
  get diagnostics v_deleted = row_count;

  -- 4. Jobs that keep failing (header, P3-37).
  begin
    -- An open notice ends once its job is no longer failing for its org (or no longer watched).
    with failing as materialized (
      select h.org_id, h.job_key from private.scheduled_job_health(pg_catalog.now()) h where h.failing
    )
    update public.notifications n
       set expires_at = pg_catalog.now()
     where n.kind = 'core.scheduled_job_failing'
       and n.created_at > pg_catalog.now() - interval '90 days'
       and n.expires_at is null
       and not exists (select 1 from failing f
                        where f.job_key = pg_catalog.split_part(n.dedupe_key, ':', 1)
                          and (f.org_id is null or f.org_id = n.org_id));
    get diagnostics v_cleared = row_count;

    select pg_catalog.count(private.notify(
             f.org_id, 'core', 'core.scheduled_job_failing', 'important',
             pg_catalog.left('La tâche « ' || f.label || ' » échoue', 160),
             pg_catalog.left(
               'La tâche « ' || f.label || ' » échoue depuis ' || f.consecutive_errors || ' exécutions ('
                 || private.job_error_label(f.last_error_code) || '). Tant qu''elle échoue, son travail '
                 || 'n''est pas fait. Son historique est dans « Tâches planifiées ». Cet avis disparaîtra '
                 || 'dès qu''elle réussira de nouveau.', 500),
             '/parametres/taches-planifiees', null, null,
             'settings.manage', null, f.job_key || ':' || f.episode, null))
      into v_notified
      from (select o.id as org_id, h.job_key, h.label, h.consecutive_errors, h.last_error_code,
                   coalesce('after:' || prev.id::text, 'first') as episode
              from private.scheduled_job_health(pg_catalog.now()) h
              -- A SQL job's notice goes to every org.
              join public.organizations o on h.org_id is null or o.id = h.org_id
              left join lateral (
                select n.id, n.created_at, n.expires_at
                  from public.notifications n
                 where n.org_id = o.id and n.kind = 'core.scheduled_job_failing'
                   and pg_catalog.split_part(n.dedupe_key, ':', 1) = h.job_key
                 -- An open one wins a tie (two notices of one transaction share created_at).
                 order by n.created_at desc, n.expires_at is null desc, n.id desc
                 limit 1) prev on true
             where h.failing
               -- After 90 days the previous one has left « À surveiller »: a reminder.
               and (prev.id is null or prev.expires_at <= pg_catalog.now()
                    or prev.created_at <= pg_catalog.now() - interval '90 days')) f
     -- Counted only when new (private.notify returns the existing id on a dedupe).
     where not exists (select 1 from public.notifications n
                        where n.org_id = f.org_id and n.kind = 'core.scheduled_job_failing'
                          and n.dedupe_key = f.job_key || ':' || f.episode);
    v_alert := ' failing_notified=' || v_notified || ' failing_cleared=' || v_cleared;
  exception when others then
    -- The SQLSTATE only (`sqlerrm` can quote row values), like private.run_sql_job.
    v_alert := ' failing_error=' || sqlstate;
  end;

  return 'abandoned=' || v_abandoned || ' reconciled=' || v_reconciled
      || ' failed=' || v_failed || ' deleted=' || v_deleted || v_alert;
end;
$$;

-- create or replace keeps the privileges; restated so the file reads alone.
revoke all on function private.job_scheduled_jobs_reconcile() from public, anon, authenticated, service_role;

update public.scheduled_jobs
   set description = 'Inscrit dans l''historique les appels de tâches restés sans réponse ou en échec, clôt les '
                     || 'exécutions interrompues depuis plus de 15 minutes, et avertit les administrateurs dans '
                     || '« À surveiller » quand une tâche échoue trois fois de suite (l''avis disparaît dès '
                     || 'qu''elle réussit de nouveau).'
 where key = 'core.scheduled_jobs_reconcile';
