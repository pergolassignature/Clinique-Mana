/**
 * Design §3: a disabled module's functions refuse calls.
 * Pass the caller's client (`AuthResult.client`): `module_enabled` reads the
 * caller's org. Call it after `verifyAuth`.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { errorResponse } from './auth.ts'

/** null when the module is enabled for the caller's org, otherwise a Response (403/500). */
export async function requireModule(client: SupabaseClient, moduleKey: string): Promise<Response | null> {
  const { data, error } = await client.rpc('module_enabled', { p_key: moduleKey })
  if (error) return errorResponse('Module check failed', 500)
  return data === true ? null : errorResponse(`Module disabled: ${moduleKey}`, 403)
}
