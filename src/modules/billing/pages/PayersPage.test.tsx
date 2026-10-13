import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { PayerQueueGroup } from '../api/payers'
import { PayersPage } from './PayersPage'

const mocks = vi.hoisted(() => ({
  payers: { fetchPayerQueue: vi.fn(), preparePayerInvoices: vi.fn() },
  queue: { sendInvoices: vi.fn(), deliverNow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('../api/payers', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.payers }))
vi.mock('../api/queue', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.queue }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.billing.payers'

const IVAC: PayerQueueGroup = {
  organisation: { id: 'o-ivac', kind: 'ivac', name: 'IVAC', cadence: 'monthly', billingEmail: 'factures@ivac.test', isActive: true },
  pending: [
    { clientPayerId: 'cp1', clientId: 'c1', clientName: 'Ivan Essai', clientNumber: 12, fileNumber: 'IV-1', sessions: 2, amountCents: 18900, oldest: '2026-09-15', due: true },
  ],
  drafts: [],
  unpaid: { count: 1, balanceCents: 9450 },
}
const PAE: PayerQueueGroup = {
  organisation: { id: 'o-pae', kind: 'pae', name: 'Fournisseur X', cadence: 'threshold', billingEmail: null, isActive: true },
  pending: [
    { clientPayerId: 'cp2', clientId: 'c2', clientName: 'Paula Essai', clientNumber: 13, fileNumber: null, sessions: 1, amountCents: 8000, oldest: '2026-10-01', due: false },
  ],
  drafts: [{ id: 'i7', clientId: 'c3', clientName: 'Rémi Essai', payerReference: 'PAE-9', totalCents: 16000, lines: 2, createdAt: '2026-10-13T12:00:00Z' }],
  unpaid: { count: 0, balanceCents: 0 },
}

function open(role: FixtureRole = 'admin_assistant') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<PayersPage />, { access: { access: accessForRole(role) } })}</QueryClientProvider>)
}

beforeEach(() => {
  mocks.payers.fetchPayerQueue.mockResolvedValue([IVAC, PAE])
  mocks.payers.preparePayerInvoices.mockResolvedValue(['i8'])
  mocks.queue.sendInvoices.mockResolvedValue([{ invoiceId: 'i7', number: '2026-701', error: null }])
  mocks.queue.deliverNow.mockResolvedValue({ done: 1, failed: 0 })
})
afterEach(() => vi.clearAllMocks())

describe('PayersPage', () => {
  it('per organisation: what is to claim (now or later), the drafts, the unpaid; a missing billing address said', async () => {
    open()
    const ivac = await screen.findByRole('region', { name: 'IVAC' })
    const ivacRows = within(within(ivac).getByRole('table', { name: t(`${P}.pendingLabel`, { organisation: 'IVAC' }) })).getAllByRole('row')
    expect(ivacRows[1]).toHaveTextContent('Ivan Essai')
    expect(ivacRows[1]).toHaveTextContent('IV-1')
    expect(ivacRows[1]).toHaveTextContent(t(`${P}.due`))
    expect(within(ivac).getByText(/Factures impayées : 1/)).toBeInTheDocument()

    const pae = screen.getByRole('region', { name: 'Fournisseur X' })
    expect(within(pae).getByText(t(`${P}.noBillingEmail`))).toBeInTheDocument()
    expect(within(pae).getByText(t(`${P}.later.threshold`))).toBeInTheDocument()
    expect(within(pae).getByText(t(`${P}.noFileNumber`))).toBeInTheDocument()
    expect(within(pae).getByRole('link', { name: 'Rémi Essai' })).toHaveAttribute('href', '/facturation/factures/i7')
  })

  it('« Préparer les factures » drafts what is due, by each organisation’s cadence', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: t(`${P}.prepareAll`, { count: '1' }) }))
    await waitFor(() => expect(mocks.payers.preparePayerInvoices).toHaveBeenCalledWith(null, false))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${P}.prepared`, { count: '1' }))
  })

  it('« Facturer les PAE » asks first, then claims every PAE share (never IVAC’s)', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: t(`${P}.closeYear`) }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Fournisseur X')
    await user.click(within(dialog).getByRole('button', { name: t(`${P}.closeConfirm`) }))
    await waitFor(() => expect(mocks.payers.preparePayerInvoices).toHaveBeenCalledTimes(1))
    expect(mocks.payers.preparePayerInvoices).toHaveBeenCalledWith('o-pae', true)
  })

  it('« Tout envoyer » sends an organisation’s drafts', async () => {
    const user = userEvent.setup()
    open()
    const pae = await screen.findByRole('region', { name: 'Fournisseur X' })
    await user.click(within(pae).getByRole('button', { name: t(`${P}.sendAll`, { count: '1' }) }))
    await waitFor(() => expect(mocks.queue.sendInvoices).toHaveBeenCalledWith(['i7']))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${P}.sent`, { count: '1' }))
  })

  it('the conseillère reads, never prepares nor sends', async () => {
    open('counselor')
    await screen.findByRole('region', { name: 'IVAC' })
    expect(screen.queryByRole('button', { name: t(`${P}.prepareAll`, { count: '1' }) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${P}.closeYear`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${P}.send`) })).not.toBeInTheDocument()
  })
})
