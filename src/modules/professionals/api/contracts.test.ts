import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import { IDS } from '../test/fixtures'
import {
  contractJson,
  DRAFT_ID,
  PAPER_FILE,
  PAPER_ID,
  paperJson,
  REQUEST_ID,
  requestJson,
  SIGNED_FILE,
  SIGNED_REQUEST,
  signedInForceJson,
  TEMPLATE_ID,
  templateJson,
  versionJson,
} from '../test/fixtures-contract'
import {
  archiveTemplateVersion,
  createTemplateVersion,
  fetchProfessionalContract,
  fetchTemplateVersions,
  listContractTemplates,
  publishTemplateVersion,
  recordPaperContract,
  sendProfessionalContract,
  updateTemplateVersion,
} from './contracts'
import { UNEXPECTED_SHAPE } from './parse'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invokeFunction: vi.fn(), uploadFile: vi.fn() }))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), uploadFile: mocks.uploadFile }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

describe('fetchProfessionalContract', () => {
  it('reads the card: the published version, the clinic signer, the latest request and its signers in order', async () => {
    mocks.rpc.mockResolvedValue({ data: contractJson(SIGNED_REQUEST), error: null })
    const contract = await fetchProfessionalContract(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_professional_contract', { p_id: IDS.professional })
    expect(contract).toMatchObject({ publishedVersion: 2, clinicSigner: true })
    expect(contract?.request).toMatchObject({ id: REQUEST_ID, status: 'signed', canRead: true, templateVersion: 2, completedAt: '2026-10-09T15:00:00+00:00' })
    expect(contract?.request?.signers.map((s) => [s.role, s.order, s.signedAt !== null])).toEqual([
      ['professional', 1, true],
      ['clinic', 2, true],
    ])
  })

  it('no template published, no request', async () => {
    mocks.rpc.mockResolvedValue({ data: contractJson(null, { template: null, clinic_signer: false }), error: null })
    await expect(fetchProfessionalContract(IDS.professional)).resolves.toEqual({ publishedVersion: null, clinicSigner: false, request: null, current: null, previous: [] })
  })

  it('the contract in force, the renewal at work and the previous contracts (P4-525)', async () => {
    mocks.rpc.mockResolvedValue({
      data: contractJson(requestJson(), { current: paperJson(), previous: [signedInForceJson(), paperJson({ id: 'p-old', can_read: false, file: null, uploaded_by_name: null })] }),
      error: null,
    })
    const contract = await fetchProfessionalContract(IDS.professional)
    expect(contract?.current).toEqual({
      kind: 'paper',
      id: PAPER_ID,
      signedOn: '2023-05-01',
      uploadedAt: '2026-10-09T16:00:00+00:00',
      uploadedByName: 'Admin A',
      canRead: true,
      file: { id: PAPER_FILE, name: 'Contrat papier.pdf', mimeType: 'application/pdf', sizeBytes: 245_000 },
    })
    expect(contract?.request).toMatchObject({ id: REQUEST_ID, status: 'sent' })
    expect(contract?.previous.map((c) => c.kind)).toEqual(['signed', 'paper'])
    expect(contract?.previous[0]).toMatchObject({ kind: 'signed', request: { status: 'signed', signedFileId: SIGNED_FILE } })
    expect(contract?.previous[1]).toMatchObject({ kind: 'paper', canRead: false, file: null, uploadedByName: null })
  })

  it('answers null for a file of another clinic; throws the PostgREST error; refuses another shape', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(fetchProfessionalContract(IDS.professional)).resolves.toBeNull()
    const error = { code: '42501', message: 'Permission refusée' }
    mocks.rpc.mockResolvedValueOnce({ data: null, error })
    await expect(fetchProfessionalContract(IDS.professional)).rejects.toBe(error)
    mocks.rpc.mockResolvedValueOnce({ data: contractJson(requestJson({ signers: 'x' })), error: null })
    await expect(fetchProfessionalContract(IDS.professional)).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('sendProfessionalContract', () => {
  it.each(['send', 'renew', 'regenerate', 'resend'] as const)('%s: one call with the key, the request id back', async (action) => {
    mocks.invokeFunction.mockResolvedValue({ request_id: REQUEST_ID, existing: false })
    await expect(sendProfessionalContract(IDS.professional, action, 'key-1')).resolves.toBe(REQUEST_ID)
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('professionals-contract-send', {
      professional_id: IDS.professional,
      action,
      idempotency_key: 'key-1',
    })
  })

  it('a refusal comes back as the RPC refusal with its HINT', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Aucun modèle de contrat publié.', { refusal: true, field: 'template' }))
    await expect(sendProfessionalContract(IDS.professional, 'send', 'k')).rejects.toEqual({ code: 'P0001', message: 'Aucun modèle de contrat publié.', hint: 'template' })
  })

  it('a send in progress (409) stays the function’s conflict, never « le dossier vient de changer »', async () => {
    const error = new FunctionCallError('conflict', 409, 'Un envoi est déjà en cours.')
    mocks.invokeFunction.mockRejectedValue(error)
    await expect(sendProfessionalContract(IDS.professional, 'send', 'k')).rejects.toBe(error)
  })

  it('a missing value keeps its label; an unexpected answer is an internal error', async () => {
    const missing = new FunctionCallError('missing_variable', 400, 'A template value is missing', { variable: 'professional.address', label: 'Adresse du professionnel' })
    mocks.invokeFunction.mockRejectedValueOnce(missing)
    await expect(sendProfessionalContract(IDS.professional, 'send', 'k')).rejects.toBe(missing)
    mocks.invokeFunction.mockResolvedValueOnce({ ok: true })
    await expect(sendProfessionalContract(IDS.professional, 'send', 'k')).rejects.toMatchObject({ code: 'internal' })
  })
})

describe('recordPaperContract (P4-520)', () => {
  it('uploads the PDF for the professional (purpose professional_contract), then records it with its date', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: PAPER_FILE })
    mocks.rpc.mockResolvedValue({ data: PAPER_ID, error: null })
    const file = new File(['%PDF'], 'contrat.pdf', { type: 'application/pdf' })
    await expect(recordPaperContract({ professionalId: IDS.professional, file, mimeType: 'application/pdf', signedOn: '2023-05-01' })).resolves.toBe(PAPER_ID)
    expect(mocks.uploadFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ purpose: 'professional_contract', subjectType: 'professional', subjectId: IDS.professional, file, mimeType: 'application/pdf' }),
    )
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_professional_paper_contract', { p_id: IDS.professional, p_file_id: PAPER_FILE, p_signed_on: '2023-05-01' })
  })

  it('throws the refusal unchanged (its HINT shows under the date)', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: PAPER_FILE })
    const refusal = { code: 'P0001', message: 'La date de signature ne peut pas être dans le futur.', hint: 'signed_on' }
    mocks.rpc.mockResolvedValue({ data: null, error: refusal })
    const file = new File(['%PDF'], 'contrat.pdf', { type: 'application/pdf' })
    await expect(recordPaperContract({ professionalId: IDS.professional, file, mimeType: 'application/pdf', signedOn: '2030-01-01' })).rejects.toBe(refusal)
  })
})

describe('templates and versions', () => {
  it('lists the module’s templates', async () => {
    mocks.rpc.mockResolvedValue({ data: [templateJson()], error: null })
    const [template] = await listContractTemplates()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_document_templates', { p_module_key: 'professionals' })
    expect(template).toMatchObject({ id: TEMPLATE_ID, title: 'Contrat de service', canEdit: true, isActive: true, publishedVersion: null, draftVersionId: DRAFT_ID })
  })

  it('reads a template’s versions, newest first', async () => {
    mocks.rpc.mockResolvedValue({ data: [versionJson()], error: null })
    const [version] = await fetchTemplateVersions(TEMPLATE_ID)
    // Core's RPC, never the table itself (module isolation, CLAUDE.md §5).
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_document_template_versions', { p_template_id: TEMPLATE_ID })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(version).toMatchObject({ id: DRAFT_ID, version: 1, status: 'draft', emailSubject: 'Votre contrat de service à signer' })
  })

  it('creates, saves, publishes and archives through core’s RPCs', async () => {
    mocks.rpc.mockResolvedValue({ data: DRAFT_ID, error: null })
    await expect(createTemplateVersion(TEMPLATE_ID)).resolves.toBe(DRAFT_ID)
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_template_version', { p_template_id: TEMPLATE_ID })

    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const body = { title: 'x' }
    await updateTemplateVersion(DRAFT_ID, { body, variables: [], signers: [], emailSubject: 'Objet', emailMessage: 'Message' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('update_template_version', {
      p_id: DRAFT_ID,
      p_body: body,
      p_variables: [],
      p_signers: [],
      p_email_subject: 'Objet',
      p_email_message: 'Message',
    })
    await publishTemplateVersion(DRAFT_ID)
    expect(mocks.rpc).toHaveBeenLastCalledWith('publish_template_version', { p_id: DRAFT_ID })
    await archiveTemplateVersion(DRAFT_ID)
    expect(mocks.rpc).toHaveBeenLastCalledWith('archive_template_version', { p_id: DRAFT_ID })
  })

  it('throws a refusal unchanged', async () => {
    const error = { code: 'P0001', message: 'Variable inconnue : {{x}}.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(publishTemplateVersion(DRAFT_ID)).rejects.toBe(error)
  })
})
