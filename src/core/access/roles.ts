import { t } from '@/i18n'
import frCA from '@/i18n/fr-CA.json'

// Labels in fr-CA.json `roles` must stay in sync with public.roles.name (migration 20261007192359_core_roles_split.sql).
type KnownRole = keyof typeof frCA.roles

const isKnownRole = (key: string): key is KnownRole => Object.hasOwn(frCA.roles, key)

/** French label of a role key; the database name (roles.name) for roles added later, else the key. */
export function roleLabel(key: string, databaseName?: string | null): string {
  return isKnownRole(key) ? t(`roles.${key}`) : (databaseName ?? key)
}
