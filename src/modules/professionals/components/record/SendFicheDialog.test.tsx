import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { ProfessionalRecord } from '../../api/parse'
import { IDS } from '../../test/fixtures'
import { recordWithStatus } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { FicheMenu } from './FicheMenu'

const mocks = vi.hoisted(() => ({
  renderFichePdf: vi.fn(),
  uploadFile: vi.fn(),
  sendFicheEmail: vi.fn(),
  markFicheGenerated: vi.fn(),
  fetchPublicFees: vi.fn(),
  fetchOrganization: vi.fn(),
  fetchProfessionalsSettings: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../pdf/generate-fiche-pdf', () => ({ renderFichePdf: mocks.renderFichePdf }))
vi.mock('../../api/fiche', () => ({ sendFicheEmail: mocks.sendFicheEmail, markFicheGenerated: mocks.markFicheGenerated, fetchPublicFees: mocks.fetchPublicFees }))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), uploadFile: mocks.uploadFile }))
vi.mock('@/core/settings/organization/api', () => ({ fetchOrganization: mocks.fetchOrganization }))
vi.mock('../../api/settings', () => ({ fetchProfessionalsSettings: mocks.fetchProfessionalsSettings }))
vi.mock('@/shared/ui/sonner', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/ui/sonner')>()), toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const M = 'modules.professionals.fiche.menu'
const S = 'modules.professionals.fiche.send'
const E = 'modules.professionals.fiche.errors'
const PDF = new Blob(['%PDF-1.3'], { type: 'application/pdf' })
const FILE_ID = '11111111-1111-4111-8111-111111111111'

afterEach(() => vi.resetAllMocks())

function renderMenu(record: ProfessionalRecord = recordWithStatus('active', true)) {
  mocks.fetchOrganization.mockResolvedValue({ name: 'Clinique MANA', phone: null, email: null, website: null, logo_file_id: null })
  mocks.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false, ficheShowProContact: true, ficheShowClinicFooter: true, ficheShowClosing: true })
  mocks.renderFichePdf.mockResolvedValue(PDF)
  mocks.fetchPublicFees.mockResolvedValue([])
  mocks.uploadFile.mockResolvedValue({ fileId: FILE_ID })
  mocks.sendFicheEmail.mockResolvedValue({ emailLogId: 'log-1' })
  return renderRecordTab(<FicheMenu />, { record, role: 'counselor' })
}

const trigger = () => screen.getByRole('button', { name: t(`${M}.trigger`) })
async function openDialog() {
  await userEvent.click(trigger())
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.email`) }))
  return screen.findByRole('dialog', { name: t(`${S}.title`) })
}
const toField = () => screen.getByRole('textbox', { name: new RegExp(`^${t(`${S}.to`)}`) })
const submit = () => userEvent.click(screen.getByRole('button', { name: t(`${S}.submit`) }))

describe('SendFicheDialog', () => {
  it('is offered for an active professional only, saying why otherwise', async () => {
    renderMenu(recordWithStatus('draft', true))
    await userEvent.click(trigger())
    const item = await screen.findByRole('menuitem', { name: t(`${M}.email`) })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menu')).toHaveTextContent(t(`${M}.emailActiveOnly`))
  })

  it('opens on the address field, without a title choice for one title', async () => {
    renderMenu()
    const dialog = await openDialog()
    await waitFor(() => expect(toField()).toHaveFocus())
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent(t(`${S}.description`, { name: 'Marie Tremblay' }))
  })

  it('asks for a valid address before anything is made', async () => {
    renderMenu()
    await openDialog()
    await submit()
    expect(await screen.findByText(t(`${S}.emailRequired`))).toBeInTheDocument()
    await userEvent.type(toField(), 'client@exemple')
    await submit()
    expect(await screen.findByText(t(`${S}.invalidEmail`))).toBeInTheDocument()
    expect(mocks.renderFichePdf).not.toHaveBeenCalled()
  })

  it('makes the fiche, uploads that file, sends it, then closes and returns focus to « Fiche PDF »', async () => {
    const record = recordWithStatus('active', true)
    renderMenu(record)
    await openDialog()
    await userEvent.type(toField(), '  client@exemple.ca ')
    await userEvent.type(screen.getByRole('textbox', { name: t(`${S}.message`) }), '  Comme convenu, voici la fiche.  ')
    await submit()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ record, titleId: IDS.psychologue }))
    const upload = mocks.uploadFile.mock.calls[0]?.[0]
    expect(upload).toMatchObject({ purpose: 'professional_fiche', subjectType: 'professional', subjectId: IDS.professional, mimeType: 'application/pdf' })
    expect(upload.file).toBeInstanceOf(File)
    expect([upload.file.name, upload.file.type, upload.file.size]).toEqual(['Fiche - Marie Tremblay.pdf', 'application/pdf', PDF.size])
    expect(mocks.sendFicheEmail).toHaveBeenCalledWith({
      professionalId: IDS.professional,
      fileId: FILE_ID,
      to: 'client@exemple.ca',
      message: 'Comme convenu, voici la fiche.',
    })
    // The function stamps the fiche itself.
    expect(mocks.markFicheGenerated).not.toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.sent`, { email: 'client@exemple.ca' }))
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('offers the title when there are two, the primary first, and makes the fiche of the one chosen', async () => {
    const record = recordWithStatus('active', true)
    renderMenu({
      ...record,
      professions: [
        { id: 'r1', titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true },
        { id: 'r2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: false },
      ],
    })
    await openDialog()
    const select = screen.getByRole('combobox', { name: t(`${S}.titleLabel`) })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Psychologue', 'Naturopathe'])
    await userEvent.selectOptions(select, 'Naturopathe')
    await userEvent.type(toField(), 'client@exemple.ca')
    await submit()
    await waitFor(() => expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ titleId: IDS.naturopathe })))
  })

  it('shows an address the server refuses under its field, and keeps the dialog', async () => {
    renderMenu()
    mocks.sendFicheEmail.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Invalid recipient', { field: 'to' }))
    await openDialog()
    await userEvent.type(toField(), 'client@exemple.ca')
    await submit()
    await waitFor(() => expect(toField()).toHaveAccessibleDescription(expect.stringContaining(t(`${E}.invalidRecipient`))))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    ['a refusal, as written', new FunctionCallError('invalid_request', 400, 'Seuls les professionnels actifs peuvent être proposés.', { refusal: true }), 'Seuls les professionnels actifs peuvent être proposés.'],
    ['too many sends, with the delay', new FunctionCallError('rate_limited', 429, 'Too many', {}, 1_200), `${t(`${E}.rateLimited`)} ${t('common.retryIn.minutesOther', { count: '20' })}`],
    ['email not configured', new FunctionCallError('not_configured', 503, 'x'), t(`${E}.notConfigured`)],
    ['the provider down', new FunctionCallError('provider_error', 502, 'x'), t(`${E}.provider`)],
    ['the upload gone', new FunctionCallError('not_found', 404, 'x'), t(`${E}.uploadGone`)],
  ])('shows %s above the buttons', async (_case, error, text) => {
    renderMenu()
    mocks.sendFicheEmail.mockRejectedValue(error)
    await openDialog()
    await userEvent.type(toField(), 'client@exemple.ca')
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('says so when the upload fails, and sends nothing', async () => {
    renderMenu()
    mocks.uploadFile.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Ce fichier dépasse la taille permise (10 Mo).', { refusal: true }))
    await openDialog()
    await userEvent.type(toField(), 'client@exemple.ca')
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce fichier dépasse la taille permise (10 Mo).')
    expect(mocks.sendFicheEmail).not.toHaveBeenCalled()
  })

  it('says so when the fiche cannot be made, and uploads nothing', async () => {
    renderMenu()
    mocks.renderFichePdf.mockRejectedValue(new Error('font fetch failed'))
    await openDialog()
    await userEvent.type(toField(), 'client@exemple.ca')
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${E}.render`))
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
})
