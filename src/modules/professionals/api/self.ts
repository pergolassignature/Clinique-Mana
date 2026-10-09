import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'
import { GENDERS, type SubmissionSection } from '../lib/constants'
import { SUBMISSION_SECTIONS } from '../lib/questionnaire'
import { myRecordPayload, parseRpc, type MyProfessionalRecord } from './parse'
import { sqlArgs } from './sql-args'

/**
 * The provider's own questionnaire (4b.4) and « Mon profil » (4b.5; RPCs of 20261008191219_professionals_onboarding.sql,
 * `professionals.self`, own record only): the open submission, the autosave of one section, the
 * private step, the consent signature and « Envoyer mon profil » (`professionals-submit`). Every
 * function throws the PostgREST or `FunctionCallError` unchanged: the questionnaire routes a
 * P0001 by its HINT (the field) and says the rest in French.
 */

/** One section's answers or prefill: the keys of `private.submission_fields()` (normalised by the database). */
export type SectionValues = Readonly<Record<string, unknown>>

const sectionObject = z.record(z.string(), z.unknown())
const sectionsObject = z.record(z.string(), sectionObject)

export const mySubmissionPayload = z
  .object({
    id: z.string(),
    kind: z.enum(['onboarding', 'update']),
    status: z.enum(['draft', 'submitted']),
    requested_sections: z.array(z.enum(SUBMISSION_SECTIONS)),
    prefill: sectionsObject,
    values: sectionsObject,
    decision_note: z.string().nullable(),
    submitted_at: z.string().nullable(),
    updated_at: z.string(),
    private_saved_at: z.string().nullable(),
    /** She started this update herself (« Mettre mon profil à jour »), not the clinic (P4-375). */
    started_by_me: z.boolean(),
    /** The private step as saved for this submission: plain numbers and masks only (never a SIN or an account). */
    private: z
      .object({
        business_number: z.string().nullable(),
        gst_number: z.string().nullable(),
        qst_number: z.string().nullable(),
        bank_institution: z.string().nullable(),
        bank_transit: z.string().nullable(),
        bank_account_last4: z.string().nullable(),
        sin_last3: z.string().nullable(),
      })
      .nullable(),
    /** Whether the record already holds a SIN or an account (completeness counts them). */
    on_file: z.object({ has_sin: z.boolean(), has_bank_account: z.boolean() }).nullable(),
    /** The latest published consent; null when the clinic has none published. */
    consent: z.object({ id: z.string(), version: z.number(), title: z.string(), body: z.string() }).nullable(),
    /** The version number of the text the draft's signature names (null: unsigned). */
    signed_consent_version: z.number().nullable(),
    collect_sin: z.boolean(),
    /** The gender writes the titles in the provider's form (P4-342, P4-367). */
    professional: z.object({ first_name: z.string(), last_name: z.string(), email: z.string(), gender: z.enum(GENDERS).nullable() }),
  })
  .transform((s) => ({
    id: s.id,
    kind: s.kind,
    status: s.status,
    requestedSections: s.requested_sections,
    prefill: s.prefill as Readonly<Record<string, SectionValues>>,
    values: s.values as Readonly<Record<string, SectionValues>>,
    decisionNote: s.decision_note,
    submittedAt: s.submitted_at,
    updatedAt: s.updated_at,
    privateSavedAt: s.private_saved_at,
    startedByMe: s.started_by_me,
    private: s.private && {
      businessNumber: s.private.business_number,
      gstNumber: s.private.gst_number,
      qstNumber: s.private.qst_number,
      bankInstitution: s.private.bank_institution,
      bankTransit: s.private.bank_transit,
      bankAccountLast4: s.private.bank_account_last4,
      sinLast3: s.private.sin_last3,
    },
    onFile: { hasSin: s.on_file?.has_sin ?? false, hasBankAccount: s.on_file?.has_bank_account ?? false },
    consent: s.consent,
    signedConsentVersion: s.signed_consent_version,
    collectSin: s.collect_sin,
    professional: {
      firstName: s.professional.first_name,
      lastName: s.professional.last_name,
      email: s.professional.email,
      gender: s.professional.gender,
    },
  }))
export type MySubmission = z.output<typeof mySubmissionPayload>
export type SubmissionPrivate = NonNullable<MySubmission['private']>

/** The caller's open submission (draft or submitted), or null when there is nothing to complete. */
export async function fetchMySubmission(): Promise<MySubmission | null> {
  const { data, error } = await supabase.rpc('get_my_submission')
  if (error) throw error
  return data === null ? null : parseRpc(mySubmissionPayload, data)
}

/**
 * Saves the keys given of one section (the database merges them into the section: a key never
 * sent is a field not answered, P4-176). Resolves with the submission's new `updated_at`.
 */
export async function saveMySubmissionDraft(section: string, values: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc('save_my_submission_draft', { p_section: section, p_values: values as never })
  if (error) throw error
  return parseRpc(z.string(), data)
}

/** The private step (P4-38): the plain numbers as given (null clears), the SIN and the account kept when null. */
export interface SubmissionPrivateInput {
  businessNumber: string | null
  gstNumber: string | null
  qstNumber: string | null
  bankInstitution: string | null
  bankTransit: string | null
  bankAccount: string | null
  sin: string | null
}

/** Encrypted at once by the database; never stored in the draft, never cached here. */
export async function saveMySubmissionPrivate(input: SubmissionPrivateInput): Promise<void> {
  const { error } = await supabase.rpc(
    'save_my_submission_private',
    sqlArgs<'save_my_submission_private'>({
      p_sin: input.sin,
      p_business_number: input.businessNumber,
      p_gst_number: input.gstNumber,
      p_qst_number: input.qstNumber,
      p_bank_institution: input.bankInstitution,
      p_bank_transit: input.bankTransit,
      p_bank_account: input.bankAccount,
    }),
  )
  if (error) throw error
}

/** What the record already holds of the private data (`get_my_professional_private`): plain numbers and masks. */
const myPrivatePayload = z
  .tuple([
    z.object({
      sin_last3: z.string().nullable(),
      business_number: z.string().nullable(),
      gst_number: z.string().nullable(),
      qst_number: z.string().nullable(),
      bank_institution: z.string().nullable(),
      bank_transit: z.string().nullable(),
      bank_account_last4: z.string().nullable(),
      updated_at: z.string().nullable(),
    }),
  ])
  .transform(([r]) => ({
    sinLast3: r.sin_last3,
    businessNumber: r.business_number,
    gstNumber: r.gst_number,
    qstNumber: r.qst_number,
    bankInstitution: r.bank_institution,
    bankTransit: r.bank_transit,
    bankAccountLast4: r.bank_account_last4,
  }))
export type MyProfessionalPrivate = z.output<typeof myPrivatePayload>

/** The caller's private data on file, masked (one row of nulls when nothing is stored). */
export async function fetchMyProfessionalPrivate(): Promise<MyProfessionalPrivate> {
  const { data, error } = await supabase.rpc('get_my_professional_private')
  if (error) throw error
  return parseRpc(myPrivatePayload, data)
}

/**
 * « Envoyer mon profil »: `professionals-submit` (P4-264) → `{ ok: true }`. A refusal is a
 * `FunctionCallError` 400 with `field` (the HINT) and, for incomplete steps, `sections` in its
 * `extra` (P4-262).
 */
export async function submitMyProfile(): Promise<void> {
  await invokeFunction('professionals-submit', {})
}

// --- « Mon profil » (Task 4b.5) ---------------------------------------------------------------

/**
 * The caller's own record (`get_my_professional_record`): the record bundle of
 * `get_professional_record` without readiness (P4-473); null when no file is
 * linked to the account.
 */
export async function fetchMyProfessionalRecord(): Promise<MyProfessionalRecord | null> {
  const { data, error } = await supabase.rpc('get_my_professional_record')
  if (error) throw error
  return parseRpc(myRecordPayload, data)
}

/**
 * « Mettre mon profil à jour »: an update submission for the sections chosen (stored in the
 * questionnaire's order); resolves with its id. One open submission at a time (« Une soumission
 * est déjà en cours. », HINT `submission`); an inactive file is refused (HINT `status`, P4-303).
 */
export async function startMyProfileUpdate(sections: readonly SubmissionSection[]): Promise<string> {
  const { data, error } = await supabase.rpc('start_my_profile_update', { p_sections: [...sections] })
  if (error) throw error
  return parseRpc(z.string(), data)
}
