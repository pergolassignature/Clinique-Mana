import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { InvoiceBundle } from '../api/invoices'
import { InvoicePage } from './InvoicePage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchInvoice: vi.fn(),
    finalizeInvoice: vi.fn(),
    setInvoicePayer: vi.fn(),
    setLinePrice: vi.fn(),
    addAdjustment: vi.fn(),
    issueCreditNote: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/invoices', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const I = 'modules.billing.invoice'

const bundle = (overrides: Partial<InvoiceBundle['invoice']> = {}): InvoiceBundle => ({
  invoice: {
    id: 'i1',
    number: null,
    status: 'draft',
    clientId: 'c1',
    payerId: 'c1',
    issuedOn: null,
    taxExempt: false,
    gstRate: 0.05,
    qstRate: 0.09975,
    subtotalCents: 16783,
    gstCents: 189,
    qstCents: 377,
    totalCents: 17349,
    notesClient: null,
    notesInternal: null,
    ...overrides,
  },
  client: { id: 'c1', name: 'Léa Essai', clientNumber: 12 },
  payer: { id: 'c1', name: 'Léa Essai' },
  payerOptions: [
    { id: 'c1', name: 'Léa Essai', isSelf: true, relation: null },
    { id: 'c3', name: 'Camille Essai', isSelf: false, relation: 'parent' },
  ],
  lines: [
    {
      id: 'l1', lineType: 'service', appointmentId: 'a1', professionalId: 'p1', serviceCode: 10150, description: 'Consultation individuelle 50 min — 5 octobre 2026',
      quantity: 1, unitPriceCents: 13000, priceSource: 'grid', taxRule: 'exempt', subtotalCents: 13000, gstCents: 0, qstCents: 0, totalCents: 13000,
    },
    {
      id: 'l2', lineType: 'file_opening', appointmentId: null, professionalId: null, serviceCode: 10100, description: 'Ouverture de dossier – individuel',
      quantity: 1, unitPriceCents: 3783, priceSource: 'fixed', taxRule: 'taxable', subtotalCents: 3783, gstCents: 189, qstCents: 377, totalCents: 4349,
    },
    {
      id: 'l3', lineType: 'service', appointmentId: null, professionalId: null, serviceCode: 50400, description: 'Rédaction de rapport',
      quantity: 1, unitPriceCents: null, priceSource: 'entered', taxRule: 'exempt', subtotalCents: 0, gstCents: 0, qstCents: 0, totalCents: 0,
    },
  ],
  creditNote: null,
})

function open(role: FixtureRole = 'admin_assistant') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <Routes>
            <Route path="/facturation/factures/:id" element={<InvoicePage />} />
          </Routes>
        </UnsavedChangesProvider>,
        { path: '/facturation/factures/i1', access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.api.fetchInvoice.mockResolvedValue(bundle())
  mocks.api.finalizeInvoice.mockResolvedValue('2026-601')
  mocks.api.setInvoicePayer.mockResolvedValue(undefined)
  mocks.api.setLinePrice.mockResolvedValue(undefined)
  mocks.api.addAdjustment.mockResolvedValue(undefined)
  mocks.api.issueCreditNote.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('InvoicePage', () => {
  it('a draft: its lines with taxes, the totals the database computed, « Facturé à » among the allowed', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${I}.draftTitle`) })).toBeInTheDocument()
    const lines = screen.getByRole('table', { name: t(`${I}.lines`) })
    expect(within(lines).getByText('Ouverture de dossier – individuel')).toBeInTheDocument()
    expect(within(lines).getByText('5,66 $')).toBeInTheDocument()
    expect(screen.getByText('173,49 $')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/^Facturé à/), 'c3')
    await waitFor(() => expect(mocks.api.setInvoicePayer).toHaveBeenCalledWith('i1', 'c3'))
  })

  it('an amount to type, then « Finaliser » numbers it', async () => {
    const user = userEvent.setup()
    open()
    await user.type(await screen.findByLabelText(t(`${I}.amountFor`, { description: 'Rédaction de rapport' })), '84,00')
    await user.click(screen.getByRole('button', { name: t(`${I}.amountSave`) }))
    await waitFor(() => expect(mocks.api.setLinePrice).toHaveBeenCalledWith('l3', 8400))
    await user.click(screen.getByRole('button', { name: t(`${I}.finalize`) }))
    await waitFor(() => expect(mocks.api.finalizeInvoice).toHaveBeenCalledWith('i1'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${I}.finalized`, { number: '2026-601' }))
  })

  it('an adjustment line', async () => {
    const user = userEvent.setup()
    open()
    const form = await screen.findByRole('form', { name: t(`${I}.adjustment.title`) })
    await user.type(within(form).getByLabelText(/^Description/), 'Déplacement')
    await user.type(within(form).getByLabelText(/^Prix unitaire/), '25')
    await user.click(within(form).getByRole('checkbox', { name: t(`${I}.adjustment.taxable`) }))
    await user.click(within(form).getByRole('button', { name: t(`${I}.adjustment.add`) }))
    await waitFor(() =>
      expect(mocks.api.addAdjustment).toHaveBeenCalledWith({ invoiceId: 'i1', description: 'Déplacement', quantity: 1, unitPriceCents: 2500, taxable: true }),
    )
  })

  it('an issued invoice: not edited, corrected by a credit note with a reason', async () => {
    const user = userEvent.setup()
    mocks.api.fetchInvoice.mockResolvedValue(bundle({ status: 'issued', number: '2026-12', issuedOn: '2026-10-13' }))
    open()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${I}.title`, { number: '2026-12' }) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${I}.finalize`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: t(`${I}.adjustment.title`) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${I}.credit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${I}.creditTitle`) })
    await user.type(within(dialog).getByLabelText(/^Raison/), 'Erreur de payeur')
    await user.click(within(dialog).getByRole('button', { name: t(`${I}.creditSubmit`) }))
    await waitFor(() => expect(mocks.api.issueCreditNote).toHaveBeenCalledWith('i1', 'Erreur de payeur'))
  })

  it('the conseillère reads, never edits', async () => {
    open('counselor')
    expect(await screen.findByRole('heading', { level: 1, name: t(`${I}.draftTitle`) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${I}.finalize`) })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Facturé à/)).not.toBeInTheDocument()
  })
})
