import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../../api/parse'
import type { ProfessionalPatch } from '../../../api/record'
import { recordFixture } from '../../../test/fixtures-domain'
import { renderRecordTab } from '../../../test/record-tab'
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
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const I = 'modules.professionals.record.identity'
let stored: ProfessionalRecord

beforeEach(() => {
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
    it('saves the number, and an empty field deletes it', async () => {
      mocks.record.setPayerNumber.mockResolvedValue(undefined)
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.payers.title`))
      const ivac = within(payers).getByRole('textbox', { name: t(`${I}.payers.ivac`) })
      expect(ivac).toHaveValue('123456')
      await userEvent.clear(ivac)
      await save(payers)
      await waitFor(() => expect(mocks.record.setPayerNumber).toHaveBeenCalledExactlyOnceWith(stored.professional.id, 'ivac', null))
    })

    it('shows a duplicate under the field (HINT ivac), not in a toast', async () => {
      const message = 'Ce numéro IVAC est déjà attribué à un autre professionnel.'
      mocks.record.setPayerNumber.mockRejectedValue({ code: 'P0001', message, hint: 'ivac', details: '' })
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.payers.title`))
      const ivac = within(payers).getByRole('textbox', { name: t(`${I}.payers.ivac`) })
      await userEvent.clear(ivac)
      await userEvent.type(ivac, '654321')
      await save(payers)

      await waitFor(() => expect(ivac).toHaveAccessibleDescription(`${t(`${I}.payers.ivacHelp`)} ${message}`))
      expect(ivac).toHaveFocus()
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(ivac).toHaveValue('654321')
    })

    it('shows another refusal in a toast', async () => {
      mocks.record.setPayerNumber.mockRejectedValue({ code: 'P0001', message: 'Professionnel introuvable.', hint: '', details: '' })
      renderRecordTab(<IdentityTab />, { record: stored })
      const payers = card(t(`${I}.payers.title`))
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

    it('has no « Modifier » once the professional has an account', () => {
      stored = { ...stored, professional: { ...stored.professional, profileId: '00000000-0000-4000-8000-000000009999' } }
      renderRecordTab(<IdentityTab />, { record: stored })
      expect(screen.queryByRole('button', { name: t(`${I}.contact.changeLabel`) })).not.toBeInTheDocument()
      expect(loginEmail()).toHaveAccessibleDescription(t(`${I}.contact.accountOwns`))
    })
  })

  it('is read-only for the conseillère: one notice, focusable values, no buttons', () => {
    renderRecordTab(<IdentityTab />, { record: stored, role: 'counselor' })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.getByText(t(`${I}.readOnly`))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const first = screen.getByRole('textbox', { name: t(`${I}.identity.firstName`) })
    expect(first).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: t(`${I}.contact.province`) })).toHaveValue(t('settings.provinces.QC'))
    expect(screen.getByRole('textbox', { name: 'N° de permis' })).toHaveValue('12345')
  })
})
