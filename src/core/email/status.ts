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
 * they are never stored. Anything else reads « Échec · Raison inconnue », its code in a tooltip
 * (C-7); `status.test.ts` fails on a transport code missing here.
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
  /** A second line, or null: why the outcome is unknown, or « Raison inconnue » for a code with no French word. */
  detail: string | null
  /** The raw code of a reason or status with no French word, for a tooltip only (C-7); null otherwise. */
  code: string | null
}

/**
 * How an email's status reads, wherever it is shown (Courriels → Historique d'envoi, and the
 * timelines of Phase 4). A `failed` row with `provider_unavailable` is **not** a failure: the
 * provider may have accepted it and a later webhook can still move it on, so it reads « Résultat
 * inconnu » (warning), never « Échec ». Other known codes name the reason; an unknown code shows
 * as « Raison inconnue » under « Échec » (the code in `code`, for a tooltip). An unknown status
 * reads « Statut inconnu ».
 */
export function emailStatusLabel(status: string, errorCode: string | null): EmailStatusLabel {
  if (!isEmailStatus(status)) return { label: t('email.status.unknown'), tone: 'default', detail: null, code: status }
  if (status === 'failed' && errorCode !== null) {
    if (errorCode === 'provider_unavailable') {
      return { label: t('email.failure.unknownOutcome'), tone: 'warning', detail: t('email.failure.unknownOutcomeHint'), code: null }
    }
    if (isKnownFailure(errorCode)) return { label: t(FAILURES[errorCode]), tone: 'error', detail: null, code: null }
    return { label: t('email.status.failed'), tone: 'error', detail: t('email.failure.unexpected'), code: errorCode }
  }
  return { label: t(`email.status.${status}`), tone: EMAIL_STATUSES[status], detail: null, code: null }
}

/**
 * The codes of an email that did not leave at send time (a function's `email_problem`, an
 * invitation's stored `email_error`; `_shared/email/send.ts` `SendFailureCode`), in the words of
 * the log's failures (C3, C-6): a refused address reads « Adresse invalide » here as in Courriels.
 */
const SEND_PROBLEMS = {
  invalid_request: 'email.failure.invalidRecipient',
  rate_limited: 'email.failure.rateLimited',
  not_configured: 'email.failure.notConfigured',
  module_disabled: 'email.failure.moduleDisabled',
  provider_error: 'email.failure.providerError',
} as const
const isSendProblem = (code: string): code is keyof typeof SEND_PROBLEMS => Object.hasOwn(SEND_PROBLEMS, code)

/**
 * Why an email did not leave, as a status word (« Adresse invalide », « Limite d'envoi atteinte »,
 * « Envoi de courriels non configuré… »): a log row's `error_code` as `emailStatusLabel` reads it,
 * or a send-time code; « Échec » for anything else. Every « courriel non parti » line and toast
 * names its reason with it, so an invitation never words a failure its own way.
 */
export function emailProblemLabel(code: string | null): string {
  if (code === null) return t('email.status.failed')
  if (isSendProblem(code)) return t(SEND_PROBLEMS[code])
  return emailStatusLabel('failed', code).label
}

