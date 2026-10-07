import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { clinicSchema, toClinicFormValues } from '@/core/settings/organization/schemas'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { LEAVE_LINK, renderOrganizationPage, testOrganization } from '@/test/organization'
import { OrganizationCard } from './OrganizationCard'

const mocks = vi.hoisted(() => ({
  api: { fetchOrganization: vi.fn(), updateOrganization: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/organization/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

/** A two-field card on the « Clinique » schema: the generic behaviour, independent of any page. */
function card(organization: Organization = testOrganization) {
  return (
    <OrganizationCard
      organization={organization}
      title="Clinique"
      description="Le nom et le NEQ."
      schema={clinicSchema}
      toFormValues={toClinicFormValues}
      successMessage="Clinique enregistrée."
    >
      {(form) => (
        <>
          <FormField label="Nom" required error={form.formState.errors.name?.message}>
            {(field) => <Input {...field} {...form.register('name')} />}
          </FormField>
          <FormField label="NEQ" error={form.formState.errors.neq?.message}>
            {(field) => <Input {...field} {...form.register('neq')} />}
          </FormField>
        </>
      )}
    </OrganizationCard>
  )
}

const neq = () => screen.getByRole('textbox', { name: 'NEQ' })
const saveButton = () => screen.getByRole('button', { name: t('common.save') })
const cancelButton = () => screen.getByRole('button', { name: t('common.cancel') })
const leave = () => userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
const location = () => screen.getByTestId('location').textContent

async function edit(field: HTMLElement, value: string) {
  await userEvent.clear(field)
  if (value) await userEvent.type(field, value)
}

describe('OrganizationCard', () => {
  it('fills the form from the organization; Annuler and Enregistrer wait for a change', () => {
    renderOrganizationPage(card())
    expect(screen.getByRole('form', { name: 'Clinique' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: `Nom ${t('common.form.required')}` })).toHaveValue('Clinique MANA')
    expect(neq()).toHaveValue('1234567890')
    expect(saveButton()).toBeDisabled()
    expect(cancelButton()).toBeDisabled()
  })

  it('puts Annuler before Enregistrer (reading and tab order)', () => {
    renderOrganizationPage(card())
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual([t('common.cancel'), t('common.save')])
  })

  it('shows the field error and does not save an invalid value', async () => {
    renderOrganizationPage(card())
    await edit(neq(), '123')
    await userEvent.click(saveButton())
    expect(await screen.findByText(t('settings.validation.neq'))).toBeInTheDocument()
    expect(neq()).toHaveAttribute('aria-invalid', 'true')
    expect(neq()).toHaveFocus()
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it("saves only this card's fields, normalised, then shows the saved values and is clean again", async () => {
    mocks.api.updateOrganization.mockImplementation(async (_id, patch) => ({ ...testOrganization, ...patch }))
    renderOrganizationPage(card())
    await edit(neq(), ' 9876 543-210 ')
    await userEvent.click(saveButton())

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Clinique enregistrée.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', {
      name: 'Clinique MANA',
      legal_name: '9999-9999 Québec inc.',
      neq: '9876543210',
    })
    await waitFor(() => expect(neq()).toHaveValue('9876543210'))
    expect(saveButton()).toBeDisabled()
    expect(cancelButton()).toBeDisabled()
  })

  it('disarms the guard after a save whose normalised values equal what was stored', async () => {
    // Same NEQ, typed differently: dirty for the form, unchanged once saved.
    mocks.api.updateOrganization.mockResolvedValue(testOrganization)
    renderOrganizationPage(card())
    await edit(neq(), '1234-567-890')
    await userEvent.click(saveButton())
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())

    await waitFor(() => expect(neq()).toHaveValue('1234567890'))
    await leave()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(location()).toBe('/ailleurs')
  })

  it('arms the guard while dirty: leaving asks first', async () => {
    renderOrganizationPage(card())
    await edit(neq(), '9876543210')
    await leave()
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
    expect(location()).toBe('/parametres/identite')
  })

  it('Annuler restores the saved values and disarms the guard', async () => {
    renderOrganizationPage(card())
    await edit(neq(), '123')
    await userEvent.click(saveButton())
    await screen.findByText(t('settings.validation.neq'))

    await userEvent.click(cancelButton())
    expect(neq()).toHaveValue('1234567890')
    expect(screen.queryByText(t('settings.validation.neq'))).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    await leave()
    expect(location()).toBe('/ailleurs')
  })

  it('marks the form busy and the button pending while saving', async () => {
    mocks.api.updateOrganization.mockReturnValue(new Promise(() => {}))
    renderOrganizationPage(card())
    await edit(neq(), '9876543210')
    await userEvent.click(saveButton())

    expect(await screen.findByRole('button', { name: t('common.saving') })).toBeDisabled()
    expect(screen.getByRole('form', { name: 'Clinique' })).toHaveAttribute('aria-busy', 'true')
    expect(cancelButton()).toBeDisabled()
  })

  it.each([
    [{ code: 'P0001', message: 'Ce NEQ appartient déjà à une autre clinique.' }, 'Ce NEQ appartient déjà à une autre clinique.'],
    [{ code: '23514', message: 'violates check constraint "organizations_neq_check"' }, t('common.errors.invalidValue')],
  ])('shows the mapped error (%o) and keeps the edit', async (error, message) => {
    mocks.api.updateOrganization.mockRejectedValue(error)
    renderOrganizationPage(card())
    await edit(neq(), '9876543210')
    await userEvent.click(saveButton())

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message))
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(neq()).toHaveValue('9876543210')
    expect(saveButton()).toBeEnabled()
  })

  it('keeps unsaved edits when the organization changes underneath (another card saved), and takes the rest', async () => {
    const { rerender } = renderOrganizationPage(card())
    await edit(neq(), '9876543210')
    // What another card's save does: the cached organization changes (here, its legal name too).
    rerender(card({ ...testOrganization, name: 'Clinique MANA Laval', neq: '1111111111' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: `Nom ${t('common.form.required')}` })).toHaveValue('Clinique MANA Laval'))
    expect(neq()).toHaveValue('9876543210')
    expect(saveButton()).toBeEnabled()
  })

  it('keeps what was typed while the save was in flight: still there, dirty, guard armed', async () => {
    let resolve: (saved: Organization) => void = () => {}
    mocks.api.updateOrganization.mockReturnValue(new Promise((r) => (resolve = r)))
    renderOrganizationPage(card())
    await edit(neq(), '9876543210')
    await userEvent.click(saveButton())
    await screen.findByRole('button', { name: t('common.saving') })

    // The fields stay enabled while saving: the user goes on typing.
    const name = screen.getByRole('textbox', { name: `Nom ${t('common.form.required')}` })
    await userEvent.type(name, ' Laval')
    resolve({ ...testOrganization, neq: '9876543210' })

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(name).toHaveValue('Clinique MANA Laval')
    expect(neq()).toHaveValue('9876543210')
    await leave()
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('a field typed back to its submitted value during the save takes the saved (normalised) value', async () => {
    let resolve: (saved: Organization) => void = () => {}
    mocks.api.updateOrganization.mockReturnValue(new Promise((r) => (resolve = r)))
    renderOrganizationPage(card())
    await edit(neq(), '9876-543-210')
    await userEvent.click(saveButton())
    await screen.findByRole('button', { name: t('common.saving') })
    resolve({ ...testOrganization, neq: '9876543210' })

    await waitFor(() => expect(neq()).toHaveValue('9876543210'))
    expect(saveButton()).toBeDisabled()
  })

  it('keeps its validation errors when the organization changes underneath (another card saved, a refetch)', async () => {
    const { rerender } = renderOrganizationPage(card())
    await edit(neq(), '123')
    await userEvent.click(saveButton())
    await screen.findByText(t('settings.validation.neq'))

    rerender(card({ ...testOrganization, name: 'Clinique MANA Laval' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: `Nom ${t('common.form.required')}` })).toHaveValue('Clinique MANA Laval'))
    expect(screen.getByText(t('settings.validation.neq'))).toBeInTheDocument()
    expect(neq()).toHaveAttribute('aria-invalid', 'true')
    expect(neq()).toHaveValue('123')
  })

  describe('read-only', () => {
    it('renders the values read-only and focusable, without Annuler or Enregistrer', async () => {
      renderOrganizationPage(card(), { readOnly: true })
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(neq()).toHaveAttribute('readonly')
      expect(neq()).toBeEnabled()
      await userEvent.tab() // the leave link
      await userEvent.tab()
      expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveFocus()
    })

    it('never arms the guard, even if a value changes (e.g. an extension writes into a field)', async () => {
      renderOrganizationPage(card(), { readOnly: true })
      fireEvent.change(neq(), { target: { value: '9876543210' } })
      fireEvent.input(neq(), { target: { value: '9876543210' } })
      await leave()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(location()).toBe('/ailleurs')
      expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
    })
  })
})
