import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import {
  deleteProfessionalDocument,
  discardConsentDraft,
  documentDownloadUrl,
  fetchConsentVersions,
  fetchMyDocuments,
  fetchProfessionalDocuments,
  publishConsentVersion,
  rejectProfessionalDocument,
  saveConsentDraft,
  setProfessionalDocumentExpiry,
  uploadProfessionalDocument,
  verifyProfessionalDocument,
} from './documents'
import { UNEXPECTED_SHAPE } from './parse'
import { IDS } from '../test/fixtures'
import { CONSENT_JSON, DOC_IDS, documentJson, documentsJson } from '../test/fixtures-documents'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invokeFunction: vi.fn(), uploadFile: vi.fn(), signedFileUrl: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))
vi.mock('@/core/storage/api', () => ({ uploadFile: mocks.uploadFile, signedFileUrl: mocks.signedFileUrl }))

afterEach(() => vi.clearAllMocks())

const ok = (data: unknown) => mocks.rpc.mockResolvedValue({ data, error: null })

describe('fetchProfessionalDocuments / fetchMyDocuments', () => {
  it('reads the tab with one call and maps it (camelCase, the insurance’s metadata, the file)', async () => {
    ok(documentsJson({ documents: [documentJson({ metadata: { insurer: 'La Capitale', policy_number: 'P-1' } })] }))
    const data = await fetchProfessionalDocuments(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_professional_documents', { p_id: IDS.professional })
    expect(data?.today).toBe('2026-10-09')
    expect(data?.documents[0]).toMatchObject({
      id: DOC_IDS.insurance,
      typeKey: 'insurance',
      expiresOn: '2027-03-31',
      insurer: 'La Capitale',
      policyNumber: 'P-1',
      uploadedBySelf: true,
      file: { id: DOC_IDS.insuranceFile, name: 'assurance-2026.pdf', mimeType: 'application/pdf', sizeBytes: 245_760 },
    })
    expect(data?.consent?.signerName).toBe('Marie Tremblay')
  })

  it('the provider’s own consent comes without the signer’s name (null, P4-472)', async () => {
    ok(documentsJson({ consent: { ...CONSENT_JSON, signer_name: null } }))
    const data = await fetchMyDocuments()
    expect(data?.consent).toMatchObject({ version: 1, signerName: null, signedAt: CONSENT_JSON.signed_at })
  })

  it('« Mes documents » asks for her own record (no id); null without a file', async () => {
    ok(null)
    await expect(fetchMyDocuments()).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('get_professional_documents', {})
  })

  it('an unexpected payload is refused, an RPC error thrown unchanged', async () => {
    ok({ professional_id: 1 })
    await expect(fetchProfessionalDocuments(IDS.professional)).rejects.toThrow(UNEXPECTED_SHAPE)
    const error = { code: '42501', message: 'Permission refusée' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchProfessionalDocuments(IDS.professional)).rejects.toBe(error)
  })
})

describe('uploadProfessionalDocument', () => {
  const file = new File(['%PDF-1.7'], 'assurance.pdf', { type: 'application/pdf' })

  it('staff: the staff purpose, subject the professional, then attach with the date and the insurer', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: DOC_IDS.renewalFile })
    ok(DOC_IDS.insuranceRenewal)
    const onStep = vi.fn()
    await expect(
      uploadProfessionalDocument({ professionalId: IDS.professional, typeKey: 'insurance', file, mimeType: 'application/pdf', expiresOn: '2027-03-31', insurer: 'La Capitale', policyNumber: null, self: false, onStep }),
    ).resolves.toBe(DOC_IDS.insuranceRenewal)
    expect(mocks.uploadFile).toHaveBeenCalledExactlyOnceWith({ purpose: 'professional_document', subjectType: 'professional', subjectId: IDS.professional, file, mimeType: 'application/pdf', onStep })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('attach_professional_document', {
      p_id: IDS.professional,
      p_type_key: 'insurance',
      p_file_id: DOC_IDS.renewalFile,
      p_expires_on: '2027-03-31',
      p_metadata: { insurer: 'La Capitale' },
    })
  })

  it('the professional: her own purpose; no date sends null (the rule’s default)', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: DOC_IDS.cvFile })
    ok(DOC_IDS.cv)
    await uploadProfessionalDocument({ professionalId: IDS.professional, typeKey: 'cv', file, mimeType: 'application/pdf', expiresOn: null, self: true })
    expect(mocks.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'professional_self_document' }))
    expect(mocks.rpc).toHaveBeenCalledWith('attach_professional_document', expect.objectContaining({ p_expires_on: null, p_metadata: {} }))
  })

  it('a failed upload never attaches', async () => {
    mocks.uploadFile.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Too many'))
    await expect(uploadProfessionalDocument({ professionalId: IDS.professional, typeKey: 'cv', file, mimeType: 'application/pdf', expiresOn: null, self: false })).rejects.toBeInstanceOf(FunctionCallError)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('the reviewer’s actions', () => {
  it('verify, redate and delete call their RPC', async () => {
    ok(null)
    await verifyProfessionalDocument(DOC_IDS.insurance, '2027-06-30')
    await verifyProfessionalDocument(DOC_IDS.photo, null)
    await setProfessionalDocumentExpiry(DOC_IDS.insurance, '2027-04-30')
    await deleteProfessionalDocument(DOC_IDS.insurance)
    expect(mocks.rpc.mock.calls).toEqual([
      ['verify_professional_document', { p_doc_id: DOC_IDS.insurance, p_expires_on: '2027-06-30' }],
      ['verify_professional_document', { p_doc_id: DOC_IDS.photo, p_expires_on: null }],
      ['set_professional_document_expiry', { p_doc_id: DOC_IDS.insurance, p_expires_on: '2027-04-30' }],
      ['delete_professional_document', { p_doc_id: DOC_IDS.insurance }],
    ])
  })

  it('« Refuser » goes through professionals-documents and says whether she was emailed', async () => {
    mocks.invokeFunction.mockResolvedValue({ ok: true, emailed: true, email_problem: null })
    await expect(rejectProfessionalDocument(DOC_IDS.insurance, 'Illisible.')).resolves.toEqual({ emailed: true, emailProblem: null })
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('professionals-documents', { action: 'reject', document_id: DOC_IDS.insurance, reason: 'Illisible.' })
    mocks.invokeFunction.mockResolvedValue({ ok: true, emailed: false, email_problem: 'rate_limited', retry_after: 30 })
    await expect(rejectProfessionalDocument(DOC_IDS.insurance, 'Illisible.')).resolves.toEqual({ emailed: false, emailProblem: { code: 'rate_limited', retryAfter: 30 } })
  })

  it('« Refuser »: a refusal passed on by the function is thrown as the RPC error (its HINT kept)', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Indiquez pourquoi le document est refusé.', { refusal: true, field: 'reason' }))
    await expect(rejectProfessionalDocument(DOC_IDS.insurance, ' ')).rejects.toEqual({ code: 'P0001', message: 'Indiquez pourquoi le document est refusé.', hint: 'reason' })
  })

  it('« Télécharger »: a download URL signed for this press', async () => {
    mocks.signedFileUrl.mockResolvedValue({ url: 'https://files.test/d', expiresAt: '2026-10-09T12:05:00Z' })
    await expect(documentDownloadUrl(DOC_IDS.insuranceFile)).resolves.toBe('https://files.test/d')
    expect(mocks.signedFileUrl).toHaveBeenCalledWith(DOC_IDS.insuranceFile, { download: true })
  })
})

describe('« Consentements »', () => {
  it('splits the versions into the one in force, the draft and the earlier ones', async () => {
    const v = (id: string, version: number, published: boolean) => ({
      id,
      version,
      title: `Version ${version}`,
      body: 'Texte',
      published_at: published ? '2026-10-01T14:00:00+00:00' : null,
      published_by_name: published ? 'Julie Roy' : null,
      signed_count: published ? 2 : 0,
      created_at: '2026-10-01T13:00:00+00:00',
      updated_at: '2026-10-01T13:00:00+00:00',
    })
    ok({ key: 'image_rights', current_id: 'v2', versions: [v('v3', 3, false), v('v2', 2, true), v('v1', 1, true)] })
    const result = await fetchConsentVersions()
    expect(mocks.rpc).toHaveBeenCalledWith('get_consent_versions', { p_key: 'image_rights' })
    expect(result.current?.id).toBe('v2')
    expect(result.draft?.id).toBe('v3')
    expect(result.previous.map((x) => x.id)).toEqual(['v1'])
  })

  it('save, publish and discard call their RPC', async () => {
    ok('v3')
    await expect(saveConsentDraft({ title: 'Titre', body: 'Texte' })).resolves.toBe('v3')
    ok(null)
    await publishConsentVersion('v3')
    await discardConsentDraft('v3')
    expect(mocks.rpc.mock.calls).toEqual([
      ['save_consent_draft', { p_key: 'image_rights', p_title: 'Titre', p_body: 'Texte' }],
      ['publish_consent_version', { p_id: 'v3' }],
      ['discard_consent_draft', { p_id: 'v3' }],
    ])
  })
})
