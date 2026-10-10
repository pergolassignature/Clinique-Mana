import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { BankDetails } from '@/core/settings/bank/api'
import { bankKeys } from '@/core/settings/bank/hooks'
import { LEAVE_LINK, renderOrganizationPage } from '@/test/organization'
import { BankSettingsPage } from './BankSettingsPage'

const mocks = vi.hoisted(() => ({
  bank: { fetchBankDetails: vi.fn(), revealAccountNumber: vi.fn(), setBankDetails: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/bank/api', () => mocks.bank)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const DETAILS: BankDetails = {
  institution_number: '815',
  transit_number: '30000',
  account_last4: '4567',
  etransfer_email: 'paiement@cliniquemana.test',
  // 14:30 in the clinic (America/Toronto, EDT).
  updated_at: '2026-10-07T18:30:00Z',
  updated_by_name: 'Marie Tremblay',
}

const card = () => screen.getByRole('region', { name: t('settings.bank.title') })
const form = () => screen.getByRole('form', { name: t('settings.bank.title') })
const field = (label: string, required = false) =>
  within(form()).getByRole('textbox', { name: required ? `${label} ${t('common.form.required')}` : label })
const showButton = () => screen.getByRole('button', { name: t('settings.bank.display.showLabel') })
const hideButton = () => screen.getByRole('button', { name: t('settings.bank.display.hideLabel') })
const editButton = () => screen.getByRole('button', { name: t('settings.bank.display.editLabel') })
/** A definition list value, by its term. */
const valueOf = (term: string) => within(card()).getByText(term, { selector: 'dt' }).nextElementSibling

async function renderPage({ details = DETAILS as BankDetails | null } = {}) {
  mocks.bank.fetchBankDetails.mockResolvedValue(details)
  const result = renderOrganizationPage(<BankSettingsPage />)
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  return result
}

describe('BankSettingsPage', () => {
  it('says who sees the details and that every reveal is logged', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t('settings.sections.bank') })).toBeInTheDocument()
    expect(
      screen.getByText(
        "Visibles par les administrateurs seulement. Chaque affichage du numéro de compte est inscrit au journal d'audit.",
      ),
    ).toBeInTheDocument()
  })

  it('shows the details masked, with the Interac email and who changed them when', async () => {
    await renderPage()
    expect(valueOf(t('settings.bank.display.institution'))).toHaveTextContent('815')
    expect(valueOf(t('settings.bank.display.transit'))).toHaveTextContent('30000')
    expect(within(card()).getByText('••••4567')).toBeInTheDocument()
    // Screen readers hear words, not four bullets.
    expect(within(card()).getByText('••••4567')).toHaveAttribute('aria-hidden', 'true')
    expect(within(card()).getByText(t('settings.bank.display.masked', { last4: '4567' }))).toHaveClass('sr-only')
    expect(valueOf(t('settings.bank.display.email'))).toHaveTextContent('paiement@cliniquemana.test')
    expect(within(card()).getByText('Modifié le 7 oct. 2026 à 14:30 par Marie Tremblay')).toBeInTheDocument()
    expect(mocks.bank.revealAccountNumber).not.toHaveBeenCalled()
  })

  it('shows « — » without an Interac email, and the date alone without an author', async () => {
    await renderPage({ details: { ...DETAILS, etransfer_email: null, updated_by_name: null } })
    expect(valueOf(t('settings.bank.display.email'))).toHaveTextContent('—')
    expect(within(card()).getByText('Modifié le 7 oct. 2026 à 14:30')).toBeInTheDocument()
  })

  it('reveals the number once through the RPC, keeps it out of the query cache, and « Masquer » hides it', async () => {
    mocks.bank.revealAccountNumber.mockResolvedValue('1234567')
    const { queryClient } = await renderPage()
    await userEvent.click(showButton())
    expect(await within(card()).findByText('1234567')).toBeInTheDocument()
    expect(mocks.bank.revealAccountNumber).toHaveBeenCalledOnce()
    expect(within(card()).queryByText('••••4567')).not.toBeInTheDocument()
    expect(within(card()).getByText(t('settings.bank.display.autoHide'))).toBeInTheDocument()

    const cached = queryClient.getQueryCache().findAll().map((query) => JSON.stringify(query.state.data))
    expect(cached.length).toBeGreaterThan(0)
    for (const data of cached) expect(data).not.toContain('1234567')

    await userEvent.click(hideButton())
    expect(within(card()).queryByText('1234567')).not.toBeInTheDocument()
    expect(within(card()).getByText('••••4567')).toBeInTheDocument()
    expect(showButton()).toHaveFocus()
    expect(mocks.bank.revealAccountNumber).toHaveBeenCalledOnce()
  })

  it('shows a refused reveal as a toast and stays masked', async () => {
    mocks.bank.revealAccountNumber.mockRejectedValue({ code: '42501', message: 'Permission refusée : settings.bank_manage' })
    await renderPage()
    await userEvent.click(showButton())
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden')))
    expect(within(card()).getByText('••••4567')).toBeInTheDocument()
  })

  it('edits with the stored numbers, the account empty « Inchangé », and sends account: null when it stays empty', async () => {
    mocks.bank.setBankDetails.mockResolvedValue(undefined)
    await renderPage()
    await userEvent.click(editButton())
    const institution = field(t('settings.bank.fields.institution'), true)
    expect(institution).toHaveFocus()
    expect(institution).toHaveValue('815')
    const account = field(t('settings.bank.fields.account'))
    expect(account).toHaveValue('')
    expect(account).toHaveAttribute('placeholder', t('settings.bank.fields.accountUnchanged'))
    expect(account).toHaveAttribute('autocomplete', 'off')
    expect(account).toHaveAccessibleDescription('7 à 12 chiffres. Laissez vide pour garder le compte se terminant par 4567.')
    // Password managers ignore autocomplete="off" alone.
    expect(account).toHaveAttribute('data-1p-ignore')
    expect(account).toHaveAttribute('data-lpignore', 'true')
    expect(account).toHaveAttribute('data-bwignore', 'true')
    expect(account).toHaveAttribute('data-form-type', 'other')

    const transit = field(t('settings.bank.fields.transit'), true)
    await userEvent.clear(transit)
    await userEvent.type(transit, '30001')
    mocks.bank.fetchBankDetails.mockResolvedValue({ ...DETAILS, transit_number: '30001' })
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))

    await waitFor(() =>
      expect(mocks.bank.setBankDetails).toHaveBeenCalledWith({
        institution: '815',
        transit: '30001',
        account: null,
        etransferEmail: 'paiement@cliniquemana.test',
      }),
    )
    expect(await screen.findByRole('region', { name: t('settings.bank.title') })).toBeInTheDocument()
    expect(valueOf(t('settings.bank.display.transit'))).toHaveTextContent('30001')
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.bank.saved'))
    expect(editButton()).toHaveFocus()
  })

  it('shows the database rules as field errors and does not save', async () => {
    await renderPage()
    await userEvent.click(editButton())
    await userEvent.clear(field(t('settings.bank.fields.institution'), true))
    await userEvent.type(field(t('settings.bank.fields.institution'), true), '81')
    await userEvent.clear(field(t('settings.bank.fields.transit'), true))
    await userEvent.type(field(t('settings.bank.fields.transit'), true), '3000a')
    await userEvent.type(field(t('settings.bank.fields.account')), '12a4567')
    await userEvent.clear(field(t('settings.bank.fields.email')))
    await userEvent.type(field(t('settings.bank.fields.email')), 'paiement@clinique')
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))

    expect(await within(form()).findByText("Le numéro d'institution compte 3 chiffres.")).toBeInTheDocument()
    expect(within(form()).getByText('Le numéro de transit compte 5 chiffres.')).toBeInTheDocument()
    expect(within(form()).getByText('Le numéro de compte compte de 7 à 12 chiffres.')).toBeInTheDocument()
    expect(within(form()).getByText('Courriel Interac invalide.')).toBeInTheDocument()
    expect(mocks.bank.setBankDetails).not.toHaveBeenCalled()
  })

  it('shows a P0001 refusal from the database and stays in the form', async () => {
    mocks.bank.setBankDetails.mockRejectedValue({ code: 'P0001', message: 'Le numéro de compte est requis.' })
    await renderPage()
    await userEvent.click(editButton())
    await userEvent.clear(field(t('settings.bank.fields.email')))
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Le numéro de compte est requis.'))
    expect(form()).toBeInTheDocument()
  })

  it('« Annuler » returns to the masked display without saving, edits or not', async () => {
    await renderPage()
    await userEvent.click(editButton())
    await userEvent.click(within(form()).getByRole('button', { name: t('common.cancel') }))
    expect(card()).toBeInTheDocument()
    expect(editButton()).toHaveFocus()

    await userEvent.click(editButton())
    await userEvent.type(field(t('settings.bank.fields.account')), '7654321')
    await userEvent.click(within(form()).getByRole('button', { name: t('common.cancel') }))
    expect(card()).toBeInTheDocument()
    expect(mocks.bank.setBankDetails).not.toHaveBeenCalled()
  })

  it('asks before leaving the page with unsaved changes', async () => {
    await renderPage()
    await userEvent.click(editButton())
    await userEvent.type(field(t('settings.bank.fields.account')), '7654321')
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('shows the empty state; « Ajouter » opens the form, where the account is required', async () => {
    mocks.bank.setBankDetails.mockResolvedValue(undefined)
    await renderPage({ details: null })
    expect(screen.getByText(t('settings.bank.empty.title'))).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t('settings.bank.title') })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('settings.bank.empty.add') }))

    const account = field(t('settings.bank.fields.account'), true)
    expect(account).not.toHaveAttribute('placeholder')
    expect(account).toHaveAccessibleDescription(t('settings.bank.fields.accountHelp'))
    await userEvent.type(field(t('settings.bank.fields.institution'), true), '815')
    await userEvent.type(field(t('settings.bank.fields.transit'), true), '30000')
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))
    expect(await within(form()).findByText('Le numéro de compte est requis.')).toBeInTheDocument()
    expect(mocks.bank.setBankDetails).not.toHaveBeenCalled()

    await userEvent.type(account, '123-4567')
    await userEvent.type(field(t('settings.bank.fields.email')), 'Paiement@CliniqueMana.test')
    mocks.bank.fetchBankDetails.mockResolvedValue(DETAILS)
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.bank.setBankDetails).toHaveBeenCalledWith({
        institution: '815',
        transit: '30000',
        account: '1234567',
        etransferEmail: 'paiement@cliniquemana.test',
      }),
    )
    expect(await screen.findByText('••••4567')).toBeInTheDocument()
    expect(editButton()).toHaveFocus()
  })

  it('shows the load error, not the empty state, when a first save succeeds but reloading fails', async () => {
    mocks.bank.setBankDetails.mockResolvedValue(undefined)
    await renderPage({ details: null })
    await userEvent.click(screen.getByRole('button', { name: t('settings.bank.empty.add') }))
    await userEvent.type(field(t('settings.bank.fields.institution'), true), '815')
    await userEvent.type(field(t('settings.bank.fields.transit'), true), '30000')
    await userEvent.type(field(t('settings.bank.fields.account'), true), '1234567')
    mocks.bank.fetchBankDetails.mockRejectedValue({ code: '57014', message: 'canceling statement due to statement timeout' })
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t('settings.bank.loadError'))).toBeInTheDocument()
    expect(screen.queryByText(t('settings.bank.empty.title'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('common.retry') })).toHaveFocus()
  })

  it('makes the fields read-only while saving (nothing typed meanwhile is lost), footer still shown', async () => {
    let finish: () => void = () => {}
    mocks.bank.setBankDetails.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    await renderPage()
    await userEvent.click(editButton())
    await userEvent.type(field(t('settings.bank.fields.account')), '7654321')
    await userEvent.click(within(form()).getByRole('button', { name: t('common.save') }))
    const saving = await within(form()).findByRole('button', { name: t('common.saving') })
    expect(saving).toBeInTheDocument()
    for (const textbox of within(form()).getAllByRole('textbox')) expect(textbox).toHaveAttribute('readonly')
    await act(async () => finish())
    expect(await screen.findByRole('region', { name: t('settings.bank.title') })).toBeInTheDocument()
  })

  it('masks a revealed number again when the details change (the card remounts)', async () => {
    mocks.bank.revealAccountNumber.mockResolvedValue('1234567')
    const { queryClient } = await renderPage()
    await userEvent.click(showButton())
    expect(await within(card()).findByText('1234567')).toBeInTheDocument()
    act(() => queryClient.setQueryData(bankKeys.details(), { ...DETAILS, account_last4: '4321', updated_at: '2026-10-07T19:00:00Z' }))
    // React Query notifies on the next tick.
    await waitFor(() => expect(within(card()).queryByText('1234567')).not.toBeInTheDocument())
    expect(within(card()).getByText('••••4321')).toBeInTheDocument()
  })

  it('labels « Afficher » « Affichage… » while the reveal is pending', async () => {
    let answer: (value: string) => void = () => {}
    mocks.bank.revealAccountNumber.mockReturnValue(new Promise<string>((resolve) => (answer = resolve)))
    await renderPage()
    await userEvent.click(showButton())
    const pending = screen.getByRole('button', { name: t('settings.bank.display.revealingLabel') })
    expect(pending).toHaveTextContent(t('settings.bank.display.revealing'))
    expect(pending).toHaveAttribute('aria-disabled', 'true')
    await act(async () => answer('1234567'))
    expect(within(card()).getByText('1234567')).toHaveAttribute('translate', 'no')
  })

  it('« Annuler » on a first entry goes back to the empty state', async () => {
    await renderPage({ details: null })
    await userEvent.click(screen.getByRole('button', { name: t('settings.bank.empty.add') }))
    await userEvent.click(within(form()).getByRole('button', { name: t('common.cancel') }))
    expect(screen.getByRole('button', { name: t('settings.bank.empty.add') })).toHaveFocus()
  })

  it('shows a load error with « Réessayer »', async () => {
    mocks.bank.fetchBankDetails.mockRejectedValue({ code: '42501', message: 'Permission refusée : settings.bank_manage' })
    renderOrganizationPage(<BankSettingsPage />)
    expect(await screen.findByText(t('settings.bank.loadError'))).toBeInTheDocument()
    mocks.bank.fetchBankDetails.mockResolvedValue(DETAILS)
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByText('••••4567')).toBeInTheDocument()
  })
})
