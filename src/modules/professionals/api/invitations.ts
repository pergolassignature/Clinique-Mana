import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'
import type { SubmissionSection } from '../lib/constants'
import type { InviteAction } from '../lib/onboarding'
import { asRpcRefusal } from './function-errors'
import { invitationStateRowPayload, onboardingPayload, parseRpc, UNEXPECTED_SHAPE, type Onboarding } from './parse'

/**
 * The onboarding of a file (Task 4b.3): its states (4b.1's read RPCs) and the actions, all through
 * `professionals-invite` (4b.2): the browser never sees an invitation token, and never learns the
 * link (P4-260). Throws a function's refusal as the RPC error it passes on (`{ code: 'P0001',
 * message, hint }`), so `moduleErrorMessage` and `rpcErrorHint` read it as for an RPC called
 * directly; anything else stays a `FunctionCallError`.
 */

const FUNCTION = 'professionals-invite'

/**
 * Why an email did not leave although what it is about exists (the link, the update request): the
 * function's code (`provider_error`, `not_configured`, `rate_limited`, `invalid_request` for a
 * refused address, `module_disabled`, `internal`) and a 429's `Retry-After` (seconds).
 */
export interface EmailProblem {
  code: string
  retryAfter: number | null
}

/** « Envoyer l'invitation » and the like: the new link's expiry when the email left, else why it did not. */
export interface InvitationResult {
  expiresAt: string | null
  emailProblem: EmailProblem | null
}

/** « Demander une mise à jour »: the open submission, and why its email did not leave, if it did not (P4-267). */
export interface UpdateRequestResult {
  submissionId: string
  emailProblem: EmailProblem | null
}

/** The id an error answer carries when what the email was about was created (4b.2). */
const createdId = (error: unknown, key: 'professional_id' | 'submission_id'): string | null =>
  error instanceof FunctionCallError && typeof error.extra[key] === 'string' ? (error.extra[key] as string) : null

const problemOf = (error: FunctionCallError): EmailProblem => ({ code: error.code, retryAfter: error.retryAfter })

const invitationAnswer = z.object({ ok: z.literal(true), expires_at: z.string() })
const updateAnswer = z.object({ ok: z.literal(true), submission_id: z.string() })

/**
 * Emails a new invitation link (`send`, `resend`, `new_link`; each revokes the live link). An
 * error answer naming the professional means the link exists but the email failed: resolved with
 * `emailProblem` (« Utilisez « Renvoyer l'invitation » »). A refused double click (the file's 5 s
 * guard, P4-261) is a 429 without ids: nothing was created, thrown.
 */
export async function sendProfessionalInvitation(id: string, action: InviteAction): Promise<InvitationResult> {
  try {
    const answer = invitationAnswer.safeParse(await invokeFunction(FUNCTION, { action, professional_id: id }))
    if (!answer.success) throw new Error(UNEXPECTED_SHAPE)
    return { expiresAt: answer.data.expires_at, emailProblem: null }
  } catch (error) {
    if (createdId(error, 'professional_id') && error instanceof FunctionCallError) return { expiresAt: null, emailProblem: problemOf(error) }
    throw asRpcRefusal(error)
  }
}

/** « Révoquer l'invitation »: the live link stops working, the questionnaire in progress is closed (P4-301). */
export async function revokeProfessionalInvitation(id: string): Promise<void> {
  try {
    await invokeFunction(FUNCTION, { action: 'revoke', professional_id: id })
  } catch (error) {
    throw asRpcRefusal(error)
  }
}

/**
 * « Demander une mise à jour » for the chosen sections (an account is required, one open
 * submission at a time). An error answer naming the submission means it exists but its email
 * failed (P4-267): resolved with `emailProblem`.
 */
export async function requestProfessionalUpdate(id: string, sections: readonly SubmissionSection[]): Promise<UpdateRequestResult> {
  try {
    const answer = updateAnswer.safeParse(await invokeFunction(FUNCTION, { action: 'request_update', professional_id: id, sections }))
    if (!answer.success) throw new Error(UNEXPECTED_SHAPE)
    return { submissionId: answer.data.submission_id, emailProblem: null }
  } catch (error) {
    const submissionId = createdId(error, 'submission_id')
    if (submissionId && error instanceof FunctionCallError) return { submissionId, emailProblem: problemOf(error) }
    throw asRpcRefusal(error)
  }
}

// --- Reads ---------------------------------------------------------------------------------------

/** The record's onboarding line (`professionals.view`); null without link or submission. */
export async function fetchProfessionalOnboarding(id: string): Promise<Onboarding | null> {
  const { data, error } = await supabase.rpc('get_professional_onboarding', { p_id: id })
  if (error) throw error
  return parseRpc(onboardingPayload, data)
}

/** Every file's onboarding with a link or a submission, by professional id, in one request (P4-270). */
export async function fetchInvitationStates(): Promise<ReadonlyMap<string, Onboarding>> {
  const { data, error } = await supabase.rpc('list_professional_invitation_states')
  if (error) throw error
  return new Map(parseRpc(z.array(invitationStateRowPayload), data).map((row) => [row.professionalId, row.onboarding]))
}

/**
 * One email about the professional (`list_subject_emails`, P3-26): its template's label, its
 * outcome and who sent it (null for the system: the reminders job). The address is null once the
 * row is anonymised (24 months).
 */
const subjectEmailPayload = z
  .object({
    id: z.string(),
    template_key: z.string(),
    template_label: z.string(),
    status: z.string(),
    to_email: z.string().nullable(),
    sent_by: z.string().nullable(),
    sent_by_name: z.string().nullable(),
    created_at: z.string(),
    sent_at: z.string().nullable(),
    last_event_at: z.string().nullable(),
    error_code: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    templateKey: r.template_key,
    templateLabel: r.template_label,
    status: r.status,
    toEmail: r.to_email,
    sentBy: r.sent_by,
    sentByName: r.sent_by_name,
    createdAt: r.created_at,
    errorCode: r.error_code,
  }))
export type SubjectEmail = z.output<typeof subjectEmailPayload>

/** The most emails the timeline reads: the RPC's own cap (no cursor; a professional gets a few). */
export const PROFESSIONAL_EMAILS_MAX = 100

/** The professional's emails, newest first (at most PROFESSIONAL_EMAILS_MAX). */
export async function fetchProfessionalEmails(id: string): Promise<SubjectEmail[]> {
  const { data, error } = await supabase.rpc('list_subject_emails', { p_subject_type: 'professional', p_subject_id: id, p_limit: PROFESSIONAL_EMAILS_MAX })
  if (error) throw error
  return parseRpc(z.array(subjectEmailPayload), data)
}
