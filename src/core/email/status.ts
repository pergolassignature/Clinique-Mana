import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'

/** `email_log.status`, in the order of the log's filter, with the tone of its dot. */
export const EMAIL_STATUSES = {
  queued: 'neutral',
  sent: 'neutral',
  delivered: 'success',
  delivery_delayed: 'warning',
  bounced: 'error',
  complained: 'error',
  failed: 'error',
} as const satisfies Record<string, StatusTone>
export type EmailStatus = keyof typeof EMAIL_STATUSES
const isEmailStatus = (status: string): status is EmailStatus => Object.hasOwn(EMAIL_STATUSES, status)

/**
 * The `error_code` of a `failed` row, as written by the send path and the database:
 * - `mark_email_failed` stores the transport's code (`_shared/email/transport.ts`):
 *   `provider_unavailable`, `provider_rejected`, `provider_rate_limited`, `invalid_recipient`;
 * - the Resend webhook's `email.failed` stores `provider_failed` (`apply_email_event`);
 * - the stale-queue job stores `provider_unavailable`.
 * The transport's `resend_*` details (`resend_503`, `resend_timeout`…) are report codes only:
 * they are never stored. Anything else reads « Échec » with its code.
 */
const FAILURES = {
  invalid_recipient: 'email.failure.invalidRecipient',
  provider_rejected: 'email.failure.rejected',
  provider_failed: 'email.failure.rejected',
  provider_rate_limited: 'email.failure.rateLimited',
} as const
const isKnownFailure = (code: string): code is keyof typeof FAILURES => Object.hasOwn(FAILURES, code)

interface EmailStatusLabel {
  /** The French word for the outcome. */
  label: string
  tone: StatusTone
  /** A second line, or null: why the outcome is unknown, or « Code : … » for a code with no French word. */
  detail: string | null
}

/**
 * How an email's status reads, wherever it is shown (Courriels → Historique d'envoi, and the
 * timelines of Phase 4). A `failed` row with `provider_unavailable` is **not** a failure: the
 * provider may have accepted it and a later webhook can still move it on, so it reads « Résultat
 * inconnu » (warning), never « Échec ». Other known codes name the reason; an unknown code shows
 * as « Code : … » under « Échec ». An unknown status is shown as stored.
 */
export function emailStatusLabel(status: string, errorCode: string | null): EmailStatusLabel {
  if (!isEmailStatus(status)) return { label: status, tone: 'default', detail: null }
  if (status === 'failed' && errorCode !== null) {
    if (errorCode === 'provider_unavailable') {
      return { label: t('email.failure.unknownOutcome'), tone: 'warning', detail: t('email.failure.unknownOutcomeHint') }
    }
    if (isKnownFailure(errorCode)) return { label: t(FAILURES[errorCode]), tone: 'error', detail: null }
    return { label: t('email.status.failed'), tone: 'error', detail: t('email.errorCode', { code: errorCode }) }
  }
  return { label: t(`email.status.${status}`), tone: EMAIL_STATUSES[status], detail: null }
}
