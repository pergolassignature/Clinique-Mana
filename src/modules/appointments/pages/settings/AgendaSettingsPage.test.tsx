import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { DEFAULT_AGENDA_SETTINGS } from '../../api/changes'
import { appointmentsManifest } from '../../manifest'
import { AgendaSettingsPage } from './AgendaSettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchAgendaSettings: vi.fn(), saveAgendaSettings: vi.fn() },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/changes', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/core/settings/secrets/api', () => mocks.secrets)
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.appointments.settings'

beforeEach(() => {
  mocks.api.fetchAgendaSettings.mockResolvedValue(DEFAULT_AGENDA_SETTINGS)
  mocks.api.saveAgendaSettings.mockResolvedValue(undefined)
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([{ key: 'google_calendar_client_id', updated_at: '2026-10-13T15:00:00+00:00' }])
  mocks.jobs.listScheduledJobs.mockResolvedValue([
    {
      key: 'appointments.google_busy_sync',
      label: 'Plages occupées des agendas Google',
      description: '',
      kind: 'function',
      is_maintenance: false,
      local_hour: null,
      schedule: '*/15 * * * *',
      enabled: false,
      last_started_at: null,
      last_status: null,
      last_detail: null,
    },
  ])
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false }: { readOnly?: boolean } = {}) {
  const section = appointmentsManifest.settingsSections.find((s) => s.id === 'agenda')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { modules: ['professionals', 'services', 'clients', 'appointments'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<AgendaSettingsPage />, { readOnly, section, access: { access }, path: '/parametres/agenda' })}
    </QueryClientProvider>,
  )
}

describe('AgendaSettingsPage', () => {
  it('Paramètres → Agenda: seen with appointments.view, changed with appointments.settings', () => {
    const section = appointmentsManifest.settingsSections.find((s) => s.id === 'agenda')!
    expect([section.path, section.permission, section.editPermission]).toEqual(['agenda', 'appointments.view', 'appointments.settings'])
  })

  it('the business days and hours, the reminders, the late notice in business hours (on by default, AP-31)', async () => {
    const user = userEvent.setup()
    renderPage()
    const late = await screen.findByRole('checkbox', { name: t(`${S}.lateNotice`) })
    expect(late).toBeChecked()
    expect(screen.getByRole('checkbox', { name: t(`${S}.weekdays.1`) })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: t(`${S}.weekdays.6`) })).not.toBeChecked()
    await user.click(late)
    await user.click(screen.getByRole('checkbox', { name: t(`${S}.weekdays.6`) }))
    const form = late.closest('form')!
    await user.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveAgendaSettings).toHaveBeenCalledExactlyOnceWith({
        ...DEFAULT_AGENDA_SETTINGS,
        businessDays: [1, 2, 3, 4, 5, 6],
        lateNoticeBusinessHours: false,
      }),
    )
  })

  it('at least one business day; an hour out of range is refused before saving', async () => {
    const user = userEvent.setup()
    renderPage()
    const late = await screen.findByRole('checkbox', { name: t(`${S}.lateNotice`) })
    const form = late.closest('form')!
    const hour = within(form).getByRole('textbox', { name: (name) => name.startsWith(t(`${S}.reminderHour`)) })
    await user.clear(hour)
    await user.type(hour, '30')
    await user.click(within(form).getByRole('button', { name: t('common.save') }))
    expect(await within(form).findByText(t(`${S}.invalid`))).toBeInTheDocument()
    await user.clear(hour)
    await user.type(hour, '8')
    for (const d of ['1', '2', '3', '4', '5']) await user.click(screen.getByRole('checkbox', { name: t(`${S}.weekdays.${d}` as `${typeof S}.weekdays.1`) }))
    await user.click(within(form).getByRole('button', { name: t('common.save') }))
    expect(await within(form).findByText(t(`${S}.daysRequired`))).toBeInTheDocument()
    expect(mocks.api.saveAgendaSettings).not.toHaveBeenCalled()
  })

  it('R6 (AP-46): the professionals’ Google agendas — their own application (write-only), the return address, the job', async () => {
    renderPage()
    const G = 'modules.appointments.calendar.settings'
    expect(await screen.findByRole('heading', { name: t(`${G}.title`) })).toBeInTheDocument()
    expect(await screen.findByText(t(`${G}.clientId`))).toBeInTheDocument()
    expect(screen.getByText(t(`${G}.clientSecret`))).toBeInTheDocument()
    expect(screen.getByDisplayValue(`${window.location.origin}/mon-agenda/agenda-google`)).toBeInTheDocument()
    expect(await screen.findByText(t(`${G}.job.off`))).toBeInTheDocument()
  })
})
