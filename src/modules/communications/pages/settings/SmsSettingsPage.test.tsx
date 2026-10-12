import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { ScheduledJob } from '@/core/jobs/api'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { communicationsManifest } from '../../manifest'
import { SMS_DISPATCH_JOB, SmsSettingsPage } from './SmsSettingsPage'

const mocks = vi.hoisted(() => ({
  settings: { fetchSmsSettings: vi.fn(), saveSmsSettings: vi.fn(), fetchLastYeastarEventAt: vi.fn(), smsWebhookUrl: (org: string) => `http://api.test/functions/v1/sms-webhook?org=${org}` },
  sms: { sendSmsTest: vi.fn() },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/sms-settings', () => mocks.settings)
vi.mock('../../api/sms', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/sms')>()), ...mocks.sms }))
vi.mock('@/core/settings/secrets/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.secrets }))
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.communications.sms.settings'
const SAVED = {
  baseUrl: null,
  clientId: null,
  did: null,
  consentText: 'Vous acceptez de recevoir des textos de la clinique. Répondez ARRÊT pour ne plus en recevoir.',
  optOutReply: 'Vous ne recevrez plus de textos de la clinique.',
}

const job = (enabled: boolean): ScheduledJob => ({
  key: SMS_DISPATCH_JOB,
  label: 'Envoi des textos',
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

beforeEach(() => {
  mocks.settings.fetchSmsSettings.mockResolvedValue(SAVED)
  mocks.settings.saveSmsSettings.mockImplementation(async (patch: object) => ({ ...SAVED, ...patch }))
  mocks.settings.fetchLastYeastarEventAt.mockResolvedValue(null)
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([{ key: 'yeastar_webhook_secret', updated_at: '2027-03-01T15:00:00Z' }])
  mocks.jobs.listScheduledJobs.mockResolvedValue([job(false)])
  mocks.jobs.setScheduledJobEnabled.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ readOnly = false, permissions }: { readOnly?: boolean; permissions?: string[] } = {}) {
  const section = communicationsManifest.settingsSections.find((s) => s.id === 'sms')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { modules: ['communications'], ...(permissions && { permissions }) })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<SmsSettingsPage />, { readOnly, section, access: { access }, path: '/parametres/textos' })}
    </QueryClientProvider>,
  )
}

const field = (label: string) => screen.getByRole('textbox', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}`) })

describe('SmsSettingsPage', () => {
  it('saves the PBX address, the client id and the number (as E.164)', async () => {
    renderPage()
    await screen.findByRole('heading', { name: t(`${S}.pbx.title`) })
    await userEvent.type(field(t(`${S}.pbx.baseUrl`)), 'https://pbx.exemple.com/')
    await userEvent.type(field(t(`${S}.pbx.clientId`)), 'app-id')
    await userEvent.type(field(t(`${S}.pbx.did`)), '418 555-0199')
    const pbx = field(t(`${S}.pbx.baseUrl`)).closest('form')!
    await userEvent.click(within(pbx).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.settings.saveSmsSettings).toHaveBeenCalledExactlyOnceWith({ baseUrl: 'https://pbx.exemple.com', clientId: 'app-id', did: '+14185550199' }),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.saved`))
  })

  it('refuses an address that is not https before any call', async () => {
    renderPage()
    await screen.findByRole('heading', { name: t(`${S}.pbx.title`) })
    await userEvent.type(field(t(`${S}.pbx.baseUrl`)), 'http://pbx.exemple.com')
    const pbx = field(t(`${S}.pbx.baseUrl`)).closest('form')!
    await userEvent.click(within(pbx).getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${S}.pbx.baseUrlInvalid`))).toBeInTheDocument()
    expect(mocks.settings.saveSmsSettings).not.toHaveBeenCalled()
  })

  it('the consent text must keep ARRÊT', async () => {
    renderPage()
    const consent = await screen.findByRole('textbox', { name: new RegExp(`^${t(`${S}.texts.consentText`)}`) })
    await userEvent.clear(consent)
    await userEvent.type(consent, 'Vous recevrez nos rappels de rendez-vous par texto.')
    await userEvent.click(within(consent.closest('form')!).getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${S}.texts.consentNeedsStop`))).toBeInTheDocument()
    expect(mocks.settings.saveSmsSettings).not.toHaveBeenCalled()
  })

  it('the webhook address to paste, the secrets write-only, no event yet', async () => {
    renderPage()
    expect(await screen.findByDisplayValue('http://api.test/functions/v1/sms-webhook?org=o1')).toBeInTheDocument()
    expect(await screen.findByText(t(`${S}.webhook.noEvent`))).toBeInTheDocument()
    expect(screen.getAllByText(t(`${S}.pbx.clientSecret`)).length).toBeGreaterThan(0)
  })

  it('the dispatch job is off: « Activer » for whoever may switch jobs', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.send.jobEnable`) }))
    await waitFor(() => expect(mocks.jobs.setScheduledJobEnabled).toHaveBeenCalledWith(SMS_DISPATCH_JOB, true))
  })

  it('« Envoyer un texto de test » to a typed number', async () => {
    mocks.sms.sendSmsTest.mockResolvedValue({ id: 'm1' })
    renderPage()
    await userEvent.type(await screen.findByRole('textbox', { name: new RegExp(`^${t(`${S}.send.testTo`)}`) }), '514 555-1234')
    await userEvent.click(screen.getByRole('button', { name: t(`${S}.send.test`) }))
    await waitFor(() => expect(mocks.sms.sendSmsTest).toHaveBeenCalledWith('+15145551234'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.send.testSent`))
  })

  it('read-only: no save, no test', async () => {
    renderPage({ readOnly: true })
    await screen.findByRole('heading', { name: t(`${S}.pbx.title`) })
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${S}.send.test`) })).not.toBeInTheDocument()
  })
})
