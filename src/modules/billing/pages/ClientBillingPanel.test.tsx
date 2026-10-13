import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { ClientBilling } from '../api/invoices'
import type { ClientPayerBilling } from '../api/payers'
import { ClientBillingPanel } from './ClientBillingPanel'

const mocks = vi.hoisted(() => ({
  api: { fetchClientBilling: vi.fn(), fetchBillingNames: vi.fn(), createInvoice: vi.fn(), setDefaultPayer: vi.fn(), createManualInvoice: vi.fn() },
  queue: { setSpecialAgreement: vi.fn(), createStatement: vi.fn(), deliverNow: vi.fn() },
  payers: { fetchClientPayersBilling: vi.fn(), setClientPayerOrganisation: vi.fn(), createPayerInvoice: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/invoices', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('../api/queue', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.queue }))
vi.mock('../api/payers', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.payers }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.billing.client'
const CP = 'modules.billing.payers.client'

const PAE: ClientPayerBilling = {
  clientPayerId: 'cp2',
  kind: 'pae',
  organisationName: 'Fournisseur X',
  fileNumber: 'PAE-9',
  isStub: false,
  organisation: { id: 'o-pae', name: 'Fournisseur X', chosen: false, billingEmail: 'factures@x.test' },
  periodFrom: '2026-04-01',
  periodTo: '2027-03-31',
  usedCents: 26000,
  usedSessions: 3,
  maxAmountCents: 30000,
  maxSessions: null,
  expired: false,
  pendingCents: 8000,
  options: [
    { id: 'o-pae', name: 'Fournisseur X' },
    { id: 'o-y', name: 'Fournisseur Y' },
  ],
  budgetLow: true,
}
const STUB: ClientPayerBilling = {
  ...PAE,
  clientPayerId: 'cp3',
  kind: 'ivac',
  organisationName: null,
  fileNumber: null,
  isStub: true,
  organisation: { id: 'o-ivac', name: 'IVAC', chosen: false, billingEmail: null },
  periodFrom: null,
  periodTo: null,
  usedCents: 0,
  usedSessions: 0,
  maxAmountCents: null,
  pendingCents: 0,
  options: [{ id: 'o-ivac', name: 'IVAC' }],
  budgetLow: false,
}

const BILLING: ClientBilling = {
  defaultPayerId: 'c1',
  payerOptions: [
    { id: 'c1', name: 'Léa Essai', isSelf: true, relation: null },
    { id: 'c3', name: 'Camille Essai', isSelf: false, relation: 'parent' },
  ],
  specialAgreement: null,
  balanceCents: 17349,
  payments: [],
  statements: [],
  invoices: [
    { id: 'i1', number: '2026-12', status: 'issued', issuedOn: '2026-10-06', totalCents: 17349, paidCents: 0, paymentStatus: 'unpaid', payerId: 'c3', payerKind: 'relation', payerOrganisationName: null, createdAt: '2026-10-06T12:00:00Z' },
  ],
  toInvoice: [{ appointmentId: 'a2', startsAt: '2026-10-07T14:00:00Z', state: 'completed', serviceId: 's50', professionalId: 'p1', firstClient: true }],
}

function open(role: FixtureRole = 'admin_assistant') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/clients/:id/:onglet" element={<ClientBillingPanel />} />
          <Route path="/facturation/factures/:id" element={<p>Page de la facture</p>} />
        </Routes>,
        { path: '/clients/c1/visites', access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.api.fetchClientBilling.mockResolvedValue(BILLING)
  mocks.api.fetchBillingNames.mockResolvedValue({ professionals: new Map([['p1', 'Félix Gauthier']]), services: new Map([['s50', 'Consultation individuelle 50 min']]) })
  mocks.api.createInvoice.mockResolvedValue('i9')
  mocks.api.setDefaultPayer.mockResolvedValue(undefined)
  mocks.queue.setSpecialAgreement.mockResolvedValue(undefined)
  mocks.queue.createStatement.mockResolvedValue('s1')
  mocks.queue.deliverNow.mockResolvedValue({ done: 1, failed: 0 })
  mocks.payers.fetchClientPayersBilling.mockResolvedValue([])
  mocks.payers.setClientPayerOrganisation.mockResolvedValue(undefined)
  mocks.payers.createPayerInvoice.mockResolvedValue('i9')
})
afterEach(() => vi.clearAllMocks())

describe('ClientBillingPanel', () => {
  it('the dossier’s invoices, its default payer, and « Créer la facture » for what is left (it opens the draft)', async () => {
    const user = userEvent.setup()
    open()
    const invoices = await screen.findByRole('list', { name: t(`${C}.invoices`) })
    expect(within(invoices).getByText('2026-12')).toBeInTheDocument()
    expect(within(invoices).getByText(/facturée à Camille Essai/)).toBeInTheDocument()
    const left = screen.getByRole('list', { name: t(`${C}.toInvoiceList`) })
    expect(within(left).getByText(/Félix Gauthier · Consultation individuelle 50 min/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/^Facturé à, par défaut/), 'c3')
    await waitFor(() => expect(mocks.api.setDefaultPayer).toHaveBeenCalledWith('c1', 'c3'))
    await user.click(within(left).getByRole('button', { name: t(`${C}.create`) }))
    await waitFor(() => expect(mocks.api.createInvoice).toHaveBeenCalledWith(['a2']))
    expect(await screen.findByText('Page de la facture')).toBeInTheDocument()
  })

  it('the balance, the « entente particulière » saved, a statement prepared and sent to the chosen payer', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(t(`${C}.balance`, { amount: '173,49 $' }))).toBeInTheDocument()
    const agreement = screen.getByRole('form', { name: t(`${C}.agreement.title`) })
    await user.type(within(agreement).getByLabelText(/^Entente particulière/), 'Tarif convenu')
    await user.click(within(agreement).getByRole('button', { name: t(`${C}.agreement.save`) }))
    await waitFor(() => expect(mocks.queue.setSpecialAgreement).toHaveBeenCalledWith('c1', 'Tarif convenu'))
    await user.selectOptions(screen.getByLabelText(/^Payeur/), 'c3')
    await user.click(screen.getByRole('button', { name: t(`${C}.statement.send`) }))
    await waitFor(() => expect(mocks.queue.createStatement).toHaveBeenCalledWith({ clientId: 'c1', year: expect.any(Number), payerId: 'c3', send: true }))
    await waitFor(() => expect(mocks.queue.deliverNow).toHaveBeenCalled())
  })

  it('« Payeurs tiers » (FP-8): the year\u2019s use, « Budget bas », the organisation billed, a payer invoice by hand', async () => {
    mocks.payers.fetchClientPayersBilling.mockResolvedValue([PAE, STUB])
    const user = userEvent.setup()
    open()
    const section = await screen.findByRole('region', { name: t(`${CP}.title`) })
    expect(within(section).getByText(t(`${CP}.usedOfAmount`, { used: '260,00 $', max: '300,00 $' }))).toBeInTheDocument()
    expect(within(section).getByText(t(`${CP}.budgetLow`))).toBeInTheDocument()
    expect(within(section).getByText(t(`${CP}.pending`, { amount: '80,00 $' }))).toBeInTheDocument()
    // The import's IVAC payer: to complete, no invoice by hand until it is.
    expect(within(section).getByText(t(`${CP}.stub`))).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: /^Nouvelle facture à/ })).toHaveLength(1)
    await user.selectOptions(within(section).getAllByLabelText(/^Organisme facturé/)[0]!, 'o-y')
    await waitFor(() => expect(mocks.payers.setClientPayerOrganisation).toHaveBeenCalledWith('cp2', 'o-y'))
    await user.click(within(section).getByRole('button', { name: t(`${CP}.createInvoice`, { organisation: 'Fournisseur X' }) }))
    await waitFor(() => expect(mocks.payers.createPayerInvoice).toHaveBeenCalledWith('cp2'))
    expect(await screen.findByText('Page de la facture')).toBeInTheDocument()
  })

  it('the conseillère reads: no creation, the payer read-only', async () => {
    open('counselor')
    await screen.findByRole('list', { name: t(`${C}.invoices`) })
    expect(screen.queryByRole('button', { name: t(`${C}.create`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${C}.manual`) })).not.toBeInTheDocument()
  })
})
