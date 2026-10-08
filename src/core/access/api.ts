import * as Sentry from '@sentry/react'
import { supabase } from '@/core/supabase/client'
import { parseAccess, type AccessResult } from './access'

export async function fetchMyAccess(): Promise<AccessResult> {
  const { data, error } = await supabase.rpc('get_my_access')
  if (error) throw error
  try {
    return parseAccess(data)
  } catch (parseError) {
    // The RPC and the schema disagree: a deploy bug, not a user problem. No-op without Sentry init.
    Sentry.captureException(parseError, { tags: { area: 'access' } })
    throw parseError
  }
}

/**
 * A role the clinic can use: a base role (`org_id` null: admin, counselor, admin_assistant,
 * provider) or one of the clinic's custom roles (`custom_` + 8 hex characters, decision #40).
 */
export interface OrgRole {
  key: string
  /** French, stored (roles.name). Base roles show their i18n label instead (`roleLabel`). */
  name: string
  org_id: string | null
}

/** The base roles and the caller's clinic's custom roles (RLS on `roles` keeps the other clinics' out). */
export async function fetchOrgRoles(): Promise<OrgRole[]> {
  const { data, error } = await supabase.from('roles').select('key, name, org_id')
  if (error) throw error
  return data
}

export interface CatalogPermission {
  key: string
  module_key: string
  /** French, shown as is. */
  description: string
}

/** The permission template: what exists, by module. It changes only with a migration. */
export interface PermissionCatalog {
  permissions: CatalogPermission[]
  modules: { key: string; name: string }[]
}

/** Permissions and modules, readable by every authenticated user. */
export async function fetchPermissionCatalog(): Promise<PermissionCatalog> {
  const [permissions, modules] = await Promise.all([
    supabase.from('permissions').select('key, module_key, description'),
    supabase.from('modules').select('key, name'),
  ])
  if (permissions.error) throw permissions.error
  if (modules.error) throw modules.error
  return { permissions: permissions.data, modules: modules.data }
}
