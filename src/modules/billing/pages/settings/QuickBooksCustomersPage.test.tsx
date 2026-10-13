import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import type { CustomerMatch, QboSettings } from '../../api/quickbooks'
import { billingManifest } from '../../manifest'
import { QuickBooksCustomersPage } from './QuickBooksCustomersPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchQboSettings: vi.fn(),
    fetchMatchCounts: vi.fn(),
    listMatches: vi.fn(),
    decideMatch: vi.fn(),
    searchClients: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/quickbooks', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/quickbooks')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.billing.qbo.customers'

const SETTINGS: QboSettings = {
  connection: {
    id: 'q1',
    realm_id: '1',
    environment: 'production',
    company_name: 'Clinique Fictive inc.',
    status: 'connected',
    status_reason: null,
    connected_at: '2026-10-13T12:00:00Z',
    connected_by_name: null,
    disconnected_at: null,
    refresh_token_expires_at: null,
    last_sync_at: '2026-10-13T12:05:00Z',
    last_sync_status: 'ok',
    last_error_code: null,
    accounts_synced_at: '2026-10-13T12:05:00Z',
    customers_synced_at: '2026-10-13T12:05:00Z',
  },
  accounts: [],
  map: [],
}

const match = (over: Partial<CustomerMatch> = {}): CustomerMatch => ({
  qbo_id: '58',
  display_name: 'Alice Tremblay',
  email: 'alice@exemple.test',
  phones: [],
  active: true,
  level: 'medium',
  reasons: ['same_name'],
  status: 'to_decide',
  source: 'auto',
  decided_at: null,
  client: null,
  candidates: [{ id: 'c1', client_number: 12, display_name: 'Alice Tremblay', email: null, is_archived: false }],
  ...over,
})

beforeEach(() => {
  mocks.api.fetchQboSettings.mockResolvedValue(SETTINGS)
  mocks.api.fetchMatchCounts.mockResolvedValue({ to_decide: 1, linked: 4, no_match: 2, ignored: 0 })
  mocks.api.listMatches.mockResolvedValue([match()])
  mocks.api.decideMatch.mockResolvedValue('linked')
})
afterEach(() => vi.clearAllMocks())

function renderPage() {
  const section = billingManifest.settingsSections.find((s) => s.id === 'quickbooks_customers')!
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', { permissions: [...ROLE_PERMISSIONS.admin], modules: ['clients', 'services', 'professionals', 'appointments', 'billing'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<QuickBooksCustomersPage />, { section, access: { access }, path: `/parametres/${section.path}` })}
    </QueryClientProvider>,
  )
}

describe('QuickBooksCustomersPage', () => {
  it('shows the customers to decide with their candidate files and the counts per tab', async () => {
    renderPage()
    const list = await screen.findByRole('list', { name: t(`${C}.tabs.to_decide`) })
    expect(within(list).getByText(t(`${C}.reasons.same_name`), { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: new RegExp(t(`${C}.tabs.linked`)) })).toHaveTextContent('4')
    expect(mocks.api.listMatches).toHaveBeenCalledWith('to_decide', '', 0)
  })

  it('links a customer to a candidate file, then says so', async () => {
    const user = userEvent.setup()
    renderPage()
    const list = await screen.findByRole('list', { name: t(`${C}.tabs.to_decide`) })
    await user.click(within(list).getByRole('button', { name: /Alice Tremblay/ }))
    await waitFor(() => expect(mocks.api.decideMatch).toHaveBeenCalledWith('58', { decision: 'link', clientId: 'c1' }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.done.linked`, { customer: 'Alice Tremblay' }))
  })

  it('before the first read: says to synchronise first', async () => {
    mocks.api.fetchQboSettings.mockResolvedValue({ ...SETTINGS, connection: { ...SETTINGS.connection!, customers_synced_at: null } })
    renderPage()
    expect(await screen.findByText(t(`${C}.syncFirst`), { exact: false })).toBeInTheDocument()
    expect(mocks.api.listMatches).not.toHaveBeenCalled()
  })
})
