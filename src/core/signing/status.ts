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
 * The `last_error` of a draft whose send failed, when it has French words. `_shared/signing.ts`
 * stores a send's (`mark_signature_request_failed`): Documenso unreachable or failing, refusing the
 * key, or the document refused before it was sent (subject or message too long, two signers with
 * one address). The reconcile stores a failed settle's with its own codes (`failureCode`,
 * `_shared/signing-events.ts`): the envelope not found at Documenso, the request refused, Documenso
 * unreachable, the key refused. Every other code (`render_failed`, `storage_failed`,
 * `mark_sent_failed`, `previous_cancel_failed`, `provider_error`…) reads « Code : … ».
 */
const FAILURES = {
  provider_unavailable: 'signing.failure.providerUnavailable',
  provider_not_configured: 'signing.failure.providerRefused',
  provider_invalid_request: 'signing.failure.providerInvalidRequest',
  provider_not_found: 'signing.failure.providerNotFound',
  provider_rejected: 'signing.failure.providerRejected',
  provider_unreachable: 'signing.failure.providerUnreachable',
  not_configured: 'signing.failure.providerRefused',
} as const
const isKnownFailure = (code: string): code is keyof typeof FAILURES => Object.hasOwn(FAILURES, code)

interface SignatureStatusLabel {
  /** The French word for the state. */
  label: string
  tone: StatusTone
  /** A second line, or null: why a send failed, or « Code : … » for a code with no French words. */
  detail: string | null
}

/**
 * How a signature request's state reads, wherever it is shown (Signature électronique → the last
 * test document, and the record timelines of Phase 4). A draft is a send under way until it has a
 * `last_error`: `abandoned` (the reconcile gave it up) reads « Abandonné », any other code is
 * « Échec de l'envoi » with its reason. Once a request has left the draft state its error code no
 * longer applies. An unknown status is shown as stored.
 */
export function signatureStatusLabel(status: string, lastError: string | null): SignatureStatusLabel {
  if (!isSignatureStatus(status)) return { label: status, tone: 'default', detail: null }
  if (status === 'draft' && lastError !== null) {
    if (lastError === 'abandoned') return { label: t('signing.failure.abandoned'), tone: 'default', detail: null }
    return {
      label: t('signing.failure.failed'),
      tone: 'error',
      detail: isKnownFailure(lastError) ? t(FAILURES[lastError]) : t('signing.errorCode', { code: lastError }),
    }
  }
  return { label: t(`signing.status.${status}`), tone: SIGNATURE_STATUSES[status], detail: null }
}
