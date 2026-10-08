import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { REVEAL_DURATION_MS } from '@/shared/lib/use-revealed-value'
import type { ProfessionalCompensation } from '../../../api/compensation'
import type { ProfessionalPrivate } from '../../../api/private'
import { professionalKeys } from '../../../hooks/keys'
import { compensationFixture, EMPTY_PRIVATE, privateFixture, PRIVATE_UPDATED_AT } from '../../../test/fixtures-compensation'
import { recordFixture } from '../../../test/fixtures-domain'
import { renderRecordTab } from '../../../test/record-tab'
import { CompensationTab } from './CompensationTab'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  compensation: {
    fetchProfessionalCompensation: vi.fn(),
    setProfessionalMargin: vi.fn(),
    deleteProfessionalMargin: vi.fn(),
    setProfessionalRecognition: vi.fn(),
    deleteProfessionalRecognition: vi.fn(),
  },
  private: {
    fetchProfessionalPrivate: vi.fn(),
    revealProfessionalPrivate: vi.fn(),
    setProfessionalTaxNumbers: vi.fn(),
    setProfessionalBank: vi.fn(),
    setProfessionalSin: vi.fn(),
    clearProfessionalPrivateField: vi.fn(),
  },
  settings: { fetchProfessionalsSettings: vi.fn(), saveProfessionalsSettings: vi.fn() },
  history: { fetchProfessionalHistory: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('../../../api/compensation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/compensation')>()),
  ...mocks.compensation,
}))
vi.mock('../../../api/private', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/private')>()), ...mocks.private }))
vi.mock('../../../api/settings', () => mocks.settings)
vi.mock('../../../api/history', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/history')>()), ...mocks.history }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.professionals.record.compensation'
const NEW_VERSION = '2026-10-08T18:00:00.654321+00:00'
const STALE = { code: 'P0001', message: 'Ces renseignements ont été modifiés depuis leur affichage.', hint: 'stale' }

let storedPrivate: ProfessionalPrivate
let storedCompensation: ProfessionalCompensation
const record = recordFixture()
const id = record.professional.id

beforeEach(() => {
  // Date only: the clinic's today (2026-10-08) and the 24-hour delete window; timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  storedPrivate = privateFixture()
  storedCompensation = compensationFixture()
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  mocks.private.fetchProfessionalPrivate.mockImplementation(async () => storedPrivate)
  mocks.compensation.fetchProfessionalCompensation.mockImplementation(async () => storedCompensation)
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: true })
  mocks.history.fetchProfessionalHistory.mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const render = (options: { role?: 'admin' | 'admin_assistant'; permissions?: string[] } = {}) =>
  renderRecordTab(<CompensationTab />, { record, role: options.role ?? 'admin', permissions: options.permissions })

/** Every value React Query holds (queries and mutations), as one string to search. */
const cacheDump = (queryClient: ReturnType<typeof render>['queryClient']) =>
  JSON.stringify([
    queryClient.getQueryCache().findAll().map((q) => [q.queryKey, q.state.data]),
    queryClient.getMutationCache().findAll().map((m) => [m.state.variables, m.state.data]),
  ])

describe('CompensationTab — cards per permission', () => {
  it('shows every card to the admin, the requests started together', async () => {
    render()
    expect(mocks.compensation.fetchProfessionalCompensation).toHaveBeenCalledWith(id)
    expect(mocks.private.fetchProfessionalPrivate).toHaveBeenCalledWith(id)
    expect(mocks.settings.fetchProfessionalsSettings).toHaveBeenCalledOnce()
    for (const title of [`${C}.margin.title`, `${C}.recognition.title`, `${C}.sin.title`, `${C}.bank.title`] as const) {
      expect(await screen.findByRole('region', { name: t(title) })).toBeInTheDocument()
    }
    expect(screen.getByRole('form', { name: t(`${C}.taxNumbers.title`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.privacyNote`))).toBeInTheDocument()
  })

  it('shows only the compensation cards without professionals.private (and reads nothing private)', async () => {
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    expect(await screen.findByRole('region', { name: t(`${C}.margin.title`) })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t(`${C}.sin.title`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: t(`${C}.taxNumbers.title`) })).not.toBeInTheDocument()
    expect(mocks.private.fetchProfessionalPrivate).not.toHaveBeenCalled()
  })

  it('shows only the private cards without professionals.compensation', async () => {
    render({ permissions: ['professionals.view', 'professionals.private'] })
    expect(await screen.findByRole('region', { name: t(`${C}.bank.title`) })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t(`${C}.margin.title`) })).not.toBeInTheDocument()
    expect(mocks.compensation.fetchProfessionalCompensation).not.toHaveBeenCalled()
  })
})

describe('CompensationTab — private cards', () => {
  it('saves « Fiscalité » alone, with the updated_at it read', async () => {
    mocks.private.setProfessionalTaxNumbers.mockResolvedValue(NEW_VERSION)
    render()
    const form = await screen.findByRole('form', { name: t(`${C}.taxNumbers.title`) })
    const qst = within(form).getByRole('textbox', { name: t(`${C}.taxNumbers.qst`) })
    await userEvent.clear(qst)
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenCalledExactlyOnceWith(
        id,
        { businessNumber: '123456789', gstNumber: '123456789RT0001', qstNumber: null },
        PRIVATE_UPDATED_AT,
      ),
    )
    expect(mocks.private.setProfessionalBank).not.toHaveBeenCalled()
    expect(mocks.private.setProfessionalSin).not.toHaveBeenCalled()
  })

  it('on a stale refusal, refetches, keeps the draft and says so; the next save sends the new version', async () => {
    mocks.private.setProfessionalTaxNumbers.mockRejectedValueOnce(STALE).mockResolvedValueOnce(NEW_VERSION)
    render()
    const form = await screen.findByRole('form', { name: t(`${C}.taxNumbers.title`) })
    const bn = within(form).getByRole('textbox', { name: t(`${C}.taxNumbers.businessNumber`) })
    await userEvent.clear(bn)
    await userEvent.type(bn, '987654321')
    // Someone else saved meanwhile: the refetch brings their TPS and a new version.
    storedPrivate = privateFixture({ gstNumber: '111111111RT0001', updatedAt: NEW_VERSION })
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))

    expect(await within(form).findByRole('alert')).toHaveTextContent(t(`${C}.stale`))
    await waitFor(() => expect(within(form).getByRole('textbox', { name: t(`${C}.taxNumbers.gst`) })).toHaveValue('111111111 RT 0001'))
    expect(bn).toHaveValue('987654321')
    expect(mocks.private.fetchProfessionalPrivate).toHaveBeenCalledTimes(2)

    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenCalledTimes(2))
    expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenLastCalledWith(
      id,
      { businessNumber: '987654321', gstNumber: '111111111RT0001', qstNumber: '1234567890TQ0001' },
      NEW_VERSION,
    )
  })

  it('saves the bank without the account when it is left « Inchangé », with the version read', async () => {
    mocks.private.setProfessionalBank.mockResolvedValue(NEW_VERSION)
    render()
    const bank = await screen.findByRole('region', { name: t(`${C}.bank.title`) })
    await userEvent.click(within(bank).getByRole('button', { name: t('settings.bank.display.editLabel') }))
    const form = screen.getByRole('form', { name: t(`${C}.bank.title`) })
    const account = within(form).getByRole('textbox', { name: t('settings.bank.fields.account') })
    expect(account).toHaveValue('')
    expect(account).toHaveAttribute('autocomplete', 'off')
    expect(account).toHaveAttribute('placeholder', t('settings.bank.fields.accountUnchanged'))
    const transit = within(form).getByRole('textbox', { name: t('settings.bank.fields.transit') })
    await userEvent.clear(transit)
    await userEvent.type(transit, '12345')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.private.setProfessionalBank).toHaveBeenCalledExactlyOnceWith(id, { institution: '815', transit: '12345', account: null }, PRIVATE_UPDATED_AT),
    )
    expect(mocks.private.setProfessionalTaxNumbers).not.toHaveBeenCalled()
  })

  it('enters a SIN in its dialog, never prefilled, with the version read', async () => {
    storedPrivate = privateFixture({ sinLast3: null })
    mocks.private.setProfessionalSin.mockResolvedValue(NEW_VERSION)
    const { queryClient } = render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    expect(within(sin).getByText(t(`${C}.sin.none`))).toBeInTheDocument()
    await userEvent.click(within(sin).getByRole('button', { name: t(`${C}.sin.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.sin.dialog.addTitle`) })
    const field = within(dialog).getByRole('textbox', { name: `${t(`${C}.sin.dialog.field`)} ${t('common.form.required')}` })
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveFocus()
    await userEvent.type(field, '123 456 789')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t('modules.professionals.validation.sinInvalid'))).toBeInTheDocument()
    await userEvent.clear(field)
    await userEvent.type(field, '046 454 286')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalSin).toHaveBeenCalledExactlyOnceWith(id, '046454286', PRIVATE_UPDATED_AT))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(cacheDump(queryClient)).not.toContain('046454286'))
  })

  it('reads « Non recueilli » without collection and nothing stored, and offers no entry', async () => {
    storedPrivate = privateFixture({ sinLast3: null })
    mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false })
    render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    expect(within(sin).getByText(t(`${C}.sin.notCollected`))).toBeInTheDocument()
    expect(within(sin).getByText(t(`${C}.sin.notCollectedHelp`))).toBeInTheDocument()
    expect(within(sin).queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps « Retirer » for a stored SIN while collection is off, and removes it after confirmation', async () => {
    mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false })
    mocks.private.clearProfessionalPrivateField.mockResolvedValue(undefined)
    render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    expect(within(sin).queryByRole('button', { name: t(`${C}.sin.replaceLabel`) })).not.toBeInTheDocument()
    await userEvent.click(within(sin).getByRole('button', { name: t(`${C}.sin.removeLabel`) }))
    const confirm = screen.getByRole('alertdialog', { name: t(`${C}.sin.removeTitle`) })
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${C}.sin.remove`) }))
    await waitFor(() => expect(mocks.private.clearProfessionalPrivateField).toHaveBeenCalledExactlyOnceWith(id, 'sin'))
  })

  it('reveals the SIN in component state only, never in the query cache, and masks it after 60 s', async () => {
    mocks.private.revealProfessionalPrivate.mockResolvedValue('046454286')
    const { queryClient } = render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    expect(mocks.private.revealProfessionalPrivate).not.toHaveBeenCalled()
    vi.useFakeTimers()
    fireEvent.click(within(sin).getByRole('button', { name: t(`${C}.sin.showLabel`) }))
    await act(async () => {})
    expect(within(sin).getByText('046454286')).toBeInTheDocument()
    expect(mocks.private.revealProfessionalPrivate).toHaveBeenCalledExactlyOnceWith(id, 'sin')
    expect(cacheDump(queryClient)).not.toContain('046454286')
    act(() => vi.advanceTimersByTime(REVEAL_DURATION_MS))
    expect(within(sin).queryByText('046454286')).not.toBeInTheDocument()
    expect(within(sin).getByText(t(`${C}.sin.masked`, { last3: '286' }))).toBeInTheDocument()
  })

  it('shows an unreadable kept value with its hint, on reveal', async () => {
    mocks.private.revealProfessionalPrivate.mockRejectedValue({
      code: 'P0001',
      message: 'Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement.',
      hint: 'Retirez le numéro de compte enregistré, ou saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.',
    })
    render()
    const bank = await screen.findByRole('region', { name: t(`${C}.bank.title`) })
    await userEvent.click(within(bank).getByRole('button', { name: t('settings.bank.display.showLabel') }))
    const alert = await within(bank).findByRole('alert')
    expect(alert).toHaveTextContent('Le numéro de compte enregistré ne peut pas être lu')
    expect(alert).toHaveTextContent('Retirez le numéro de compte enregistré')
  })

  it('offers « Ajouter » when no bank data is stored', async () => {
    storedPrivate = { ...EMPTY_PRIVATE }
    render()
    const bank = await screen.findByRole('region', { name: t(`${C}.bank.title`) })
    expect(within(bank).getByText(t(`${C}.bank.empty.title`))).toBeInTheDocument()
    expect(within(bank).getByRole('button', { name: t(`${C}.bank.empty.add`) })).toBeInTheDocument()
  })
})

describe('CompensationTab — compensation cards', () => {
  it('reads the margin in force, the default range and a coming margin with its date-only start', async () => {
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    const margin = await screen.findByRole('region', { name: t(`${C}.margin.title`) })
    const rows = within(margin).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Consultation')
    expect(rows[1]).toHaveTextContent('25–30 % (par défaut)')
    expect(rows[1]).toHaveTextContent('Prévue : 28 % dès le 1 nov. 2026')
  })

  it('sends a new margin’s date string unchanged and warns outside the default range', async () => {
    mocks.compensation.setProfessionalMargin.mockResolvedValue({ id: 'm2', warning: true })
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    const margin = await screen.findByRole('region', { name: t(`${C}.margin.title`) })
    await userEvent.click(within(margin).getByRole('button', { name: t(`${C}.margin.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.margin.dialog.title`) })
    await userEvent.type(within(dialog).getByRole('textbox', { name: `${t(`${C}.margin.dialog.margin`)} ${t('common.form.required')}` }), '35')
    // jest-dom reads a no-break space as a space.
    expect(within(dialog).getAllByRole('status')[0]).toHaveTextContent('Hors de la fourchette par défaut (25–30 %).')
    // The open Consultation margin starts on 2026-11-01: the next one must start later.
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t('modules.professionals.compensation.from'))), { target: { value: '2026-12-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.compensation.add') }))
    await waitFor(() =>
      expect(mocks.compensation.setProfessionalMargin).toHaveBeenCalledExactlyOnceWith(id, { kind: 'consultation', marginPct: 35, effectiveFrom: '2026-12-01', note: null }),
    )
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.margin.savedOutside`)))
  })

  it('puts a date refusal (HINT effective_from) under the date field', async () => {
    mocks.compensation.setProfessionalMargin.mockRejectedValue({ code: 'P0001', message: 'La nouvelle marge doit commencer après le 2026-11-01.', hint: 'effective_from' })
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    const margin = await screen.findByRole('region', { name: t(`${C}.margin.title`) })
    await userEvent.click(within(margin).getByRole('button', { name: t(`${C}.margin.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.margin.dialog.title`) })
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'workshop')
    await userEvent.type(within(dialog).getByRole('textbox', { name: `${t(`${C}.margin.dialog.margin`)} ${t('common.form.required')}` }), '25')
    const date = within(dialog).getByLabelText(new RegExp(t('modules.professionals.compensation.from')))
    fireEvent.change(date, { target: { value: '2026-12-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.compensation.add') }))
    await waitFor(() => expect(date).toHaveAccessibleDescription(expect.stringContaining('La nouvelle marge doit commencer après le 2026-11-01.')))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deletes the coming margin created today, after confirmation', async () => {
    mocks.compensation.deleteProfessionalMargin.mockResolvedValue(undefined)
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    const margin = await screen.findByRole('region', { name: t(`${C}.margin.title`) })
    await userEvent.click(within(margin).getByRole('button', { name: t(`${C}.margin.historyLabel`, { kind: 'Consultation' }) }))
    await userEvent.click(within(margin).getByRole('button', { name: /Supprimer la marge Consultation/ }))
    const confirm = screen.getByRole('alertdialog', { name: t(`${C}.margin.deleteTitle`) })
    await userEvent.click(within(confirm).getByRole('button', { name: t('modules.professionals.compensation.delete') }))
    await waitFor(() => expect(mocks.compensation.deleteProfessionalMargin).toHaveBeenCalledExactlyOnceWith(storedCompensation.marginRows[0]?.id))
  })

  it('says amounts are not computed and the cap is unconfirmed; the level entered long ago cannot be deleted', async () => {
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    const recognition = await screen.findByRole('region', { name: t(`${C}.recognition.title`) })
    expect(within(recognition).getByText(t(`${C}.recognition.notComputed`))).toBeInTheDocument()
    expect(within(recognition).getByText('Interprétation du plafond de 25 % à confirmer.')).toBeInTheDocument()
    await userEvent.click(within(recognition).getByRole('button', { name: t(`${C}.recognition.historyLabel`) }))
    expect(within(recognition).queryByRole('button', { name: /Supprimer le niveau/ })).not.toBeInTheDocument()
  })

  it('refetches the terms and the history’s first page after a save', async () => {
    mocks.compensation.setProfessionalRecognition.mockResolvedValue(undefined)
    const { invalidated } = render({ permissions: ['professionals.view', 'professionals.compensation'] })
    const recognition = await screen.findByRole('region', { name: t(`${C}.recognition.title`) })
    await userEvent.click(within(recognition).getByRole('button', { name: t(`${C}.recognition.update`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.recognition.dialog.title`) })
    await userEvent.type(within(dialog).getByRole('textbox', { name: `${t(`${C}.recognition.level`)} ${t('common.form.required')}` }), '3')
    await userEvent.type(within(dialog).getByRole('textbox', { name: `${t(`${C}.recognition.sessions`)} ${t('common.form.required')}` }), '160')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t('modules.professionals.compensation.from'))), { target: { value: '2027-01-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.compensation.setProfessionalRecognition).toHaveBeenCalledExactlyOnceWith(id, { level: 3, sessions: 160, effectiveFrom: '2027-01-01', note: null }))
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.compensation(id)))
    expect(invalidated()).toContainEqual(professionalKeys.history(id))
    expect(invalidated()).not.toContainEqual(professionalKeys.lists())
  })
})
