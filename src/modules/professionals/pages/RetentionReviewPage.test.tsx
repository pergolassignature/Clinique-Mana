import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { RetentionReview, ReviewRow } from '../api/compensation'
import { professionalKeys } from '../hooks/keys'
import { setupQueryClient } from '../test/query-client'
import { RetentionReviewPage } from './RetentionReviewPage'

const mocks = vi.hoisted(() => ({
  compensation: { fetchRetentionReview: vi.fn(), recordMonthlySessions: vi.fn(), decideRetention: vi.fn() },
  history: { fetchProfessionalHistory: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/compensation', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/compensation')>()), ...mocks.compensation }))
vi.mock('../api/history', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/history')>()), ...mocks.history }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.professionals.review'
const W = 'modules.professionals.compensation'
const P1 = '00000000-0000-4000-8000-000000009001'
const P2 = '00000000-0000-4000-8000-000000009002'
const P3 = '00000000-0000-4000-8000-000000009003'

const base = {
  titleName: 'Psychologue',
  sessionsBefore: 33.5,
  floorPct: 25,
  increaseDecided: false,
  agreements: 0,
  previousPct: null,
  inForcePct: 28,
  next: null,
  pay: [{ duration: 50 as const, clientPriceCents: 17500, appliedCents: 12600, suggestedCents: 12688 }],
}
/** Un: a gap with September entered; Deux: conforme, nothing entered; Trois: the floor, an increase decided. */
const ROWS: ReviewRow[] = [
  {
    ...base,
    id: P1,
    firstName: 'Paul',
    lastName: 'Un',
    entry: { long: 20, short: 4, adjustment: 0, note: null, updatedAt: '2026-10-02T14:00:00.123456+00:00' },
    sessionsTotal: 55.5,
    applied: { id: 'r1', pct: 28, decision: 'initial', effectiveFrom: '2026-07-01', tierThreshold: 0, note: null },
    suggested: { threshold: 51, pct: 27.5 },
    status: 'gap',
    agreements: 1,
  },
  {
    ...base,
    id: P2,
    firstName: 'Pia',
    lastName: 'Deux',
    entry: null,
    sessionsBefore: 10,
    sessionsTotal: 10,
    applied: { id: 'r2', pct: 30, decision: 'suggested', effectiveFrom: '2026-07-01', tierThreshold: 0, note: null },
    suggested: { threshold: 0, pct: 30 },
    status: 'conforme',
  },
  {
    ...base,
    id: P3,
    firstName: 'Fleur',
    lastName: 'Trois',
    entry: null,
    sessionsBefore: 320,
    sessionsTotal: 320,
    applied: { id: 'r3', pct: 25, decision: 'suggested', effectiveFrom: '2026-10-01', tierThreshold: 301, note: null },
    suggested: { threshold: 301, pct: 25 },
    status: 'floor',
    increaseDecided: true,
  },
]
const review = (month: string, rows = ROWS): RetentionReview => ({ month, on: '2026-10-01', rows })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  mocks.compensation.fetchRetentionReview.mockImplementation(async (month: string) => review(month))
  mocks.history.fetchProfessionalHistory.mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function renderPage() {
  const client = setupQueryClient()
  render(<QueryClientProvider client={client.queryClient}>{renderWithContexts(<RetentionReviewPage />, { path: '/professionnels/revision-mensuelle', access: { access: accessForRole('admin') } })}</QueryClientProvider>)
  return client
}
const list = () => screen.findByRole('list', { name: t(`${R}.listLabel`, { month: 'septembre 2026' }) })
const itemOf = async (name: string) => {
  const items = within(await list()).getAllByRole('listitem')
  const item = items.find((li) => li.textContent?.includes(name))
  if (!item) throw new Error(`no row ${name}`)
  return item
}

describe('RetentionReviewPage (P4-190)', () => {
  it('reads last month in one request and shows the gaps first', async () => {
    renderPage()
    await list()
    expect(mocks.compensation.fetchRetentionReview).toHaveBeenCalledExactlyOnceWith('2026-09-01')
    expect(screen.getByRole('link', { name: 'Paul Un' })).toHaveAttribute('href', `/professionnels/${P1}/remuneration`)
    expect(screen.queryByRole('link', { name: 'Pia Deux' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: t(`${R}.filter`) })).toHaveDisplayValue('Écart à valider (1)')
  })

  it('tints the rows as the sheet: yellow for a gap, green for a decided increase', async () => {
    renderPage()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.filter`) }), 'all')
    expect(await itemOf('Paul Un')).toHaveClass('bg-warning/10')
    expect(await itemOf('Fleur Trois')).toHaveClass('bg-success/10')
    expect(await itemOf('Pia Deux')).not.toHaveClass('bg-warning/10')
    expect(await itemOf('Paul Un')).toHaveTextContent('1 entente(s) particulière(s)')
  })

  it('saves the changed rows in one batch, each with the version read, and refetches', async () => {
    mocks.compensation.recordMonthlySessions.mockResolvedValue(undefined)
    const { invalidated } = renderPage()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.filter`) }), 'all')
    const un = within(await itemOf('Paul Un')).getByRole('textbox', { name: t(`${R}.longLabel`, { name: 'Paul Un' }) })
    await userEvent.clear(un)
    await userEvent.type(un, '24')
    expect(await itemOf('Paul Un')).toHaveTextContent('59,5')
    const deux = within(await itemOf('Pia Deux')).getByRole('textbox', { name: t(`${R}.shortLabel`, { name: 'Pia Deux' }) })
    await userEvent.type(deux, '2')
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.save`) }))
    await waitFor(() =>
      expect(mocks.compensation.recordMonthlySessions).toHaveBeenCalledExactlyOnceWith('2026-09-01', [
        { professionalId: P1, long: 24, short: 4, expectedUpdatedAt: '2026-10-02T14:00:00.123456+00:00' },
        { professionalId: P2, long: 0, short: 2, expectedUpdatedAt: null },
      ]),
    )
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.reviews()))
    expect(invalidated()).toContainEqual(professionalKeys.compensations())
  })

  it('names the professional of a stale refusal and keeps the drafts', async () => {
    mocks.compensation.recordMonthlySessions.mockRejectedValue({ code: 'P0001', message: 'Les séances de ce mois ont été modifiées depuis leur affichage.', hint: 'stale', details: P1 })
    renderPage()
    const un = within(await itemOf('Paul Un')).getByRole('textbox', { name: t(`${R}.longLabel`, { name: 'Paul Un' }) })
    await userEvent.clear(un)
    await userEvent.type(un, '24')
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.save`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${R}.stale`, { name: 'Paul Un' }))
    expect(un).toHaveValue('24')
  })

  it('refuses a fraction before any request', async () => {
    renderPage()
    const un = within(await itemOf('Paul Un')).getByRole('textbox', { name: t(`${R}.longLabel`, { name: 'Paul Un' }) })
    await userEvent.clear(un)
    await userEvent.type(un, '2,5')
    expect(await itemOf('Paul Un')).toHaveTextContent(t(`${W}.validation.sessionsLong`))
    expect(screen.getByRole('button', { name: t(`${R}.save`) })).toHaveAttribute('aria-disabled', 'true')
  })

  it('applies the suggestion for a gap from the first day of the next month', async () => {
    mocks.compensation.decideRetention.mockResolvedValue({ id: 'r4', pct: 27.5, decreased: true })
    renderPage()
    await userEvent.click(within(await itemOf('Paul Un')).getByRole('button', { name: t(`${R}.decisionLabel.suggested`, { name: 'Paul Un' }) }))
    const dialog = screen.getByRole('dialog', { name: t(`${W}.decision.titleFor.suggested`, { name: 'Paul Un' }) })
    expect(within(dialog).getByLabelText(new RegExp(t(`${W}.from`)))).toHaveValue('2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    await waitFor(() =>
      expect(mocks.compensation.decideRetention).toHaveBeenCalledExactlyOnceWith(P1, { decision: 'suggested', pct: null, effectiveFrom: '2026-10-01', note: null }),
    )
  })

  it('reads another month; a future one is not offered', async () => {
    renderPage()
    const month = await screen.findByLabelText(t(`${R}.month`))
    expect(month).toHaveAttribute('max', '2026-10')
    fireEvent.change(month, { target: { value: '2026-08' } })
    await waitFor(() => expect(mocks.compensation.fetchRetentionReview).toHaveBeenCalledWith('2026-08-01'))
    fireEvent.change(month, { target: { value: '2026-12' } })
    expect(mocks.compensation.fetchRetentionReview).not.toHaveBeenCalledWith('2026-12-01')
  })
})
