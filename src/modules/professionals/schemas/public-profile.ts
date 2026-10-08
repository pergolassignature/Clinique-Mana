import { z } from 'zod'
import { optionalEmail, optionalPhone } from '@/shared/lib/field-schemas'
import type { PublicProfile } from '../api/parse'
import { longText } from './text'

/**
 * « Profil public » (`professionals.manage`): the texts on the fiche and the public contact, as
 * `professional_public_profiles_*_check` checks them. Empty fields are not shown (null).
 */
export const publicProfileSchema = z.object({
  bio: longText(4000),
  approach: longText(4000),
  // Stored lower-cased (the check compares with lower()).
  publicEmail: optionalEmail().transform((v) => v?.toLowerCase() ?? null),
  publicPhone: optionalPhone(),
})
export type PublicProfileValues = z.input<typeof publicProfileSchema>

export function toPublicProfileFormValues(p: PublicProfile): PublicProfileValues {
  return { bio: p.bio ?? '', approach: p.approach ?? '', publicEmail: p.publicEmail ?? '', publicPhone: p.publicPhone ?? '' }
}
