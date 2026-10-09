import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  titleLabel: 'Psychologue',
  sessionsBefore: 33.5,
  floorPct: 25,
  increaseDecided: false,
  agreements: 0,
  previousPct: null,
  inForcePct: 28,
  next: null,
  pay: [{ duration: 50 as const, clientPriceCents: 17500, appliedCents: 12600, suggestedCents: 12688, upcomingCents: null }],
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
    next: { threshold: 101, pct: 27 },
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
/** Isa Quatre: no rate yet, 30 % suggested. */
const NO_RATE: ReviewRow = {
  ...base,
  id: '00000000-0000-4000-8000-000000009004',
  firstName: 'Isa',
  lastName: 'Quatre',
  titleLabel: 'Travailleuse sociale',
  entry: null,
  sessionsBefore: 0,
  sessionsTotal: 0,
  applied: null,
  inForcePct: null,
  suggested: { threshold: 0, pct: 30 },
  next: { threshold: 51, pct: 29.5 },
  status: 'no_rate',
  pay: [{ duration: 50, clientPriceCents: 15000, appliedCents: null, suggestedCents: 10500, upcomingCents: null }],
}
const review = (month: string, rows = ROWS): RetentionReview => ({ month, on: '2026-10-01', rows })
const NBSP = '\u00A0'
const pct = (value: string) => `${value}${NBSP}%`
const decide = (action: string, name: string) => ({ name: t(`${R}.decisionFor`, { action, name }) })

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
  it('reads last month in one request and shows what is to decide first, in plain words (P4-197)', async () => {
    renderPage()
    await list()
    expect(mocks.compensation.fetchRetentionReview).toHaveBeenCalledExactlyOnceWith('2026-09-01')
    expect(screen.getByRole('link', { name: 'Paul Un' })).toHaveAttribute('href', `/professionnels/${P1}/remuneration`)
    expect(screen.queryByRole('link', { name: 'Pia Deux' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: t(`${R}.filter`) })).toHaveDisplayValue('À décider (1)')
    expect(screen.getByText('1 écart à valider')).toBeInTheDocument()
    const un = await itemOf('Paul Un')
    // The row is named by the professional; the cells read in words.
    expect(within(await list()).getByRole('listitem', { name: 'Paul Un' })).toBe(un)
    expect(un).toHaveTextContent('55,5 (33,5 + 22)')
    expect(un).toHaveTextContent('33,5 avant + 22 ce mois-ci')
    expect(un).toHaveTextContent('51–100')
    expect(un).toHaveTextContent('51 à 100 séances')
    expect(un).toHaveTextContent('nouveau')
    // jest-dom reads a no-break space as a space.
    expect(un).toHaveTextContent('Passe de 28 % à 27,5 %')
    expect(un).toHaveTextContent(t(`${W}.status.newTier`))
    expect(within(un).getByRole('button', decide(`Appliquer ${pct('27,5')}`, 'Paul Un'))).toHaveTextContent('Appliquer 27,5 %')
    expect(within(un).getByRole('button', decide(`Maintenir ${pct('28')}`, 'Paul Un'))).toBeInTheDocument()
    expect(within(un).getByRole('button', decide('Autre taux…', 'Paul Un'))).toBeInTheDocument()
    // No pay in the table any more: it is in the decision.
    expect(un).not.toHaveTextContent('126,00')
    // The month in French words, between two arrows.
    const month = screen.getByRole('group', { name: t(`${R}.month`) })
    expect(month).toHaveTextContent('septembre 2026')
    expect(within(month).getByRole('button', { name: t(`${R}.monthNext`) })).toBeEnabled()
  })

  it('labels the count fields with the professional and says how a 30-minute session counts', async () => {
    renderPage()
    const un = await itemOf('Paul Un')
    expect(within(un).getByRole('textbox', { name: 'Séances de 50/60 min — Paul Un' })).toHaveValue('20')
    expect(within(un).getByRole('textbox', { name: 'Séances de 30 min — Paul Un' })).toHaveAccessibleDescription('30 min = ½ séance')
    expect(screen.getByText(t(`${R}.legend`))).toBeInTheDocument()
  })

  it('reads a missing rate as « Taux de départ à fixer », never as a gap, and fixes it at the suggestion', async () => {
    mocks.compensation.fetchRetentionReview.mockImplementation(async (month: string) => review(month, [...ROWS, NO_RATE]))
    mocks.compensation.decideRetention.mockResolvedValue({ id: 'r5', pct: 30, decreased: false })
    renderPage()
    const isa = await itemOf('Isa Quatre')
    expect(screen.getByRole('combobox', { name: t(`${R}.filter`) })).toHaveDisplayValue('À décider (2)')
    expect(screen.getByText('1 écart à valider · 1 taux de départ à fixer')).toBeInTheDocument()
    expect(isa).toHaveTextContent(t(`${W}.status.noRate`))
    expect(isa).not.toHaveTextContent(t(`${W}.status.newTier`))
    expect(isa).not.toHaveClass('bg-warning/10')
    expect(isa).toHaveTextContent('Aucun taux · 30 % proposé')
    expect(within(isa).getByRole('button', decide('Autre taux…', 'Isa Quatre'))).toBeInTheDocument()
    await userEvent.click(within(isa).getByRole('button', decide(`Fixer à ${pct('30')}`, 'Isa Quatre')))
    const dialog = screen.getByRole('dialog', { name: `Fixer à ${pct('30')} — Isa Quatre` })
    expect(dialog).toHaveTextContent('Rencontre 50 min : versé 105,00 $')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    await waitFor(() => expect(mocks.compensation.decideRetention).toHaveBeenCalledWith(NO_RATE.id, expect.objectContaining({ decision: 'suggested', pct: null, expectedOpenId: null })))
  })

  it('opens the current month when last month holds only imported opening balances, and marks them', async () => {
    const imported = { long: 0, short: 0, adjustment: 62.5, note: 'Solde importé', updatedAt: '2026-10-02T14:00:00+00:00' }
    mocks.compensation.fetchRetentionReview.mockImplementation(async (month: string) =>
      review(month, [{ ...(ROWS[0] as ReviewRow), entry: month === '2026-09-01' ? imported : null, sessionsBefore: month === '2026-09-01' ? 0 : 62.5 }]),
    )
    renderPage()
    await waitFor(() => expect(mocks.compensation.fetchRetentionReview).toHaveBeenCalledWith('2026-10-01'))
    expect(await screen.findByRole('list', { name: t(`${R}.listLabel`, { month: 'octobre 2026' }) })).toBeInTheDocument()
    // Going back to September shows what the balance is.
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.monthPrevious`) }))
    expect(await itemOf('Paul Un')).toHaveTextContent('Solde importé : 62,5 séances avant le suivi')
  })

  it('keeps last month when it holds sessions besides an imported balance', async () => {
    const imported = { long: 0, short: 0, adjustment: 62.5, note: 'Solde importé', updatedAt: '2026-10-02T14:00:00+00:00' }
    mocks.compensation.fetchRetentionReview.mockImplementation(async (month: string) => review(month, [{ ...(ROWS[0] as ReviewRow), entry: imported }, ROWS[1] as ReviewRow, { ...(ROWS[2] as ReviewRow), entry: { ...imported, long: 3 } }]))
    renderPage()
    await list()
    expect(mocks.compensation.fetchRetentionReview).toHaveBeenCalledExactlyOnceWith('2026-09-01')
  })

  it('tints the rows as the sheet: yellow for a gap, green for a decided increase', async () => {
    renderPage()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.filter`) }), 'all')
    expect(await itemOf('Paul Un')).toHaveClass('bg-warning/10')
    expect(await itemOf('Fleur Trois')).toHaveClass('bg-success/10')
    expect(await itemOf('Fleur Trois')).toHaveTextContent(`${t(`${W}.status.increaseDecided`)}Dès le 1 oct. 2026`)
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

  it('applies the suggestion for a gap from the first day of the next month, showing the pay before and after', async () => {
    mocks.compensation.decideRetention.mockResolvedValue({ id: 'r4', pct: 27.5, decreased: true })
    renderPage()
    await userEvent.click(within(await itemOf('Paul Un')).getByRole('button', decide(`Appliquer ${pct('27,5')}`, 'Paul Un')))
    const dialog = screen.getByRole('dialog', { name: `Appliquer ${pct('27,5')} — Paul Un` })
    expect(dialog).toHaveTextContent('Rencontre 50 min : versé 126,00 $ → devient 126,88 $ (+0,88 $)')
    expect(within(dialog).getByLabelText(new RegExp(t(`${W}.from`)))).toHaveValue('2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    // The count runs through the reviewed month: what is applied is the suggestion shown.
    await waitFor(() =>
      expect(mocks.compensation.decideRetention).toHaveBeenCalledExactlyOnceWith(P1, {
        decision: 'suggested',
        pct: null,
        effectiveFrom: '2026-10-01',
        note: null,
        countMonth: '2026-09-01',
        expectedOpenId: 'r1',
      }),
    )
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Taux de 27,5\u00A0% enregistré : la retenue baisse, une augmentation pour le professionnel.'))
  })

  it('refetches the reviews when a decision is refused', async () => {
    mocks.compensation.decideRetention.mockRejectedValue({ code: 'P0001', message: 'Le taux de ce professionnel a été modifié depuis son affichage.', hint: 'stale' })
    const { invalidated } = renderPage()
    await userEvent.click(within(await itemOf('Paul Un')).getByRole('button', decide(`Appliquer ${pct('27,5')}`, 'Paul Un')))
    const dialog = screen.getByRole('dialog', { name: `Appliquer ${pct('27,5')} — Paul Un` })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t(`${W}.decision.stale`)))
    expect(invalidated()).toContainEqual(professionalKeys.reviews())
  })

  it('reads another month with the arrows; a future one is not offered', async () => {
    renderPage()
    await list()
    const month = screen.getByRole('group', { name: t(`${R}.month`) })
    let release: (value: RetentionReview) => void = () => undefined
    mocks.compensation.fetchRetentionReview.mockImplementationOnce(() => new Promise<RetentionReview>((resolve) => (release = resolve)))
    await userEvent.click(within(month).getByRole('button', { name: t(`${R}.monthPrevious`) }))
    await waitFor(() => expect(mocks.compensation.fetchRetentionReview).toHaveBeenCalledWith('2026-08-01'))
    // While August loads: the loader, never September's rows or « Rien à décider ».
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
    expect(screen.queryByText(t(`${R}.noTodo`, { month: 'septembre 2026' }))).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Paul Un' })).not.toBeInTheDocument()
    release(review('2026-08-01'))
    expect(await screen.findByRole('list', { name: t(`${R}.listLabel`, { month: 'août 2026' }) })).toBeInTheDocument()
    expect(month).toHaveTextContent('août 2026')
    await userEvent.click(within(month).getByRole('button', { name: t(`${R}.monthNext`) }))
    await userEvent.click(within(month).getByRole('button', { name: t(`${R}.monthNext`) }))
    expect(await screen.findByRole('list', { name: t(`${R}.listLabel`, { month: 'octobre 2026' }) })).toBeInTheDocument()
    expect(within(month).getByRole('button', { name: t(`${R}.monthNext`) })).toBeDisabled()
    expect(mocks.compensation.fetchRetentionReview).not.toHaveBeenCalledWith('2026-11-01')
  })

  it('says when nothing is to decide', async () => {
    mocks.compensation.fetchRetentionReview.mockImplementation(async (month: string) => review(month, [ROWS[1] as ReviewRow]))
    renderPage()
    expect(await screen.findByText(t(`${R}.noTodo`, { month: 'septembre 2026' }))).toBeInTheDocument()
  })
})
