import { t } from '@/i18n'
import type { PushKind, PushStatus } from '../api/quickbooks'

const P = 'modules.billing.qbo.push'

/** « Facture », « Note de crédit », « Paiement », « Facture du professionnel ». */
export const pushKindLabel = (kind: PushKind): string => t(`${P}.kinds.${kind}`)

/** « Envoyé », « En attente », « En échec ». */
export const pushStatusLabel = (status: PushStatus): string => t(`${P}.statuses.${status}`)

const KNOWN = [
  'missing_map',
  'qbo_validation',
  'qbo_duplicate_name',
  'qbo_rate_limited',
  'qbo_timeout',
  'qbo_unreachable',
  'qbo_provider_error',
  'qbo_forbidden',
  'invoice_not_pushed',
  'client_gone',
  'not_supported',
  'bill_voided',
] as const
type KnownCode = (typeof KNOWN)[number]

/** Why a push did not go, in plain words; any other code reads as « Erreur inattendue ». */
export function pushErrorText(code: string | null): string | null {
  if (!code) return null
  return (KNOWN as readonly string[]).includes(code) ? t(`${P}.errors.${code as KnownCode}`) : t(`${P}.errors.other`)
}
