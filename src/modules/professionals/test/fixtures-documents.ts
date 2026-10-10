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
  consent: '00000000-0000-4000-8000-00000000d007',
  photoFile: '00000000-0000-4000-8000-00000000f101',
  insuranceFile: '00000000-0000-4000-8000-00000000f102',
  renewalFile: '00000000-0000-4000-8000-00000000f103',
  oldFile: '00000000-0000-4000-8000-00000000f104',
  cvFile: '00000000-0000-4000-8000-00000000f105',
  consentFile: '00000000-0000-4000-8000-00000000f106',
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

/** The image consent signed through Documenso on 8 Oct. (P4-485): verified, no end date (P4-504). */
export const CONSENT_DOC_JSON = documentJson({
  id: DOC_IDS.consent,
  type_id: IDS.consentType,
  type_key: 'image_consent',
  expires_on: null,
  uploaded_at: '2026-10-08T13:58:00+00:00',
  uploaded_by_self: false,
  reviewed_by_name: null,
  signature_request_id: '00000000-0000-4000-8000-00000000c501',
  file: { id: DOC_IDS.consentFile, name: 'consentement.pdf', mime_type: 'application/pdf', size_bytes: 40_960 },
})

/**
 * The payload: a verified insurance, a photo and the signed image consent by default (every
 * required type valid). `consent` is always null since P4-507 (the retired e-consent).
 */
export function documentsJson(over: Json = {}): Json {
  return {
    professional_id: IDS.professional,
    today: '2026-10-09',
    photo: { document_id: DOC_IDS.photo, file_id: DOC_IDS.photoFile },
    documents: [documentJson(), PHOTO_JSON, CONSENT_DOC_JSON],
    consent: null,
    staged: [],
    ...over,
  }
}

/** One `staged` item (P4-495): the photo, sent with an update on 8 Oct. by default. */
export function stagedJson(over: Json = {}): Json {
  return {
    type_key: 'photo',
    kind: 'photo',
    submission_id: '00000000-0000-4000-8000-00000000e501',
    status: 'submitted',
    submitted_at: '2026-10-08T14:00:00+00:00',
    ...over,
  }
}

export function documentsFixture(over: Json = {}): ProfessionalDocuments {
  const parsed = parseRpc(documentsPayload, documentsJson(over))
  if (!parsed) throw new Error('documents fixture: null')
  return parsed
}
