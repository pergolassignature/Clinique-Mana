import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { MyPayoutPeriod, PayoutLine, PayoutPeriod } from '../api/payroll'
import { MyPayPage } from './MyPayPage'

const mocks = vi.hoisted(() => ({
  api: {
    listMyPayoutPeriods: vi.fn(),
    fetchPayoutPeriod: vi.fn(),
    validatePayoutPeriod: vi.fn(),
    requestPayoutCorrection: vi.fn(),
    generateProfessionalInvoice: vi.fn(),
    uploadProfessionalInvoice: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/payroll', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/payroll')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@/core/storage/hooks', () => ({ useSignedFileUrl: () => ({ data: { url: 'https://files.test/f.pdf' }, isError: false }) }))

const M = 'modules.billing.payroll'
const PERIOD = 'p0000000-0000-0000-0000-000000000001'

const line = (over: Partial<PayoutLine>): PayoutLine => ({
  id: 'l1',
  kind: 'session',
  occurred_on: '2026-09-03',
  paid_on: null,
  client_id: 'c1',
  client_name: 'Alice Essai',
  client_number: 1042,
  service_code: 10150,
  service_name: 'Consultation individuelle 50 min',
  duration: 50,
  base_cents: 17500,
  retention_pct: 28,
  amount_cents: 12600,
  pricing: 'grid',
  note: null,
  late: false,
  ...over,
})

const period = (over: Partial<PayoutPeriod> = {}): PayoutPeriod => ({
  id: PERIOD,
  month: '2026-09-01',
  state: 'to_validate',
  professional: { professional_id: 'pro1', display_name: 'Pro Un', title_label: 'Psychologue' },
  title_name: 'Psychologue',
  lines_count: 3,
  unpriced_count: 0,
  total_cents: 34600,
  built_at: '2026-10-01T11:15:00Z',
  sent_at: '2026-10-01T14:00:00Z',
  correction_note: null,
  correction_requested_at: null,
  validated_at: null,
  reopen_reason: null,
  paid_on: null,
  payment_note: null,
  lines: [
    line({}),
    line({ id: 'l2', occurred_on: '2026-08-29', late: true, amount_cents: 12600 }),
    line({ id: 'l3', kind: 'other_fees', service_code: 50400, service_name: 'Rédaction de rapport', base_cents: 10000, retention_pct: 15, amount_cents: 8500, duration: null }),
  ],
  invoice: null,
  ...over,
})

const mine = (over: Partial<MyPayoutPeriod> = {}): MyPayoutPeriod => ({
  id: PERIOD,
  month: '2026-09-01',
  state: 'to_validate',
  lines_count: 3,
  total_cents: 34600,
  sent_at: '2026-10-01T14:00:00Z',
  validated_at: null,
  paid_on: null,
  has_invoice: false,
  ...over,
})

beforeEach(() => {
  mocks.api.listMyPayoutPeriods.mockResolvedValue([mine()])
  mocks.api.fetchPayoutPeriod.mockResolvedValue(period())
})
afterEach(() => vi.clearAllMocks())

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/ma-paie/:periodId?" element={<MyPayPage />} />
        </Routes>,
        { path },
      )}
    </QueryClientProvider>,
  )
}

describe('MyPayPage (« Ma paie », FPay)', () => {
  it('lists her summaries with their state, total and invoice', async () => {
    mocks.api.listMyPayoutPeriods.mockResolvedValue([mine(), mine({ id: 'p2', month: '2026-08-01', state: 'paid', paid_on: '2026-09-05', has_invoice: true, total_cents: 71100 })])
    renderAt('/ma-paie')
    const table = await screen.findByRole('table', { name: t(`${M}.mine.table`) })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]!).getByRole('link', { name: 'Septembre 2026' })).toHaveAttribute('href', `/ma-paie/${PERIOD}`)
    expect(within(rows[1]!).getByText(t(`${M}.states.to_validate`))).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/346,00/)).toBeInTheDocument()
    expect(within(rows[2]!).getByText(t(`${M}.states.paid`))).toBeInTheDocument()
    expect(within(rows[2]!).getByText(t(`${M}.mine.invoiceAttached`))).toBeInTheDocument()
  })

  it('nothing yet: says when a summary appears', async () => {
    mocks.api.listMyPayoutPeriods.mockResolvedValue([])
    renderAt('/ma-paie')
    expect(await screen.findByText(t(`${M}.mine.emptyTitle`))).toBeInTheDocument()
  })

  it('a summary: her lines (clients, a late one, the report at 15 %) and the total; « Valider le sommaire » after a confirmation', async () => {
    mocks.api.validatePayoutPeriod.mockResolvedValue(undefined)
    renderAt(`/ma-paie/${PERIOD}`)
    const table = await screen.findByRole('table', { name: t(`${M}.lines.table`) })
    expect(within(table).getAllByText('Alice Essai')).toHaveLength(3)
    expect(within(table).getByText(t(`${M}.lines.late`))).toBeInTheDocument()
    expect(within(table).getByText(/15\s%/)).toBeInTheDocument()
    expect(screen.getByText(/346,00/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${M}.period.actions.validate`) }))
    await userEvent.click(await screen.findByRole('button', { name: t(`${M}.period.validateDialog.confirm`) }))
    await waitFor(() => expect(mocks.api.validatePayoutPeriod).toHaveBeenCalledWith(PERIOD))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${M}.period.toasts.validated`))
  })

  it('« Signaler une correction » sends her note', async () => {
    mocks.api.requestPayoutCorrection.mockResolvedValue(undefined)
    renderAt(`/ma-paie/${PERIOD}`)
    await userEvent.click(await screen.findByRole('button', { name: t(`${M}.period.actions.correction`) }))
    await userEvent.type(screen.getByLabelText(new RegExp(t(`${M}.period.correctionDialog.label`))), 'Il manque le 12.')
    await userEvent.click(screen.getByRole('button', { name: t(`${M}.period.correctionDialog.submit`) }))
    await waitFor(() => expect(mocks.api.requestPayoutCorrection).toHaveBeenCalledWith(PERIOD, 'Il manque le 12.'))
  })

  it('a line to complete: validation is held back and said why', async () => {
    mocks.api.fetchPayoutPeriod.mockResolvedValue(period({
      unpriced_count: 1,
      lines: [line({ pricing: 'no_rate', amount_cents: null, retention_pct: null })],
    }))
    renderAt(`/ma-paie/${PERIOD}`)
    expect(await screen.findByText(t(`${M}.lines.unpriced`, { reason: t(`${M}.pricing.no_rate`) }))).toBeInTheDocument()
    const validate = screen.getByRole('button', { name: t(`${M}.period.actions.validate`) })
    expect(validate).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(validate)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('validated: « Générer la facture » with her number and date', async () => {
    mocks.api.fetchPayoutPeriod.mockResolvedValue(period({ state: 'validated', validated_at: '2026-10-02T12:00:00Z' }))
    mocks.api.generateProfessionalInvoice.mockResolvedValue(undefined)
    renderAt(`/ma-paie/${PERIOD}`)
    expect(await screen.findByText(t(`${M}.period.notices.invoiceMissing`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${M}.period.actions.generate`) }))
    const number = screen.getByLabelText(new RegExp(t(`${M}.dialogs.invoice.number`)))
    expect(number).toHaveValue('2026-09')
    await userEvent.clear(number)
    await userEvent.type(number, 'F-17')
    await userEvent.click(screen.getByRole('button', { name: t(`${M}.dialogs.invoice.generate`) }))
    await waitFor(() => expect(mocks.api.generateProfessionalInvoice).toHaveBeenCalledWith(PERIOD, 'F-17', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)))
  })

  it('with her invoice: its number, date and a link to open it', async () => {
    mocks.api.fetchPayoutPeriod.mockResolvedValue(period({
      state: 'validated',
      validated_at: '2026-10-02T12:00:00Z',
      invoice: { id: 'i1', source: 'generated', file_id: 'f1', number: 'F-17', issued_on: '2026-10-02', amount_cents: 34600, created_at: '2026-10-02T12:00:00Z' },
    }))
    renderAt(`/ma-paie/${PERIOD}`)
    expect(await screen.findByText(t(`${M}.period.invoice.summary`, { number: 'F-17', date: '2 octobre 2026' }))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${M}.period.invoice.open`) })).toHaveAttribute('href', 'https://files.test/f.pdf')
  })
})
