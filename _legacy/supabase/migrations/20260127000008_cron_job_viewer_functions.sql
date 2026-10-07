-- Migration: cron_job_viewer_functions
-- Purpose: Add functions to view pg_cron jobs and runs from the frontend
-- Created: 2026-01-27
-- Note: These functions gracefully handle when pg_cron extension is not enabled

-- =============================================================================
-- FUNCTION: Get all cron jobs
-- Wraps cron.job to expose via PostgREST
-- Returns empty if pg_cron is not enabled
-- =============================================================================

create or replace function public.get_cron_jobs()
returns table (
  jobid bigint,
  schedule text,
  command text,
  nodename text,
  nodeport integer,
  database text,
  username text,
  active boolean,
  jobname text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if pg_cron extension exists
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    return query execute '
      select
        jobid,
        schedule,
        command,
        nodename,
        nodeport,
        database,
        username,
        active,
        jobname
      from cron.job
      order by jobname
    ';
  end if;
  -- Return empty result if pg_cron not installed
  return;
end;
$$;

comment on function public.get_cron_jobs is
  'Returns all configured pg_cron jobs. Returns empty if pg_cron extension is not enabled.';

-- =============================================================================
-- FUNCTION: Get recent cron job runs
-- Wraps cron.job_run_details to expose via PostgREST
-- Returns empty if pg_cron is not enabled
-- =============================================================================

create or replace function public.get_cron_job_runs(run_limit integer default 20)
returns table (
  runid bigint,
  jobid bigint,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if pg_cron extension exists
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    return query execute format('
      select
        runid,
        jobid,
        job_pid,
        database,
        username,
        command,
        status,
        return_message,
        start_time,
        end_time
      from cron.job_run_details
      order by start_time desc
      limit %s
    ', run_limit);
  end if;
  -- Return empty result if pg_cron not installed
  return;
end;
$$;

comment on function public.get_cron_job_runs is
  'Returns recent pg_cron job execution history. Returns empty if pg_cron extension is not enabled.';

-- =============================================================================
-- GRANT PERMISSIONS
-- Allow authenticated users to view cron jobs
-- =============================================================================

grant execute on function public.get_cron_jobs() to authenticated;
grant execute on function public.get_cron_job_runs(integer) to authenticated;
