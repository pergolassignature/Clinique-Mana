/**
 * What the Professionnels functions share (Task 4b.2): the values of the
 * module's email templates, the app pages their buttons open, and the answer
 * for a refusal of a module RPC.
 *
 * The template values mirror the `variables` seeded by
 * `*_professionals_onboarding.sql`: a builder per template, so a renamed
 * variable fails one test here rather than an email at run time.
 */
import { jsonResponse } from './auth.ts'
import { rpcErrorResponse } from './errors.ts'
import { appOrigin } from './links.ts'

/** The provider's questionnaire (P4-44: an update request opens it behind sign-in, no token). */
export const QUESTIONNAIRE_PATH = '/mon-profil/questionnaire'

/** `professionals.invite` and `professionals.invite_reminder`. */
export function invitationValues(input: {
  firstName: string
  clinicName: string
  expiresAt: string
}): Record<string, unknown> {
  return {
    professional: { first_name: input.firstName },
    clinic: { name: input.clinicName },
    invitation: { expires_at: input.expiresAt },
  }
}

/** `professionals.profile_update`. */
export function profileUpdateValues(input: {
  firstName: string
  clinicName: string
}): Record<string, unknown> {
  return {
    professional: { first_name: input.firstName },
    clinic: { name: input.clinicName },
  }
}

/** `professionals.submission_received` (to the reviewers). */
export function submissionReceivedValues(input: {
  fullName: string
}): Record<string, unknown> {
  return { professional: { full_name: input.fullName } }
}

/** The provider's « Mes documents » (Task 4c.6): the document emails' button, behind sign-in. */
export const MY_DOCUMENTS_PATH = '/mes-documents'

/**
 * `professionals.document_expiring`, `professionals.document_expired` and
 * `professionals.document_expired_reminder` (Task 4c.4). `expiresOn` is the
 * date-only last valid day (`yyyy-MM-dd`): the template declares it `kind:
 * date`, so it is printed as written, never shifted by a time zone.
 */
export function documentExpiryValues(input: {
  firstName: string
  clinicName: string
  expiresOn: string
}): Record<string, unknown> {
  return {
    professional: { first_name: input.firstName },
    clinic: { name: input.clinicName },
    document: { expires_on: input.expiresOn },
  }
}

/** `professionals.document_rejected` (sent by Task 4c.3's function after `reject_professional_document`). */
export function documentRejectedValues(input: {
  firstName: string
  clinicName: string
  typeName: string
  reason: string
}): Record<string, unknown> {
  return {
    professional: { first_name: input.firstName },
    clinic: { name: input.clinicName },
    document: { type_name: input.typeName, rejection_reason: input.reason },
  }
}

/** An app path the module builds (no `//`, query, fragment or dot segment). */
const APP_PATH = /^\/(?:[a-z0-9-]+\/)*[a-z0-9-]*$/

/**
 * `<APP_URL origin><path>`, or null when `APP_URL` is not an accepted app
 * origin (`appOrigin`: https, or `http://localhost:5173` locally) or `path`
 * is not a plain app path. Never carries a token.
 */
export function appPageUrl(
  appUrl: string | undefined,
  path: string,
): string | null {
  const origin = appOrigin(appUrl?.trim() ?? '')
  return origin && APP_PATH.test(path) ? `${origin}${path}` : null
}

/** The record page a reviewer opens (the in-app notice's link, P4-271). */
export function professionalDocumentsPath(professionalId: string): string {
  return `/professionnels/${professionalId}/documents`
}

/** An RPC error as supabase-js returns it (PostgREST adds `hint` and `details`). */
export interface RpcError {
  code?: string
  message?: string
  hint?: string | null
  details?: string | null
}

/** A HINT that names a field or a step (4b.1 « Refusals »), never a sentence. */
const FIELD_HINT = /^[a-z_]{1,32}$/
/** The DETAIL of a `sections` refusal: section keys, comma-separated. */
const SECTION_LIST = /^[a-z_]{1,32}(?:,[a-z_]{1,32}){0,19}$/

/**
 * The answer for a module RPC's error: as `rpcErrorResponse`, but a P0001
 * refusal also carries its HINT as `field` (`account`, `submission`,
 * `status`, `invitation`, `sections`…) and, for `sections`, the incomplete
 * section keys from its DETAIL as `sections`, so the app can route it. The
 * messages and these keys never hold a value (4b.1).
 */
export function professionalsRpcError(
  error: RpcError,
  req?: Request,
): Response {
  if (error.code !== 'P0001' || !error.message) {
    return rpcErrorResponse(error, req)
  }
  const field = error.hint && FIELD_HINT.test(error.hint) ? error.hint : null
  const sections = field === 'sections' && error.details &&
      SECTION_LIST.test(error.details)
    ? error.details.split(',')
    : null
  return jsonResponse(
    {
      error: {
        code: 'invalid_request',
        message: error.message,
        refusal: true,
        ...(field && { field }),
        ...(sections && { sections }),
      },
    },
    400,
    req,
  )
}

// The SQLSTATEs `professionalsRpcError` answers as the caller's own (not reported).
export { isExpectedRpcError } from './errors.ts'
