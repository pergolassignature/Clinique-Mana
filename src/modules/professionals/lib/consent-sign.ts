import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import type { MyImageConsent } from '../api/consent-sign'

const S = 'modules.professionals.consentSign'

/** Documenso sends her back with `?consentement=signe` (the function's redirect). */
export const SIGNED_PARAM = 'consentement'

/**
 * « Signé le 9 oct. 2026 » (signed through Documenso), or « Consentement au dossier » (a paper one
 * the clinic attached); null when none is in force. Never an end date: the consent does not expire
 * (P4-504).
 */
export function consentInForceText(consent: MyImageConsent): string | null {
  if (!consent.validUntil) return null
  const request = consent.request
  const signedAt = request?.status === 'signed' ? (request.signedAt ?? request.completedAt) : null
  return signedAt ? t(`${S}.signedOn`, { date: formatClinicDateShort(signedAt) }) : t(`${S}.onFile`)
}
