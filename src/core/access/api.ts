import { supabase } from '@/core/supabase/client'
import { parseAccess, type AccessResult } from './access'

export async function fetchMyAccess(): Promise<AccessResult> {
  const { data, error } = await supabase.rpc('get_my_access')
  if (error) throw error
  return parseAccess(data)
}
