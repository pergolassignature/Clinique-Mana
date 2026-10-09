import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDS } from '../test/fixtures'
import { REVIEW_JSON, SUBMISSION_ID, SUBMISSIONS_JSON } from '../test/fixtures-review'
import { UNEXPECTED_SHAPE } from './parse'
import { applyProfessionalSubmission, fetchProfessionalSubmissions, fetchSubmissionReview, rejectProfessionalSubmission } from './submissions'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('fetchProfessionalSubmissions', () => {
  it('reads the file’s submissions, newest first as given', async () => {
    mocks.rpc.mockResolvedValue({ data: SUBMISSIONS_JSON, error: null })
    const rows = await fetchProfessionalSubmissions(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledWith('list_professional_submissions', { p_id: IDS.professional })
    expect(rows.map((r) => r.id)).toEqual(SUBMISSIONS_JSON.map((r) => r.id))
    expect(rows[1]).toMatchObject({ kind: 'update', status: 'approved', reviewedByName: 'Julie Adjointe', appliedCount: 1, requestedSections: ['motifs'] })
  })

  it('reads « sent back » apart from its note, which only reviewers get (P4-474)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...SUBMISSIONS_JSON[0], status: 'draft', decision_note: null, returned: true }], error: null })
    const [row] = await fetchProfessionalSubmissions(IDS.professional)
    expect(row).toMatchObject({ status: 'draft', decisionNote: null, returned: true })
  })

  it('refuses an unknown status', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...SUBMISSIONS_JSON[0], status: 'rejected' }], error: null })
    await expect(fetchProfessionalSubmissions(IDS.professional)).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('fetchSubmissionReview', () => {
  it('reads the sections and fields; a private field has no value', async () => {
    mocks.rpc.mockResolvedValue({ data: REVIEW_JSON, error: null })
    const review = await fetchSubmissionReview(SUBMISSION_ID)
    expect(mocks.rpc).toHaveBeenCalledWith('get_submission_review', { p_submission_id: SUBMISSION_ID })
    expect(review?.submission).toMatchObject({ id: SUBMISSION_ID, kind: 'onboarding', status: 'submitted', professionalId: IDS.professional })
    const account = review?.sections.find((s) => s.section === 'tax_bank')?.fields.find((f) => f.field === 'bank_account')
    expect(account).toEqual({ field: 'bank_account', kind: 'private', answered: true, changed: true, current: null, submitted: null })
  })

  it('answers null for a submission of another clinic', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchSubmissionReview(SUBMISSION_ID)).resolves.toBeNull()
  })

  it('refuses a field the app does not know', async () => {
    const sections = [{ section: 'personal', fields: [{ field: 'nickname', label_key: 'x', kind: 'plain', answered: true, changed: true, current: null, submitted: 'Mimi' }] }]
    mocks.rpc.mockResolvedValue({ data: { ...REVIEW_JSON, sections }, error: null })
    await expect(fetchSubmissionReview(SUBMISSION_ID)).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('decisions', () => {
  it('applies the chosen fields', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await applyProfessionalSubmission(SUBMISSION_ID, ['city', 'motif_ids'])
    expect(mocks.rpc).toHaveBeenCalledWith('apply_professional_submission', { p_submission_id: SUBMISSION_ID, p_fields: ['city', 'motif_ids'] })
  })

  // P4-363: « Approuver sans changement » is an empty list. Never null: the RPC reads null as
  // « every available field » (P4-176).
  it('approves without a change with an empty list, never null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await applyProfessionalSubmission(SUBMISSION_ID, [])
    expect(mocks.rpc).toHaveBeenCalledWith('apply_professional_submission', { p_submission_id: SUBMISSION_ID, p_fields: [] })
  })

  it('sends the profile back with the note', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await rejectProfessionalSubmission(SUBMISSION_ID, 'Précisez vos langues.')
    expect(mocks.rpc).toHaveBeenCalledWith('reject_professional_submission', { p_submission_id: SUBMISSION_ID, p_note: 'Précisez vos langues.' })
  })

  it('passes a refusal on unchanged', async () => {
    const error = { code: 'P0001', message: 'Cette soumission n’attend pas de révision.', hint: 'status' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(applyProfessionalSubmission(SUBMISSION_ID, [])).rejects.toBe(error)
  })
})
