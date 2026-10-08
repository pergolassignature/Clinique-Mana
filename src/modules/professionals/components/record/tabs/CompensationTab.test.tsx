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
    recordMonthlySessions: vi.fn(),
    decideRetention: vi.fn(),
    deleteProfessionalRetention: vi.fn(),
    setClientAgreement: vi.fn(),
    endClientAgreement: vi.fn(),
    deleteClientAgreement: vi.fn(),
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
    for (const title of [`${C}.retention.title`, `${C}.agreements.title`, `${C}.sin.title`, `${C}.bank.title`] as const) {
      expect(await screen.findByRole('region', { name: t(title) })).toBeInTheDocument()
    }
    expect(screen.getByRole('form', { name: t(`${C}.taxNumbers.title`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.privacyNote`))).toBeInTheDocument()
  })

  it('shows only the compensation cards without professionals.private (and reads nothing private)', async () => {
    render({ permissions: ['professionals.view', 'professionals.compensation'] })
    expect(await screen.findByRole('region', { name: t(`${C}.retention.title`) })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t(`${C}.sin.title`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: t(`${C}.taxNumbers.title`) })).not.toBeInTheDocument()
    expect(mocks.private.fetchProfessionalPrivate).not.toHaveBeenCalled()
  })

  it('shows only the private cards without professionals.compensation', async () => {
    render({ permissions: ['professionals.view', 'professionals.private'] })
    expect(await screen.findByRole('region', { name: t(`${C}.bank.title`) })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t(`${C}.retention.title`) })).not.toBeInTheDocument()
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

  it('after a stale refusal, sends the newer version the cache already held (a refetch while typing)', async () => {
    mocks.private.setProfessionalTaxNumbers.mockRejectedValueOnce(STALE).mockResolvedValueOnce('2026-10-08T19:00:00.000001+00:00')
    const { queryClient } = render()
    const form = await screen.findByRole('form', { name: t(`${C}.taxNumbers.title`) })
    const bn = within(form).getByRole('textbox', { name: t(`${C}.taxNumbers.businessNumber`) })
    await userEvent.clear(bn)
    await userEvent.type(bn, '987654321')
    // A background refetch (window focus) brings another person's save: the dirty card keeps the
    // version it started from, so its save is refused once; the refusal's refetch brings the same.
    storedPrivate = privateFixture({ updatedAt: NEW_VERSION })
    await act(() => queryClient.refetchQueries({ queryKey: professionalKeys.private(id) }))
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(t(`${C}.stale`))
    expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenLastCalledWith(id, expect.anything(), PRIVATE_UPDATED_AT)
    await waitFor(() => expect(mocks.private.fetchProfessionalPrivate).toHaveBeenCalledTimes(3))

    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenCalledTimes(2))
    expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenLastCalledWith(id, expect.objectContaining({ businessNumber: '987654321' }), NEW_VERSION)
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.taxNumbers.saved`)))
  })

  it('« Fiscalité » left dirty while « Banque » saves: refused once, then saved with the bank’s version', async () => {
    mocks.private.setProfessionalBank.mockImplementation(async () => {
      storedPrivate = privateFixture({ bankTransit: '12345', updatedAt: NEW_VERSION })
      return NEW_VERSION
    })
    mocks.private.setProfessionalTaxNumbers.mockRejectedValueOnce(STALE).mockResolvedValueOnce('2026-10-08T19:00:00.000001+00:00')
    render()
    const tax = await screen.findByRole('form', { name: t(`${C}.taxNumbers.title`) })
    const bn = within(tax).getByRole('textbox', { name: t(`${C}.taxNumbers.businessNumber`) })
    await userEvent.clear(bn)
    await userEvent.type(bn, '987654321')

    const bankCard = screen.getByRole('region', { name: t(`${C}.bank.title`) })
    await userEvent.click(within(bankCard).getByRole('button', { name: t('settings.bank.display.editLabel') }))
    const bank = screen.getByRole('form', { name: t(`${C}.bank.title`) })
    const transit = within(bank).getByRole('textbox', { name: t('settings.bank.fields.transit') })
    await userEvent.clear(transit)
    await userEvent.type(transit, '12345')
    await userEvent.click(within(bank).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalBank).toHaveBeenCalledExactlyOnceWith(id, expect.anything(), PRIVATE_UPDATED_AT))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.bank.saved`)))

    await userEvent.click(within(tax).getByRole('button', { name: t('common.save') }))
    expect(await within(tax).findByRole('alert')).toHaveTextContent(t(`${C}.stale`))
    expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenLastCalledWith(id, expect.anything(), PRIVATE_UPDATED_AT)
    await userEvent.click(within(tax).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenCalledTimes(2))
    expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenLastCalledWith(id, expect.objectContaining({ businessNumber: '987654321' }), NEW_VERSION)
  })

  it('sends the version a save returned when the refetch after it fails', async () => {
    mocks.private.setProfessionalTaxNumbers.mockResolvedValueOnce(NEW_VERSION).mockResolvedValueOnce('2026-10-08T19:00:00.000001+00:00')
    render()
    const form = await screen.findByRole('form', { name: t(`${C}.taxNumbers.title`) })
    mocks.private.fetchProfessionalPrivate.mockRejectedValue(new TypeError('Failed to fetch'))
    const bn = within(form).getByRole('textbox', { name: t(`${C}.taxNumbers.businessNumber`) })
    await userEvent.clear(bn)
    await userEvent.type(bn, '987654321')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.taxNumbers.saved`)))
    // The card shows what it saved, not the numbers the failed refetch left in the cache.
    expect(bn).toHaveValue('987654321')

    await userEvent.clear(bn)
    await userEvent.type(bn, '111111111')
    await userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenCalledTimes(2))
    expect(mocks.private.setProfessionalTaxNumbers).toHaveBeenLastCalledWith(id, expect.objectContaining({ businessNumber: '111111111' }), NEW_VERSION)
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

  it('in the SIN dialog, a stale refusal is followed by a save with the newer version', async () => {
    mocks.private.setProfessionalSin.mockRejectedValueOnce(STALE).mockResolvedValueOnce('2026-10-08T19:00:00.000001+00:00')
    const { queryClient } = render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    await userEvent.click(within(sin).getByRole('button', { name: t(`${C}.sin.replaceLabel`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.sin.dialog.replaceTitle`) })
    // Another person's save reaches the cache while the dialog is open: it keeps the version it opened on.
    storedPrivate = privateFixture({ updatedAt: NEW_VERSION })
    await act(() => queryClient.refetchQueries({ queryKey: professionalKeys.private(id) }))
    const field = within(dialog).getByRole('textbox', { name: `${t(`${C}.sin.dialog.field`)} ${t('common.form.required')}` })
    await userEvent.type(field, '046 454 286')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`${C}.stale`))
    expect(mocks.private.setProfessionalSin).toHaveBeenLastCalledWith(id, '046454286', PRIVATE_UPDATED_AT)
    expect(field).toHaveValue('046 454 286')

    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.private.setProfessionalSin).toHaveBeenCalledTimes(2))
    expect(mocks.private.setProfessionalSin).toHaveBeenLastCalledWith(id, '046454286', NEW_VERSION)
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
    mocks.private.clearProfessionalPrivateField.mockImplementation(async () => {
      storedPrivate = privateFixture({ sinLast3: null, updatedAt: NEW_VERSION })
    })
    render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    expect(within(sin).queryByRole('button', { name: t(`${C}.sin.replaceLabel`) })).not.toBeInTheDocument()
    await userEvent.click(within(sin).getByRole('button', { name: t(`${C}.sin.removeLabel`) }))
    const confirm = screen.getByRole('alertdialog', { name: t(`${C}.sin.removeTitle`) })
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${C}.sin.remove`) }))
    await waitFor(() => expect(mocks.private.clearProfessionalPrivateField).toHaveBeenCalledExactlyOnceWith(id, 'sin'))
    // No button is left in the card (« Non recueilli »): the focus goes to its title.
    expect(await within(sin).findByText(t(`${C}.sin.notCollected`))).toBeInTheDocument()
    await waitFor(() => expect(within(sin).getByRole('heading', { name: t(`${C}.sin.title`) })).toHaveFocus())
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

  it('masks a revealed value again when the row’s updated_at changes', async () => {
    mocks.private.revealProfessionalPrivate.mockResolvedValue('046454286')
    const { queryClient } = render()
    const sin = await screen.findByRole('region', { name: t(`${C}.sin.title`) })
    await userEvent.click(within(sin).getByRole('button', { name: t(`${C}.sin.showLabel`) }))
    expect(await within(sin).findByText('046454286')).toBeInTheDocument()
    // Any private save, here or in another tab, gives the row a new version.
    storedPrivate = privateFixture({ updatedAt: NEW_VERSION })
    await act(() => queryClient.refetchQueries({ queryKey: professionalKeys.private(id) }))
    await waitFor(() => expect(within(sin).queryByText('046454286')).not.toBeInTheDocument())
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

describe('CompensationTab — « Rétention » (P4-180…)', () => {
  const W = 'modules.professionals.compensation'
  const COMPENSATION_ONLY = { permissions: ['professionals.view', 'professionals.compensation'] }
  const retention = () => screen.findByRole('region', { name: t(`${C}.retention.title`) })

  it('reads the status, the count, the applied and suggested rates, the pay and the other rates', async () => {
    render(COMPENSATION_ONLY)
    const card = await retention()
    expect(within(card).getByText(t(`${W}.retentionStatus.gap`))).toBeInTheDocument()
    // jest-dom reads a no-break space as a space.
    expect(card).toHaveTextContent('Séances cumulées55,5')
    expect(card).toHaveTextContent('28 % Taux de départ')
    expect(card).toHaveTextContent('27,5 %Palier de 51 séances · prochain palier à 101 séances (27 %)')
    expect(card).toHaveTextContent('50 min 126,00 $ →suggéré : 126,88 $')
    expect(card).toHaveTextContent('Prix client : 175,00 $')
    expect(card).toHaveTextContent('Ateliers et conférences 25 % · Annulation tardive 30 %')
  })

  it('applies the suggestion from the first day of next month; the toast says it is an increase', async () => {
    mocks.compensation.decideRetention.mockResolvedValue({ id: 'r2', pct: 27.5, decreased: true })
    const { invalidated } = render(COMPENSATION_ONLY)
    const card = await retention()
    await userEvent.click(within(card).getByRole('button', { name: t(`${W}.decision.action.suggested`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${W}.decision.title.suggested`) })
    expect(dialog).toHaveTextContent('La retenue de la clinique passe de 28 % à 27,5 % (palier de 51 séances).')
    expect(within(dialog).getByLabelText(new RegExp(t(`${W}.from`)))).toHaveValue('2026-11-01')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    await waitFor(() =>
      expect(mocks.compensation.decideRetention).toHaveBeenCalledExactlyOnceWith(id, { decision: 'suggested', pct: null, effectiveFrom: '2026-11-01', note: null }),
    )
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.decision.savedDecreased`)))
    expect(invalidated()).toContainEqual(professionalKeys.compensation(id))
    expect(invalidated()).toContainEqual(professionalKeys.history(id))
    expect(invalidated()).toContainEqual(professionalKeys.reviews())
    expect(invalidated()).not.toContainEqual(professionalKeys.lists())
  })

  it('wants a reason for a custom rate', async () => {
    mocks.compensation.decideRetention.mockResolvedValue({ id: 'r2', pct: 26, decreased: true })
    render(COMPENSATION_ONLY)
    const card = await retention()
    await userEvent.click(within(card).getByRole('button', { name: t(`${W}.decision.action.custom`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${W}.decision.title.custom`) })
    await userEvent.type(within(dialog).getByRole('textbox', { name: `${t(`${W}.decision.rate`)} ${t('common.form.required')}` }), '26')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    expect(await within(dialog).findByText(t(`${W}.validation.customNote`))).toBeInTheDocument()
    expect(mocks.compensation.decideRetention).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: `${t(`${W}.note`)} ${t('common.form.required')}` }), 'Entente fictive')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    await waitFor(() =>
      expect(mocks.compensation.decideRetention).toHaveBeenCalledExactlyOnceWith(id, { decision: 'custom', pct: 26, effectiveFrom: '2026-11-01', note: 'Entente fictive' }),
    )
  })

  it('puts a date refusal (HINT effective_from) under the date field', async () => {
    mocks.compensation.decideRetention.mockRejectedValue({ code: 'P0001', message: 'Le nouveau taux doit commencer après le 2026-11-01.', hint: 'effective_from' })
    render(COMPENSATION_ONLY)
    const card = await retention()
    await userEvent.click(within(card).getByRole('button', { name: t(`${W}.decision.action.maintained`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${W}.decision.title.maintained`) })
    const date = within(dialog).getByLabelText(new RegExp(t(`${W}.from`)))
    // The open rate started on 2026-07-01: the next one from the 2nd.
    expect(date).toHaveAttribute('min', '2026-07-02')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.decision.confirm`) }))
    await waitFor(() => expect(date).toHaveAccessibleDescription(expect.stringContaining('Le nouveau taux doit commencer après le 2026-11-01.')))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens « Ajouter les séances du mois » on last month, prefilled, and sends the version read', async () => {
    mocks.compensation.recordMonthlySessions.mockResolvedValue(undefined)
    render(COMPENSATION_ONLY)
    const card = await retention()
    await userEvent.click(within(card).getByRole('button', { name: t(`${C}.sessions.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.sessions.dialog.title`) })
    expect(within(dialog).getByLabelText(new RegExp(t(`${C}.sessions.dialog.month`)))).toHaveValue('2026-09')
    const long = within(dialog).getByRole('textbox', { name: t(`${C}.sessions.dialog.long`) })
    expect(long).toHaveValue('20')
    await userEvent.clear(long)
    await userEvent.type(long, '24')
    // 55,5 − September's 22 + 24 + 2.
    expect(dialog).toHaveTextContent('Nouveau cumul : 59,5 séances.')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.compensation.recordMonthlySessions).toHaveBeenCalledExactlyOnceWith('2026-09-01', [
        { professionalId: id, long: 24, short: 4, adjustment: 0, note: null, expectedUpdatedAt: '2026-10-02T14:00:00.123456+00:00' },
      ]),
    )
  })

  it('a new month starts empty, with no version; a stale refusal takes the newer one for the next save', async () => {
    const staleSessions = { code: 'P0001', message: 'Les séances de ce mois ont été modifiées depuis leur affichage.', hint: 'stale', details: id }
    mocks.compensation.recordMonthlySessions.mockRejectedValueOnce(staleSessions).mockResolvedValueOnce(undefined)
    render(COMPENSATION_ONLY)
    const card = await retention()
    await userEvent.click(within(card).getByRole('button', { name: t(`${C}.sessions.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.sessions.dialog.title`) })
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t(`${C}.sessions.dialog.month`))), { target: { value: '2026-10' } })
    const long = within(dialog).getByRole('textbox', { name: t(`${C}.sessions.dialog.long`) })
    await waitFor(() => expect(long).toHaveValue(''))
    await userEvent.type(long, '5')
    // Someone else entered October meanwhile.
    storedCompensation = compensationFixture({
      sessionRows: [{ id: 'oct', month: '2026-10-01', long: 3, short: 0, adjustment: 0, note: null, updatedAt: NEW_VERSION }, ...compensationFixture().sessionRows],
    })
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t(`${C}.sessions.stale`))).toBeInTheDocument()
    expect(mocks.compensation.recordMonthlySessions.mock.calls[0]?.[1]).toEqual([expect.objectContaining({ expectedUpdatedAt: null })])
    // The refetched month replaces the draft: check, then save again.
    await waitFor(() => expect(long).toHaveValue('3'))
    await userEvent.clear(long)
    await userEvent.type(long, '6')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.compensation.recordMonthlySessions).toHaveBeenCalledTimes(2))
    expect(mocks.compensation.recordMonthlySessions.mock.calls[1]?.[1]).toEqual([expect.objectContaining({ long: 6, expectedUpdatedAt: NEW_VERSION })])
  })

  it('lists the client agreements with both amounts; a new one refuses a pay above the client price', async () => {
    mocks.compensation.setClientAgreement.mockResolvedValue(undefined)
    render(COMPENSATION_ONLY)
    const agreements = await screen.findByRole('region', { name: t(`${C}.agreements.title`) })
    expect(agreements).toHaveTextContent('D-1042 · 50 min')
    expect(agreements).toHaveTextContent('Prix client 120,00 $ · Versé au professionnel 85,00 $')
    await userEvent.click(within(agreements).getByRole('button', { name: t(`${C}.agreements.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${C}.agreements.dialog.title`) })
    expect(within(dialog).getByText(t(`${C}.agreements.dialog.clientHelp`))).toBeInTheDocument()
    const req = (key: string) => `${t(key as never)} ${t('common.form.required')}`
    await userEvent.type(within(dialog).getByRole('textbox', { name: req(`${C}.agreements.dialog.client`) }), 'AB')
    await userEvent.type(within(dialog).getByRole('textbox', { name: req(`${C}.agreements.dialog.clientPrice`) }), '100')
    await userEvent.type(within(dialog).getByRole('textbox', { name: req(`${C}.agreements.dialog.professionalAmount`) }), '110')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t(`${W}.from`))), { target: { value: '2026-11-01' } })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.add`) }))
    expect(await within(dialog).findByText(t(`${W}.validation.amountAbovePrice`))).toBeInTheDocument()
    const amount = within(dialog).getByRole('textbox', { name: req(`${C}.agreements.dialog.professionalAmount`) })
    await userEvent.clear(amount)
    await userEvent.type(amount, '70,50')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${W}.add`) }))
    await waitFor(() =>
      expect(mocks.compensation.setClientAgreement).toHaveBeenCalledExactlyOnceWith(id, {
        clientLabel: 'AB',
        duration: 50,
        professionalAmountCents: 7050,
        clientPriceCents: 10000,
        effectiveFrom: '2026-11-01',
        note: null,
      }),
    )
  })

  it('offers « Supprimer » on the agreement created today, never on the rate entered long ago', async () => {
    mocks.compensation.deleteClientAgreement.mockResolvedValue(undefined)
    render(COMPENSATION_ONLY)
    const card = await retention()
    await userEvent.click(within(card).getByRole('button', { name: t(`${C}.retention.rateHistory`) }))
    expect(within(card).queryByRole('button', { name: /Supprimer le taux/ })).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /Supprimer l’entente D-1042/ }))
    const confirm = screen.getByRole('alertdialog', { name: t(`${C}.agreements.deleteTitle`) })
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${W}.delete`) }))
    await waitFor(() => expect(mocks.compensation.deleteClientAgreement).toHaveBeenCalledExactlyOnceWith(storedCompensation.agreementRows[0]?.id))
  })

  it('reads « Profession à confirmer » and offers no decision without a grid', async () => {
    storedCompensation = compensationFixture({ grid: null, suggested: null, next: null, status: 'profession_unconfirmed', pay: [] })
    render(COMPENSATION_ONLY)
    const card = await retention()
    expect(within(card).getByText(t(`${W}.retentionStatus.profession_unconfirmed`))).toBeInTheDocument()
    expect(within(card).getByText(t(`${C}.retention.noGrid`))).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: t(`${W}.decision.action.suggested`) })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: t(`${C}.sessions.add`) })).toBeInTheDocument()
  })
})
