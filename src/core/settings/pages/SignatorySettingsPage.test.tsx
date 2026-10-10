import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Organization } from '@/core/settings/organization/api'
import { LEAVE_LINK, renderOrganizationPage, testOrganization } from '@/test/organization'
import { SignatorySettingsPage } from './SignatorySettingsPage'

const mocks = vi.hoisted(() => ({
  api: { fetchOrganization: vi.fn(), updateOrganization: vi.fn(), setOrgAsset: vi.fn() },
  storage: { uploadFile: vi.fn(), signedFileUrl: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('@/core/settings/organization/api', () => mocks.api)
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), ...mocks.storage }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const CARD = t('settings.signatory.representative.title')
const SIGNATURE_ID = '44444444-4444-4444-8444-444444444444'
const card = () => screen.getByRole('form', { name: CARD })
const nameField = () => screen.getByRole('textbox', { name: t('settings.signatory.fields.name') })
const titleField = () => screen.getByRole('textbox', { name: t('settings.signatory.fields.title') })
const emailField = () => screen.getByRole('textbox', { name: t('settings.signatory.fields.email') })
const SIGNATURE = t('settings.signatory.signature.title')
const signatureCard = () => screen.getByRole('region', { name: SIGNATURE })
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
  it('shows the title and description, loads, then fills the card', async () => {
    mocks.api.fetchOrganization.mockResolvedValue(testOrganization)
    renderOrganizationPage(<SignatorySettingsPage />)
    expect(screen.getByRole('heading', { level: 1, name: t('settings.sections.signatory') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.signatory.description'))).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))

    expect(await screen.findByRole('form', { name: CARD })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Marie Tremblay')
    expect(titleField()).toHaveValue('Directrice')
    expect(titleField()).toHaveAttribute('placeholder', 'Directrice')
    expect(emailField()).toHaveValue('direction@cliniquemana.com')
    expect(emailField()).toHaveAttribute('type', 'email')
    expect(emailField()).toHaveAccessibleDescription(t('settings.signatory.fields.emailHelp'))
  })

  it('refuses an invalid email without saving', async () => {
    await renderPage()
    await edit(emailField(), 'direction@clinique')
    await save()
    expect(await screen.findByText(t('auth.errors.invalidEmail'))).toBeInTheDocument()
    expect(emailField()).toHaveAccessibleDescription(`${t('settings.signatory.fields.emailHelp')} ${t('auth.errors.invalidEmail')}`)
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it('saves the email trimmed, and an empty one as null', async () => {
    saveEchoes()
    await renderPage()
    await edit(emailField(), ' signature@cliniquemana.com ')
    await save()
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Signataire enregistré.'))
    expect(mocks.api.updateOrganization).toHaveBeenLastCalledWith('o1', expect.objectContaining({ signatory_email: 'signature@cliniquemana.com' }))

    await edit(emailField(), '')
    await save()
    await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenLastCalledWith('o1', expect.objectContaining({ signatory_email: null })))
  })

  it('refuses a name over 120 characters without saving', async () => {
    await renderPage()
    await edit(nameField(), 'a'.repeat(121))
    await save()
    expect(await screen.findByText('120 caractères maximum.')).toBeInTheDocument()
    expect(nameField()).toHaveAccessibleDescription('120 caractères maximum.')
    expect(mocks.api.updateOrganization).not.toHaveBeenCalled()
  })

  it('saves its three fields only, trimmed and empty as null, then confirms « Signataire enregistré. »', async () => {
    saveEchoes()
    await renderPage()
    await edit(nameField(), '  Julie Gagnon ')
    await edit(titleField(), '')
    await save()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Signataire enregistré.'))
    expect(mocks.api.updateOrganization).toHaveBeenCalledExactlyOnceWith('o1', {
      signatory_name: 'Julie Gagnon',
      signatory_title: null,
      signatory_email: 'direction@cliniquemana.com',
    })
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

  it('follows the reading order with Tab: Nom, Titre, Courriel, then (once dirty) Annuler, Enregistrer', async () => {
    await renderPage()
    const controls = labelledControls()
    expect(controls.map((c) => c.getAttribute('name'))).toEqual(['signatory_name', 'signatory_title', 'signatory_email'])
    expect(within(card()).queryAllByRole('button')).toEqual([])
    await edit(nameField(), 'Autre')
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
      expect(controls).toHaveLength(3)
      for (const control of controls) {
        expect(control).toHaveRole('textbox')
        expect(control).toHaveAttribute('readonly')
        expect(control).toBeEnabled()
      }
      expect(nameField()).toHaveValue('Marie Tremblay')
      expect(titleField()).not.toHaveAttribute('placeholder')
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('hides the signature image card, and asks for no URL (only settings.manage may see it)', async () => {
      await renderPage({ organization: { ...testOrganization, signature_file_id: SIGNATURE_ID }, readOnly: true })
      expect(screen.queryByRole('region', { name: SIGNATURE })).not.toBeInTheDocument()
      expect(screen.queryByText(t('settings.signatory.signature.description'))).not.toBeInTheDocument()
      expect(mocks.storage.signedFileUrl).not.toHaveBeenCalled()
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

  describe('« Image de signature » (settings.manage)', () => {
    const NEW_ID = '33333333-3333-4333-8333-333333333333'
    const preview = () => within(signatureCard()).getByRole('img', { name: t('settings.signatory.signature.alt') })

    it('comes after the signatory card, with its help, and shows the image through a signed URL', async () => {
      mocks.storage.signedFileUrl.mockResolvedValue({ url: 'https://x.test/s.png?token=t', expiresAt: '2026-10-08T12:05:00Z' })
      await renderPage({ organization: { ...testOrganization, signature_file_id: SIGNATURE_ID } })
      expect(card().compareDocumentPosition(signatureCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(within(signatureCard()).getByText(t('settings.signatory.signature.description'))).toBeInTheDocument()
      expect(within(signatureCard()).getByRole('button', { name: t('settings.signatory.signature.replace') })).toHaveAccessibleDescription(
        // The limits come from UPLOAD_PURPOSES (checked against the migrations), not the text.
        /^PNG à fond transparent recommandé \(JPEG accepté\), 2 Mo et 4\s000 pixels de côté au plus\.$/,
      )
      await waitFor(() => expect(preview()).toHaveAttribute('src', 'https://x.test/s.png?token=t'))
      expect(mocks.storage.signedFileUrl).toHaveBeenCalledWith(SIGNATURE_ID, expect.anything())
    })

    it('uploads an image as org_signature and sets it as the signature', async () => {
      mocks.storage.uploadFile.mockResolvedValue({ fileId: NEW_ID })
      mocks.api.setOrgAsset.mockResolvedValue(undefined)
      mocks.storage.signedFileUrl.mockResolvedValue({ url: 'https://x.test/n.png?token=t', expiresAt: '2026-10-08T12:05:00Z' })
      await renderPage()
      expect(within(signatureCard()).getByText(t('settings.signatory.signature.empty'))).toBeInTheDocument()
      const input = signatureCard().querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(input, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'signature.png', { type: 'image/png' }))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.signatory.signature.saved')))
      expect(mocks.storage.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'org_signature', subjectType: 'organization', subjectId: 'o1' }))
      expect(mocks.api.setOrgAsset).toHaveBeenCalledExactlyOnceWith('signature', NEW_ID)
    })
  })
})
