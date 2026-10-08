import { supabase } from '@/core/supabase/client'

/** A configured org secret: its name and when it was last set. The value never leaves Vault. */
interface OrgSecretKey {
  key: string
  updated_at: string
}

/** The secrets configured for the caller's org (`settings.view`): names only. */
export async function listOrgSecretKeys(): Promise<OrgSecretKey[]> {
  const { data, error } = await supabase.rpc('list_org_secret_keys')
  if (error) throw error
  return data
}

/** Creates or replaces a secret of the caller's org (`settings.integrations_manage`; the value goes to Vault). */
export async function setOrgSecret(key: string, value: string): Promise<void> {
  const { error } = await supabase.rpc('set_org_secret', { p_key: key, p_value: value })
  if (error) throw error
}
