import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { FixtureRole } from '@/test/role-fixtures'
import { IDS } from '../../test/fixtures'
import { contractJson, parsedContract, REQUEST_ID, requestJson, SIGNED_FILE, SIGNED_REQUEST } from '../../test/fixtures-contract'
import { recordFixture } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { ContractCard } from './ContractCard'

const mocks = vi.hoisted(() => ({
  contracts: { fetchProfessionalContract: vi.fn(), sendProfessionalContract: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn() },
  sync: vi.fn(),
  documentDownloadUrl: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/contracts')>()), ...mocks.contracts }))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/core/signing/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/signing/api')>()), syncSignatureRequest: mocks.sync }))
vi.mock('../../api/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/documents')>()),
  documentDownloadUrl: (...args: unknown[]) => mocks.documentDownloadUrl(...args),
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

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
  it('no contract: « Aucun contrat », then « Préparer et envoyer » after a confirmation naming the version', async () => {
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await openCard(contractJson(null))
    expect(screen.getByText(t(`${C}.state.none`))).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.none`, { firstName: 'Marie' }))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.send`) }))
    const dialog = await screen.findByRole('alertdialog', { name: t(`${C}.confirm.send.title`, { firstName: 'Marie' }) })
    expect(dialog).toHaveTextContent(t(`${C}.confirm.send.body`, { firstName: 'Marie', version: '2' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${C}.confirm.send.action`) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledExactlyOnceWith(IDS.professional, 'send', expect.any(String)))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.toasts.send`, { firstName: 'Marie' })))
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

  it('« Régénérer » warns that the contract out is cancelled', async () => {
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await openCard(contractJson(requestJson()))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.regenerate`) }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t(`${C}.confirm.regenerate.body`, { firstName: 'Marie', version: '2' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${C}.confirm.regenerate.action`) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledWith(IDS.professional, 'regenerate', expect.any(String)))
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
    expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledWith(IDS.professional, 'resend', expect.any(String))
  })

  it('a failed send shows its reason in the card', async () => {
    mocks.contracts.sendProfessionalContract.mockRejectedValue(new FunctionCallError('missing_variable', 400, 'x', { label: 'Adresse du professionnel' }))
    await openCard(contractJson(null))
    await userEvent.click(screen.getByRole('button', { name: t(`${A}.send`) }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t(`${C}.confirm.send.action`) }))
    expect(await screen.findByText(t(`${C}.errors.missingVariable`, { label: 'Adresse du professionnel' }))).toBeInTheDocument()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('signed: « Signé le … », the stored PDF through a signed URL, and the signing journal', async () => {
    await openCard(contractJson(SIGNED_REQUEST))
    expect(screen.getByText('Signé')).toBeInTheDocument()
    expect(screen.getByText(/^Envoyé le .+ · Signé le .+$/)).toBeInTheDocument()
    // Signed at the press, never on render nor every few minutes (storage-sign: 120 an hour, P4-455).
    const pdf = screen.getByRole('button', { name: t(`${A}.pdfLabel`, { firstName: 'Marie' }) })
    expect(mocks.documentDownloadUrl).not.toHaveBeenCalled()
    await userEvent.click(pdf)
    await waitFor(() => expect(mocks.documentDownloadUrl).toHaveBeenCalledExactlyOnceWith(SIGNED_FILE))
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
    expect(mocks.documentDownloadUrl).not.toHaveBeenCalled()
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
