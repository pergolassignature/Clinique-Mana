import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { ScheduledJob } from '@/core/jobs/api'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { communicationsManifest } from '../../manifest'
import { MAILBOX } from '../../test/fixtures'
import { GmailSettingsPage } from './GmailSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    listMailConnections: vi.fn(),
    fetchCommunicationsSettings: vi.fn(),
    saveCommunicationsSettings: vi.fn(),
    startGmailConnect: vi.fn(),
    finishGmailConnect: vi.fn(),
    syncMailConnection: vi.fn(),
    disconnectMailConnection: vi.fn(),
  },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
  leaveFor: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/mailboxes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/mailboxes')>()), ...mocks.api }))
vi.mock('@/core/settings/secrets/api', () => mocks.secrets)
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('../../lib/leave-for', () => ({ leaveFor: mocks.leaveFor }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const G = 'modules.communications.settings.gmail'
const M = `${G}.mailboxes`

const job = (key: string, enabled: boolean): ScheduledJob => ({
  key,
  label: key,
  description: '',
  kind: 'function',
  is_maintenance: false,
  local_hour: null,
  schedule: '*/15 * * * *',
  enabled,
  last_started_at: null,
  last_status: null,
  last_detail: null,
})

const ADMIN = [...ROLE_PERMISSIONS.admin, 'communications.inbox', 'communications.mailboxes_manage']

beforeEach(() => {
  mocks.api.listMailConnections.mockResolvedValue([MAILBOX, { ...MAILBOX, id: 'c2', email_address: 'administration@clinique.test', status: 'needs_reconnect', status_reason: 'invalid_grant' }])
  mocks.api.fetchCommunicationsSettings.mockResolvedValue({ pubsub_topic: null, pubsub_service_account: null })
  mocks.api.saveCommunicationsSettings.mockImplementation(async (patch: object) => ({ pubsub_topic: null, pubsub_service_account: null, ...patch }))
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([
    { key: 'google_oauth_client_id', updated_at: '2026-10-12T15:00:00+00:00' },
    { key: 'google_oauth_client_secret', updated_at: '2026-10-12T15:00:00+00:00' },
  ])
  mocks.jobs.listScheduledJobs.mockResolvedValue([job('communications.gmail_sync', true), job('communications.gmail_watch_renew', false)])
})
afterEach(() => vi.clearAllMocks())

function renderPage(permissions: string[] = ADMIN) {
  const section = communicationsManifest.settingsSections.find((s) => s.id === 'gmail')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { permissions, modules: ['professionals', 'communications'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<GmailSettingsPage />, { section, access: { access }, path: `/parametres/${section.path}` })}
    </QueryClientProvider>,
  )
}

const row = async (email: string) => (await screen.findByText(email)).closest('li') as HTMLElement

describe('GmailSettingsPage', () => {
  it('lists each mailbox with its state in plain words and its counts', async () => {
    renderPage()
    const info = await row('info@clinique.test')
    expect(within(info).getByText(t(`${M}.status.connected`))).toBeInTheDocument()
    expect(within(info).getByText(new RegExp(t(`${M}.threadsOther`, { count: '9' })))).toBeInTheDocument()
    expect(within(info).getByRole('button', { name: t(`${M}.sync`) })).toBeInTheDocument()
    const admin = await row('administration@clinique.test')
    expect(within(admin).getByText(t(`${M}.status.needsReconnect`))).toBeInTheDocument()
    expect(within(admin).getByText(t(`${M}.reason.invalidGrant`))).toBeInTheDocument()
    expect(within(admin).getByRole('button', { name: t(`${M}.reconnect`) })).toBeInTheDocument()
    expect(within(admin).queryByRole('button', { name: t(`${M}.sync`) })).not.toBeInTheDocument()
  })

  it('« Synchroniser » says the outcome beside the button', async () => {
    mocks.api.syncMailConnection.mockResolvedValue({ outcome: 'synced', messages: 3, attachments: 0, initial_pending: false })
    renderPage()
    const info = await row('info@clinique.test')
    await userEvent.click(within(info).getByRole('button', { name: t(`${M}.sync`) }))
    expect(await within(info).findByText(t(`${M}.syncOutcome.doneOther`, { count: '3' }))).toBeInTheDocument()
    expect(mocks.api.syncMailConnection).toHaveBeenCalledWith(MAILBOX.id, undefined)
  })

  it('« Connecter une boîte » leaves for Google; a missing application is said in French', async () => {
    mocks.api.startGmailConnect.mockResolvedValueOnce('https://accounts.google.com/o/oauth2/v2/auth?x=1')
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${M}.connect`) }))
    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledExactlyOnceWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'))
    expect(mocks.api.startGmailConnect).toHaveBeenCalledOnce()

    mocks.api.startGmailConnect.mockRejectedValueOnce(new FunctionCallError('not_configured', 503, 'Google OAuth client is not set'))
    await userEvent.click(screen.getByRole('button', { name: t(`${M}.connect`) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('modules.communications.errors.notConfigured')))
  })

  it('warns when the Google application is not entered yet', async () => {
    mocks.secrets.listOrgSecretKeys.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(t(`${M}.appMissing`))).toBeInTheDocument()
  })

  it('« Déconnecter » asks first, then disconnects', async () => {
    mocks.api.disconnectMailConnection.mockResolvedValue({ revoked: true })
    renderPage()
    const info = await row('info@clinique.test')
    await userEvent.click(within(info).getByRole('button', { name: t(`${M}.disconnect`) }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(t(`${M}.disconnectConfirm.title`, { email: 'info@clinique.test' }))).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${M}.disconnectConfirm.action`) }))
    await waitFor(() => expect(mocks.api.disconnectMailConnection).toHaveBeenCalledExactlyOnceWith(MAILBOX.id))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${M}.disconnected`)))
  })

  it('saves the topic and the service account, refusing malformed ones before the database', async () => {
    renderPage()
    const field = await screen.findByRole('textbox', { name: new RegExp(`^${t(`${G}.topic.label`)}`) })
    await userEvent.type(field, 'mon-sujet')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${G}.topic.invalid`))).toBeInTheDocument()
    expect(mocks.api.saveCommunicationsSettings).not.toHaveBeenCalled()
    await userEvent.clear(field)
    await userEvent.type(field, 'projects/mana-prod/topics/gmail-push')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    const account = screen.getByRole('textbox', { name: new RegExp(`^${t(`${G}.push.account`)}`) })
    await userEvent.type(account, 'not-an-account')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${G}.push.accountInvalid`))).toBeInTheDocument()
    await userEvent.clear(account)
    await userEvent.type(account, 'Gmail-Push@Mana-Prod.iam.gserviceaccount.com')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveCommunicationsSettings).toHaveBeenLastCalledWith({
        pubsub_topic: 'projects/mana-prod/topics/gmail-push',
        pubsub_service_account: 'gmail-push@mana-prod.iam.gserviceaccount.com',
      }),
    )
  })

  it('shows the push address and audience (no secret), and the jobs’ state', async () => {
    renderPage()
    expect(await screen.findByDisplayValue(/gmail-webhook\?org=o1$/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('clinique-mana:gmail-push:o1')).toBeInTheDocument()
    expect(await screen.findByText(t(`${G}.jobs.sync.onNoHour`))).toBeInTheDocument()
    expect(screen.getByText(t(`${G}.jobs.watch.off`))).toBeInTheDocument()
  })

  it('without settings.integrations_manage the Google keys are read only', async () => {
    renderPage(['settings.view', 'communications.inbox', 'communications.mailboxes_manage'])
    expect(await screen.findByText(t(`${G}.app.readOnly`))).toBeInTheDocument()
    expect(screen.queryByText(t(`${G}.jobs.unknown`))).not.toBeInTheDocument()
  })
})
