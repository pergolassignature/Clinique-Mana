import { z } from 'zod'
import { t } from '@/i18n'

/**
 * A new password, as GoTrue accepts it: at least 10 characters (`minimum_password_length` in
 * config.toml) and at most 72 bytes, since bcrypt only uses the first 72 (an accented letter
 * takes two). Used by « Choisir un nouveau mot de passe » and « Mon compte ». The same rule as
 * `accept-invite` (`supabase/functions/_shared/password.ts`) and config.toml:
 * `password-parity.test.ts`.
 */
export const newPasswordRule = z
  .string()
  .min(10, { error: t('auth.reset.tooShort') })
  .refine((v) => new TextEncoder().encode(v).length <= 72, { error: t('auth.reset.tooLong') })

/** For forms that add fields to the pair: refine the whole object with this and `passwordMismatch`. */
export const passwordsMatch = (v: { password: string; confirm: string }) => v.password === v.confirm
export const passwordMismatch = { path: ['confirm'], error: t('auth.reset.mismatch') }

/** New password + confirmation. */
export const newPasswordSchema = z.object({ password: newPasswordRule, confirm: z.string() }).refine(passwordsMatch, passwordMismatch)
export type NewPasswordValues = z.infer<typeof newPasswordSchema>
