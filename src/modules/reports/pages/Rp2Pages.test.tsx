import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts, testAccess } from '@/test/contexts'
import type { IvacReport, IvacRow, PayoutsReport } from '../api/rp2'
import { sortIvacRows } from '../lib/rp2'
import { IvacReportPage } from './IvacReportPage'
import { PayoutsReportPage } from './PayoutsReportPage'

const mocks = vi.hoisted(() => ({
  api: { fetchIvacReport: vi.fn(), fetchPayoutsReport: vi.fn() },
  download: vi.fn(),
}))
vi.mock('../api/rp2', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/rp2')>()), ...mocks.api }))
vi.mock('@/shared/lib/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/lib/csv')>()), downloadCsv: mocks.download }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const V = 'modules.reports.ivac'
const P = 'modules.reports.payouts'

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

const row = (over: Partial<IvacRow>): IvacRow => ({
  line_id: 'l1',
  service_on: '2026-09-10',
  by_hand: false,
  client_id: 'c1',
  client_name: 'Anne Ivac',
  client_number: 12,
  file_number: 'IV-1',
  professional_id: 'p1',
  professional_name: 'Hélène Pro',
  professional_ivac_number: 'IVAC-123',
  service_code: 10150,
  service_name: 'Consultation 50 min',
  amount_cents: 9450,
  state: 'claimed',
  client_invoice_id: 'i1',
  client_invoice_number: '2026-10',
  payer_invoice_id: 'i2',
  payer_invoice_number: '2026-11',
  payer_issued_on: '2026-10-01',
  ...over,
})
const zero = { count: 0, amount_cents: 0 }
const ivac: IvacReport = {
  rows: [
    row({}),
    row({ line_id: 'l2', service_on: '2026-09-20', client_name: 'Béa Ivac', file_number: null, state: 'to_claim', payer_invoice_id: null, payer_invoice_number: null }),
    row({ line_id: 'l3', service_on: '2026-09-05', client_name: 'Cléo Ivac', state: 'draft', payer_invoice_number: null, professional_ivac_number: null }),
  ],
  by_state: { to_claim: { count: 1, amount_cents: 9450 }, draft: { count: 1, amount_cents: 9450 }, claimed: { count: 1, amount_cents: 9450 }, partial: zero, paid: zero },
  totals: { count: 3, amount_cents: 28350 },
  truncated: false,
  options: { professionals: [{ id: 'p1', name: 'Hélène Pro' }] },
}
const payouts: PayoutsReport = {
  rows: [
    {
      period_id: 'pp1', month: '2026-09-01', professional_id: 'p1', professional_name: 'Hélène Pro', title_name: 'Psychologue', state: 'paid',
      sessions: 2, session_cents: 12000, late_cancellations: 0, late_cancellation_cents: 0, other_cents: 0, adjustment_cents: 2000,
      total_cents: 14000, unpriced_count: 0, paid_on: '2026-10-05',
    },
    {
      period_id: 'pp2', month: '2026-09-01', professional_id: 'p2', professional_name: 'Marc Pro', title_name: null, state: 'to_validate',
      sessions: 0, session_cents: 0, late_cancellations: 0, late_cancellation_cents: 0, other_cents: 0, adjustment_cents: 0,
      total_cents: 30000, unpriced_count: 1, paid_on: null,
    },
  ],
  by_month: [{ month: '2026-09-01', professionals: 2, sessions: 2, total_cents: 44000, paid_cents: 14000, to_pay_cents: 0, not_validated: 1 }],
  by_professional: [
    { professional_id: 'p1', professional_name: 'Hélène Pro', months: 1, sessions: 2, total_cents: 14000, paid_cents: 14000 },
    { professional_id: 'p2', professional_name: 'Marc Pro', months: 1, sessions: 0, total_cents: 30000, paid_cents: 0 },
  ],
  totals: { periods: 2, sessions: 2, total_cents: 44000, paid_cents: 14000, to_pay_cents: 0, not_validated: 1 },
  truncated: false,
  options: { professionals: [] },
}

function renderAt(path: string, permissions: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/rapports/ivac" element={<IvacReportPage />} />
          <Route path="/rapports/paie" element={<PayoutsReportPage />} />
        </Routes>,
        { path, access: { access: { ...testAccess, permissions, modules: ['reports', 'billing'] } } },
      )}
    </QueryClientProvider>,
  )
}

describe('« IVAC » (RP-8)', () => {
  it('the totals per state, each session with its file, the IVAC number and both invoices; filters from the address', async () => {
    mocks.api.fetchIvacReport.mockResolvedValue(ivac)
    renderAt('/rapports/ivac?du=2026-09-01&au=2026-09-30&etat=claimed', ['reports.finance', 'billing.view'])
    const table = await screen.findByRole('table', { name: t(`${V}.table`) })
    expect(mocks.api.fetchIvacReport).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30', state: 'claimed', professionalId: null })
    const figures = screen.getByLabelText(t(`${V}.totals`)).textContent ?? ''
    expect(figures).toContain('283,50')
    expect(figures).toContain(t(`${V}.totalLabels.state`, { state: t(`${V}.states.to_claim`), count: '1' }))
    const rows = within(table).getAllByRole('row').slice(1)
    // Newest first by default.
    expect(rows.map((r) => within(r).getAllByRole('cell')[1]!.textContent)).toEqual([
      expect.stringContaining('Béa Ivac'),
      expect.stringContaining('Anne Ivac'),
      expect.stringContaining('Cléo Ivac'),
    ])
    expect(rows[0]).toHaveTextContent(t(`${V}.noIvacFile`))
    expect(rows[1]).toHaveTextContent(t(`${V}.ivacFile`, { number: 'IV-1' }))
    expect(rows[1]).toHaveTextContent(t(`${V}.ivacNumber`, { number: 'IVAC-123' }))
    expect(within(rows[1]!).getByRole('link', { name: '2026-11' })).toHaveAttribute('href', '/facturation/factures/i2')
    expect(rows[2]).toHaveTextContent(t(`${V}.noIvacNumber`))
    expect(rows[2]).toHaveTextContent(t(`${V}.draftInvoice`))
  })

  it('sorts by client, and the CSV follows the order shown', async () => {
    const user = userEvent.setup()
    mocks.api.fetchIvacReport.mockResolvedValue(ivac)
    renderAt('/rapports/ivac?du=2026-09-01&au=2026-09-30', ['reports.finance'])
    await screen.findByRole('table', { name: t(`${V}.table`) })
    await user.selectOptions(screen.getByLabelText(t(`${V}.sort.label`)), 'client')
    const rows = within(screen.getByRole('table', { name: t(`${V}.table`) })).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Anne Ivac')
    // Without billing.view, the invoice numbers are plain text.
    expect(within(rows[0]!).queryByRole('link')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('modules.reports.export') }))
    const [fileName, content] = mocks.download.mock.calls[0] as [string, string]
    expect(fileName).toBe('ivac-2026-09-01-au-2026-09-30.csv')
    expect(content.indexOf('Anne Ivac')).toBeLessThan(content.indexOf('Béa Ivac'))
    expect(content).toContain('IVAC-123')
  })

  it('sortIvacRows: oldest first, by professional with the newest first among equals', () => {
    expect(sortIvacRows(ivac.rows, 'date_asc').map((r) => r.line_id)).toEqual(['l3', 'l1', 'l2'])
    expect(sortIvacRows(ivac.rows, 'professional').map((r) => r.line_id)).toEqual(['l2', 'l1', 'l3'])
  })
})

describe('« Paie » (RP-9)', () => {
  it('the totals, per month, per professional and each summary, opened in « Paie » for who runs it', async () => {
    mocks.api.fetchPayoutsReport.mockResolvedValue(payouts)
    renderAt('/rapports/paie?du=2026-09-01&au=2026-09-30', ['reports.payroll', 'billing.payroll'])
    const summaries = await screen.findByRole('table', { name: t(`${P}.rowsTitle`) })
    expect(mocks.api.fetchPayoutsReport).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30', professionalId: null })
    expect(screen.getByLabelText(t(`${P}.totals`)).textContent).toContain('440,00')
    expect(screen.getByRole('table', { name: t(`${P}.byMonthTitle`) })).toHaveTextContent('septembre 2026')
    expect(within(summaries).getByRole('link', { name: 'Hélène Pro' })).toHaveAttribute('href', '/facturation/paie?mois=2026-09&periode=pp1')
    expect(summaries).toHaveTextContent(t(`${P}.states.to_validate`))
    expect(summaries).toHaveTextContent(t(`${P}.unpriced`, { count: '1' }))
  })

  it('no summary: said, with where they are made', async () => {
    mocks.api.fetchPayoutsReport.mockResolvedValue({ ...payouts, rows: [], by_month: [], by_professional: [] })
    renderAt('/rapports/paie?du=2026-09-01&au=2026-09-30', ['reports.payroll'])
    expect(await screen.findByText(t(`${P}.empty`))).toBeInTheDocument()
  })
})
