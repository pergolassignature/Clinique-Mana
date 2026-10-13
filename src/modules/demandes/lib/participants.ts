import { t } from '@/i18n'

const P = 'modules.demandes.participants'

/**
 * How many people a request of this kind is for (legacy: couple 2, family 2 or more): a warning in
 * plain words, never a block (D-37). Null when the count fits or the kind says nothing.
 */
export function countWarning(beneficiary: string | null, count: number): string | null {
  if (beneficiary === 'couple' && count !== 2) return t(`${P}.count.couple`, { count: String(count) })
  if (beneficiary === 'family' && count < 2) return t(`${P}.count.family`, { count: String(count) })
  return null
}
