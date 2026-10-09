import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import {
  deleteProfessionalDocument,
  documentDownloadUrl,
  fetchMyDocuments,
  fetchProfessionalDocuments,
  rejectProfessionalDocument,
  setProfessionalDocumentExpiry,
  uploadProfessionalDocument,
  verifyProfessionalDocument,
} from './documents'
import { UNEXPECTED_SHAPE } from './parse'
import { IDS } from '../test/fixtures'
import { DOC_IDS, documentJson, documentsJson } from '../test/fixtures-documents'

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
  })

  it('the signed image consent is a document without an end date; the retired e-consent is not read (P4-504, P4-507)', async () => {
    ok(documentsJson())
    const data = await fetchMyDocuments()
    expect(data?.documents[2]).toMatchObject({ typeKey: 'image_consent', expiresOn: null, signatureRequestId: '00000000-0000-4000-8000-00000000c501' })
    expect(data).not.toHaveProperty('consent')
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
