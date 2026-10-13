import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts, testAccess } from '@/test/contexts'
import type { DemandesReport } from '../api/demandes-report'
import { DemandesReportPage } from './DemandesReportPage'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }))
vi.mock('../api/demandes-report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/demandes-report')>()),
  fetchDemandesReport: mocks.fetch,
}))
vi.mock('@/shared/lib/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/lib/csv')>()), downloadCsv: mocks.download }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const D = 'modules.reports.demandes'

const report: DemandesReport = {
  from: '2026-09-01',
  to: '2026-09-30',
  totals: {
    received: 3, duplicates: 1, matched_activity: 2, activity_rate: 66.7, matched_cohort: 1, cohort_rate: 33.3,
    contacted_on_time: 1, contacted_late: 1, pending: 0, overdue: 0, no_attempt: 1, waitlisted: 1,
  },
  weeks: [
    { week_start: '2026-08-31', received: 1, matched: 2, first_cancelled: 0 },
    { week_start: '2026-09-07', received: 2, matched: 0, first_cancelled: 1 },
  ],
  months: [{ month_start: '2026-09-01', received: 3, matched: 2, first_cancelled: 1 }],
  by_channel: [{ channel: 'phone', received: 2, matched: 1 }, { channel: 'web_form', received: 1, matched: 0 }],
  by_counselor: [{ id: 'u1', name: 'Conseillère A', received: 2 }, { id: null, name: null, received: 1 }],
  outcomes: [{ state: 'closed', closed_reason: 'no_answer', count: 1 }, { state: 'matched', closed_reason: null, count: 2 }],
  by_professional: [{ id: 'p1', name: 'Pro Un', matched: 2 }, { id: null, name: null, matched: 1 }],
  by_professional_week: [{ week_start: '2026-08-31', id: 'p1', name: 'Pro Un', matched: 2 }],
  by_clientele: [{ id: null, name: null, matched: 2 }],
  by_source: [{ id: 's1', name: 'Google', received: 1, matched: 1 }, { id: null, name: null, received: 2, matched: 0 }],
  by_campaign: [],
  by_utm: [{ source: 'facebook', medium: null, other: false, received: 1, matched: 1 }, { source: null, medium: null, other: true, received: 4, matched: 0 }],
  by_referrer: [{ host: 'google.com', other: false, received: 1, matched: 1 }],
  delays: {
    first_contact_hours: { count: 2, median: 37.5, average: 37.5 },
    proposal_days: { count: 0, median: null, average: null },
    match_days: { count: 1, median: 2, average: 2 },
  },
  first_appointments: {
    matched: 2, cancelled: 1, rate: 50, notice_hours: { average: 24, min: 24, max: 24 }, lead_days: { average: 14, min: 14, max: 14 },
    by_reason: [{ name: 'Plus requis', count: 1 }], by_professional: [{ id: 'p1', name: 'Pro Un', count: 1 }],
  },
  waitlist: {
    open: [{ target_kind: 'professional', id: 'p1', name: 'Pro Un', waiting: 1, incomplete: 0, priority: 1 }],
    waiting_total: 1, incomplete_total: 0, registered: 1, exits: [], wait_days: { count: 0, median: null, average: null },
  },
  places: {
    snapshot_on: '2026-09-28', total_left: 1, tracked: 2,
    by_professional: [{ id: 'p1', name: 'Pro Un', declared: 3, left: 0, accepting: true }],
    weeks: [{ week_start: '2026-09-28', snapshot_on: '2026-09-28', total_left: 1 }],
  },
}

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/rapports/demandes" element={<DemandesReportPage />} />
        </Routes>,
        { path, access: { access: { ...testAccess, permissions: ['reports.view'], modules: ['reports', 'demandes'] } } },
      )}
    </QueryClientProvider>,
  )
}

describe('« Indicateurs des demandes » (D6)', () => {
  it('« Activité »: the totals with both rates, the weeks, the channels in plain words', async () => {
    mocks.fetch.mockResolvedValue(report)
    renderAt('/rapports/demandes?du=2026-09-01&au=2026-09-30')
    const totals = await screen.findByLabelText(t(`${D}.sections.totals`))
    expect(totals.textContent).toContain('2 (66,7\u00A0%)')
    expect(totals.textContent).toContain('1 (33,3\u00A0%)')
    expect(mocks.fetch).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' })
    const weeks = screen.getByRole('table', { name: t(`${D}.sections.weeks`) })
    expect(within(weeks).getAllByRole('row')).toHaveLength(3)
    // The period starts on a Tuesday: its first week is cut.
    expect(within(weeks).getByText(/\(partielle\)$/)).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: t(`${D}.sections.months`) })).getByText('Septembre 2026')).toBeInTheDocument()
    const promise = screen.getByRole('table', { name: t(`${D}.sections.promise`) })
    expect(within(promise).getByText(t(`${D}.totals.noAttempt`))).toBeInTheDocument()
    expect(screen.getByText(t(`${D}.totals.duplicatesLine`, { count: '1' }), { exact: false })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: t(`${D}.sections.professionals`) })).getByText(t(`${D}.noProfessional`))).toBeInTheDocument()
    expect(screen.getByRole('table', { name: t(`${D}.sections.professionalsWeeks`) })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: t(`${D}.sections.channels`) })).getByText('Téléphone')).toBeInTheDocument()
    expect(screen.getByText(t(`${D}.noCounselor`))).toBeInTheDocument()
    expect(screen.getByText('Fermée : Sans réponse')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: t(`${D}.tabs.activity`) })).toHaveAttribute('aria-selected', 'true')
  })

  it('« Provenance » (?onglet=provenance): the declared source, utm, referrer; an empty campaign said; exported', async () => {
    mocks.fetch.mockResolvedValue(report)
    renderAt('/rapports/demandes?onglet=provenance&du=2026-09-01&au=2026-09-30')
    const sources = await screen.findByRole('table', { name: t(`${D}.sections.sources`) })
    expect(within(sources).getByText('Google')).toBeInTheDocument()
    expect(within(sources).getByText(t(`${D}.noSource`))).toBeInTheDocument()
    expect(screen.getByText(t(`${D}.noCampaign`))).toBeInTheDocument()
    expect(screen.getByText(`facebook / ${t(`${D}.noUtmMedium`)}`)).toBeInTheDocument()
    expect(screen.getByText(t(`${D}.others`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('modules.reports.export') }))
    expect(mocks.download).toHaveBeenCalledWith(
      'indicateurs-demandes-provenance-2026-09-01-au-2026-09-30.csv',
      expect.stringContaining('Google : reçues;1'),
    )
  })

  it('« Délais et premiers rendez-vous »: medians in business hours and days, the cancellations', async () => {
    mocks.fetch.mockResolvedValue(report)
    renderAt('/rapports/demandes?onglet=delais&du=2026-09-01&au=2026-09-30')
    const delays = await screen.findByRole('table', { name: t(`${D}.sections.delays`) })
    expect(within(delays).getAllByText('1,6 jour ouvrable')).toHaveLength(2)
    expect(within(delays).getAllByText(t(`${D}.noData`))).toHaveLength(2)
    expect(screen.getByLabelText(t(`${D}.sections.firstAppointments`)).textContent).toContain('50,0\u00A0%')
    expect(within(screen.getByRole('table', { name: t(`${D}.sections.firstReasons`) })).getByText('Plus requis')).toBeInTheDocument()
    const ranges = screen.getByRole('table', { name: t(`${D}.sections.firstRanges`) })
    expect(within(ranges).getAllByText('14,0 jours')).toHaveLength(3)
    expect(screen.getByRole('table', { name: t(`${D}.sections.firstWeeks`) })).toBeInTheDocument()
  })

  it('« Liste d\'attente et places »: who waits per list, the last photo of the places', async () => {
    mocks.fetch.mockResolvedValue(report)
    renderAt('/rapports/demandes?onglet=liste-attente&du=2026-09-01&au=2026-09-30')
    expect(await screen.findByText(t(`${D}.waitlist.listKind.professional`, { name: 'Pro Un' }))).toBeInTheDocument()
    expect(screen.getByText(t(`${D}.waitlist.noExit`))).toBeInTheDocument()
    expect(screen.getByText(/Photo du .* : 1 place restante /)).toBeInTheDocument()
  })

  it('Demandes disabled: the database\'s refusal is shown as written', async () => {
    mocks.fetch.mockRejectedValue({ code: 'P0001', message: 'Activez d\'abord Demandes : ce rapport lit ses demandes.', hint: 'module' })
    renderAt('/rapports/demandes?du=2026-09-01&au=2026-09-30')
    expect(await screen.findByText(/Activez d'abord Demandes/)).toBeInTheDocument()
  })
})
