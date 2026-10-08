import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { DefaultRangeRow, RecognitionRuleRow } from '../../api/compensation'
import { professionalKeys } from '../../hooks/keys'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { CompensationSettingsPage } from './CompensationSettingsPage'

const mocks = vi.hoisted(() => ({
  compensation: {
    fetchCompensationKinds: vi.fn(),
    fetchCompensationTerms: vi.fn(),
    setCompensationDefault: vi.fn(),
    deleteCompensationDefault: vi.fn(),
    setRecognitionRule: vi.fn(),
    deleteRecognitionRule: vi.fn(),
  },
  settings: { fetchProfessionalsSettings: vi.fn(), saveProfessionalsSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/compensation', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/compensation')>()), ...mocks.compensation }))
vi.mock('../../api/settings', () => mocks.settings)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.professionals.settings.compensation'
const KINDS = [
  { key: 'consultation', name: 'Consultation' },
  { key: 'workshop', name: 'Atelier' },
]
const OLD = '2026-01-01T00:00:00Z'
const DEFAULTS: DefaultRangeRow[] = [
  // The seeded range, closed by a coming one created today (deletable).
  { id: 'd2', kind: 'consultation', min: 26, max: 31, effectiveFrom: '2027-01-01', effectiveTo: null, createdAt: '2026-10-08T15:00:00Z' },
  { id: 'd1', kind: 'consultation', min: 25, max: 30, effectiveFrom: '2017-01-01', effectiveTo: '2027-01-01', createdAt: OLD },
  // A kind's only range: never deletable.
  { id: 'd3', kind: 'workshop', min: 25, max: 25, effectiveFrom: '2017-01-01', effectiveTo: null, createdAt: OLD },
]
const RULES: RecognitionRuleRow[] = [
  { id: 'r1', stepSessions: 50, bonusPer50MinCents: 50, bonusPer30MinCents: 25, capPct: 25, capBasis: 'unconfirmed', effectiveFrom: '2017-01-01', effectiveTo: null, createdAt: OLD, note: null },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  mocks.compensation.fetchCompensationKinds.mockResolvedValue(KINDS)
  mocks.compensation.fetchCompensationTerms.mockResolvedValue({ defaults: DEFAULTS, rules: RULES })
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false })
  mocks.settings.saveProfessionalsSettings.mockImplementation(async (patch: { collectSin: boolean }) => ({ collectSin: patch.collectSin }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const render = (permissions?: string[]) => renderProfessionalsSettingsPage(<CompensationSettingsPage />, { sectionId: 'compensation', permissions })
const region = (title: string) => screen.findByRole('region', { name: title })

describe('CompensationSettingsPage', () => {
  it('lists each kind’s dated ranges, « Supprimer » only on the open range the database will let go', async () => {
    render()
    const defaults = await region(t(`${S}.defaults.title`))
    const table = within(defaults).getByRole('table', { name: t(`${S}.defaults.title`) })
    expect(within(table).getByRole('columnheader', { name: 'Consultation' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Atelier' })).toBeInTheDocument()
    const deletes = within(table).getAllByRole('button', { name: /Supprimer la fourchette/ })
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toHaveAccessibleName('Supprimer la fourchette Consultation de 26–31\u00A0% dès le 1 janv. 2027')
    await userEvent.click(deletes[0] as HTMLElement)
    const confirm = screen.getByRole('alertdialog', { name: t(`${S}.defaults.deleteTitle`) })
    mocks.compensation.deleteCompensationDefault.mockResolvedValue(undefined)
    await userEvent.click(within(confirm).getByRole('button', { name: t('modules.professionals.compensation.delete') }))
    await waitFor(() => expect(mocks.compensation.deleteCompensationDefault).toHaveBeenCalledExactlyOnceWith('d2'))
  })

  it('adds a range for a kind; every professional’s terms are refetched', async () => {
    mocks.compensation.setCompensationDefault.mockResolvedValue(undefined)
    const { invalidated } = render()
    const defaults = await region(t(`${S}.defaults.title`))
    await userEvent.click(within(defaults).getByRole('button', { name: t(`${S}.defaults.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${S}.defaults.dialog.title`) })
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'workshop')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(t(`${S}.defaults.dialog.min`).replace(/[()%]/g, '.')) }), '20')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(t(`${S}.defaults.dialog.max`).replace(/[()%]/g, '.')) }), '25')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t('modules.professionals.compensation.from'))), { target: { value: '2027-01-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.compensation.add') }))
    await waitFor(() =>
      expect(mocks.compensation.setCompensationDefault).toHaveBeenCalledExactlyOnceWith({ kind: 'workshop', min: 20, max: 25, effectiveFrom: '2027-01-01' }),
    )
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.compensations()))
  })

  it('shows the rules in dollars, the unconfirmed cap, and never offers to delete the first rule', async () => {
    render()
    const rules = await region(t(`${S}.rules.title`))
    // jest-dom reads a no-break space as a space.
    expect(within(rules).getByText('Palier de 50 séances · 0,50 $ par séance de 50 min · 0,25 $ par séance de 30 min')).toBeInTheDocument()
    expect(within(rules).getByText('Plafond de 25 % · base : À confirmer')).toBeInTheDocument()
    expect(within(rules).getByText('Interprétation du plafond de 25 % à confirmer.')).toBeInTheDocument()
    expect(within(rules).queryByRole('button', { name: /Supprimer la règle/ })).not.toBeInTheDocument()
  })

  it('starts a new rule from the one in force and sends cents', async () => {
    mocks.compensation.setRecognitionRule.mockResolvedValue(undefined)
    render()
    const rules = await region(t(`${S}.rules.title`))
    await userEvent.click(within(rules).getByRole('button', { name: t(`${S}.rules.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${S}.rules.dialog.title`) })
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'margin_reduction')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t('modules.professionals.compensation.from'))), { target: { value: '2027-01-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.compensation.add') }))
    await waitFor(() =>
      expect(mocks.compensation.setRecognitionRule).toHaveBeenCalledExactlyOnceWith({
        stepSessions: 50,
        bonusPer50MinCents: 50,
        bonusPer30MinCents: 25,
        capPct: 25,
        capBasis: 'margin_reduction',
        effectiveFrom: '2027-01-01',
        note: null,
      }),
    )
  })

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
    await region(t(`${S}.defaults.title`))
    expect(screen.queryByRole('region', { name: t(`${S}.sin.title`) })).not.toBeInTheDocument()
    expect(mocks.settings.fetchProfessionalsSettings).not.toHaveBeenCalled()
  })
})
