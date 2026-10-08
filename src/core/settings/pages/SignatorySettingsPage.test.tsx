import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { LEAVE_LINK, renderOrganizationPage, testOrganization } from '@/test/organization'
import { SignatorySettingsPage } from './SignatorySettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchOrganization: vi.fn(), updateOrganization: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/organization/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const CARD = t('settings.signatory.representative.title')
const card = () => screen.getByRole('form', { name: CARD })
const nameField = () => screen.getByRole('textbox', { name: t('settings.signatory.fields.name') })
const titleField = () => screen.getByRole('textbox', { name: t('settings.signatory.fields.title') })
const save = () => userEvent.click(within(card()).getByRole('button', { name: t('common.save') }))

const labelledControls = () =>
  [...card().querySelectorAll('label')].map((label) => document.getElementById(label.htmlFor) as HTMLElement)

async function edit(element: HTMLElement, value: string) {
  await userEvent.clear(element)
  if (value) await userEvent.type(element, value)
}

async function renderPage({ organization = testOrganization, readOnly = false }: { organization?: Organization; readOnly?: boolean } = {}) {
  mocks.api.fetchOrganization.mockResolvedValue(organization)
  const result = renderOrganizationPage(<SignatorySettingsPage />, { readOnly })
  await screen.findByRole('form', { name: CARD })
  return result
}

function saveEchoes() {
  mocks.api.updateOrganization.mockImplementation(async (_id: string, patch: Partial<Organization>) => ({ ...testOrganization, ...patch }))
}

describe('SignatorySettingsPage', () => {
  it('shows the title and description, loads, then fills the card, with the note about the signature image', async () => {
    mocks.api.fetchOrganization.mockResolvedValue(testOrganization)
    renderOrganizationPage(<SignatorySettingsPage />)
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.signatory') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.signatory.description'))).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))

    expect(await screen.findByRole('form', { name: CARD })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Marie Tremblay')
    expect(titleField()).toHaveValue('Directrice')
    expect(titleField()).toHaveAttribute('placeholder', 'Directrice')
    // The note sits under the card, outside it.
    const note = screen.getByText("L'image de la signature s'ajoutera avec les contrats.")
    expect(card()).not.toContainElement(note)
    expect(card().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('refuses a name over 120 characters without saving', async () => {
    await renderPage()
    await edit(nameField(), 'a'.repeat(121))
    await save()
    expect(await screen.findByText('120 caractères maximum.')).toBeInTheDocument()
    expect(nameField()).toHaveAccessibleDescription('120 caractères maximum.')
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it('saves its two fields only, trimmed and empty as null, then confirms « Signataire enregistré. »', async () => {
    saveEchoes()
    await renderPage()
    await edit(nameField(), '  Julie Gagnon ')
    await edit(titleField(), '')
    await save()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Signataire enregistré.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', { signatory_name: 'Julie Gagnon', signatory_title: null })
    await waitFor(() => expect(nameField()).toHaveValue('Julie Gagnon'))
  })

  it('shows the mapped error when the save is refused', async () => {
    mocks.api.updateOrganization.mockRejectedValue({ code: 'P0001', message: 'Refusé par la base.' })
    await renderPage()
    await edit(titleField(), 'Directeur')
    await save()
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Refusé par la base.'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('asks before leaving with unsaved changes', async () => {
    await renderPage()
    await userEvent.type(titleField(), ' générale')
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })

  it('follows the reading order with Tab: Nom, Titre, Annuler, Enregistrer', async () => {
    await renderPage()
    const controls = labelledControls()
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(['signatory_name', 'signatory_title'])
    const buttons = within(card()).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([t('common.cancel'), t('common.save')])
    const [first, ...rest] = [...controls, ...buttons]
    first?.focus()
    for (const control of rest) {
      await userEvent.tab()
      expect(document.activeElement).toBe(control)
    }
  })

  it('« Annuler » puts the stored values back and returns focus to Nom', async () => {
    await renderPage()
    await edit(nameField(), 'Autre')
    await userEvent.click(within(card()).getByRole('button', { name: t('common.cancel') }))
    expect(nameField()).toHaveValue('Marie Tremblay')
    await waitFor(() => expect(nameField()).toHaveFocus())
  })

  describe('read-only (settings.view without settings.manage)', () => {
    it('shows the notice once, every field read-only (focusable, not disabled), no placeholder and no buttons', async () => {
      await renderPage({ readOnly: true })
      expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
      const controls = labelledControls()
      expect(controls).toHaveLength(2)
      for (const control of controls) {
        expect(control).toHaveRole('textbox')
        expect(control).toHaveAttribute('readonly')
        expect(control).toBeEnabled()
      }
      expect(nameField()).toHaveValue('Marie Tremblay')
      expect(titleField()).not.toHaveAttribute('placeholder')
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.getByText(t('settings.signatory.note'))).toBeInTheDocument()
    })

    it('lets the values be reached and not changed', async () => {
      await renderPage({ readOnly: true })
      nameField().focus()
      await userEvent.keyboard('xyz')
      expect(nameField()).toHaveValue('Marie Tremblay')
      await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
    })
  })
})
