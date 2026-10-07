import { supabase } from '@/core/supabase/client'

export interface ModuleRow {
  key: string
  name: string
  depends_on: string[]
  enabled: boolean
}

/** The org's modules (excluding core) with their dependencies and enabled flag. */
export async function fetchModules(): Promise<ModuleRow[]> {
  const { data, error } = await supabase.rpc('list_modules')
  if (error) throw error
  return data.map(({ key, name, depends_on, enabled }) => ({ key, name, depends_on, enabled }))
}

/** Raises the SQL error (French message) on missing permission or dependency problems. */
export async function setModuleEnabled(key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_module_enabled', { p_key: key, p_enabled: enabled })
  if (error) throw error
}
