import { parseRpc } from '../api/parse'
import { reviewPayload, type SubmissionReview } from '../api/submissions'
import { IDS } from './fixtures'

/**
 * The review's payloads as the database returns them (snake_case JSON), shaped on
 * `get_submission_review` (20261008191219) and `list_professional_submissions` (20261008231358).
 * Test-only: no production file imports this one.
 */

export const SUBMISSION_ID = '00000000-0000-4000-8000-00000000e101'
export const PHOTO_FILE = '00000000-0000-4000-8000-00000000f001'
export const INSURANCE_FILE = '00000000-0000-4000-8000-00000000f002'
const CONSENT_V1 = '00000000-0000-4000-8000-00000000c001'

const label = (field: string) => `modules.professionals.submission.fields.${field}`
const plain = (field: string, current: unknown, submitted: unknown, changed: boolean, answered = true) => ({
  field,
  label_key: label(field),
  kind: 'plain',
  answered,
  current,
  submitted,
  changed,
})

/**
 * Marie Tremblay's onboarding, sent: a new phone and city (changed), the postal code confirmed as is,
 * line 2 never answered; a second title; English added and nothing removed; Aînés added, Couples
 * kept but no longer ★; Psychose added and Anxiété removed; a photo and an insurance; the bank
 * account entered (private: no value); the consent signed.
 */
export const REVIEW_JSON = {
  submission: {
    id: SUBMISSION_ID,
    professional_id: IDS.professional,
    kind: 'onboarding',
    status: 'submitted',
    requested_sections: ['personal', 'professional', 'languages', 'clienteles', 'motifs', 'photo', 'insurance', 'tax_bank', 'consent'],
    submitted_at: '2026-10-08T14:00:00+00:00',
    reviewed_at: null,
    reviewed_by_name: null,
    decision_note: null,
    applied_fields: null,
    private_saved_at: '2026-10-08T13:55:00+00:00',
  },
  sections: [
    {
      section: 'personal',
      fields: [
        plain('personal_phone', '+15145551234', '+15145559876', true),
        plain('address_line1', '123, rue Saint-Denis', '123, rue Saint-Denis', false),
        plain('address_line2', null, null, false, false),
        plain('city', 'Montréal', 'Laval', true),
        plain('province', 'QC', 'QC', false),
        plain('postal_code', 'H2X 1Y4', 'H2X 1Y4', false),
      ],
    },
    {
      section: 'professional',
      fields: [
        {
          field: 'professions',
          label_key: label('professions'),
          kind: 'set',
          answered: true,
          current: [{ title_id: IDS.psychologue, licence_number: '12345', is_primary: true }],
          submitted: [
            { title_id: IDS.psychologue, licence_number: '12345', is_primary: true },
            { title_id: IDS.naturopathe, licence_number: null, is_primary: false },
          ],
          changed: true,
        },
        plain('years_experience', 12, 12, false),
      ],
    },
    {
      section: 'languages',
      fields: [{ field: 'language_ids', label_key: label('language_ids'), kind: 'set', answered: true, current: [IDS.fr], submitted: [IDS.en, IDS.fr], changed: true }],
    },
    {
      section: 'clienteles',
      fields: [
        {
          field: 'clienteles',
          label_key: label('clienteles'),
          kind: 'set',
          answered: true,
          current: [{ id: IDS.couples, specialized: true }],
          submitted: [
            { id: IDS.couples, specialized: false },
            { id: IDS.seniors, specialized: false },
          ],
          changed: true,
        },
        plain('min_client_age', null, null, false, false),
        plain('women_only', false, false, false, false),
      ],
    },
    {
      section: 'motifs',
      fields: [{ field: 'motif_ids', label_key: label('motif_ids'), kind: 'set', answered: true, current: [IDS.anxiete], submitted: [IDS.psychose], changed: true }],
    },
    { section: 'photo', fields: [{ field: 'photo', label_key: label('photo'), kind: 'file', answered: true, current: null, submitted: { file_id: PHOTO_FILE }, changed: true }] },
    {
      section: 'insurance',
      fields: [
        {
          field: 'insurance',
          label_key: label('insurance'),
          kind: 'file',
          answered: true,
          current: null,
          submitted: { file_id: INSURANCE_FILE, expires_on: '2027-03-31' },
          changed: true,
        },
      ],
    },
    {
      section: 'tax_bank',
      fields: [
        { field: 'business_number', label_key: label('business_number'), kind: 'private', answered: false, changed: false },
        { field: 'gst_number', label_key: label('gst_number'), kind: 'private', answered: false, changed: false },
        { field: 'qst_number', label_key: label('qst_number'), kind: 'private', answered: false, changed: false },
        { field: 'bank_institution', label_key: label('bank_institution'), kind: 'private', answered: true, changed: false },
        { field: 'bank_transit', label_key: label('bank_transit'), kind: 'private', answered: true, changed: false },
        { field: 'bank_account', label_key: label('bank_account'), kind: 'private', answered: true, changed: true },
        { field: 'sin', label_key: label('sin'), kind: 'private', answered: false, changed: false },
      ],
    },
    {
      section: 'consent',
      fields: [
        {
          field: 'consent',
          label_key: label('consent'),
          kind: 'consent',
          answered: true,
          current: null,
          submitted: { consent_version_id: CONSENT_V1, signer_name: 'Marie Tremblay', signed_at: '2026-10-08T13:58:00+00:00', version: 1 },
          changed: true,
        },
      ],
    },
  ],
}

/** The fields REVIEW_JSON marks changed, in the registry's order (the default selection). */
export const REVIEW_CHANGED_FIELDS = [
  'personal_phone',
  'city',
  'professions',
  'language_ids',
  'clienteles',
  'motif_ids',
  'photo',
  'insurance',
  'bank_account',
  'consent',
] as const

/** `list_professional_submissions`: the onboarding sent for review, an update Marie started herself, applied. */
export const SUBMISSIONS_JSON = [
  {
    id: SUBMISSION_ID,
    kind: 'onboarding',
    status: 'submitted',
    requested_sections: REVIEW_JSON.submission.requested_sections,
    created_at: '2026-10-05T12:00:00+00:00',
    submitted_at: '2026-10-08T14:00:00+00:00',
    reviewed_at: null,
    reviewed_by_name: null,
    decision_note: null,
    returned: false,
    applied_count: null,
    started_by_professional: false,
  },
  {
    id: '00000000-0000-4000-8000-00000000e102',
    kind: 'update',
    status: 'approved',
    requested_sections: ['motifs'],
    created_at: '2026-09-01T12:00:00+00:00',
    submitted_at: '2026-09-02T12:00:00+00:00',
    reviewed_at: '2026-09-03T15:30:00+00:00',
    reviewed_by_name: 'Julie Adjointe',
    decision_note: null,
    returned: false,
    applied_count: 1,
    started_by_professional: true,
  },
]

/** REVIEW_JSON as the sheet reads it, with `over` merged into its submission. */
export function submissionReview(over: Partial<(typeof REVIEW_JSON)['submission']> = {}): SubmissionReview {
  const review = parseRpc(reviewPayload, { ...REVIEW_JSON, submission: { ...REVIEW_JSON.submission, ...over } })
  if (!review) throw new Error('fixture: no review')
  return review
}

/**
 * REVIEW_JSON with some fields replaced (`{field: {...}}` merged into each named field), as the sheet
 * reads it: an expired insurance, a consent on an older text, or nothing changed at all.
 */
export function submissionReviewWithFields(fields: Record<string, Record<string, unknown>>, every?: Record<string, unknown>): SubmissionReview {
  const sections = REVIEW_JSON.sections.map((section) => ({
    ...section,
    fields: section.fields.map((f) => ({ ...f, ...every, ...fields[f.field] })),
  }))
  const review = parseRpc(reviewPayload, { ...REVIEW_JSON, sections })
  if (!review) throw new Error('fixture: no review')
  return review
}
