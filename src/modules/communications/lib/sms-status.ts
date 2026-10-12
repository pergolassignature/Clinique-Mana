import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { SmsConsentStatus, SmsKind, SmsStatus } from '../api/sms'

const S = 'modules.communications.sms'

/** Codes the page has words for (`sms_messages.error_code`); a delivery report's own code reads « code de la centrale : … ». */
const KNOWN_ERRORS = new Set([
  'provider_unreachable',
  'provider_error',
  'provider_rejected',
  'token_limit',
  'token_invalid',
  'channel_not_found',
  'not_configured',
  'module_disabled',
  'lock_timeout',
  'provider_unavailable',
  'consent_withdrawn',
  'internal',
])

/** Why a text failed, in French, from its stored code (`null` → the generic text). */
export function smsErrorText(code: string | null): string {
  if (code && KNOWN_ERRORS.has(code)) return t(`${S}.errorCode.${code as 'internal'}`)
  return t(`${S}.errorCode.other`, { code: code ?? '—' })
}

const STATUS_TONES: Record<SmsStatus, StatusTone> = {
  queued: 'neutral',
  sending: 'neutral',
  sent: 'success',
  failed: 'error',
  received: 'info',
}

/** A text's status as shown wherever it appears (« Textos », the settings' test): one word and its dot. */
export function smsStatusLabel(status: SmsStatus): { label: string; tone: StatusTone } {
  return { label: t(`${S}.status.${status}`), tone: STATUS_TONES[status] }
}

/** Why a text was sent (« Rappel », « Réponse »…). */
export function smsKindLabel(kind: SmsKind): string {
  return t(`${S}.kind.${kind}`)
}

/** The consent in force for a number: « Consentement donné », « … retiré », « Aucun consentement ». */
export function smsConsentLabel(status: SmsConsentStatus | null): { label: string; tone: StatusTone } {
  if (status === 'opted_in') return { label: t(`${S}.consent.opted_in`), tone: 'success' }
  if (status === 'opted_out') return { label: t(`${S}.consent.opted_out`), tone: 'error' }
  return { label: t(`${S}.consent.none`), tone: 'neutral' }
}
