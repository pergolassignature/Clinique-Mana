import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { ModuleSlotTargetContext } from '@/core/modules/slots'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { AppointmentBilling } from '../api/invoices'
import { AppointmentBillingPanel } from './AppointmentBillingPanel'

const mocks = vi.hoisted(() => ({
  api: { fetchAppointmentBilling: vi.fn(), createInvoice: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/invoices', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.billing.appointment'

const base: AppointmentBilling = {
  appointment_id: 'e1',
  state: 'completed',
  invoiceable: true,
  lines: [],
  preview: { client_id: 'c1', missing: false, variant_applied: false, subtotal_cents: 17500, tax_cents: null, total_cents: 17500, file_opening: { missing: false, total_cents: 2500 } },
  fee: null,
}

afterEach(() => vi.clearAllMocks())

function renderPanel(data: AppointmentBilling | null, role: FixtureRole = 'admin_assistant') {
  mocks.api.fetchAppointmentBilling.mockResolvedValue(data)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <ModuleSlotTargetContext.Provider value={{ 'appointment.sheet': { appointmentId: 'e1' } }}>
          <Routes>
            <Route path="/agenda" element={<AppointmentBillingPanel />} />
            <Route path="/facturation/factures/:id" element={<p>Page de la facture</p>} />
          </Routes>
        </ModuleSlotTargetContext.Provider>,
        { path: '/agenda', access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

describe('AppointmentBillingPanel (L10)', () => {
  it('not invoiced: the price create_invoice would put, the file opening, « Créer la facture » opens the invoice', async () => {
    mocks.api.createInvoice.mockResolvedValue('i9')
    renderPanel(base)
    expect(await screen.findByText(t(`${A}.notInvoiced`))).toBeInTheDocument()
    expect(screen.getByText(/^Prix prévu : 175,00/)).toBeInTheDocument()
    expect(screen.getByText(/frais d’ouverture de dossier : 25,00/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.create`) }))
    await waitFor(() => expect(mocks.api.createInvoice).toHaveBeenCalledWith(['e1']))
    expect(await screen.findByText('Page de la facture')).toBeInTheDocument()
  })

  it('a price not fixed is said; without billing.manage, no button', async () => {
    renderPanel({ ...base, preview: { ...base.preview!, missing: true, total_cents: null, subtotal_cents: null, file_opening: null } }, 'counselor')
    expect(await screen.findByText(t(`${A}.priceMissing`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${A}.create`) })).not.toBeInTheDocument()
  })

  it('invoiced: its invoice, state, payment and balance, a link; the credited one said', async () => {
    renderPanel({
      ...base,
      invoiceable: false,
      preview: null,
      lines: [
        { line_id: 'l1', line_type: 'service', credited: false, line_total_cents: 17500, invoice_id: 'i2', number: '2026-12', status: 'issued',
          payment_status: 'partial', invoice_total_cents: 17500, paid_cents: 10000, client_id: 'c1', client_name: 'Léa Essai' },
        { line_id: 'l0', line_type: 'service', credited: true, line_total_cents: 17500, invoice_id: 'i1', number: '2026-11', status: 'credited',
          payment_status: 'unpaid', invoice_total_cents: 17500, paid_cents: 0, client_id: 'c1', client_name: 'Léa Essai' },
      ],
    })
    expect(await screen.findByRole('link', { name: t(`${A}.invoice`, { number: '2026-12' }) })).toHaveAttribute('href', '/facturation/factures/i2')
    expect(screen.getByText(/^Solde : 75,00/)).toBeInTheDocument()
    expect(screen.getByText(t(`${A}.credited`, { numbers: '2026-11' }))).toBeInTheDocument()
    expect(screen.queryByText(t(`${A}.notInvoiced`))).not.toBeInTheDocument()
  })

  it('cancelled late: the fee and its decision', async () => {
    renderPanel({
      ...base,
      state: 'cancelled',
      invoiceable: false,
      preview: null,
      fee: { kind: 'late_cancellation', status: 'pending', fee_percent: 50, amount_cents: 8750, invoice_id: null, invoice_number: null },
    })
    expect(await screen.findByText('Annulation tardive · À décider')).toBeInTheDocument()
    expect(screen.getByText(/87,50.*\(50 % de la séance\)/)).toBeInTheDocument()
  })
})
