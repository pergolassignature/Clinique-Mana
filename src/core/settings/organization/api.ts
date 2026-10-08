import { supabase } from '@/core/supabase/client'
import type { Tables } from '@/core/supabase/database.types'

/** Everything the settings pages read from `organizations` (design §3.2). */
export const ORGANIZATION_COLUMNS =
  'id, name, timezone, default_locale, currency, legal_name, neq, address_line1, address_line2, city, province, postal_code, country, phone, email, website, gst_number, qst_number, signatory_name, signatory_title, privacy_officer_name, privacy_officer_email, privacy_policy_url, record_retention_years, updated_at' as const

export type Organization = Pick<
  Tables<'organizations'>,
  | 'id'
  | 'name'
  | 'timezone'
  | 'default_locale'
  | 'currency'
  | 'legal_name'
  | 'neq'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'province'
  | 'postal_code'
  | 'country'
  | 'phone'
  | 'email'
  | 'website'
  | 'gst_number'
  | 'qst_number'
  | 'signatory_name'
  | 'signatory_title'
  | 'privacy_officer_name'
  | 'privacy_officer_email'
  | 'privacy_policy_url'
  | 'record_retention_years'
  | 'updated_at'
>

/**
 * The columns a settings card may write. `default_locale` and `currency` stay read-only until a
 * second one exists; `country` has no update grant (sending it raises 42501).
 */
export type OrganizationUpdate = Partial<Omit<Organization, 'id' | 'default_locale' | 'currency' | 'country' | 'updated_at'>>

/** The caller's organization (RLS returns only their own). */
export async function fetchOrganization(): Promise<Organization> {
  const { data, error } = await supabase.from('organizations').select(ORGANIZATION_COLUMNS).single()
  if (error) throw error
  return data
}

/**
 * Updates the caller's organization and returns the saved row.
 *
 * RLS needs `settings.manage`, and a refused update is not an error: it updates zero rows. That
 * case throws a 42501-shaped error, which `moduleErrorMessage` turns into the permission text.
 */
export async function updateOrganization(id: string, patch: OrganizationUpdate): Promise<Organization> {
  const { data, error } = await supabase.from('organizations').update(patch).eq('id', id).select(ORGANIZATION_COLUMNS)
  if (error) throw error
  const [saved] = data
  if (!saved) throw Object.assign(new Error('no row updated'), { code: '42501' })
  return saved
}
