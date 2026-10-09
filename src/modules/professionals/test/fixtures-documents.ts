import { documentsPayload, type ProfessionalDocuments } from '../api/documents'
import { parseRpc } from '../api/parse'
import { IDS } from './fixtures'

/**
 * `get_professional_documents` payloads as the database returns them (20261009000253
 * professionals_documents.sql), parsed as the API does. Test-only.
 */

export const DOC_IDS = {
  photo: '00000000-0000-4000-8000-00000000d001',
  insurance: '00000000-0000-4000-8000-00000000d002',
  insuranceRenewal: '00000000-0000-4000-8000-00000000d003',
  insuranceOld: '00000000-0000-4000-8000-00000000d004',
  cv: '00000000-0000-4000-8000-00000000d005',
  refused: '00000000-0000-4000-8000-00000000d006',
  photoFile: '00000000-0000-4000-8000-00000000f101',
  insuranceFile: '00000000-0000-4000-8000-00000000f102',
  renewalFile: '00000000-0000-4000-8000-00000000f103',
  oldFile: '00000000-0000-4000-8000-00000000f104',
  cvFile: '00000000-0000-4000-8000-00000000f105',
} as const

type Json = Record<string, unknown>

/** One document row of the payload (snake_case), verified insurance by default. */
export function documentJson(over: Json = {}): Json {
  return {
    id: DOC_IDS.insurance,
    type_id: IDS.insuranceType,
    type_key: 'insurance',
    status: 'verified',
    expires_on: '2027-03-31',
    metadata: {},
    uploaded_at: '2026-10-01T14:00:00+00:00',
    uploaded_by_self: true,
    reviewed_at: '2026-10-02T15:00:00+00:00',
    reviewed_by_name: 'Julie Adjointe',
    rejection_reason: null,
    submission_id: null,
    file: { id: DOC_IDS.insuranceFile, name: 'assurance-2026.pdf', mime_type: 'application/pdf', size_bytes: 245_760 },
    ...over,
  }
}

export const PHOTO_JSON = documentJson({
  id: DOC_IDS.photo,
  type_id: IDS.photoType,
  type_key: 'photo',
  expires_on: null,
  file: { id: DOC_IDS.photoFile, name: 'portrait.jpg', mime_type: 'image/jpeg', size_bytes: 1_572_864 },
})

export const CV_JSON = documentJson({
  id: DOC_IDS.cv,
  type_id: IDS.cvType,
  type_key: 'cv',
  status: 'verified',
  expires_on: null,
  uploaded_by_self: false,
  file: { id: DOC_IDS.cvFile, name: 'cv.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 40_960 },
})

export const CONSENT_JSON = {
  id: '00000000-0000-4000-8000-00000000c501',
  version: 1,
  signer_name: 'Marie Tremblay',
  signed_at: '2026-10-08T13:58:00+00:00',
  expires_on: '2027-10-08',
  withdrawn_at: null,
  withdrawal_effective_on: null,
}

/** The payload: a photo, a verified insurance and the e-consent by default (every required type valid). */
export function documentsJson(over: Json = {}): Json {
  return {
    professional_id: IDS.professional,
    today: '2026-10-09',
    photo: { document_id: DOC_IDS.photo, file_id: DOC_IDS.photoFile },
    documents: [documentJson(), PHOTO_JSON],
    consent: CONSENT_JSON,
    ...over,
  }
}

export function documentsFixture(over: Json = {}): ProfessionalDocuments {
  const parsed = parseRpc(documentsPayload, documentsJson(over))
  if (!parsed) throw new Error('documents fixture: null')
  return parsed
}
