-- =============================================================================
-- Scheduled jobs: catalogue, per-clinic switch, run log, pg_cron and pg_net
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §8
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.3 (P3-11, P3-22)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `scheduled_jobs` is a global catalogue seeded by migrations (like `permissions`: not
--   audited, git is its history). A job is either `sql` (a `private.job_<name>() returns text`
--   function, run database-wide by `private.run_sql_job`, so always a maintenance job) or
--   `function` (an edge function posted to by `private.invoke_job_function`; the function
--   loops over `list_job_orgs` and logs its own runs through `start_job_run` / `finish_job_run`,
--   supabase/functions/_shared/jobs.ts).
-- * Schedules live here (`cron.schedule` with an existing name updates it). A business job at a
--   clinic-local hour (P3-22) is scheduled hourly; `list_job_orgs` keeps the orgs whose local
--   hour matches and that have no cron run yet for that local date, and the unique index on
--   (job_key, org_id, run_local_date) makes `start_job_run` answer null on a second cron run.
--   A manual run never sets `run_local_date`, so it does not use up the clinic day.
-- * `org_scheduled_jobs` is the per-clinic switch (audited). A row exists for every org × job
--   (triggers on both parents): maintenance jobs start enabled and cannot be switched off,
--   business jobs start disabled.
-- * `scheduled_job_runs` is an operational log (no audit trigger, 000_invariants list); its
--   `detail` holds counts or an error code (SQLSTATE, never `sqlerrm`), at most 500 characters.
-- * No secret in a table: `invoke_job_function` reads the Vault secrets `project_url` and
--   `internal_function_secret` at call time (pg_net's queue holds the request only until it is
--   sent). A missing secret is logged as an `error` run (`configuration_missing`), not raised.
--   Deviation from PS Hub (invoke_internal_edge_function): the project URL comes from Vault, not
--   from code, and a dedicated internal secret is sent instead of the service-role key (PS Hub's
--   Vault copy of that key drifted after a rotation and every call got a 401).
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- Catalogue
-- -----------------------------------------------------------------------------
create table public.scheduled_jobs (
  key text primary key check (key ~ '^[a-z_]+\.[a-z0-9_]+$'),
  module_key text not null references public.modules(key),
  label text not null check (pg_catalog.length(pg_catalog.btrim(label)) > 0),
  description text not null,
  kind text not null check (kind in ('sql', 'function')),
  sql_function text check (sql_function ~ '^private\.job_[a-z0-9_]+$'),
  function_name text check (function_name ~ '^[a-z0-9-]+$'),
  cron_job_name text unique,
  local_hour smallint check (local_hour between 0 and 23),
  is_maintenance boolean not null default false,
  created_at timestamptz not null default now(),
  -- `<module>.<name>`, like permission keys.
  check (pg_catalog.split_part(key, '.', 1) = module_key),
  -- Exactly one target, according to the kind.
  check ((kind = 'sql') = (sql_function is not null) and (kind = 'function') = (function_name is not null)),
  -- A SQL job runs once for the whole database: it cannot be switched per clinic nor run at a
  -- clinic-local hour.
  check (kind = 'function' or (is_maintenance and local_hour is null))
);
create index scheduled_jobs_module_key_idx on public.scheduled_jobs (module_key);

alter table public.scheduled_jobs enable row level security;
revoke all on public.scheduled_jobs from anon, authenticated;
grant select on public.scheduled_jobs to authenticated;
create policy scheduled_jobs_select on public.scheduled_jobs
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Per-clinic switch
-- -----------------------------------------------------------------------------
create table public.org_scheduled_jobs (
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_key text not null references public.scheduled_jobs(key) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  primary key (org_id, job_key)
);
create index org_scheduled_jobs_job_key_idx on public.org_scheduled_jobs (job_key);
create index org_scheduled_jobs_updated_by_idx on public.org_scheduled_jobs (updated_by);

alter table public.org_scheduled_jobs enable row level security;
revoke all on public.org_scheduled_jobs from anon, authenticated;
grant select on public.org_scheduled_jobs to authenticated;
create policy org_scheduled_jobs_select on public.org_scheduled_jobs
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('settings.view'))
  );

create trigger org_scheduled_jobs_set_updated_at
  before update on public.org_scheduled_jobs
  for each row execute function private.set_updated_at();
create trigger org_scheduled_jobs_audit
  after insert or update or delete on public.org_scheduled_jobs
  for each row execute function private.audit_trigger();

-- A new org gets a row per job.
create function private.seed_org_scheduled_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.org_scheduled_jobs (org_id, job_key, enabled)
  select new.id, j.key, j.is_maintenance
    from public.scheduled_jobs j
  on conflict do nothing;
  return null;
end;
$$;

create trigger organizations_seed_scheduled_jobs
  after insert on public.organizations
  for each row execute function private.seed_org_scheduled_jobs();

-- A new job (a migration seeding the catalogue) reaches every existing org. This is also the
-- backfill: the jobs below are seeded after this trigger exists.
create function private.propagate_scheduled_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.org_scheduled_jobs (org_id, job_key, enabled)
  select o.id, new.key, new.is_maintenance
    from public.organizations o
  on conflict do nothing;
  return null;
end;
$$;

create trigger scheduled_jobs_propagate
  after insert on public.scheduled_jobs
  for each row execute function private.propagate_scheduled_job();

revoke all on function
  private.seed_org_scheduled_jobs(),
  private.propagate_scheduled_job()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Run log
-- -----------------------------------------------------------------------------
create table public.scheduled_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null references public.scheduled_jobs(key) on delete cascade,
  -- Null for a database-wide run (SQL maintenance jobs, a function job that could not be posted).
  org_id uuid references public.organizations(id) on delete cascade,
  trigger text not null check (trigger in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error', 'skipped')),
  -- Counts and error codes only, never personal data.
  detail text check (pg_catalog.length(detail) <= 500),
  -- The clinic's local date of a cron run of a local-hour job (P3-22); null otherwise.
  run_local_date date
);
-- Serves the job FK, list_scheduled_job_runs(p_job_key) and the last run per job.
create index scheduled_job_runs_job_started_idx on public.scheduled_job_runs (job_key, started_at desc);
-- Serves the org FK and the RLS predicate.
create index scheduled_job_runs_org_started_idx on public.scheduled_job_runs (org_id, started_at desc);
-- Serves list_scheduled_job_runs without a job: own-org and database-wide rows (an OR the org
-- index cannot order), newest first.
create index scheduled_job_runs_started_idx on public.scheduled_job_runs (started_at desc);
-- Once per clinic day (P3-22).
create unique index scheduled_job_runs_local_date_key
  on public.scheduled_job_runs (job_key, org_id, run_local_date)
  where run_local_date is not null;

alter table public.scheduled_job_runs enable row level security;
revoke all on public.scheduled_job_runs from anon, authenticated;
grant select on public.scheduled_job_runs to authenticated;
create policy scheduled_job_runs_select on public.scheduled_job_runs
  for select to authenticated
  using (
    (org_id = (select private.current_user_org_id()) or org_id is null)
    and (select private.has_permission('settings.view'))
  );

-- -----------------------------------------------------------------------------
-- Runners (cron and run_scheduled_job_now; no role may call them)
-- -----------------------------------------------------------------------------
-- Runs a SQL job database-wide and logs it. A failure is logged with its SQLSTATE and does not
-- raise, so the cron entry itself always succeeds.
create function private.run_sql_job(p_key text, p_trigger text default 'cron')
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_fn text;
  v_proc regprocedure;
  v_run uuid;
  v_detail text;
begin
  select j.sql_function into v_fn
    from public.scheduled_jobs j
   where j.key = p_key and j.kind = 'sql';
  v_proc := pg_catalog.to_regprocedure(v_fn || '()');
  if v_proc is null or p_trigger is null or p_trigger not in ('cron', 'manual') then
    raise exception 'Unknown SQL job or invalid trigger' using errcode = '22023';
  end if;

  insert into public.scheduled_job_runs (job_key, org_id, trigger)
  values (p_key, null, p_trigger)
  returning id into v_run;

  begin
    -- A regprocedure prints with its argument list: `private.job_x()`.
    execute pg_catalog.format('select %s', v_proc) into v_detail;
    update public.scheduled_job_runs r
       set status = 'ok', detail = pg_catalog.left(v_detail, 500), finished_at = pg_catalog.clock_timestamp()
     where r.id = v_run;
  exception when others then
    -- The SQLSTATE only: `sqlerrm` can quote row values.
    update public.scheduled_job_runs r
       set status = 'error', detail = sqlstate, finished_at = pg_catalog.clock_timestamp()
     where r.id = v_run;
  end;
end;
$$;

-- Posts `{ job_key, org_id, trigger }` to the job's edge function (asynchronous, pg_net). The
-- function logs its runs; this only logs a missing configuration.
create function private.invoke_job_function(p_key text, p_org_id uuid default null, p_trigger text default 'cron')
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_fn text;
  v_url text;
  v_secret text;
begin
  select j.function_name into v_fn
    from public.scheduled_jobs j
   where j.key = p_key and j.kind = 'function';
  if v_fn is null or p_trigger is null or p_trigger not in ('cron', 'manual') then
    raise exception 'Unknown function job or invalid trigger' using errcode = '22023';
  end if;

  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'internal_function_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    insert into public.scheduled_job_runs (job_key, org_id, trigger, status, detail, finished_at)
    values (p_key, p_org_id, p_trigger, 'error', 'configuration_missing', pg_catalog.clock_timestamp());
    return;
  end if;

  perform net.http_post(
    url := pg_catalog.rtrim(v_url, '/') || '/functions/v1/' || v_fn,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := pg_catalog.jsonb_build_object('job_key', p_key, 'org_id', p_org_id, 'trigger', p_trigger),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function
  private.run_sql_job(text, text),
  private.invoke_job_function(text, uuid, text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Service-role RPCs (supabase/functions/_shared/jobs.ts)
-- -----------------------------------------------------------------------------
-- The orgs a cron run of a function job covers: job and module enabled; for a local-hour job,
-- only orgs at that local hour with no cron run yet for their local date.
create function public.list_job_orgs(p_key text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.scheduled_jobs%rowtype;
begin
  select * into v_job from public.scheduled_jobs j where j.key = p_key and j.kind = 'function';
  if not found then
    raise exception 'Unknown function job' using errcode = '22023';
  end if;
  return query
    select o.id
      from public.organizations o
      join public.org_scheduled_jobs s on s.org_id = o.id and s.job_key = v_job.key and s.enabled
     where public.module_enabled_for_org(o.id, v_job.module_key)
       and (v_job.local_hour is null
            or (extract(hour from pg_catalog.now() at time zone o.timezone) = v_job.local_hour
                and not exists (
                  select 1 from public.scheduled_job_runs r
                   where r.job_key = v_job.key
                     and r.org_id = o.id
                     and r.run_local_date = (pg_catalog.now() at time zone o.timezone)::date)))
     order by o.id;
end;
$$;

-- Starts one org's run of a function job; null when it must not run: the job or its module is
-- disabled for the org, or (cron, local-hour job) it already ran for the clinic's local date.
create function public.start_job_run(p_key text, p_org_id uuid, p_trigger text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.scheduled_jobs%rowtype;
  v_tz text;
  v_date date;
  v_id uuid;
begin
  if p_trigger is null or p_trigger not in ('cron', 'manual') then
    raise exception 'Invalid trigger' using errcode = '22023';
  end if;
  select * into v_job from public.scheduled_jobs j where j.key = p_key and j.kind = 'function';
  if not found then
    raise exception 'Unknown function job' using errcode = '22023';
  end if;
  select o.timezone into v_tz from public.organizations o where o.id = p_org_id;
  if not found then
    raise exception 'Unknown organization' using errcode = '22023';
  end if;

  if not exists (select 1 from public.org_scheduled_jobs s
                  where s.org_id = p_org_id and s.job_key = p_key and s.enabled)
     or not public.module_enabled_for_org(p_org_id, v_job.module_key) then
    return null;
  end if;
  if v_job.local_hour is not null and p_trigger = 'cron' then
    v_date := (pg_catalog.now() at time zone v_tz)::date;
  end if;

  insert into public.scheduled_job_runs (job_key, org_id, trigger, run_local_date)
  values (p_key, p_org_id, p_trigger, v_date)
  on conflict (job_key, org_id, run_local_date) where run_local_date is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Finishes a running run with its outcome.
create function public.finish_job_run(p_id uuid, p_status text, p_detail text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('ok', 'error', 'skipped')
     or pg_catalog.length(p_detail) > 500 then
    raise exception 'Invalid job run outcome' using errcode = '22023';
  end if;
  update public.scheduled_job_runs r
     set status = p_status, detail = p_detail, finished_at = pg_catalog.clock_timestamp()
   where r.id = p_id and r.status = 'running';
  if not found then
    raise exception 'Unknown or finished job run' using errcode = '22023';
  end if;
end;
$$;

revoke all on function
  public.list_job_orgs(text),
  public.start_job_run(text, uuid, text),
  public.finish_job_run(uuid, text, text)
from public, anon, authenticated;
grant execute on function
  public.list_job_orgs(text),
  public.start_job_run(text, uuid, text),
  public.finish_job_run(uuid, text, text)
to service_role;

-- -----------------------------------------------------------------------------
-- User RPCs (« Tâches planifiées », Task 3.5)
-- -----------------------------------------------------------------------------
-- The jobs of the caller's org (jobs of a disabled module are hidden), with their schedule,
-- switch and last run.
create function public.list_scheduled_jobs()
returns table (
  key text,
  label text,
  description text,
  kind text,
  is_maintenance boolean,
  local_hour smallint,
  schedule text,
  enabled boolean,
  last_started_at timestamptz,
  last_status text,
  last_detail text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('settings.view') then
    raise exception 'Permission refusée : settings.view' using errcode = '42501';
  end if;
  return query
    select j.key, j.label, j.description, j.kind, j.is_maintenance, j.local_hour,
           c.schedule, coalesce(s.enabled, j.is_maintenance),
           lr.started_at, lr.status, lr.detail
      from public.scheduled_jobs j
      left join public.org_scheduled_jobs s on s.org_id = v_org and s.job_key = j.key
      left join cron.job c on c.jobname = j.cron_job_name
      left join lateral (
        select r.started_at, r.status, r.detail
          from public.scheduled_job_runs r
         where r.job_key = j.key and (r.org_id = v_org or r.org_id is null)
         order by r.started_at desc
         limit 1
      ) lr on true
     where public.module_enabled_for_org(v_org, j.module_key)
     order by j.is_maintenance, j.label;
end;
$$;

-- Recent runs visible to the caller (own org and database-wide), newest first (RLS applies).
create function public.list_scheduled_job_runs(
  p_job_key text default null,
  p_limit int default 20,
  p_before timestamptz default null
)
returns table (
  id uuid,
  job_key text,
  trigger text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  detail text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.job_key, r.trigger, r.status, r.started_at, r.finished_at, r.detail
    from public.scheduled_job_runs r
   where (p_job_key is null or r.job_key = p_job_key)
     and (p_before is null or r.started_at < p_before)
   order by r.started_at desc, r.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- Switches a business job on or off for the caller's org (audited through the table).
create function public.set_scheduled_job_enabled(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_maintenance boolean;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  select j.is_maintenance into v_maintenance from public.scheduled_jobs j where j.key = p_key;
  if not found or p_enabled is null then
    raise exception 'Tâche inconnue : %', p_key using errcode = '22023';
  end if;
  if v_maintenance then
    raise exception 'Les tâches d''entretien restent toujours actives.' using errcode = 'P0001';
  end if;

  insert into public.org_scheduled_jobs (org_id, job_key, enabled, updated_by)
  values (v_org, p_key, p_enabled, auth.uid())
  on conflict (org_id, job_key) do update
    set enabled = excluded.enabled,
        updated_by = excluded.updated_by;
end;
$$;

-- Runs a job now for the caller's org (once per 5 minutes per org and job).
create function public.run_scheduled_job_now(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_job public.scheduled_jobs%rowtype;
  v_allowed boolean;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  select * into v_job from public.scheduled_jobs j where j.key = p_key;
  if not found or not public.module_enabled_for_org(v_org, v_job.module_key) then
    raise exception 'Tâche inconnue : %', p_key using errcode = '22023';
  end if;
  if not exists (select 1 from public.org_scheduled_jobs s
                  where s.org_id = v_org and s.job_key = p_key and s.enabled) then
    raise exception 'Activez d''abord cette tâche.' using errcode = 'P0001';
  end if;

  select rl.allowed into v_allowed
    from public.consume_rate_limit(
      'jobs.run_now',
      pg_catalog.sha256(pg_catalog.convert_to(v_org::text || ':' || p_key, 'UTF8')),
      1, 300) rl;
  if not v_allowed then
    raise exception 'Cette tâche vient d''être lancée. Réessayez dans quelques minutes.' using errcode = 'P0001';
  end if;

  if v_job.kind = 'sql' then
    perform private.run_sql_job(p_key, 'manual');
  else
    perform private.invoke_job_function(p_key, v_org, 'manual');
  end if;
end;
$$;

revoke all on function
  public.list_scheduled_jobs(),
  public.list_scheduled_job_runs(text, int, timestamptz),
  public.set_scheduled_job_enabled(text, boolean),
  public.run_scheduled_job_now(text)
from public, anon, authenticated, service_role;
grant execute on function
  public.list_scheduled_jobs(),
  public.list_scheduled_job_runs(text, int, timestamptz),
  public.set_scheduled_job_enabled(text, boolean),
  public.run_scheduled_job_now(text)
to authenticated;
-- service_role is revoked above (Supabase's default privileges grant it EXECUTE): these act
-- for the calling user's org (auth.uid()).

-- -----------------------------------------------------------------------------
-- Core maintenance jobs
-- -----------------------------------------------------------------------------
-- Rate-limit windows last at most one day, so a window that started more than 24 h ago has
-- ended. Only safe while every window is <= 86 400 s: consume_rate_limit refuses longer ones,
-- and every LIMITS entry in supabase/functions/_shared/rate-limit.ts must stay within it.
create function private.job_rate_limits_cleanup()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.rate_limits rl where rl.window_start < pg_catalog.now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return 'deleted=' || v_deleted;
end;
$$;

-- Completed events keep no payload (complete_webhook_event already clears it; this catches any
-- other path); failed events lose theirs after 7 days, when providers have stopped retrying;
-- every event is deleted after 90 days.
create function private.job_webhook_events_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_cleared bigint;
  v_deleted bigint;
begin
  update public.webhook_events w set payload = null
   where w.payload is not null
     and (w.status = 'completed'
          or (w.status = 'failed' and w.received_at < pg_catalog.now() - interval '7 days'));
  get diagnostics v_cleared = row_count;
  delete from public.webhook_events w where w.received_at < pg_catalog.now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return 'payloads_cleared=' || v_cleared || ' deleted=' || v_deleted;
end;
$$;

revoke all on function
  private.job_rate_limits_cleanup(),
  private.job_webhook_events_purge()
from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('core.rate_limits_cleanup', 'core', 'Nettoyage des limites de fréquence',
   'Supprime les compteurs de fréquence de plus de 24 heures.',
   'sql', 'private.job_rate_limits_cleanup', 'core.rate_limits_cleanup', true),
  ('core.webhook_events_purge', 'core', 'Purge des événements reçus',
   'Efface le contenu des événements reçus des services externes une fois traités (après 7 jours en cas d''échec), et les supprime après 90 jours.',
   'sql', 'private.job_webhook_events_purge', 'core.webhook_events_purge', true)
on conflict do nothing;

select cron.schedule('core.rate_limits_cleanup', '7 * * * *',
  $$select private.run_sql_job('core.rate_limits_cleanup')$$);
select cron.schedule('core.webhook_events_purge', '10 8 * * *',
  $$select private.run_sql_job('core.webhook_events_purge')$$);
