import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { GridRow, RateRow } from '../../api/compensation'
import { professionalKeys } from '../../hooks/keys'
import { IDS } from '../../test/fixtures'
import { CATALOG } from '../../test/fixtures-domain'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { CompensationSettingsPage } from './CompensationSettingsPage'

const mocks = vi.hoisted(() => ({
  compensation: {
    fetchCompensationKinds: vi.fn(),
    fetchCompensationTerms: vi.fn(),
    setCompensationRate: vi.fn(),
    deleteCompensationRate: vi.fn(),
    setRetentionGrid: vi.fn(),
    deleteRetentionGrid: vi.fn(),
  },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  settings: { fetchProfessionalsSettings: vi.fn(), saveProfessionalsSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/compensation', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/compensation')>()), ...mocks.compensation }))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.catalog }))
vi.mock('../../api/settings', () => mocks.settings)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.professionals.settings.compensation'
const W = 'modules.professionals.compensation'
const KINDS = [
  { key: 'workshop', name: 'Ateliers et conférences' },
  { key: 'late_cancellation', name: 'Annulation tardive' },
]
const OLD = '2026-07-01T00:00:00Z'
const GRIDS: GridRow[] = [
  // Psychologue: the seeded grid, and a coming version created today (deletable).
  {
    id: 'g2',
    titleId: IDS.psychologue,
    effectiveFrom: '2027-01-01',
    effectiveTo: null,
    createdAt: '2026-10-08T15:00:00Z',
    note: null,
    tiers: [
      { threshold: 0, pct: 27 },
      { threshold: 101, pct: 25 },
    ],
    prices: [{ duration: 50, clientPriceCents: 18000 }],
  },
  {
    id: 'g1',
    titleId: IDS.psychologue,
    effectiveFrom: '2026-07-01',
    effectiveTo: '2027-01-01',
    createdAt: OLD,
    note: null,
    tiers: [
      { threshold: 0, pct: 28 },
      { threshold: 51, pct: 27.5 },
      { threshold: 301, pct: 25 },
    ],
    prices: [
      { duration: 60, clientPriceCents: 20000 },
      { duration: 50, clientPriceCents: 17500 },
      { duration: 30, clientPriceCents: 13000 },
    ],
  },
]
const RATES: RateRow[] = [
  { id: 'c1', kind: 'workshop', pct: 25, effectiveFrom: '2026-07-01', effectiveTo: null, createdAt: OLD },
  { id: 'c2', kind: 'late_cancellation', pct: 30, effectiveFrom: '2026-07-01', effectiveTo: null, createdAt: OLD },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.compensation.fetchCompensationKinds.mockResolvedValue(KINDS)
  mocks.compensation.fetchCompensationTerms.mockResolvedValue({ grids: GRIDS, rates: RATES })
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false })
  mocks.settings.saveProfessionalsSettings.mockImplementation(async (patch: { collectSin: boolean }) => ({ collectSin: patch.collectSin }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const render = (permissions?: string[]) => renderProfessionalsSettingsPage(<CompensationSettingsPage />, { sectionId: 'compensation', permissions })
const region = (title: string) => screen.findByRole('region', { name: title })

describe('CompensationSettingsPage — grids (P4-185)', () => {
  it('summarises each active title’s grid in force, says when a title has none, and announces a coming version', async () => {
    render()
    const grids = await region(t(`${S}.grids.title`))
    // jest-dom reads a no-break space as a space.
    expect(grids).toHaveTextContent('PsychologueDe 28 % à 25 % (dès 301 séances) · 60 min / couple 200,00 $ · 50 min 175,00 $ · 30 min 130,00 $')
    expect(grids).toHaveTextContent('Nouvelle version dès le 1 janv. 2027.')
    expect(grids).toHaveTextContent(`Naturopathe${t(`${S}.grids.none`)}`)
    expect(grids).not.toHaveTextContent('Ancien titre')
  })

  it('shows the tiers as the sheet reads them (exact with half sessions), and deletes only the coming version', async () => {
    mocks.compensation.deleteRetentionGrid.mockResolvedValue(undefined)
    render()
    const grids = await region(t(`${S}.grids.title`))
    await userEvent.click(within(grids).getByRole('button', { name: t(`${S}.grids.details`, { count: '2' }) }))
    const table = within(grids).getByRole('table', { name: t(`${S}.grids.tiersLabel`, { title: 'Psychologue', date: '1 juil. 2026' }) })
    expect(within(table).getAllByRole('row').map((row) => row.textContent?.replace(/\u00A0/g, ' '))).toEqual(['Séances cumuléesRetenue', '0 à 50,528 %', '51 à 300,527,5 %', '301 et plus25 %'])
    const deletes = within(grids).getAllByRole('button', { name: /Supprimer la grille/ })
    expect(deletes).toHaveLength(1)
    await userEvent.click(deletes[0] as HTMLElement)
    await userEvent.click(within(screen.getByRole('alertdialog', { name: t(`${S}.grids.deleteTitle`) })).getByRole('button', { name: t(`${W}.delete`) }))
    await waitFor(() => expect(mocks.compensation.deleteRetentionGrid).toHaveBeenCalledExactlyOnceWith('g2'))
  })

  it('starts a new version from the open one and sends it; every professional and review is refetched', async () => {
    mocks.compensation.setRetentionGrid.mockResolvedValue(undefined)
    const { invalidated } = render()
    const grids = await region(t(`${S}.grids.title`))
    await userEvent.click(within(grids).getByRole('button', { name: t(`${S}.grids.newVersionLabel`, { title: 'Psychologue' }) }))
    const dialog = screen.getByRole('dialog', { name: t(`${S}.grids.dialog.title`, { title: 'Psychologue' }) })
    const prices = within(dialog).getByRole('group', { name: t(`${S}.grids.dialog.prices`) })
    expect(within(prices).getByRole('textbox', { name: '50 min' })).toHaveValue('180,00')
    await userEvent.type(within(prices).getByRole('textbox', { name: '30 min' }), '130')
    // The open version starts on 2027-01-01: the next one later.
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t(`${W}.from`))), { target: { value: '2027-07-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.add`) }))
    await waitFor(() =>
      expect(mocks.compensation.setRetentionGrid).toHaveBeenCalledExactlyOnceWith({
        titleId: IDS.psychologue,
        effectiveFrom: '2027-07-01',
        tiers: [
          { threshold: 0, pct: 27 },
          { threshold: 101, pct: 25 },
        ],
        prices: [
          { duration: 50, clientPriceCents: 18000 },
          { duration: 30, clientPriceCents: 13000 },
        ],
        note: null,
      }),
    )
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.compensations()))
    expect(invalidated()).toContainEqual(professionalKeys.reviews())
  })

  it('refuses tiers that would raise the retention, before any request', async () => {
    render()
    const grids = await region(t(`${S}.grids.title`))
    await userEvent.click(within(grids).getByRole('button', { name: t(`${S}.grids.createLabel`, { title: 'Naturopathe' }) }))
    const dialog = screen.getByRole('dialog', { name: t(`${S}.grids.dialog.title`, { title: 'Naturopathe' }) })
    const tiers = within(dialog).getByRole('group', { name: t(`${S}.grids.dialog.tiers`) })
    await userEvent.type(within(tiers).getByRole('textbox', { name: t(`${S}.grids.dialog.retention`, { index: '1' }) }), '30')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${S}.grids.dialog.addTier`) }))
    await userEvent.type(within(tiers).getByRole('textbox', { name: t(`${S}.grids.dialog.threshold`, { index: '2' }) }), '51')
    await userEvent.type(within(tiers).getByRole('textbox', { name: t(`${S}.grids.dialog.retention`, { index: '2' }) }), '31')
    await userEvent.type(within(dialog).getByRole('textbox', { name: '50 min' }), '120')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t(`${W}.from`))), { target: { value: '2026-11-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.add`) }))
    expect(await within(dialog).findByText(t(`${W}.validation.tiersDecreasing`))).toBeInTheDocument()
    expect(mocks.compensation.setRetentionGrid).not.toHaveBeenCalled()
  })
})

describe('CompensationSettingsPage — other kinds (P4-181)', () => {
  it('lists the rates of the other kinds, never offering to delete a kind’s first rate', async () => {
    render()
    const rates = await region(t(`${S}.rates.title`))
    const table = within(rates).getByRole('table', { name: t(`${S}.rates.title`) })
    expect(within(table).getByRole('columnheader', { name: 'Ateliers et conférences' })).toBeInTheDocument()
    expect(table).toHaveTextContent('25 %')
    expect(within(rates).queryByRole('button', { name: /Supprimer le taux/ })).not.toBeInTheDocument()
  })

  it('adds a rate for a kind', async () => {
    mocks.compensation.setCompensationRate.mockResolvedValue(undefined)
    render()
    const rates = await region(t(`${S}.rates.title`))
    await userEvent.click(within(rates).getByRole('button', { name: t(`${S}.rates.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${S}.rates.dialog.title`) })
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'late_cancellation')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(t(`${S}.rates.dialog.rate`).replace(/[()%]/g, '.')) }), '35')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t(`${W}.from`))), { target: { value: '2027-01-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.add`) }))
    await waitFor(() =>
      expect(mocks.compensation.setCompensationRate).toHaveBeenCalledExactlyOnceWith({ kind: 'late_cancellation', pct: 35, effectiveFrom: '2027-01-01' }),
    )
  })
})

describe('CompensationSettingsPage — « Recueillir le NAS »', () => {
  it('asks before turning SIN collection on, and saves only once confirmed', async () => {
    render()
    const card = await region(t(`${S}.sin.title`))
    const toggle = within(card).getByRole('switch', { name: t(`${S}.sin.collect`) })
    await waitFor(() => expect(toggle).not.toHaveAttribute('aria-disabled'))
    await userEvent.click(toggle)
    const confirm = screen.getByRole('alertdialog', { name: t(`${S}.sin.confirmTitle`) })
    expect(confirm).toHaveTextContent(t(`${S}.sin.confirmBody`))
    expect(mocks.settings.saveProfessionalsSettings).not.toHaveBeenCalled()
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.cancel') }))
    expect(mocks.settings.saveProfessionalsSettings).not.toHaveBeenCalled()
    expect(toggle).not.toBeChecked()

    await userEvent.click(toggle)
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t(`${S}.sin.confirm`) }))
    await waitFor(() => expect(mocks.settings.saveProfessionalsSettings).toHaveBeenCalledExactlyOnceWith({ collectSin: true }))
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('turns collection off without asking', async () => {
    mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: true })
    render()
    const card = await region(t(`${S}.sin.title`))
    const toggle = within(card).getByRole('switch', { name: t(`${S}.sin.collect`) })
    await waitFor(() => expect(toggle).toBeChecked())
    await userEvent.click(toggle)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.settings.saveProfessionalsSettings).toHaveBeenCalledExactlyOnceWith({ collectSin: false }))
  })

  it('offers « Réessayer » when the SIN setting cannot be read, never a switch reading « off »', async () => {
    mocks.settings.fetchProfessionalsSettings.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ collectSin: true })
    render()
    const card = await region(t(`${S}.sin.title`))
    expect(await within(card).findByRole('alert')).toHaveTextContent(t(`${S}.sin.loadError`))
    expect(within(card).queryByRole('switch')).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(within(card).getByRole('switch', { name: t(`${S}.sin.collect`) })).toBeChecked())
  })

  it('shows « Renseignements fiscaux » only with professionals.private and professionals.settings', async () => {
    render(['professionals.view', 'professionals.compensation', 'professionals.settings'])
    await region(t(`${S}.grids.title`))
    expect(screen.queryByRole('region', { name: t(`${S}.sin.title`) })).not.toBeInTheDocument()
    expect(mocks.settings.fetchProfessionalsSettings).not.toHaveBeenCalled()
  })
})
