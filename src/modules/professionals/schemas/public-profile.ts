import { z } from 'zod'
import { t } from '@/i18n'
import { optionalEmail, optionalPhone } from '@/shared/lib/field-schemas'
import { formatPhone } from '@/shared/lib/format'
import type { PublicProfile } from '../api/parse'
import { longText } from './text'

/**
 * « Profil public » (`professionals.manage`): the texts on the fiche and the public contact, as
 * `professional_public_profiles_*_check` checks them. Empty fields are not shown (null).
 */
export const publicProfileSchema = z.object({
  bio: longText(4000),
  approach: longText(4000),
  // Stored lower-cased (the check compares with lower()), 254 characters at most.
  publicEmail: optionalEmail()
    .transform((v) => v?.toLowerCase() ?? null)
    .refine((v) => v === null || v.length <= 254, { error: t('auth.errors.invalidEmail') }),
  publicPhone: optionalPhone(),
})
type PublicProfileValues = z.input<typeof publicProfileSchema>

export function toPublicProfileFormValues(p: PublicProfile): PublicProfileValues {
  return { bio: p.bio ?? '', approach: p.approach ?? '', publicEmail: p.publicEmail ?? '', publicPhone: formatPhone(p.publicPhone) }
}
