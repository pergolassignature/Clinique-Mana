/**
 * A new password as GoTrue takes it: at least `minimum_password_length`
 * characters (supabase/config.toml) and at most 72 bytes, since bcrypt reads
 * only the first 72 (an accented letter takes two). `accept-invite` checks it
 * before creating the account; the browser's twin is
 * `src/core/auth/password-schema.ts`, and
 * `src/core/auth/password-parity.test.ts` holds the two and config.toml to one
 * rule (Vitest imports this file: zod only). Auth may still refuse a password
 * for its own reasons (leaked-password protection on staging): `weak_password`.
 */
import { z } from 'zod'

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_BYTES = 72

const utf8Length = (value: string) => new TextEncoder().encode(value).length

export const passwordRule = z.string().min(MIN_PASSWORD_LENGTH).refine((v) =>
  utf8Length(v) <= MAX_PASSWORD_BYTES
)
