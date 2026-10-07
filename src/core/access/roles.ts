import { t, type TranslationKey } from '@/i18n'

const KNOWN = ['admin', 'counselor', 'admin_assistant', 'provider'] as const

/** French label of a role key; the database name (roles.name) for roles added later, else the key. */
export function roleLabel(key: string, databaseName?: string | null): string {
  if ((KNOWN as readonly string[]).includes(key)) return t(`roles.${key}` as TranslationKey)
  return databaseName ?? key
}
