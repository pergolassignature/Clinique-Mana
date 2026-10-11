import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'

/** `signature_requests.status`, in the order of its lifecycle, with the tone of its dot. */
const SIGNATURE_STATUSES = {
  draft: 'neutral',
  sent: 'neutral',
  viewed: 'neutral',
  signed: 'success',
  rejected: 'error',
  cancelled: 'default',
  expired: 'warning',
} as const satisfies Record<string, StatusTone>
type SignatureStatus = keyof typeof SIGNATURE_STATUSES
const isSignatureStatus = (status: string): status is SignatureStatus => Object.hasOwn(SIGNATURE_STATUSES, status)

/**
 * Every code a signature request's `last_error` may hold, in plain French (C6, C-7):
 * - the send (`_shared/signing.ts` `markFailed`): Documenso unreachable, failing or refusing the
 *   key or the document, the earlier envelope unreadable or not cancelled, a rendering failure
 *   (`PdfErrorCode`, or `render_failed`), the PDF not stored, the send not stamped (cancelled);
 * - the reconcile (`failureCode`, `_shared/signing-events.ts`): the envelope not found, the
 *   request refused, Documenso unreachable or failing, a foreign document, `internal`.
 * `signing-failure-codes.test.ts` reads those sources and fails on a code missing here. An
 * unknown code still reads in French (« Erreur inattendue ») and keeps the code for a tooltip.
 */
const FAILURES = {
  provider_unavailable: 'signing.failure.providerUnavailable',
  provider_not_configured: 'signing.failure.providerRefused',
  not_configured: 'signing.failure.providerRefused',
  provider_invalid_request: 'signing.failure.providerInvalidRequest',
  provider_not_found: 'signing.failure.providerNotFound',
  provider_rejected: 'signing.failure.providerRejected',
  provider_unreachable: 'signing.failure.providerUnreachable',
  provider_error: 'signing.failure.providerError',
  signing_foreign_document: 'signing.failure.foreignDocument',
  previous_read_failed: 'signing.failure.previousRead',
  previous_cancel_failed: 'signing.failure.previousCancel',
  recover_failed: 'signing.failure.recover',
  render_failed: 'signing.failure.render',
  invalid_document: 'signing.failure.render',
  document_too_large: 'signing.failure.tooLarge',
  image_too_large: 'signing.failure.asset',
  missing_asset: 'signing.failure.asset',
  unsupported_image: 'signing.failure.asset',
  asset_unavailable: 'signing.failure.asset',
  storage_failed: 'signing.failure.storage',
  mark_sent_failed: 'signing.failure.markSent',
  internal_error: 'signing.failure.internal',
  internal: 'signing.failure.internal',
} as const
type SigningFailureCode = keyof typeof FAILURES

/** Whether `code` has its own French words (the test of the codes the functions store). */
export function isKnownSigningFailure(code: string): code is SigningFailureCode {
  return Object.hasOwn(FAILURES, code)
}

/** Why a send or a check failed, in plain French; « Erreur inattendue » for a code with no words. */
export function signingFailureText(code: string): string {
  return isKnownSigningFailure(code) ? t(FAILURES[code]) : t('signing.failure.unexpected')
}

interface SignatureStatusLabel {
  /** The French word for the state. */
  label: string
  tone: StatusTone
  /** A second line, or null: why a send failed. */
  detail: string | null
  /** The raw code of a reason with no French words, for a tooltip only; null otherwise. */
  code: string | null
}

/**
 * How a signature request's state reads, wherever it is shown (Signature électronique → the last
 * test document, and the record timelines of Phase 4). A draft is a send under way until it has a
 * `last_error`: `abandoned` (the reconcile gave it up) reads « Abandonné », any other code is
 * « Échec de l'envoi » with its reason. Once a request has left the draft state its error code no
 * longer applies. An unknown status reads « État inconnu » (its value in `code`, for a tooltip).
 */
export function signatureStatusLabel(status: string, lastError: string | null): SignatureStatusLabel {
  if (!isSignatureStatus(status)) return { label: t('signing.status.unknown'), tone: 'default', detail: null, code: status }
  if (status === 'draft' && lastError !== null) {
    if (lastError === 'abandoned') return { label: t('signing.failure.abandoned'), tone: 'default', detail: null, code: null }
    return {
      label: t('signing.failure.failed'),
      tone: 'error',
      detail: signingFailureText(lastError),
      code: isKnownSigningFailure(lastError) ? null : lastError,
    }
  }
  return { label: t(`signing.status.${status}`), tone: SIGNATURE_STATUSES[status], detail: null, code: null }
}
