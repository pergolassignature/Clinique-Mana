import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/** Runs per page of « Dernières exécutions » (the RPC's default; it clamps the limit to 1–100). */
export const JOB_RUNS_PAGE_SIZE = 20

/**
 * One job of the caller's org, as `list_scheduled_jobs` returns it. The generated types say
 * non-null everywhere, but `local_hour` is set only for a clinic-local job, `schedule` is null when
 * pg_cron has no entry for the job, and a job that never ran has no last run.
 */
const scheduledJobSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  kind: z.string(),
  is_maintenance: z.boolean(),
  local_hour: z.number().nullable(),
  schedule: z.string().nullable(),
  enabled: z.boolean(),
  last_started_at: z.string().nullable(),
  last_status: z.string().nullable(),
  /** Counts or an error code, never personal data. */
  last_detail: z.string().nullable(),
})
export type ScheduledJob = z.infer<typeof scheduledJobSchema>

/** One run (`list_scheduled_job_runs`): own org and database-wide; a running one has no end yet. */
const jobRunSchema = z.object({
  id: z.string(),
  job_key: z.string(),
  trigger: z.string(),
  status: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  detail: z.string().nullable(),
})
export type JobRun = z.infer<typeof jobRunSchema>

/** Where the next page starts: the last row seen (keyset on `started_at`, then `id`). */
export interface JobRunsCursor {
  before: string
  beforeId: string
}

/** The active jobs of the caller's org, with schedule, switch and last run. Needs `settings.view`. */
export async function listScheduledJobs(): Promise<ScheduledJob[]> {
  const { data, error } = await supabase.rpc('list_scheduled_jobs')
  if (error) throw error
  return z.array(scheduledJobSchema).parse(data)
}

/** One page of runs of every job, newest first: the newest page for a null cursor. */
export async function listScheduledJobRuns(cursor: JobRunsCursor | null): Promise<JobRun[]> {
  const { data, error } = await supabase.rpc('list_scheduled_job_runs', {
    p_limit: JOB_RUNS_PAGE_SIZE,
    ...(cursor && { p_before: cursor.before, p_before_id: cursor.beforeId }),
  })
  if (error) throw error
  return z.array(jobRunSchema).parse(data)
}

/** Switches a business job for the caller's org (`settings.manage`; maintenance jobs: P0001). */
export async function setScheduledJobEnabled(key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_scheduled_job_enabled', { p_key: key, p_enabled: enabled })
  if (error) throw error
}

/** Runs a job now for the caller's org (`settings.manage`; at most once per 5 minutes: P0001). */
export async function runScheduledJobNow(key: string): Promise<void> {
  const { error } = await supabase.rpc('run_scheduled_job_now', { p_key: key })
  if (error) throw error
}
