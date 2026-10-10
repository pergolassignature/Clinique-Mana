import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../../api/parse'
import type { ProfessionalPatch } from '../../../api/record'
import { recordFixture } from '../../../test/fixtures-domain'
import { renderRecordTab } from '../../../test/record-tab'
import { resetSuggestionsPause } from '@/core/address/availability'
import { IdentityTab } from './IdentityTab'

const mocks = vi.hoisted(() => ({
  record: {
    fetchProfessionalRecord: vi.fn(),
    updateProfessional: vi.fn(),
    setPayerNumber: vi.fn(),
    setProfessionalEmail: vi.fn(),
    setProfessions: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
  address: { fetchAddressSuggestions: vi.fn(), fetchPlaceAddress: vi.fn() },
}))
vi.mock('@/core/address/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/address/api')>()), ...mocks.address }))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const I = 'modules.professionals.record.identity'
let stored: ProfessionalRecord

beforeEach(() => {
  resetSuggestionsPause()
  mocks.address.fetchAddressSuggestions.mockResolvedValue([])
  stored = recordFixture()
  mocks.record.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.record.updateProfessional.mockImplementation(async (_id: string, patch: ProfessionalPatch) => {
    stored = { ...stored, professional: { ...stored.professional, ...patch } }
  })
  mocks.record.setProfessionalEmail.mockImplementation(async (_id: string, email: string) => {
    stored = { ...stored, professional: { ...stored.professional, email } }
  })
})
afterEach(() => vi.clearAllMocks())

const card = (title: string) => screen.getByRole('form', { name: title })
const save = (form: HTMLElement) => userEvent.click(within(form).getByRole('button', { name: t('common.save') }))
const required = (label: string) => `${label} ${t('common.form.required')}`

describe('IdentityTab', () => {
  it('saves only the Identité fields, the gender null when « Non indiqué »', async () => {
    stored = { ...stored, professional: { ...stored.professional, gender: 'female' } }
    renderRecordTab(<IdentityTab />, { record: stored })
    const identity = card(t(`${I}.identity.title`))
    const gender = within(identity).getByRole('combobox', { name: t(`${I}.identity.gender`) })
    expect(gender).toHaveValue('female')
    expect(gender).toHaveAccessibleDescription(t(`${I}.identity.genderHelp`))
    const first = within(identity).getByRole('textbox', { name: required(t(`${I}.identity.firstName`)) })
    await userEvent.clear(first)
    await userEvent.type(first, '  Marie-Ève ')
    await userEvent.selectOptions(gender, '')
    await save(identity)

    await waitFor(() =>
      expect(mocks.record.updateProfessional).toHaveBeenCalledExactlyOnceWith(stored.professional.id, { firstName: 'Marie-Ève', lastName: 'Tremblay', gender: null }),
    )
    await waitFor(() => expect(first).toHaveValue('Marie-Ève'))
  })

  it('saves the Coordonnées normalised (E.164 phone, spaced postal code), never the login email', async () => {
    renderRecordTab(<IdentityTab />, { record: stored })
    const contact = card(t(`${I}.contact.title`))
    const phone = within(contact).getByRole('textbox', { name: t(`${I}.contact.personalPhone`) })
    expect(phone).toHaveValue('514 555-1234')
    await userEvent.clear(phone)
    await userEvent.type(phone, '4189079754')
    await userEvent.tab()
    expect(phone).toHaveValue('418 907-9754')
    const postal = within(contact).getByRole('textbox', { name: t(`${I}.contact.postalCode`) })
    await userEvent.clear(postal)
    await userEvent.type(postal, 'g1r4p5')
    await save(contact)

    await waitFor(() =>
      expect(mocks.record.updateProfessional).toHaveBeenCalledExactlyOnceWith(stored.professional.id, {
        personalPhone: '+14189079754',
        addressLine1: '123, rue Saint-Denis',
        addressLine2: null,
        city: 'Montréal',
        province: 'QC',
        postalCode: 'G1R 4P5',
      }),
    )
  })

  it('fills the home address from a Google suggestion (unit into an empty line 2), keyboard only, then saves it', async () => {
    mocks.address.fetchAddressSuggestions.mockResolvedValue([
      { placeId: 'ChIJfakeUnit00000007', mainText: '402-3450 Rue Drummond', secondaryText: 'Montréal, QC, Canada' },
      { placeId: 'ChIJfakePlateau000001', mainText: '1234 Rue Saint-Denis', secondaryText: 'Montréal, QC, Canada' },
    ])
    mocks.address.fetchPlaceAddress.mockResolvedValue({
      line1: '3450, rue Drummond',
      line2: '402',
      city: 'Montréal',
      province: 'QC',
      postalCode: 'H3G 1Y2',
      country: 'CA',
    })
    renderRecordTab(<IdentityTab />, { record: stored })
    const contact = card(t(`${I}.contact.title`))
    const address = within(contact).getByRole('combobox', { name: t(`${I}.contact.addressLine1`) })
    expect(address).toHaveValue('123, rue Saint-Denis')
    // The browser's address autofill is off on every address field, as in « Identité légale » (P4-222).
    expect(address).toHaveAttribute('autocomplete', 'off')
    for (const key of ['addressLine2', 'city', 'postalCode'] as const) {
      expect(within(contact).getByRole('textbox', { name: t(`${I}.contact.${key}`) })).toHaveAttribute('autocomplete', 'off')
    }
    // « Province » is required: its accessible name carries the required mark.
    expect(within(contact).getByRole('combobox', { name: new RegExp(`^${t(`${I}.contact.province`)}`) })).toHaveAttribute('autocomplete', 'off')
    await userEvent.clear(address)
    await userEvent.type(address, '3450 drummond')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(address).toHaveValue('3450, rue Drummond'))
    expect(mocks.address.fetchPlaceAddress).toHaveBeenCalledWith('ChIJfakeUnit00000007', expect.any(String), expect.any(AbortSignal))
    expect(within(contact).getByRole('textbox', { name: t(`${I}.contact.addressLine2`) })).toHaveValue('402')
    expect(within(contact).getByRole('textbox', { name: t(`${I}.contact.postalCode`) })).toHaveValue('H3G 1Y2')
    await save(contact)

    await waitFor(() =>
      expect(mocks.record.updateProfessional).toHaveBeenCalledExactlyOnceWith(stored.professional.id, {
        personalPhone: '+15145551234',
        addressLine1: '3450, rue Drummond',
        addressLine2: '402',
        city: 'Montréal',
        province: 'QC',
        postalCode: 'H3G 1Y2',
      }),
    )
  })

  it('keeps another card’s edits when a card of the same save hook saves (Identité while Expérience is dirty)', async () => {
    renderRecordTab(<IdentityTab />, { record: stored })
    const experience = card(t(`${I}.experience.title`))
    const years = within(experience).getByRole('textbox', { name: t(`${I}.experience.years`) })
    await userEvent.clear(years)
    await userEvent.type(years, '20')
    const identity = card(t(`${I}.identity.title`))
    const last = within(identity).getByRole('textbox', { name: required(t(`${I}.identity.lastName`)) })
    await userEvent.clear(last)
    await userEvent.type(last, 'Gagnon')
    await save(identity)

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledOnce())
    expect(mocks.record.updateProfessional).toHaveBeenCalledExactlyOnceWith(stored.professional.id, { firstName: 'Marie', lastName: 'Gagnon', gender: null })
    // The refetched record reached Expérience, which kept its draft and is still dirty.
    await waitFor(() => expect(within(identity).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument())
    expect(years).toHaveValue('20')
    expect(within(experience).getByRole('button', { name: t('common.save') })).not.toHaveAttribute('aria-disabled')
    await save(experience)
    await waitFor(() => expect(mocks.record.updateProfessional).toHaveBeenLastCalledWith(stored.professional.id, { yearsExperience: 20 }))
  })

  it('saves the years of experience (0–60)', async () => {
    renderRecordTab(<IdentityTab />, { record: stored })
    const experience = card(t(`${I}.experience.title`))
    const years = within(experience).getByRole('textbox', { name: t(`${I}.experience.years`) })
    await userEvent.clear(years)
    await userEvent.type(years, '61')
    await save(experience)
    expect(await within(experience).findByText(t('modules.professionals.validation.yearsExperience'))).toBeInTheDocument()
    await userEvent.clear(years)
    await userEvent.type(years, '15')
    await save(experience)
    await waitFor(() => expect(mocks.record.updateProfessional).toHaveBeenCalledExactlyOnceWith(stored.professional.id, { yearsExperience: 15 }))
  })

  describe('IVAC', () => {
    it('saves the years and the number of « Expérience et payeurs » with one « Enregistrer », the years first (decision UI-5)', async () => {
      mocks.record.setPayerNumber.mockResolvedValue(undefined)
      renderRecordTab(<IdentityTab />, { record: stored })
      const section = card(t(`${I}.experience.title`))
      const years = within(section).getByRole('textbox', { name: t(`${I}.experience.years`) })
      const ivac = within(section).getByRole('textbox', { name: t(`${I}.payers.ivac`) })
      await userEvent.clear(years)
      await userEvent.type(years, '21')
      await userEvent.clear(ivac)
      await userEvent.type(ivac, 'AB-12')
      await save(section)
      await waitFor(() => expect(mocks.record.setPayerNumber).toHaveBeenCalledExactlyOnceWith(stored.professional.id, 'ivac', 'AB-12'))
      expect(mocks.record.updateProfessional).toHaveBeenCalledExactlyOnceWith(stored.professional.id, { yearsExperience: 21 })
      expect(mocks.record.updateProfessional.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.setPayerNumber.mock.invocationCallOrder[0] ?? 0)
      // Clean once both are stored: the buttons go (decision UI-2).
      await waitFor(() => expect(within(section).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument())
    })

    it('saves the number, and an empty field deletes it', async () => {
      mocks.record.setPayerNumber.mockResolvedValue(undefined)
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.experience.title`))
      const ivac = within(payers).getByRole('textbox', { name: t(`${I}.payers.ivac`) })
      expect(ivac).toHaveValue('123456')
      await userEvent.clear(ivac)
      await save(payers)
      await waitFor(() => expect(mocks.record.setPayerNumber).toHaveBeenCalledExactlyOnceWith(stored.professional.id, 'ivac', null))
    })

    it('upper-cases the number once left, and saves it upper-case', async () => {
      mocks.record.setPayerNumber.mockResolvedValue(undefined)
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.experience.title`))
      const ivac = within(payers).getByRole('textbox', { name: t(`${I}.payers.ivac`) })
      await userEvent.clear(ivac)
      await userEvent.type(ivac, ' probe-777 ')
      await userEvent.tab()
      expect(ivac).toHaveValue('PROBE-777')
      await save(payers)
      await waitFor(() => expect(mocks.record.setPayerNumber).toHaveBeenCalledExactlyOnceWith(stored.professional.id, 'ivac', 'PROBE-777'))
    })

    it('shows a duplicate under the field (HINT ivac), not in a toast, and moves focus there', async () => {
      const message = 'Ce numéro IVAC est déjà attribué à un autre professionnel.'
      let refuse: (error: unknown) => void = () => {}
      mocks.record.setPayerNumber.mockReturnValue(new Promise((_, reject) => (refuse = reject)))
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.experience.title`))
      const ivac = within(payers).getByRole('textbox', { name: t(`${I}.payers.ivac`) })
      await userEvent.clear(ivac)
      await userEvent.type(ivac, '654321')
      await save(payers)
      // Focus is on « Enregistrer » while the save is in flight…
      expect(within(payers).getByRole('button', { name: t('common.saving') })).toHaveFocus()
      await act(async () => refuse({ code: 'P0001', message, hint: 'ivac', details: '' }))

      // …and goes to the field the refusal is about.
      await waitFor(() => expect(ivac).toHaveAccessibleDescription(`${t(`${I}.payers.ivacHelp`)} ${message}`))
      expect(ivac).toHaveFocus()
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(ivac).toHaveValue('654321')
    })

    it('shows another refusal in a toast', async () => {
      mocks.record.setPayerNumber.mockRejectedValue({ code: 'P0001', message: 'Professionnel introuvable.', hint: '', details: '' })
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.experience.title`))
      await userEvent.type(within(payers).getByRole('textbox', { name: t(`${I}.payers.ivac`) }), '7')
      await save(payers)
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Professionnel introuvable.'))
    })
  })

  describe('login email', () => {
    const loginEmail = () => screen.getByRole('textbox', { name: t(`${I}.contact.loginEmail`) })
    const changeButton = () => screen.getByRole('button', { name: t(`${I}.contact.changeLabel`) })

    it('is read-only in the card; « Modifier » changes it through its dialog', async () => {
      renderRecordTab(<IdentityTab />, { record: stored })
      expect(loginEmail()).toHaveAttribute('readonly')
      expect(loginEmail()).toHaveValue('marie.t@exemple.ca')
      await userEvent.click(changeButton())
      const dialog = await screen.findByRole('dialog', { name: t(`${I}.changeEmail.title`) })
      const field = within(dialog).getByRole('textbox', { name: required(t(`${I}.changeEmail.email`)) })
      await userEvent.clear(field)
      await userEvent.type(field, ' Marie.Tremblay@Exemple.CA ')
      await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.record.setProfessionalEmail).toHaveBeenCalledExactlyOnceWith(stored.professional.id, 'marie.tremblay@exemple.ca')
      // The dialog's submit never reaches the Coordonnées card.
      expect(mocks.record.updateProfessional).not.toHaveBeenCalled()
      await waitFor(() => expect(loginEmail()).toHaveValue('marie.tremblay@exemple.ca'))
    })

    it('says the link already sent stops working while one is live, and only then', async () => {
      const at = (expiresAt: string) => ({ invitation: { state: 'sent' as const, sentAt: '2026-10-05T14:00:00Z', expiresAt, openedAt: null, usedAt: null, delivery: 'email' as const, emailStatus: 'sent', emailError: null }, submission: null, onboardingApproved: false })
      renderRecordTab(<IdentityTab />, { record: stored, onboarding: at('2999-01-01T00:00:00Z') })
      await userEvent.click(changeButton())
      const dialog = await screen.findByRole('dialog', { name: t(`${I}.changeEmail.title`) })
      expect(dialog).toHaveAccessibleDescription(`${t(`${I}.changeEmail.description`)} ${t(`${I}.changeEmail.invitationStops`)}`)
    })

    it('says nothing of a link that is no longer live (expired)', async () => {
      const lapsed = { invitation: { state: 'sent' as const, sentAt: '2026-10-05T14:00:00Z', expiresAt: '2000-01-01T00:00:00Z', openedAt: null, usedAt: null, delivery: 'email' as const, emailStatus: 'sent', emailError: null }, submission: null, onboardingApproved: false }
      renderRecordTab(<IdentityTab />, { record: stored, onboarding: lapsed })
      await userEvent.click(changeButton())
      const dialog = await screen.findByRole('dialog', { name: t(`${I}.changeEmail.title`) })
      expect(dialog).toHaveAccessibleDescription(t(`${I}.changeEmail.description`))
    })

    it('shows a used address under the dialog field (HINT email)', async () => {
      const message = 'Ce courriel est déjà utilisé.'
      mocks.record.setProfessionalEmail.mockRejectedValue({ code: 'P0001', message, hint: 'email', details: '' })
      renderRecordTab(<IdentityTab />, { record: stored })
      await userEvent.click(changeButton())
      const dialog = await screen.findByRole('dialog')
      const field = within(dialog).getByRole('textbox')
      await userEvent.clear(field)
      await userEvent.type(field, 'adjointe@mana.test')
      await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
      await waitFor(() => expect(field).toHaveAccessibleDescription(message))
      expect(mocks.toast.error).not.toHaveBeenCalled()
    })

    it('keeps the dialog open with the message above the buttons when an account appeared meanwhile', async () => {
      const message = 'Ce professionnel a maintenant un compte : le courriel se change dans « Mon compte ».'
      mocks.record.setProfessionalEmail.mockImplementation(async () => {
        // The account was created meanwhile: the refetch the refusal triggers brings it.
        stored = { ...stored, professional: { ...stored.professional, profileId: '00000000-0000-4000-8000-000000009999' } }
        throw { code: 'P0001', message, hint: '', details: '' }
      })
      renderRecordTab(<IdentityTab />, { record: stored })
      await userEvent.click(changeButton())
      const dialog = await screen.findByRole('dialog')
      const field = within(dialog).getByRole('textbox')
      await userEvent.clear(field)
      await userEvent.type(field, 'nouveau@exemple.ca')
      await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
      // The record refetched with the account: the trigger is gone, the dialog stays.
      await waitFor(() => expect(screen.queryByRole('button', { name: t(`${I}.contact.changeLabel`), hidden: true })).not.toBeInTheDocument())
      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(field).toHaveValue('nouveau@exemple.ca')
      expect(mocks.toast.error).not.toHaveBeenCalled()

      await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(loginEmail()).toHaveFocus()
    })

    it('keeps the dialog open with the refusal when the permission was withdrawn (42501)', async () => {
      mocks.record.setProfessionalEmail.mockRejectedValue({ code: '42501', message: 'permission denied', hint: '', details: '' })
      const { setRole } = renderRecordTab(<IdentityTab />, { record: stored })
      await userEvent.click(changeButton())
      const dialog = await screen.findByRole('dialog')
      const field = within(dialog).getByRole('textbox')
      await userEvent.clear(field)
      await userEvent.type(field, 'nouveau@exemple.ca')
      await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('common.errors.forbidden'))

      // The refetched access no longer allows editing: the tab turns read-only behind the dialog.
      act(() => setRole('counselor'))
      expect(screen.queryByRole('button', { name: t(`${I}.contact.changeLabel`), hidden: true })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(within(dialog).getByRole('alert')).toHaveTextContent(t('common.errors.forbidden'))
      expect(field).not.toHaveAttribute('readonly')

      await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(loginEmail()).toHaveFocus()
    })

    it('has no « Modifier » once the professional has an account', () => {
      stored = { ...stored, professional: { ...stored.professional, profileId: '00000000-0000-4000-8000-000000009999' } }
      renderRecordTab(<IdentityTab />, { record: stored })
      expect(screen.queryByRole('button', { name: t(`${I}.contact.changeLabel`) })).not.toBeInTheDocument()
      expect(loginEmail()).toHaveAccessibleDescription(t(`${I}.contact.accountOwns`))
    })
  })

  it('is a description list for the conseillère (UI-3): one notice, the same sections, no field, no button', () => {
    stored = { ...stored, professional: { ...stored.professional, profileId: '00000000-0000-4000-8000-000000009999' } }
    renderRecordTab(<IdentityTab />, { record: stored, role: 'counselor' })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.getByText(t(`${I}.readOnly`))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('region').map((region) => within(region).getByRole('heading').textContent)).toEqual([
      t(`${I}.identity.title`),
      t(`${I}.contact.title`),
      t(`${I}.professions.title`),
      t(`${I}.experience.title`),
    ])
    const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
    expect(value(t(`${I}.identity.firstName`))).toBe(stored.professional.firstName)
    expect(value(t(`${I}.contact.province`))).toBe(t('settings.provinces.QC'))
    expect(value(t(`${I}.professions.primary`))).toBe('Psychologue · OPQ 12345')
    // Nothing recorded reads « Non indiqué », never a blank.
    expect(value(t(`${I}.identity.gender`))).toBe(t('common.notProvided'))
  })
})
