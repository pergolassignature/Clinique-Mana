import { t } from '@/i18n'
import { formatDateOnly } from '@/shared/lib/timezone'
import type { Cadence, ClientPayerBilling, OrganisationKind } from '../api/payers'
import { formatCents } from './money'

const V = 'modules.billing.audit.values.payer_organisations'

export const organisationKindLabel = (kind: OrganisationKind): string => t(`${V}.kind.${kind}`)
export const cadenceLabel = (cadence: Cadence): string => t(`${V}.cadence.${cadence}`)

const C = 'modules.billing.payers.client'

/**
 * A client's payer's use this agreement year, in plain words (FP-8): « 160,00 $ utilisés sur
 * 300,00 $ » and/or « 2 séances sur 10 », else what was used with no maximum. The amounts are the
 * database's.
 */
export function usageText(p: ClientPayerBilling): string {
  const parts: string[] = []
  if (p.maxAmountCents !== null) parts.push(t(`${C}.usedOfAmount`, { used: formatCents(p.usedCents), max: formatCents(p.maxAmountCents) }))
  if (p.maxSessions !== null) parts.push(t(`${C}.usedOfSessions`, { used: String(p.usedSessions), max: String(p.maxSessions) }))
  if (parts.length === 0) parts.push(t(`${C}.usedNoMax`, { used: formatCents(p.usedCents), sessions: String(p.usedSessions) }))
  return parts.join(' · ')
}

/** « Année de l'entente : du 1 avril 2026 au 31 mars 2027 », when the database knows its bounds. */
export function periodText(p: ClientPayerBilling): string | null {
  if (!p.periodFrom || !p.periodTo) return null
  return t(`${C}.period`, { from: formatDateOnly(p.periodFrom), to: formatDateOnly(p.periodTo) })
}
