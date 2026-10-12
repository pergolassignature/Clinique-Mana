import { supabase } from '@/core/supabase/client'

/** A module of the clinic reserved (or not) for its testers (R-72). */
export interface ModuleTesters {
  key: string
  testersOnly: boolean
  /** The testers' user ids, in the order they were added. */
  testerIds: string[]
}

/** The flag and the testers of every module the clinic has toggled (`list_module_testers`, modules.manage). */
export async function fetchModuleTesters(): Promise<ModuleTesters[]> {
  const { data, error } = await supabase.rpc('list_module_testers')
  if (error) throw error
  return data.map((row) => ({ key: row.module_key, testersOnly: row.testers_only, testerIds: row.tester_ids ?? [] }))
}

/** Reserves a module for its testers (true) or opens it to everyone (false). */
export async function setModuleTestersOnly(key: string, testersOnly: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_module_testers_only', { p_key: key, p_testers_only: testersOnly })
  if (error) throw error
}

/** Adds an active member of the clinic as a tester (French P0001 otherwise). */
export async function addModuleTester(key: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_module_tester', { p_key: key, p_user_id: userId })
  if (error) throw error
}

export async function removeModuleTester(key: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_module_tester', { p_key: key, p_user_id: userId })
  if (error) throw error
}
