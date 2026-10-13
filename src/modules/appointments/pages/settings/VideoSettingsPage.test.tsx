import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { ScheduledJob } from '@/core/jobs/api'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { appointmentsManifest } from '../../manifest'
import { VideoSettingsPage } from './VideoSettingsPage'

const mocks = vi.hoisted(() => ({
  api: { listProfessionalVideoStatus: vi.fn(), listProfessionalNames: vi.fn(), setProfessionalVideoLink: vi.fn() },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/video', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/video')>()), ...mocks.api }))
vi.mock('@/core/settings/secrets/api', () => mocks.secrets)
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.appointments.video.settings'
const V = 'modules.appointments.video'
const id = (n: number) => `c0000000-0000-0000-0000-00000000000${n}`

const job: ScheduledJob = {
  key: 'appointments.video_sync',
  label: 'Liens Zoom des rendez-vous',
  description: '',
  kind: 'function',
  is_maintenance: false,
  local_hour: null,
  schedule: '*/5 * * * *',
  enabled: false,
  last_started_at: null,
  last_status: null,
  last_detail: null,
}

beforeEach(() => {
  mocks.api.listProfessionalNames.mockResolvedValue([
    { id: id(1), display_name: 'Ana Zoom', status: 'active' },
    { id: id(2), display_name: 'Béa Lien', status: 'active' },
    { id: id(3), display_name: 'Chloé Rien', status: 'active' },
    { id: id(4), display_name: 'Dina Reconnecte', status: 'active' },
    { id: id(5), display_name: 'Éve Inactive', status: 'inactive' },
  ])
  mocks.api.listProfessionalVideoStatus.mockResolvedValue([
    { professional_id: id(1), zoom_state: 'connected', zoom_email: 'ana@zoom.test', zoom_connected_at: '2026-10-13T15:00:00Z', zoom_reconnect_reason: null, fixed_url: null },
    { professional_id: id(2), zoom_state: null, zoom_email: null, zoom_connected_at: null, zoom_reconnect_reason: null, fixed_url: 'https://meet.google.com/abc-defg-hij' },
    { professional_id: id(4), zoom_state: 'needs_reconnect', zoom_email: 'dina@zoom.test', zoom_connected_at: '2026-10-01T15:00:00Z', zoom_reconnect_reason: 'invalid_grant', fixed_url: null },
  ])
  mocks.api.setProfessionalVideoLink.mockResolvedValue(undefined)
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([{ key: 'zoom_client_id', updated_at: '2026-10-13T15:00:00+00:00' }])
  mocks.jobs.listScheduledJobs.mockResolvedValue([job])
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false, role = 'admin' as const } = {}) {
  const section = appointmentsManifest.settingsSections.find((s) => s.id === 'video')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole(role, {
    permissions: [...ROLE_PERMISSIONS[role], 'appointments.view', 'appointments.manage'],
    modules: ['professionals', 'services', 'clients', 'appointments'],
  })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<VideoSettingsPage />, { readOnly, section, access: { access }, path: `/parametres/${section.path}` })}
    </QueryClientProvider>,
  )
}

const row = async (name: string) => (await screen.findByText(name)).closest('li') as HTMLElement

describe('VideoSettingsPage (RZ)', () => {
  it('lists each active professional with her video readiness in plain words, and a summary', async () => {
    renderPage()
    expect(await screen.findByText(t(`${S}.list.summary`, { ready: '2', total: '4' }))).toBeInTheDocument()
    expect(within(await row('Ana Zoom')).getByText(t(`${V}.readiness.zoom`))).toBeInTheDocument()
    expect(within(await row('Ana Zoom')).getByText(/^Compte ana@zoom\.test/)).toBeInTheDocument()
    expect(within(await row('Béa Lien')).getByText(t(`${V}.readiness.fixed`))).toBeInTheDocument()
    expect(within(await row('Béa Lien')).getByText('https://meet.google.com/abc-defg-hij')).toBeInTheDocument()
    expect(within(await row('Chloé Rien')).getByText(t(`${V}.readiness.none`))).toBeInTheDocument()
    expect(within(await row('Dina Reconnecte')).getByText(t(`${V}.readiness.reconnect`))).toBeInTheDocument()
    expect(screen.queryByText('Éve Inactive')).not.toBeInTheDocument()
  })

  it('filters by readiness, with counts', async () => {
    renderPage()
    await row('Ana Zoom')
    await userEvent.click(screen.getByRole('button', { name: t(`${S}.list.filter`, { label: t(`${S}.list.filters.none`), count: '1' }) }))
    expect(screen.getByText('Chloé Rien')).toBeInTheDocument()
    expect(screen.queryByText('Ana Zoom')).not.toBeInTheDocument()
  })

  it('the staff enter a professional\'s fixed link for her', async () => {
    renderPage()
    const chloe = await row('Chloé Rien')
    await userEvent.click(within(chloe).getByRole('button', { name: t(`${S}.list.addFixedFor`, { name: 'Chloé Rien' }) }))
    const field = within(chloe).getByRole('textbox', { name: new RegExp(`^${t(`${V}.fixed.label`)}`) })
    await userEvent.type(field, 'https://teams.microsoft.com/l/meetup-join/abc')
    await userEvent.click(within(chloe).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.setProfessionalVideoLink).toHaveBeenCalledExactlyOnceWith(id(3), 'https://teams.microsoft.com/l/meetup-join/abc'),
    )
  })

  it('read-only: no fixed-link action', async () => {
    renderPage({ readOnly: true })
    await row('Ana Zoom')
    expect(screen.queryByRole('button', { name: t(`${S}.list.addFixedFor`, { name: 'Chloé Rien' }) })).not.toBeInTheDocument()
  })

  it('the Zoom app: its secrets (write-only) and the two addresses to give Zoom', async () => {
    renderPage()
    expect(await screen.findByText(t(`${S}.app.clientId`))).toBeInTheDocument()
    expect(screen.getByText(t(`${S}.app.webhookSecret`))).toBeInTheDocument()
    expect(screen.getByDisplayValue(`${window.location.origin}/mon-agenda/videoconference`)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/\/functions\/v1\/zoom-deauthorize\?org=/)).toBeInTheDocument()
  })
})
