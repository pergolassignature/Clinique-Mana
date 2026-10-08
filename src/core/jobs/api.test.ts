import { afterEach, describe, expect, it, vi } from 'vitest'
import { JOB_RUNS_PAGE_SIZE, listScheduledJobRuns, listScheduledJobs, runScheduledJobNow, setScheduledJobEnabled } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const JOB = {
  key: 'core.rate_limits_cleanup',
  label: 'Nettoyage des limites de fréquence',
  description: 'Supprime les compteurs de fréquence de plus de 24 heures.',
  kind: 'sql',
  is_maintenance: true,
  local_hour: null,
  schedule: '7 * * * *',
  enabled: true,
  last_started_at: '2026-10-08T12:07:00+00:00',
  last_status: 'ok',
  last_detail: 'deleted=3',
}

const RUN = {
  id: 'a0000000-0000-0000-0000-000000000001',
  job_key: 'core.rate_limits_cleanup',
  trigger: 'cron',
  status: 'ok',
  started_at: '2026-10-08T12:07:00+00:00',
  finished_at: '2026-10-08T12:07:01+00:00',
  detail: 'deleted=3',
}

describe('listScheduledJobs', () => {
  it('calls the RPC and keeps the nulls of a job that never ran or has no cron entry', async () => {
    const neverRan = { ...JOB, key: 'professionals.x', is_maintenance: false, local_hour: 6, schedule: null, last_started_at: null, last_status: null, last_detail: null }
    mocks.rpc.mockResolvedValue({ data: [JOB, neverRan], error: null })
    await expect(listScheduledJobs()).resolves.toEqual([JOB, neverRan])
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_scheduled_jobs')
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : settings.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(listScheduledJobs()).rejects.toBe(error)
  })
})

describe('listScheduledJobRuns', () => {
  it('asks for the newest page of every job', async () => {
    mocks.rpc.mockResolvedValue({ data: [RUN], error: null })
    await expect(listScheduledJobRuns(null)).resolves.toEqual([RUN])
    expect(JOB_RUNS_PAGE_SIZE).toBe(20)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_scheduled_job_runs', { p_limit: 20 })
  })

  it('pages on the last row seen: its start and its id', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listScheduledJobRuns({ before: RUN.started_at, beforeId: RUN.id })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_scheduled_job_runs', {
      p_limit: 20,
      p_before: RUN.started_at,
      p_before_id: RUN.id,
    })
  })

  it('accepts a run still going (no end, no detail)', async () => {
    const running = { ...RUN, status: 'running', finished_at: null, detail: null }
    mocks.rpc.mockResolvedValue({ data: [running], error: null })
    await expect(listScheduledJobRuns(null)).resolves.toEqual([running])
  })
})

describe('setScheduledJobEnabled / runScheduledJobNow', () => {
  it('switch a job and run it now', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await setScheduledJobEnabled('professionals.x', false)
    await runScheduledJobNow('core.rate_limits_cleanup')
    expect(mocks.rpc.mock.calls).toEqual([
      ['set_scheduled_job_enabled', { p_key: 'professionals.x', p_enabled: false }],
      ['run_scheduled_job_now', { p_key: 'core.rate_limits_cleanup' }],
    ])
  })

  it('throw the RPC error (the P0001 message is shown as is)', async () => {
    const error = { code: 'P0001', message: "Cette tâche vient d'être lancée. Réessayez dans quelques minutes." }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(runScheduledJobNow('core.rate_limits_cleanup')).rejects.toBe(error)
    await expect(setScheduledJobEnabled('core.rate_limits_cleanup', false)).rejects.toBe(error)
  })
})
