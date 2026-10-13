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
import { RevenuePage } from './RevenuePage'

const mocks = vi.hoisted(() => ({
  api: { fetchRevenue: vi.fn(), fetchCancellations: vi.fn(), fetchFollowUp: vi.fn() },
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
  })

  it('« Par paiement »: the mode filter, the truncation said, the export', async () => {
    mocks.api.fetchRevenue.mockResolvedValue(paymentReport)
    renderAt('/rapports/revenus?vue=payment&du=2026-09-01&au=2026-09-30')
    expect(await screen.findByText(t(`${R}.truncated`))).toBeInTheDocument()
    expect(screen.getByLabelText(t(`${R}.revenue.filters.mode`))).toBeInTheDocument()
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
