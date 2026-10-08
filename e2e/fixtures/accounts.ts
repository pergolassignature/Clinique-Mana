/**
 * The four logins of the local seed (local seed only, `supabase/seed.sql` header). They exist only
 * on a local stack after `npm run db:reset`; the auth fixture refuses to type them anywhere else.
 */
export const SEED_PASSWORD = 'ManaLocal-2026'

export const ACCOUNTS = {
  admin: { email: 'admin@mana.test', name: 'Admin Local' },
  counselor: { email: 'conseillere@mana.test', name: 'Conseillère Locale' },
  adminAssistant: { email: 'adjointe@mana.test', name: 'Adjointe Locale' },
  provider: { email: 'provider@mana.test', name: 'Pro Local' },
} as const

export type AccountKey = keyof typeof ACCOUNTS
