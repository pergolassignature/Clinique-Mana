import { supabase } from '@/core/supabase/client'
import type { Tables } from '@/core/supabase/database.types'

/** Everything the settings pages read from `organizations` (design §3.2). */
export const ORGANIZATION_COLUMNS =
  'id, name, timezone, default_locale, currency, legal_name, neq, address_line1, address_line2, city, province, postal_code, country, phone, email, website, gst_number, qst_number, signatory_name, signatory_title, signatory_email, logo_file_id, signature_file_id, privacy_officer_name, privacy_officer_email, privacy_policy_url, record_retention_years, updated_at' as const

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
  | 'signatory_email'
  | 'logo_file_id'
  | 'signature_file_id'
  | 'privacy_officer_name'
  | 'privacy_officer_email'
  | 'privacy_policy_url'
  | 'record_retention_years'
  | 'updated_at'
>

/**
 * The columns a settings card may write. `default_locale` and `currency` stay read-only until a
 * second one exists; `country` has no update grant (sending it raises 42501), and neither have the
 * logo and signature image (`setOrgAsset`).
 */
export type OrganizationUpdate = Partial<
  Omit<Organization, 'id' | 'default_locale' | 'currency' | 'country' | 'updated_at' | 'logo_file_id' | 'signature_file_id'>
>

/** The clinic's two images: the logo and the signatory's signature. */
export type OrgAssetKind = 'logo' | 'signature'

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

/**
 * Sets the clinic's logo or signature image to an uploaded file (`ready`, of purpose `org_logo` /
 * `org_signature`), or removes it with null (« Retirer »). `set_org_asset` (settings.manage)
 * soft-deletes the previous file; P0001 « Fichier introuvable. » for a file it cannot use.
 */
export async function setOrgAsset(kind: OrgAssetKind, fileId: string | null): Promise<void> {
  // The generated types mark the argument non-null; the function takes null for « Retirer ».
  const { error } = await supabase.rpc('set_org_asset', { p_kind: kind, p_file_id: fileId as string })
  if (error) throw error
}
