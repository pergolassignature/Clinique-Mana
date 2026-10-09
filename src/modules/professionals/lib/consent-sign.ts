import { t } from '@/i18n'
import { formatClinicDateShort, formatDateOnly } from '@/shared/lib/timezone'
import type { MyImageConsent } from '../api/consent-sign'

const S = 'modules.professionals.consentSign'

/** Documenso sends her back with `?consentement=signe` (the function's redirect). */
export const SIGNED_PARAM = 'consentement'

/** « Signé le 9 oct. 2026 · valide jusqu'au 9 octobre 2027 », or the end date alone (an e-consent, a paper one). */
export function consentInForceText(consent: MyImageConsent): string | null {
  if (!consent.validUntil) return null
  const until = formatDateOnly(consent.validUntil)
  const request = consent.request
  const signedAt = request?.status === 'signed' ? (request.signedAt ?? request.completedAt) : null
  return signedAt ? t(`${S}.signedOn`, { date: formatClinicDateShort(signedAt), until }) : t(`${S}.validUntil`, { until })
}

