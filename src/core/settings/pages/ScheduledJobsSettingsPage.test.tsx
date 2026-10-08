import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { t } from '@/i18n'
import type { JobRun, ScheduledJob } from '@/core/jobs/api'
import type { SettingsSection } from '@/core/modules/types'
import { lazyPage } from '@/shared/lib/lazy-page'
import { renderInSettingsSection } from '@/test/settings-section'
import { ScheduledJobsSettingsPage } from './ScheduledJobsSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    listScheduledJobs: vi.fn(),
    listScheduledJobRuns: vi.fn(),
    setScheduledJobEnabled: vi.fn(),
    runScheduledJobNow: vi.fn(),
    JOB_RUNS_PAGE_SIZE: 2,
  },
  toast: { success: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn() },
}))
vi.mock('@/core/jobs/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => mocks.sentry)

afterEach(() => {
  vi.resetAllMocks()
  mocks.api.JOB_RUNS_PAGE_SIZE = 2
})

const section: SettingsSection = {
  id: 'jobs',
  path: 'taches-planifiees',
  labelKey: 'settings.sections.jobs',
  icon: CalendarClock,
  permission: 'settings.view',
  editPermission: 'settings.manage',
  group: 'plateforme',
  component: lazyPage(async () => ({ default: () => null })),
}

const MAINTENANCE: ScheduledJob = {
  key: 'core.rate_limits_cleanup',
  label: 'Nettoyage des limites de fréquence',
  description: 'Supprime les compteurs de fréquence de plus de 24 heures.',
  kind: 'sql',
  is_maintenance: true,
  local_hour: null,
  schedule: '7 * * * *',
  enabled: true,
  // 08:07 in the clinic (America/Toronto, EDT).
  last_started_at: '2026-10-08T12:07:00Z',
  last_status: 'ok',
  last_detail: 'deleted=3',
}
const BUSINESS: ScheduledJob = {
  key: 'professionals.insurance_expiry_notice',
  label: "Avis d'expiration d'assurance",
  description: "Prévient les professionnels 7 jours avant l'expiration de leur assurance.",
  kind: 'function',
  is_maintenance: false,
  local_hour: 6,
  schedule: '0 * * * *',
  enabled: false,
  last_started_at: '2026-10-07T10:00:00Z',
  last_status: 'error',
  last_detail: 'configuration_missing',
}
const NEVER_RAN: ScheduledJob = {
  ...BUSINESS,
  key: 'core.storage_cleanup',
  label: 'Nettoyage des fichiers',
  local_hour: null,
  schedule: null,
  enabled: true,
  last_started_at: null,
  last_status: null,
  last_detail: null,
}

const run = (overrides: Partial<JobRun>): JobRun => ({
  id: 'r1',
  job_key: MAINTENANCE.key,
  trigger: 'cron',
  status: 'ok',
  started_at: '2026-10-08T12:07:00Z',
  finished_at: '2026-10-08T12:07:01Z',
  detail: 'deleted=3',
  ...overrides,
})
const RUN_1 = run({ id: 'r1' })
const RUN_2 = run({ id: 'r2', job_key: BUSINESS.key, trigger: 'manual', status: 'error', started_at: '2026-10-07T10:00:00Z', detail: '23514' })
const RUN_3 = run({ id: 'r3', status: 'running', started_at: '2026-10-06T12:07:00Z', finished_at: null, detail: null })

function renderPage({ readOnly = false, jobs = [MAINTENANCE, BUSINESS, NEVER_RAN], runs = [[RUN_1, RUN_2], [RUN_3]] } = {}) {
  mocks.api.listScheduledJobs.mockResolvedValue(jobs)
  for (const page of runs) mocks.api.listScheduledJobRuns.mockResolvedValueOnce(page)
  mocks.api.listScheduledJobRuns.mockResolvedValue([])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<ScheduledJobsSettingsPage />, { readOnly, section })}
    </QueryClientProvider>,
  )
}

const jobsTable = () => screen.getByRole('table', { name: t('settings.sections.jobs') })
const runsTable = () => screen.getByRole('table', { name: t('settings.jobs.runs.title') })
const jobRow = (label: string) => within(jobsTable()).getByRole('row', { name: new RegExp(label) })
const loaded = async () => within(await screen.findByRole('table', { name: t('settings.sections.jobs') })).findByText(MAINTENANCE.label)

describe('ScheduledJobsSettingsPage — reading', () => {
  it('loads the jobs and the runs in parallel on mount', () => {
    mocks.api.listScheduledJobs.mockReturnValue(new Promise(() => {}))
    mocks.api.listScheduledJobRuns.mockReturnValue(new Promise(() => {}))
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        {renderInSettingsSection(<ScheduledJobsSettingsPage />, { section })}
      </QueryClientProvider>,
    )
    // Neither has resolved: no waterfall.
    expect(mocks.api.listScheduledJobs).toHaveBeenCalledTimes(1)
    expect(mocks.api.listScheduledJobRuns).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('lists each job: label, schedule in clinic time, last run, status dot and word, last error', async () => {
    renderPage({ readOnly: true })
    await loaded()
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.jobs') })).toBeInTheDocument()

    const maintenance = jobRow(MAINTENANCE.label)
    expect(within(maintenance).getByText(MAINTENANCE.description)).toBeInTheDocument()
    // Its own column, and repeated under the label on a phone.
    expect(within(maintenance).getAllByText('Toutes les heures')).toHaveLength(2)
    expect(within(maintenance).getByText('08 oct. 2026 à 08:07')).toBeInTheDocument()
    expect(within(maintenance).getByText('Réussie')).toBeInTheDocument()

    const business = jobRow(BUSINESS.label)
    // Testing Library reads non-breaking spaces as spaces.
    expect(within(business).getAllByText('Tous les jours à 6 h (heure de la clinique)')).toHaveLength(2)
    expect(within(business).getByText('Erreur')).toBeInTheDocument()
    expect(within(business).getByText('Configuration manquante (voir Mise en service)')).toBeInTheDocument()

    const never = jobRow(NEVER_RAN.label)
    expect(within(never).getAllByText('Non planifiée')).toHaveLength(2)
    expect(within(never).getByText(t('settings.jobs.never'))).toBeInTheDocument()
  })

  it('is read-only with settings.view: the notice, the state as words, no switch, no « Exécuter maintenant »', async () => {
    renderPage({ readOnly: true })
    await loaded()
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(t('settings.jobs.runNow')) })).not.toBeInTheDocument()
    expect(within(jobRow(MAINTENANCE.label)).getByText(t('settings.jobs.alwaysOn'))).toBeInTheDocument()
    expect(within(jobRow(BUSINESS.label)).getByText(t('settings.jobs.disabled'))).toBeInTheDocument()
    expect(within(jobRow(NEVER_RAN.label)).getByText(t('settings.jobs.enabled'))).toBeInTheDocument()
  })

  it('lists the latest runs, newest first, with « Charger plus » until the end', async () => {
    const user = userEvent.setup()
    renderPage({ readOnly: true })
    const runs = await screen.findByRole('table', { name: t('settings.jobs.runs.title') })
    await within(runs).findByText('07 oct. 2026 à 06:00')
    const [first, second] = within(runs).getAllByRole('row').slice(1)
    expect(within(first!).getByText(MAINTENANCE.label)).toBeInTheDocument()
    // The trigger has its own column, and repeats under the job on a phone.
    expect(within(first!).getAllByText('Planifiée')).toHaveLength(2)
    expect(within(second!).getAllByText('Manuelle')).toHaveLength(2)
    expect(within(second!).getByText('Erreur technique (code 23514)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t('settings.jobs.runs.loadMore') }))
    expect(await within(runsTable()).findByText('En cours')).toBeInTheDocument()
    expect(mocks.api.listScheduledJobRuns).toHaveBeenLastCalledWith({ before: RUN_2.started_at, beforeId: RUN_2.id })
    expect(screen.queryByRole('button', { name: t('settings.jobs.runs.loadMore') })).not.toBeInTheDocument()
    expect(screen.getByText(t('settings.jobs.runs.end'))).toBeInTheDocument()
  })

  it('says so when nothing has run yet', async () => {
    renderPage({ runs: [[]] })
    expect(await screen.findByText(t('settings.jobs.runs.empty.title'))).toBeInTheDocument()
  })

  it('offers a retry when the jobs fail to load', async () => {
    mocks.api.listScheduledJobs.mockRejectedValueOnce(new Error('offline'))
    mocks.api.listScheduledJobRuns.mockResolvedValue([])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        {renderInSettingsSection(<ScheduledJobsSettingsPage />, { section })}
      </QueryClientProvider>,
    )
    expect(await screen.findByText(t('settings.jobs.loadError'))).toBeInTheDocument()
    mocks.api.listScheduledJobs.mockResolvedValue([MAINTENANCE])
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await loaded()).toBeInTheDocument()
  })
})

describe('ScheduledJobsSettingsPage — with settings.manage', () => {
  const switchOf = (label: string) => within(jobRow(label)).getByRole('switch')
  const runNowOf = (label: string) => within(jobRow(label)).getByRole('button', { name: t('settings.jobs.runNowLabel', { label }) })

  it('shows no read-only notice', async () => {
    renderPage()
    await loaded()
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
  })

  it('keeps maintenance jobs always on: their switch is disabled', async () => {
    renderPage()
    await loaded()
    expect(switchOf(MAINTENANCE.label)).toBeDisabled()
    expect(switchOf(MAINTENANCE.label)).toBeChecked()
    expect(switchOf(BUSINESS.label)).toBeEnabled()
    expect(switchOf(BUSINESS.label)).not.toBeChecked()
  })

  it('switches a business job once, then confirms with a toast and reloads the list', async () => {
    const user = userEvent.setup()
    mocks.api.setScheduledJobEnabled.mockResolvedValue(undefined)
    renderPage()
    await loaded()
    await user.click(switchOf(BUSINESS.label))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.jobs.enabledToast')))
    expect(mocks.api.setScheduledJobEnabled).toHaveBeenCalledExactlyOnceWith(BUSINESS.key, true)
    expect(mocks.api.listScheduledJobs).toHaveBeenCalledTimes(2)
  })

  it('shows a refusal from the server in a toast', async () => {
    const user = userEvent.setup()
    mocks.api.setScheduledJobEnabled.mockRejectedValue({ code: 'P0001', message: "Les tâches d'entretien restent toujours actives." })
    renderPage()
    await loaded()
    await user.click(switchOf(BUSINESS.label))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Les tâches d'entretien restent toujours actives."))
  })

  it('runs a job now after a confirmation, then reloads the runs', async () => {
    const user = userEvent.setup()
    mocks.api.runScheduledJobNow.mockResolvedValue(undefined)
    renderPage()
    await loaded()
    await within(runsTable()).findByText('07 oct. 2026 à 06:00')
    const runsBefore = mocks.api.listScheduledJobRuns.mock.calls.length

    await user.click(runNowOf(MAINTENANCE.label))
    const dialog = await screen.findByRole('alertdialog')
    // Non-breaking spaces around « » and before « ? » (Testing Library reads them as spaces).
    const title = t('settings.jobs.confirm.title', { label: MAINTENANCE.label })
    expect(title).toBe(`Exécuter «\u00a0${MAINTENANCE.label}\u00a0» maintenant\u00a0?`)
    expect(within(dialog).getByText(title.replace(/\u00a0/g, ' '))).toBeInTheDocument()
    expect(mocks.api.runScheduledJobNow).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: t('settings.jobs.confirm.run') }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.jobs.started')))
    expect(mocks.api.runScheduledJobNow).toHaveBeenCalledExactlyOnceWith(MAINTENANCE.key)
    await waitFor(() => expect(mocks.api.listScheduledJobRuns.mock.calls.length).toBeGreaterThan(runsBefore))
  })

  it('cancels without running', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()
    await user.click(runNowOf(MAINTENANCE.label))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.cancel') }))
    expect(mocks.api.runScheduledJobNow).not.toHaveBeenCalled()
  })

  it('shows the P0001 message of a refused run in a toast', async () => {
    const user = userEvent.setup()
    const message = "Cette tâche vient d'être lancée. Réessayez dans quelques minutes."
    mocks.api.runScheduledJobNow.mockRejectedValue({ code: 'P0001', message })
    renderPage()
    await loaded()
    await user.click(runNowOf(MAINTENANCE.label))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.jobs.confirm.run') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message))
    expect(mocks.sentry.captureException).not.toHaveBeenCalled()
  })

  it('keeps « Exécuter maintenant » focusable but inactive while the job starts', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    mocks.api.runScheduledJobNow.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    renderPage()
    await loaded()
    await user.click(runNowOf(MAINTENANCE.label))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.jobs.confirm.run') }))
    await waitFor(() => expect(runNowOf(MAINTENANCE.label)).toHaveAttribute('aria-disabled', 'true'))
    expect(runNowOf(MAINTENANCE.label)).toBeEnabled()
    await user.click(runNowOf(MAINTENANCE.label))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    finish()
    await waitFor(() => expect(runNowOf(MAINTENANCE.label)).not.toHaveAttribute('aria-disabled'))
  })
})
