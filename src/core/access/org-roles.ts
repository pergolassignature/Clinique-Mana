import { useQuery } from '@tanstack/react-query'
import { t } from '@/i18n'
import { useAccess } from './access-context'
import { fetchOrgRoles } from './api'
import { isBaseRoleKey, roleLabel } from './roles'

/**
 * The clinic's roles and their defaults (decision #40), two queries so each change refetches only
 * what it touched: a cell → the defaults; a rename → the roles; a creation or a deletion → both.
 * Here, not in the users module, so the shell and the audit log can name a custom role.
 */
export const roleKeys = {
  all: ['roles'] as const,
  list: (orgId: string) => [...roleKeys.all, orgId, 'list'] as const,
  defaults: (orgId: string) => [...roleKeys.all, orgId, 'defaults'] as const,
}

/** The caller's org id ('' before access loads: the queries wait for it). */
export function useOrgId(): string {
  return useAccess().access?.org_id ?? ''
}

/** The base roles and the clinic's custom roles (names change rarely: the app's default freshness). */
export function useOrgRoles({ enabled = true }: { enabled?: boolean } = {}) {
  const orgId = useOrgId()
  return useQuery({ queryKey: roleKeys.list(orgId), queryFn: fetchOrgRoles, enabled: enabled && orgId !== '' })
}

/**
 * A role's label: the i18n label of a base role, the stored name of a custom role (`get_my_access`
 * returns only the key). Only a custom role loads the roles. Its label is empty while they load
 * (callers keep the line's height), and « Rôle personnalisé » if they cannot be loaded or no longer
 * list it: never the raw `custom_…` key.
 */
export function useRoleLabel(role: string): string {
  const custom = !isBaseRoleKey(role)
  const roles = useOrgRoles({ enabled: custom })
  if (!custom) return roleLabel(role)
  if (roles.isPending) return ''
  return roles.data?.find((r) => r.key === role)?.name ?? t('access.customRole')
}
