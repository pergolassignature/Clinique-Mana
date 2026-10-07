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
