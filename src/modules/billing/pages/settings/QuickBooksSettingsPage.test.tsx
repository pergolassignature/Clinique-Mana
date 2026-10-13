import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { ScheduledJob } from '@/core/jobs/api'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import type { QboSettings } from '../../api/quickbooks'
import { billingManifest } from '../../manifest'
import { QuickBooksSettingsPage } from './QuickBooksSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchQboSettings: vi.fn(),
    saveAccountMapRow: vi.fn(),
    startQboConnect: vi.fn(),
    syncQbo: vi.fn(),
    disconnectQbo: vi.fn(),
    listQboPushes: vi.fn(),
    setQboPushPaused: vi.fn(),
    retryQboPush: vi.fn(),
  },
  secrets: { listOrgSecretKeys: vi.fn(), setOrgSecret: vi.fn() },
  jobs: { listScheduledJobs: vi.fn(), setScheduledJobEnabled: vi.fn(), listScheduledJobRuns: vi.fn(), runScheduledJobNow: vi.fn() },
  leaveFor: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/quickbooks', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/quickbooks')>()), ...mocks.api }))
vi.mock('@/core/settings/secrets/api', () => mocks.secrets)
vi.mock('@/core/jobs/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/jobs/api')>()), ...mocks.jobs }))
vi.mock('../../lib/leave-for', () => ({ leaveFor: mocks.leaveFor }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const Q = 'modules.billing.qbo'

const job: ScheduledJob = {
  key: 'billing.qbo_token_refresh',
  label: 'Maintien de la connexion QuickBooks',
  description: '',
  kind: 'function',
  is_maintenance: true,
  local_hour: null,
  schedule: '17 7 * * *',
  enabled: true,
  last_started_at: null,
  last_status: null,
  last_detail: null,
}

const CONNECTED: QboSettings = {
  connection: {
    id: 'q1',
    realm_id: '9341450000000000',
    environment: 'sandbox',
    company_name: 'Clinique Fictive inc.',
    status: 'connected',
    status_reason: null,
    connected_at: '2026-10-13T12:00:00Z',
    connected_by_name: 'Admin Exemple',
    disconnected_at: null,
    refresh_token_expires_at: '2027-01-21T12:00:00Z',
    last_sync_at: '2026-10-13T12:05:00Z',
    last_sync_status: 'ok',
    last_error_code: null,
    accounts_synced_at: '2026-10-13T12:05:00Z',
    customers_synced_at: '2026-10-13T12:05:00Z',
  },
  accounts: [
    { id: '10', name: 'Services', fully_qualified_name: 'Services', acct_num: null, account_type: 'Income' },
    { id: '20', name: 'Virement bancaire à recevoir', fully_qualified_name: 'Virement bancaire à recevoir', acct_num: '1075', account_type: 'Other Current Asset' },
    { id: '23', name: 'Compte courant', fully_qualified_name: 'Compte courant', acct_num: null, account_type: 'Bank' },
  ],
  tax_codes: [{ id: '4', name: 'TPS/TVQ QC - 9,975' }],
  push: { paused: true, pending: 0, failed: 0, pushed: 0, waiting_events: 2 },
  map: [
    { key: 'revenue.services', profession_title_id: null, profession_title_name: null, mode_name: null, account_id: '10', suggested: true },
    { key: 'deposit.interac', profession_title_id: null, profession_title_name: null, mode_name: 'Virement Interac', account_id: '20', suggested: true },
    { key: 'deposit.especes', profession_title_id: null, profession_title_name: null, mode_name: 'Espèces', account_id: null, suggested: false },
  ],
}

const ADMIN = [...ROLE_PERMISSIONS.admin]

beforeEach(() => {
  mocks.api.fetchQboSettings.mockResolvedValue(CONNECTED)
  mocks.api.saveAccountMapRow.mockResolvedValue(undefined)
  mocks.secrets.listOrgSecretKeys.mockResolvedValue([
    { key: 'qbo_client_id', updated_at: '2026-10-13T11:00:00+00:00' },
    { key: 'qbo_client_secret', updated_at: '2026-10-13T11:00:00+00:00' },
  ])
  mocks.jobs.listScheduledJobs.mockResolvedValue([job])
  mocks.api.listQboPushes.mockResolvedValue({
    paused: true,
    pending_events: 2,
    counts: { failed: 1 },
    pushes: [
      {
        id: 'p1', kind: 'payment', entity_id: 'e1', invoice_id: 'i1', invoice_number: '2026-12', status: 'failed', attempts: 8,
        next_attempt_at: '2026-10-13T12:00:00Z', last_error_code: 'missing_map', qbo_id: null, amount_mismatch: false,
        pushed_at: null, updated_at: '2026-10-13T12:00:00Z',
      },
    ],
  })
  mocks.api.setQboPushPaused.mockResolvedValue(undefined)
  mocks.api.retryQboPush.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage(permissions: string[] = ADMIN) {
  const section = billingManifest.settingsSections.find((s) => s.id === 'quickbooks')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { permissions, modules: ['clients', 'services', 'professionals', 'appointments', 'billing'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<QuickBooksSettingsPage />, { section, access: { access }, path: `/parametres/${section.path}` })}
    </QueryClientProvider>,
  )
}

describe('QuickBooksSettingsPage', () => {
  it('shows the connected company, its environment and its state in plain words', async () => {
    renderPage()
    expect(await screen.findByText('Clinique Fictive inc.')).toBeInTheDocument()
    expect(screen.getByText(t(`${Q}.environments.sandbox`))).toBeInTheDocument()
    expect(screen.getByText(t(`${Q}.status.connected`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${Q}.connection.sync`) })).toBeInTheDocument()
  })

  it('lists one deposit row per payment mode, by its own name when the app has no label for it', async () => {
    renderPage()
    expect(await screen.findByLabelText(t(`${Q}.accounts.keys.deposit_interac.label`))).toHaveValue('20')
    const other = screen.getByLabelText(t(`${Q}.accounts.depositOther`, { mode: 'Espèces' }))
    expect(other).toHaveValue('')
    // A deposit row offers bank and current-asset accounts only.
    expect(within(other).queryByRole('option', { name: 'Services' })).not.toBeInTheDocument()
    expect(within(other).getByRole('option', { name: 'Compte courant' })).toBeInTheDocument()
    expect(screen.getByText(t(`${Q}.accounts.missingOne`))).toBeInTheDocument()
  })

  it('saves only the rows changed', async () => {
    const user = userEvent.setup()
    renderPage()
    const other = await screen.findByLabelText(t(`${Q}.accounts.depositOther`, { mode: 'Espèces' }))
    await user.selectOptions(other, '23')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveAccountMapRow).toHaveBeenCalledTimes(1))
    expect(mocks.api.saveAccountMapRow).toHaveBeenCalledWith('deposit.especes', null, '23')
  })

  it('without a connection: « Connecter QuickBooks » opens Intuit', async () => {
    const user = userEvent.setup()
    mocks.api.fetchQboSettings.mockResolvedValue({ ...CONNECTED, connection: null, accounts: [], map: [] })
    mocks.api.startQboConnect.mockResolvedValue('https://appcenter.intuit.com/connect/oauth2?state=x')
    renderPage()
    expect(await screen.findByText(t(`${Q}.status.notConnected`))).toBeInTheDocument()
    expect(screen.getAllByText(t(`${Q}.accounts.connectFirst`)).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: t(`${Q}.connection.connect`) }))
    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledWith('https://appcenter.intuit.com/connect/oauth2?state=x'))
    expect(mocks.api.startQboConnect).toHaveBeenCalledWith('production')
  })

  it('« Envoi à QuickBooks »: paused by default; « Démarrer l’envoi » asks first', async () => {
    const user = userEvent.setup()
    renderPage()
    const P = `${Q}.push`
    expect(await screen.findByText(t(`${P}.paused`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${P}.start`) }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(t(`${P}.startBody`))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t(`${P}.startAction`) }))
    await waitFor(() => expect(mocks.api.setQboPushPaused).toHaveBeenCalledWith(false, expect.anything()))
  })

  it('lists what was refused, why in plain words, with « Réessayer »', async () => {
    const user = userEvent.setup()
    renderPage()
    const P = `${Q}.push`
    const list = await screen.findByRole('list', { name: t(`${P}.openList`) })
    expect(within(list).getByText(t(`${P}.kinds.payment`))).toBeInTheDocument()
    expect(within(list).getByText(new RegExp(t(`${P}.errors.missing_map`).slice(0, 20)))).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: t(`${P}.retry`) }))
    await waitFor(() => expect(mocks.api.retryQboPush).toHaveBeenCalledWith('p1', expect.anything()))
  })

  it('the tax rows choose among the company’s tax codes', async () => {
    mocks.api.fetchQboSettings.mockResolvedValue({
      ...CONNECTED,
      map: [...CONNECTED.map, { key: 'tax.taxable', profession_title_id: null, profession_title_name: null, mode_name: null, account_id: '4', suggested: true }],
    })
    renderPage()
    const select = await screen.findByLabelText(t(`${Q}.accounts.keys.tax_taxable.label`))
    expect(select).toHaveValue('4')
    expect(within(select).getByRole('option', { name: 'TPS/TVQ QC - 9,975' })).toBeInTheDocument()
  })
})
