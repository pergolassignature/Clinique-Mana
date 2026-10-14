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
  queue: { sendInvoices: vi.fn(), recordPayment: vi.fn(), releaseDraft: vi.fn(), resendDocument: vi.fn(), deliverNow: vi.fn() },
  followUp: { refundPayment: vi.fn() },
  stripe: { refundByStripe: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/invoices', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('../api/queue', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.queue }))
vi.mock('../api/follow-up', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.followUp }))
vi.mock('../api/stripe', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.stripe }))
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
    queueDay: null,
    holdReason: null,
    holdNow: null,
    holdNote: null,
    paidCents: 0,
    paymentStatus: 'unpaid',
    pdfFileId: null,
    payerHasEmail: true,
    payerKind: 'client',
    payerReference: null,
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
  payments: [],
  deliveries: [],
  paymentModes: [
    { code: 'interac', name: 'Virement Interac' },
    { code: 'cheque', name: 'Chèque' },
  ],
  reminders: [],
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
  mocks.queue.sendInvoices.mockResolvedValue([{ invoiceId: 'i1', number: '2026-602', error: null }])
  mocks.queue.recordPayment.mockResolvedValue('r1')
  mocks.queue.releaseDraft.mockResolvedValue(undefined)
  mocks.queue.resendDocument.mockResolvedValue(undefined)
  mocks.queue.deliverNow.mockResolvedValue({ done: 1, failed: 0 })
  mocks.followUp.refundPayment.mockResolvedValue('f1')
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

  it('a payer\u2019s share (FP-2): its negative amount under the session, never removed by hand', async () => {
    const base = bundle()
    mocks.api.fetchInvoice.mockResolvedValue({
      ...base,
      lines: [
        base.lines[0]!,
        {
          ...base.lines[0]!,
          id: 'l9',
          lineType: 'payer_share',
          description: 'Part payée par l\u2019IVAC — dossier n° IV-1',
          serviceCode: null,
          unitPriceCents: -9450,
          subtotalCents: -9450,
          totalCents: -9450,
        },
      ],
    })
    open()
    const lines = await screen.findByRole('table', { name: t(`${I}.lines`) })
    expect(within(lines).getAllByText(/94,50/).length).toBeGreaterThan(0)
    expect(within(lines).queryByRole('button', { name: t(`${I}.removeLine`, { description: 'Part payée par l\u2019IVAC — dossier n° IV-1' }) })).not.toBeInTheDocument()
    expect(within(lines).getByRole('button', { name: t(`${I}.removeLine`, { description: base.lines[0]!.description }) })).toBeInTheDocument()
  })

  it('an amount to type, then « Finaliser sans envoyer » numbers it (its PDF, no email)', async () => {
    const user = userEvent.setup()
    open()
    await user.type(await screen.findByLabelText(t(`${I}.amountFor`, { description: 'Rédaction de rapport' })), '84,00')
    await user.click(screen.getByRole('button', { name: t(`${I}.amountSave`) }))
    await waitFor(() => expect(mocks.api.setLinePrice).toHaveBeenCalledWith('l3', 8400))
    await user.click(screen.getByRole('button', { name: t(`${I}.finalizeOnly`) }))
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
    expect(screen.queryByRole('button', { name: t(`${I}.sendFinalize`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: t(`${I}.adjustment.title`) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${I}.credit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${I}.creditTitle`) })
    await user.type(within(dialog).getByLabelText(/^Raison/), 'Erreur de payeur')
    await user.click(within(dialog).getByRole('button', { name: t(`${I}.creditSubmit`) }))
    await waitFor(() => expect(mocks.api.issueCreditNote).toHaveBeenCalledWith('i1', 'Erreur de payeur'))
  })

  it('a payer organisation’s draft (FP-4): the organisation and the file number, never another payer', async () => {
    mocks.api.fetchInvoice.mockResolvedValue({
      ...bundle({ payerKind: 'organisation', payerReference: 'IV-1' }),
      payer: { id: 'o1', name: 'IVAC' },
      payerOptions: [],
    })
    open()
    expect(await screen.findByText('IVAC')).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.payerReference`, { number: 'IV-1' }))).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Facturé à/)).not.toBeInTheDocument()
  })

  it('the conseillère reads, never edits', async () => {
    open('counselor')
    expect(await screen.findByRole('heading', { level: 1, name: t(`${I}.draftTitle`) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${I}.sendFinalize`) })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Facturé à/)).not.toBeInTheDocument()
  })

  it('« Finaliser et envoyer »: numbered and sent at once (the PDF made right after); a refusal is said', async () => {
    const user = userEvent.setup()
    mocks.api.fetchInvoice.mockResolvedValue({ ...bundle(), lines: bundle().lines.slice(0, 2) })
    open()
    await user.click(await screen.findByRole('button', { name: t(`${I}.sendFinalize`) }))
    await waitFor(() => expect(mocks.queue.sendInvoices).toHaveBeenCalledWith(['i1']))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${I}.sentOne`, { number: '2026-602' }))
    await waitFor(() => expect(mocks.queue.deliverNow).toHaveBeenCalled())
    mocks.queue.sendInvoices.mockResolvedValue([{ invoiceId: 'i1', number: null, error: 'Ce brouillon est en attente.' }])
    await user.click(screen.getByRole('button', { name: t(`${I}.sendFinalize`) }))
    expect(await screen.findByText('Ce brouillon est en attente.')).toBeInTheDocument()
  })

  it('a queued draft held for an agreement: the reason, « Remettre dans la file »', async () => {
    const user = userEvent.setup()
    mocks.api.fetchInvoice.mockResolvedValue(
      bundle({ queueDay: '2026-10-13', holdReason: 'special_agreement', holdNow: 'special_agreement', holdNote: 'Tarif convenu' }),
    )
    open()
    expect(await screen.findByText(t(`${I}.held`, { reason: t('modules.billing.queue.holds.special_agreement') }))).toBeInTheDocument()
    expect(screen.getByText('Tarif convenu')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${I}.release`) }))
    await waitFor(() => expect(mocks.queue.releaseDraft).toHaveBeenCalledWith('i1'))
  })

  it('an issued invoice: its email\u2019s outcome, its payments with their receipts, a payment recorded (the balance by default)', async () => {
    const user = userEvent.setup()
    mocks.api.fetchInvoice.mockResolvedValue({
      ...bundle({ status: 'issued', number: '2026-12', issuedOn: '2026-10-13', paidCents: 5000, paymentStatus: 'partial' }),
      deliveries: [
        { id: 'd1', status: 'done', sendEmail: true, emailStatus: 'skipped', skipReason: 'no_email', createdAt: '2026-10-13T12:00:00Z', finishedAt: '2026-10-13T12:01:00Z' },
      ],
      payments: [
        {
          id: 'p1', modeCode: 'interac', mode: 'Virement Interac', amountCents: 5000, paidOn: '2026-10-13', reference: 'CA1234', note: 'Payé par le conjoint',
          receiptId: 'r1', receiptNumber: 'R-2026-1', receiptFileId: null, receiptDeliveries: [], refunds: [], refundableCents: 5000,
        },
      ],
    })
    open()
    expect(await screen.findByText(t('modules.billing.invoice.delivery.no_email'))).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.payments.noteLine`, { note: 'Payé par le conjoint' }))).toBeInTheDocument()
    expect(screen.getByText(t('modules.billing.payment.partial'))).toBeInTheDocument()
    const list = screen.getByRole('list', { name: t(`${I}.payments.list`) })
    expect(within(list).getByText(/R-2026-1/)).toBeInTheDocument()
    const form = screen.getByRole('form', { name: t(`${I}.payments.add`) })
    expect(within(form).getByLabelText(/^Montant/)).toHaveValue('123,49')
    await user.selectOptions(within(form).getByLabelText(/^Mode de paiement/), 'cheque')
    await user.type(within(form).getByLabelText(/^Référence/), '0042')
    await user.type(within(form).getByLabelText(/^Note/), 'Chèque du conjoint')
    await user.click(within(form).getByRole('button', { name: t(`${I}.payments.submit`) }))
    await waitFor(() =>
      expect(mocks.queue.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'i1', modeCode: 'cheque', amountCents: 12349, reference: '0042', note: 'Chèque du conjoint' })),
    )
    // « Rembourser » (F3): what is left of the payment by default, a reason.
    await user.click(within(list).getByRole('button', { name: t(`${I}.payments.refund`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${I}.payments.refundTitle`) })
    expect(within(dialog).getByLabelText(/^Montant à rembourser/)).toHaveValue('50,00')
    await user.type(within(dialog).getByLabelText(/^Raison/), 'Erreur de montant')
    await user.click(within(dialog).getByRole('button', { name: t(`${I}.payments.refundSubmit`) }))
    await waitFor(() => expect(mocks.followUp.refundPayment).toHaveBeenCalledWith('p1', 5000, 'Erreur de montant'))
    // An Interac refund is the clinic's own: Stripe is never asked.
    expect(mocks.stripe.refundByStripe).not.toHaveBeenCalled()
  })

  it('« Rembourser » a Stripe payment: the card refunded at Stripe at once, what Stripe did said (FS-9)', async () => {
    const user = userEvent.setup()
    mocks.followUp.refundPayment.mockResolvedValue('rf1')
    mocks.stripe.refundByStripe.mockResolvedValue('pending')
    mocks.api.fetchInvoice.mockResolvedValue({
      ...bundle({ status: 'issued', number: '2026-12', issuedOn: '2026-10-13', paidCents: 5000, paymentStatus: 'partial' }),
      payments: [
        {
          id: 'p2', modeCode: 'stripe', mode: 'Carte (Stripe)', amountCents: 5000, paidOn: '2026-10-13', reference: null, note: null,
          receiptId: 'r2', receiptNumber: 'R-2026-2', receiptFileId: null, receiptDeliveries: [], refunds: [], refundableCents: 5000,
        },
      ],
    })
    open()
    const list = await screen.findByRole('list', { name: t(`${I}.payments.list`) })
    await user.click(within(list).getByRole('button', { name: t(`${I}.payments.refund`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${I}.payments.refundTitle`) })
    await user.type(within(dialog).getByLabelText(/^Raison/), 'Séance annulée')
    await user.click(within(dialog).getByRole('button', { name: t(`${I}.payments.refundSubmit`) }))
    await waitFor(() => expect(mocks.stripe.refundByStripe).toHaveBeenCalledWith('rf1'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.billing.saved.refundStripe.pending'))
  })

  it('an imported « Note de crédit »: shown with its mode, never « Rembourser » (BI-27)', async () => {
    mocks.api.fetchInvoice.mockResolvedValue({
      ...bundle({ status: 'issued', number: '2025-500', issuedOn: '2025-03-04', paidCents: 10000, paymentStatus: 'partial' }),
      payments: [
        {
          id: 'p3', modeCode: 'credit_note', mode: 'Note de crédit', amountCents: 6000, paidOn: '2025-03-05', reference: null, note: null,
          receiptId: null, receiptNumber: null, receiptFileId: null, receiptDeliveries: [], refunds: [], refundableCents: 6000,
        },
        {
          id: 'p4', modeCode: 'interac', mode: 'Virement Interac', amountCents: 4000, paidOn: '2025-03-04', reference: null, note: null,
          receiptId: null, receiptNumber: null, receiptFileId: null, receiptDeliveries: [], refunds: [], refundableCents: 4000,
        },
      ],
    })
    open()
    const list = await screen.findByRole('list', { name: t(`${I}.payments.list`) })
    const items = within(list).getAllByRole('listitem')
    const credit = items[0]!
    const interac = items[1]!
    expect(within(credit).getByText(/Note de crédit/)).toBeInTheDocument()
    expect(within(credit).queryByRole('button', { name: t(`${I}.payments.refund`) })).not.toBeInTheDocument()
    expect(within(interac).getByRole('button', { name: t(`${I}.payments.refund`) })).toBeInTheDocument()
  })
})
