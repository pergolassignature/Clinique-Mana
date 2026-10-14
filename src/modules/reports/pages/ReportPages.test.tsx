import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { cancellationsReport, followUpReport, invoiceReport, paymentReport } from '../test/fixtures'
import { CancellationsPage } from './CancellationsPage'
import { ConsentsReportPage } from './ConsentsReportPage'
import { RevenuePage } from './RevenuePage'

const mocks = vi.hoisted(() => ({
  api: { fetchRevenue: vi.fn(), fetchCancellations: vi.fn(), fetchFollowUp: vi.fn(), fetchConsentsReport: vi.fn() },
  download: vi.fn(),
}))
vi.mock('../api/reports', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/reports')>()), ...mocks.api }))
vi.mock('@/shared/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/csv')>()),
  downloadCsv: mocks.download,
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.reports'

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/rapports/revenus" element={<RevenuePage />} />
          <Route path="/rapports/annulations" element={<CancellationsPage />} />
          <Route path="/rapports/consentements" element={<ConsentsReportPage />} />
        </Routes>,
        { path, access: { access: { ...testAccess, permissions: ['reports.view', 'reports.finance'], modules: ['reports'] } } },
      )}
    </QueryClientProvider>,
  )
}

describe('« Revenus » (RP-2)', () => {
  it('by invoice: the totals, the credited ones apart, the rows; filters from the address', async () => {
    mocks.api.fetchRevenue.mockResolvedValue(invoiceReport)
    renderAt('/rapports/revenus?du=2026-09-01&au=2026-09-30&pro=p1')
    expect(await screen.findByText('2026-1')).toBeInTheDocument()
    expect(mocks.api.fetchRevenue).toHaveBeenCalledWith({
      view: 'invoice', from: '2026-09-01', to: '2026-09-30', professionalId: 'p1', serviceId: null, modeCode: null,
    })
    const figures = screen.getByLabelText(t(`${R}.revenue.totals`)).textContent ?? ''
    expect(figures).toContain('75,00')
    expect(screen.getByText(/créditées, non comptées : 1 \(90,00/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: t(`${R}.revenue.viewLabels.invoice`) })).toHaveAttribute('aria-selected', 'true')
    // The report is the tab's panel (named by its tab), the filters with it.
    const panel = screen.getByRole('tabpanel', { name: t(`${R}.revenue.viewLabels.invoice`) })
    expect(panel).toContainElement(screen.getByText('2026-1'))
    expect(panel).toContainElement(screen.getByRole('button', { name: t(`${R}.export`) }))
  })

  it('« Par paiement »: the mode filter, the truncation said, the export', async () => {
    mocks.api.fetchRevenue.mockResolvedValue(paymentReport)
    renderAt('/rapports/revenus?vue=payment&du=2026-09-01&au=2026-09-30')
    expect(await screen.findByText(t(`${R}.truncated`))).toBeInTheDocument()
    expect(screen.getByLabelText(t(`${R}.revenue.filters.mode`))).toBeInTheDocument()
    // L6: the refund said on its row, the refunded and the net in the totals.
    expect(screen.getByText(t(`${R}.revenue.refund`))).toBeInTheDocument()
    const totals = screen.getByLabelText(t(`${R}.revenue.totals`)).textContent ?? ''
    expect(totals).toContain(t(`${R}.revenue.totalLabels.refunds`, { count: '1' }))
    expect(totals).toContain(t(`${R}.revenue.totalLabels.net`))
    expect(totals).toContain('75,00')
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.export`) }))
    expect(mocks.download).toHaveBeenCalledWith('revenus-par-paiement-2026-09-01-au-2026-09-30.csv', expect.stringContaining('Virement Interac'))
  })

  it('a period longer than a year is said, nothing asked', async () => {
    renderAt('/rapports/revenus?du=2025-01-01&au=2026-09-30')
    expect(await screen.findByText(t(`${R}.period.tooLong`))).toBeInTheDocument()
    expect(mocks.api.fetchRevenue).not.toHaveBeenCalled()
  })
})

describe('« Annulations et absences » and « Clients à relancer » (RP-3, RP-4)', () => {
  it('per reason, then the list with the next appointment', async () => {
    mocks.api.fetchCancellations.mockResolvedValue(cancellationsReport)
    renderAt('/rapports/annulations?du=2026-09-01&au=2026-09-30')
    const byReason = await screen.findByRole('table', { name: t(`${R}.cancellations.byReason`) })
    expect(within(byReason).getByText('Plus requis')).toBeInTheDocument()
    expect(within(byReason).getByText(t(`${R}.cancellations.absent`))).toBeInTheDocument()
    const list = screen.getByRole('table', { name: t(`${R}.cancellations.list`) })
    expect(within(list).getByText(t(`${R}.cancellations.nothingAfter`))).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'Alice Essai' })).toHaveAttribute('href', '/clients/c1')
  })

  it('« Clients à relancer »: the tab in the address, each client linked, exported', async () => {
    mocks.api.fetchFollowUp.mockResolvedValue(followUpReport)
    renderAt('/rapports/annulations?onglet=relancer&du=2026-09-01&au=2026-09-30')
    expect(await screen.findByRole('link', { name: 'Alice Essai' })).toHaveAttribute('href', '/clients/c1')
    expect(mocks.api.fetchCancellations).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.export`) }))
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith('clients-a-relancer-2026-09-01-au-2026-09-30.csv', expect.stringContaining('Alice Essai')),
    )
  })
})

describe('« Consentements » (Clients C5b, CC-19)', () => {
  const report = {
    gaps: [{ consent_key: 'general', consent_name: 'Consentement général', signed: 12, resign: 2, pending: 3, overdue: 1, withdrawn: 1, none: 4 }],
    by_professional: [
      { professional_id: 'p1', professional_name: 'Félix Gauthier', consent_key: 'general', consent_name: 'Consentement général', signed: 7, to_obtain: 2 },
      { professional_id: null, professional_name: null, consent_key: 'general', consent_name: 'Consentement général', signed: 5, to_obtain: 5 },
    ],
    months: [{ month: '2026-09', signed: 6, imported: 300, withdrawn: 1 }],
    delays: [{ consent_key: 'general', consent_name: 'Consentement général', count: 6, average_days: 2.5, median_days: 1 }],
    totals: { clients: 23, signed: 306, withdrawn: 1 },
    options: { professionals: [{ id: 'p1', name: 'Félix Gauthier' }] },
  }

  it('today per consent and per professional, per month, the delay; filters from the address; the CSV', async () => {
    const user = userEvent.setup()
    mocks.api.fetchConsentsReport.mockResolvedValue(report)
    renderAt('/rapports/consentements?du=2026-09-01&au=2026-09-30&pro=p1')
    const gaps = await screen.findByRole('table', { name: t(`${R}.consents.gapsTitle`) })
    expect(within(gaps).getAllByRole('row')[1]).toHaveTextContent('Consentement général1223114')
    expect(mocks.api.fetchConsentsReport).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30', professionalId: 'p1' })
    const pros = screen.getByRole('table', { name: t(`${R}.consents.byProfessionalTitle`) })
    expect(within(pros).getByText(t(`${R}.consents.noProfessional`))).toBeInTheDocument()
    const months = screen.getByRole('table', { name: t(`${R}.consents.monthsTitle`) })
    expect(within(months).getByText('septembre 2026')).toBeInTheDocument()
    const delays = screen.getByRole('table', { name: t(`${R}.consents.delaysTitle`) })
    expect(within(delays).getByText('2,5 j')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${R}.export`) }))
    expect(mocks.download).toHaveBeenCalledWith('consentements-2026-09-01-au-2026-09-30.csv', expect.stringContaining('Consentement général;12;2;3;1;1;4'))
  })
})
