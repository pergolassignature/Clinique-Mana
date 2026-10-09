import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { FixtureRole } from '@/test/role-fixtures'
import { IDS } from '../../test/fixtures'
import { pageCountOf, pdfWithPages } from '@/core/signing/test/pdf-fixture'
import { contractJson, parsedContract, REQUEST_ID, requestJson, SIGNED_FILE, SIGNED_REQUEST, SOURCE_FILE } from '../../test/fixtures-contract'
import { recordFixture } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { ContractCard } from './ContractCard'

const mocks = vi.hoisted(() => ({
  contracts: { fetchProfessionalContract: vi.fn(), sendProfessionalContract: vi.fn(), previewProfessionalContract: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn() },
  sync: vi.fn(),
  documentDownloadUrl: vi.fn(),
  fetchStoredFile: vi.fn(),
  saveBlob: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/contracts')>()), ...mocks.contracts }))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/core/signing/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/signing/api')>()), syncSignatureRequest: mocks.sync }))
vi.mock('../../api/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/documents')>()),
  documentDownloadUrl: (...args: unknown[]) => mocks.documentDownloadUrl(...args),
}))
vi.mock('@/core/storage/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/storage/api')>()),
  fetchStoredFile: (...args: unknown[]) => mocks.fetchStoredFile(...args),
}))
vi.mock('@/shared/lib/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/files')>()),
  saveBlob: (...args: unknown[]) => mocks.saveBlob(...args),
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())
// jsdom has no blob URLs (and would fetch one in the iframe): the preview's PDF is shown through one (P4-502).
const blobUrls = { create: vi.fn(() => 'about:blank#pdf'), revoke: vi.fn() }
Object.assign(URL, { createObjectURL: blobUrls.create, revokeObjectURL: blobUrls.revoke })

const P = 'modules.professionals.contract.preview'
/** What the function answers to a preview, parsed (`previewProfessionalContract`). */
const PREVIEW = {
  bytes: new Uint8Array([37, 80, 68, 70]),
  pageCount: 9,
  title: 'Contrat de service — Marie Tremblay',
  signers: [
    { role: 'professional', name: 'Marie Tremblay', order: 1 },
    { role: 'clinic', name: 'Dominique Exemple', order: 2 },
  ],
  summary: [
    { label: 'Profession', value: 'Psychologue' },
    { label: 'Rencontre 50 min', value: '175 $ facturés au client · 126 $ versés au professionnel (avant taxes)' },
  ],
}

const C = 'modules.professionals.contract'
const A = `${C}.actions`

async function openCard(json: Record<string, unknown> | null, { role = 'admin', permissions }: { role?: FixtureRole; permissions?: string[] } = {}) {
  mocks.contracts.fetchProfessionalContract.mockResolvedValue(json === null ? null : parsedContract(json))
  mocks.record.fetchProfessionalRecord.mockResolvedValue(recordFixture())
  mocks.documentDownloadUrl.mockResolvedValue('https://files.test/contrat.pdf')
  const rendered = renderRecordTab(<ContractCard />, { record: recordFixture(), role, permissions })
  await screen.findByText(t(`${C}.title`))
  await waitFor(() => expect(screen.queryByText(t('common.loading'))).not.toBeInTheDocument())
  return rendered
}

const button = (name: string) => screen.queryByRole('button', { name })
const DATE = /\d{1,2} \S+ 2026/

describe('ContractCard (Task 4d.3)', () => {
  it('no contract: « Préparer le contrat » shows the PDF first, then sends it with the previewed key (P4-502)', async () => {
    mocks.contracts.previewProfessionalContract.mockResolvedValue(PREVIEW)
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await openCard(contractJson(null))
    expect(screen.getByText(t(`${C}.state.none`))).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.none`, { firstName: 'Marie' }))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.send`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${P}.title`, { firstName: 'Marie' }) })
    expect(await within(dialog).findByTitle(t(`${P}.frameTitle`))).toHaveAttribute('src', 'about:blank#pdf')
    expect(dialog).toHaveTextContent(`${t(`${P}.pages`)}9`)
    expect(dialog).toHaveTextContent(`${t(`${P}.version`)}2`)
    expect(dialog).toHaveTextContent('Professionnel : Marie Tremblay')
    expect(dialog).toHaveTextContent('Clinique : Dominique Exemple')
    expect(dialog).toHaveTextContent('175 $ facturés au client · 126 $ versés au professionnel (avant taxes)')
    expect(dialog).toHaveTextContent(t(`${P}.frozen`))
    expect(mocks.contracts.sendProfessionalContract).not.toHaveBeenCalled()
    const [, action, key, form] = mocks.contracts.previewProfessionalContract.mock.calls[0]!
    expect([action, form]).toEqual(['send', 'service_contract'])
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.send`, { firstName: 'Marie' }) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledExactlyOnceWith(IDS.professional, 'send', key, 'service_contract'))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.toasts.send`, { firstName: 'Marie' })))
    // Closed: the PDF's blob URL is revoked.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(blobUrls.revoke).toHaveBeenCalledWith('about:blank#pdf')
  })

  it('« Rafraîchir l’aperçu » draws a new key; « Annuler » sends nothing', async () => {
    mocks.contracts.previewProfessionalContract.mockResolvedValue(PREVIEW)
    await openCard(contractJson(null))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.send`) }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTitle(t(`${P}.frameTitle`))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.refresh`) }))
    await waitFor(() => expect(mocks.contracts.previewProfessionalContract).toHaveBeenCalledTimes(2))
    const [first, second] = mocks.contracts.previewProfessionalContract.mock.calls.map((c) => c[2])
    expect(second).not.toEqual(first)
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.contracts.sendProfessionalContract).not.toHaveBeenCalled()
  })

  it('a refusal shows in the preview, before anything is sent', async () => {
    mocks.contracts.previewProfessionalContract.mockRejectedValue({ code: 'P0001', message: 'Aucune grille de rémunération pour ce titre.', hint: 'pricing' })
    await openCard(contractJson(null))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.send`) }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Aucune grille de rémunération pour ce titre.')).toBeInTheDocument()
    const sendButton = within(dialog).getByRole('button', { name: t(`${P}.send`, { firstName: 'Marie' }) })
    expect(sendButton).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(sendButton)
    expect(mocks.contracts.sendProfessionalContract).not.toHaveBeenCalled()
  })

  it('« Voir le contrat envoyé »: the stored source PDF, for its readers only', async () => {
    mocks.fetchStoredFile.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    await openCard(contractJson(requestJson({ source_file_id: SOURCE_FILE, page_count: 9 })))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.viewSent`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${P}.sentTitle`, { firstName: 'Marie' }) })
    expect(await within(dialog).findByTitle(t(`${P}.frameTitle`))).toBeInTheDocument()
    expect(mocks.fetchStoredFile).toHaveBeenCalledWith(SOURCE_FILE, expect.anything())
    expect(dialog).toHaveTextContent(`${t(`${P}.pages`)}9`)
    expect(within(dialog).queryByRole('button', { name: t(`${P}.send`, { firstName: 'Marie' }) })).not.toBeInTheDocument()
    expect(mocks.contracts.previewProfessionalContract).not.toHaveBeenCalled()
  })

  it('« Voir le contrat envoyé » is hidden without a readable source', async () => {
    await openCard(contractJson(requestJson({ source_file_id: SOURCE_FILE, can_read: false })))
    expect(button(t(`${A}.viewSent`))).toBeNull()
  })

  it('without a published template: says so with a link to « Contrats », and the send does nothing', async () => {
    await openCard(contractJson(null, { template: null }))
    expect(screen.getByText(t(`${C}.noTemplate`), { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${C}.noTemplateLink`) })).toHaveAttribute('href', '/parametres/contrats')
    const send = screen.getByRole('button', { name: t(`${A}.send`) })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(send)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('says when only the professional will sign', async () => {
    await openCard(contractJson(null, { clinic_signer: false }))
    expect(screen.getByText(t(`${C}.noClinicSigner`))).toBeInTheDocument()
  })

  it('out for signature: the dates, each signer’s progress, and synchronise · resend · regenerate', async () => {
    mocks.sync.mockResolvedValue({ outcome: 'unchanged' })
    await openCard(
      contractJson(
        requestJson({
          status: 'viewed',
          viewed_at: '2026-10-09T13:00:00+00:00',
          signers: [
            { role: 'professional', name: 'Marie Tremblay', status: 'viewed', signing_order: 1, viewed_at: '2026-10-09T13:00:00+00:00', signed_at: null, rejected_at: null },
            { role: 'clinic', name: 'Dominique Exemple', status: 'pending', signing_order: 2, viewed_at: null, signed_at: null, rejected_at: null },
          ],
        }),
      ),
    )
    expect(screen.getByText(t(`${C}.version`, { version: '2' }))).toBeInTheDocument()
    expect(screen.getByText(/^Envoyé le .+ · Consulté le .+ · Expire le .+$/)).toBeInTheDocument()
    const signers = within(screen.getByRole('list', { name: t(`${C}.signersLabel`) })).getAllByRole('listitem')
    expect(signers[0]).toHaveTextContent('Professionnel · Marie Tremblay')
    expect(signers[0]).toHaveTextContent(/Consulté le \d/)
    expect(signers[1]).toHaveTextContent('Clinique · Dominique Exemple')
    expect(signers[1]).toHaveTextContent(t(`${C}.signer.pending`))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t(`${A}.sync`), t(`${A}.resend`), t(`${A}.regenerate`)])
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.sync`) }))
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(REQUEST_ID))
  })

  it('« Régénérer » previews first and warns that the contract out is cancelled', async () => {
    mocks.contracts.previewProfessionalContract.mockResolvedValue(PREVIEW)
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await openCard(contractJson(requestJson()))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.regenerate`) }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(t(`${P}.regenerateNote`))
    await within(dialog).findByTitle(t(`${P}.frameTitle`))
    const key = mocks.contracts.previewProfessionalContract.mock.calls[0]![2]
    expect(mocks.contracts.previewProfessionalContract.mock.calls[0]![1]).toBe('regenerate')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.send`, { firstName: 'Marie' }) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledWith(IDS.professional, 'regenerate', key, 'service_contract'))
  })

  it('« Renvoyer » names the next signer: the clinic once the professional has signed', async () => {
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await openCard(
      contractJson(
        requestJson({
          status: 'viewed',
          signers: [
            { role: 'professional', name: 'Marie Tremblay', status: 'signed', signing_order: 1, viewed_at: '2026-10-09T13:00:00+00:00', signed_at: '2026-10-09T13:05:00+00:00', rejected_at: null },
            { role: 'clinic', name: 'Dominique Exemple', status: 'pending', signing_order: 2, viewed_at: null, signed_at: null, rejected_at: null },
          ],
        }),
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.resend`) }))
    const dialog = await screen.findByRole('alertdialog', { name: t(`${C}.confirm.resend.title`, { firstName: 'Dominique Exemple' }) })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${C}.confirm.resend.action`) }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.toasts.resend`, { firstName: 'Dominique Exemple' })))
    expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledWith(IDS.professional, 'resend', expect.any(String), 'service_contract')
  })

  it('a failed send shows its reason in the card', async () => {
    mocks.contracts.previewProfessionalContract.mockResolvedValue(PREVIEW)
    mocks.contracts.sendProfessionalContract.mockRejectedValue(new FunctionCallError('missing_variable', 400, 'x', { label: 'Adresse du professionnel' }))
    await openCard(contractJson(null))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.send`) }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTitle(t(`${P}.frameTitle`))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.send`, { firstName: 'Marie' }) }))
    expect(await screen.findByText(t(`${C}.errors.missingVariable`, { label: 'Adresse du professionnel' }))).toBeInTheDocument()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('signed: « Signé le … », the contract alone, the certificate and journal, the sealed proof, and the signing journal (P4-500)', async () => {
    // The sealed PDF: the 7-page contract, then 3 pages of Documenso.
    const stored: Record<string, Uint8Array> = { [SIGNED_FILE]: await pdfWithPages(10) }
    mocks.fetchStoredFile.mockImplementation((id: string) => Promise.resolve(stored[id]))
    await openCard(contractJson(SIGNED_REQUEST))
    expect(screen.getByText('Signé')).toBeInTheDocument()
    expect(screen.getByText(/^Envoyé le .+ · Signé le .+$/)).toBeInTheDocument()
    expect(screen.getByText(t('signing.downloads.sealedHelp'), { exact: false })).toBeInTheDocument()
    // Read at the press, never on render nor every few minutes (storage-sign: 120 an hour, P4-455).
    const contract = screen.getByRole('button', { name: t(`${A}.pdfLabel`, { firstName: 'Marie' }) })
    expect(contract).toHaveTextContent('Télécharger le contrat signé')
    expect(mocks.fetchStoredFile).not.toHaveBeenCalled()
    await userEvent.click(contract)
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledTimes(1))
    expect(mocks.fetchStoredFile).toHaveBeenCalledExactlyOnceWith(SIGNED_FILE)
    const [blob, name] = mocks.saveBlob.mock.calls[0] as [Blob, string]
    expect(name).toBe('Contrat de service - Marie Tremblay - signé le 2026-10-09.pdf')
    expect(await pageCountOf(new Uint8Array(await blob.arrayBuffer()))).toBe(7)

    await userEvent.click(screen.getByRole('button', { name: t('signing.downloads.certificate') }))
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledTimes(2))
    const [certificate, certificateName] = mocks.saveBlob.mock.calls[1] as [Blob, string]
    expect(certificateName).toBe('Contrat de service - Marie Tremblay - certificat et journal de signature.pdf')
    expect(await pageCountOf(new Uint8Array(await certificate.arrayBuffer()))).toBe(3)

    await userEvent.click(screen.getByRole('button', { name: t('signing.downloads.sealed') }))
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledTimes(3))
    const [sealed, sealedName] = mocks.saveBlob.mock.calls[2] as [Blob, string]
    expect(sealedName).toBe('Contrat de service - Marie Tremblay - complet scellé.pdf')
    expect(await pageCountOf(new Uint8Array(await sealed.arrayBuffer()))).toBe(10)
    expect(button(t(`${A}.regenerate`))).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.journal`) }))
    expect(screen.getByText(t(`${C}.journal.title`))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^Marie Tremblay a signé le ${DATE.source}$`))).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.journal.pdfNote`))).toBeInTheDocument()
  })

  it('the conseillère sees the state and the signers, but neither the PDF nor an action (P4-435, P4-436)', async () => {
    await openCard(contractJson({ ...SIGNED_REQUEST, can_read: false, signed_file_id: null }), { role: 'counselor' })
    expect(screen.getByText('Signé')).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.restricted`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${A}.pdfLabel`, { firstName: 'Marie' }) })).toBeNull()
    expect(button(t('signing.downloads.sealed'))).toBeNull()
    expect(mocks.fetchStoredFile).not.toHaveBeenCalled()
  })

  it('a sealed PDF without certificate pages: the certificate download is disabled with its reason', async () => {
    const stored: Record<string, Uint8Array> = { [SIGNED_FILE]: await pdfWithPages(7) }
    mocks.fetchStoredFile.mockImplementation((id: string) => Promise.resolve(stored[id]))
    await openCard(contractJson(SIGNED_REQUEST))
    const certificate = screen.getByRole('button', { name: t('signing.downloads.certificate') })
    await userEvent.click(certificate)
    expect(await screen.findByText(t('signing.downloads.noCertificate'))).toBeInTheDocument()
    expect(mocks.toast.warning).toHaveBeenCalledWith(t('signing.downloads.noCertificate'))
    expect(certificate).toHaveAttribute('aria-disabled', 'true')
    expect(certificate).toHaveAccessibleDescription(t('signing.downloads.noCertificate'))
    expect(mocks.saveBlob).not.toHaveBeenCalled()
  })

  it('an earlier contract (no page count): N is the stored source file’s page count', async () => {
    const stored: Record<string, Uint8Array> = { [SIGNED_FILE]: await pdfWithPages(15), [SOURCE_FILE]: await pdfWithPages(7) }
    mocks.fetchStoredFile.mockImplementation((id: string) => Promise.resolve(stored[id]))
    await openCard(contractJson({ ...SIGNED_REQUEST, page_count: null }))
    await userEvent.click(screen.getByRole('button', { name: t('signing.downloads.certificate') }))
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledTimes(1))
    const [certificate] = mocks.saveBlob.mock.calls[0] as [Blob, string]
    expect(await pageCountOf(new Uint8Array(await certificate.arrayBuffer()))).toBe(8)
  })

  it('N unknown (no page count, no source file): only the sealed PDF, with the reason', async () => {
    await openCard(contractJson({ ...SIGNED_REQUEST, page_count: null, source_file_id: null }))
    expect(button(t(`${A}.pdfLabel`, { firstName: 'Marie' }))).toBeNull()
    expect(button(t('signing.downloads.certificate'))).toBeNull()
    expect(screen.getByRole('button', { name: t('signing.downloads.sealed') })).toBeInTheDocument()
    expect(screen.getByText(t('signing.downloads.cannotSplit'))).toBeInTheDocument()
  })

  it('the adjointe (no contracts.send, no compensation) cannot send', async () => {
    await openCard(contractJson(null), { role: 'admin_assistant' })
    expect(button(t(`${A}.send`))).toBeNull()
  })

  it('contracts.send without compensation is not enough (P4-436)', async () => {
    await openCard(contractJson(null), { role: 'admin_assistant', permissions: ['professionals.view', 'professionals.manage', 'professionals.contracts.send'] })
    expect(button(t(`${A}.send`))).toBeNull()
  })

  it('refused: core’s words, the reason for those who may read it, and « Régénérer »', async () => {
    await openCard(contractJson(requestJson({ status: 'rejected', rejected_at: '2026-10-09T13:00:00+00:00', rejection_reason: 'Le taux ne correspond pas.' })))
    expect(screen.getByText(/^Envoyé le .+ · Refusé le .+$/)).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.reason`))).toBeInTheDocument()
    expect(screen.getByText('Le taux ne correspond pas.')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t(`${A}.regenerate`)])
  })

  it('a failed draft offers « Réessayer l’envoi » (the same request) and « Régénérer », and says which to use', async () => {
    await openCard(contractJson(requestJson({ status: 'draft', sent_at: null, last_error: 'provider_error' })))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t(`${A}.retry`), t(`${A}.regenerate`)])
    expect(screen.getByText(t(`${C}.failedHelp`))).toBeInTheDocument()
  })

  it('a send that died without a word (its claim older than 10 minutes) is shown failed, with its buttons', async () => {
    await openCard(contractJson(requestJson({ status: 'draft', sent_at: null, last_error: null, send_started_at: '2026-01-01T12:00:00+00:00' })))
    expect(screen.getByText(t(`${C}.state.stalled`))).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.state.stalledDetail`))).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t(`${A}.retry`), t(`${A}.regenerate`)])
  })

  it('a send under way (a fresh claim) only synchronises', async () => {
    await openCard(contractJson(requestJson({ status: 'draft', sent_at: null, last_error: null, send_started_at: new Date().toISOString() })))
    expect(screen.getByText(t(`${C}.state.sending`))).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t(`${A}.sync`)])
  })
})
