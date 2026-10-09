import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import {
  SUBMISSION_FIELD_KINDS,
  SUBMISSION_FIELDS,
  SUBMISSION_KINDS,
  SUBMISSION_SECTIONS,
  SUBMISSION_STATUSES,
  type SubmissionField,
} from '../lib/constants'
import { parseRpc } from './parse'

/**
 * The staff side of a submission (Task 4b.5; 20261008191219_professionals_onboarding.sql and
 * 20261008231358_professionals_submission_review_reads.sql): the file's submissions
 * (`professionals.view`), the review payload, « Appliquer » and « Renvoyer au professionnel »
 * (`professionals.review`). Every function throws the PostgREST error unchanged.
 */

// --- The file's submissions (list_professional_submissions) ---------------------------------------

const submissionRowPayload = z
  .object({
    id: z.string(),
    kind: z.enum(SUBMISSION_KINDS),
    status: z.enum(SUBMISSION_STATUSES),
    requested_sections: z.array(z.enum(SUBMISSION_SECTIONS)),
    created_at: z.string(),
    submitted_at: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    reviewed_by_name: z.string().nullable(),
    decision_note: z.string().nullable(),
    applied_count: z.number().nullable(),
    started_by_professional: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    requestedSections: r.requested_sections,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    /** Null when nobody reviewed it, or the reviewer's account is gone. */
    reviewedByName: r.reviewed_by_name,
    /** The note of a profile sent back (a draft again), else null. */
    decisionNote: r.decision_note,
    /** Fields applied on approval; null until then. */
    appliedCount: r.applied_count,
    /** The professional started it herself (« Mettre mon profil à jour »); otherwise the clinic asked (P4-375). */
    startedByProfessional: r.started_by_professional,
  }))
export type SubmissionRow = z.output<typeof submissionRowPayload>

/** « Questionnaire et mises à jour »: newest first, at most 50, never the answers. */
export async function fetchProfessionalSubmissions(id: string): Promise<SubmissionRow[]> {
  const { data, error } = await supabase.rpc('list_professional_submissions', { p_id: id })
  if (error) throw error
  return parseRpc(z.array(submissionRowPayload), data)
}

// --- The review (get_submission_review, P4-175, P4-176) -------------------------------------------

const reviewFieldPayload = z
  .object({
    field: z.enum(SUBMISSION_FIELDS),
    kind: z.enum(SUBMISSION_FIELD_KINDS),
    /** The field can be applied: its key was saved (P4-176). An unanswered field is never applied. */
    answered: z.boolean(),
    changed: z.boolean(),
    /** Ids as the record gives them; absent for a private field (never a value, P4-175). */
    current: z.unknown().optional(),
    submitted: z.unknown().optional(),
  })
  .transform((f) => ({ field: f.field, kind: f.kind, answered: f.answered, changed: f.changed, current: f.current ?? null, submitted: f.submitted ?? null }))
export type ReviewField = z.output<typeof reviewFieldPayload>

export const reviewPayload = z
  .object({
    submission: z.object({
      id: z.string(),
      professional_id: z.string(),
      kind: z.enum(SUBMISSION_KINDS),
      status: z.enum(SUBMISSION_STATUSES),
      requested_sections: z.array(z.enum(SUBMISSION_SECTIONS)),
      submitted_at: z.string().nullable(),
      reviewed_at: z.string().nullable(),
      reviewed_by_name: z.string().nullable(),
      decision_note: z.string().nullable(),
      applied_fields: z.array(z.enum(SUBMISSION_FIELDS)).nullable(),
      private_saved_at: z.string().nullable(),
    }),
    sections: z.array(z.object({ section: z.enum(SUBMISSION_SECTIONS), fields: z.array(reviewFieldPayload) })),
  })
  .transform(({ submission: s, sections }) => ({
    submission: {
      id: s.id,
      professionalId: s.professional_id,
      kind: s.kind,
      status: s.status,
      requestedSections: s.requested_sections,
      submittedAt: s.submitted_at,
      reviewedAt: s.reviewed_at,
      reviewedByName: s.reviewed_by_name,
      decisionNote: s.decision_note,
      appliedFields: s.applied_fields,
      privateSavedAt: s.private_saved_at,
    },
    sections,
  }))
  .nullable()
export type SubmissionReview = NonNullable<z.output<typeof reviewPayload>>
export type ReviewSection = SubmissionReview['sections'][number]

/** Per requested section and field: current and submitted values; null for another clinic's or an unknown submission. */
export async function fetchSubmissionReview(submissionId: string): Promise<SubmissionReview | null> {
  const { data, error } = await supabase.rpc('get_submission_review', { p_submission_id: submissionId })
  if (error) throw error
  return parseRpc(reviewPayload, data)
}

// --- Decisions -----------------------------------------------------------------------------------

/**
 * « Appliquer les changements sélectionnés »: the chosen fields, in one transaction (any refusal
 * rolls everything back); the submission is approved. An empty list approves without changing
 * the record.
 */
export async function applyProfessionalSubmission(submissionId: string, fields: readonly SubmissionField[]): Promise<void> {
  const { error } = await supabase.rpc('apply_professional_submission', { p_submission_id: submissionId, p_fields: [...fields] })
  if (error) throw error
}

/** « Renvoyer au professionnel »: back to a draft with the note (1–1000 characters, P4-170). */
export async function rejectProfessionalSubmission(submissionId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('reject_professional_submission', { p_submission_id: submissionId, p_note: note })
  if (error) throw error
}
