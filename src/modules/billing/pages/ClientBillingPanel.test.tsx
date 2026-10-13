import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { ClientBilling } from '../api/invoices'
import { ClientBillingPanel } from './ClientBillingPanel'

const mocks = vi.hoisted(() => ({
  api: { fetchClientBilling: vi.fn(), fetchBillingNames: vi.fn(), createInvoice: vi.fn(), setDefaultPayer: vi.fn(), createManualInvoice: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/invoices', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.billing.client'

const BILLING: ClientBilling = {
  defaultPayerId: 'c1',
  payerOptions: [
    { id: 'c1', name: 'Léa Essai', isSelf: true, relation: null },
    { id: 'c3', name: 'Camille Essai', isSelf: false, relation: 'parent' },
  ],
  invoices: [{ id: 'i1', number: '2026-12', status: 'issued', issuedOn: '2026-10-06', totalCents: 17349, payerId: 'c3', createdAt: '2026-10-06T12:00:00Z' }],
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

  it('the conseillère reads: no creation, the payer read-only', async () => {
    open('counselor')
    await screen.findByRole('list', { name: t(`${C}.invoices`) })
    expect(screen.queryByRole('button', { name: t(`${C}.create`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${C}.manual`) })).not.toBeInTheDocument()
  })
})
