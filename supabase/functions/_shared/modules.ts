/**
 * Design §3: a disabled module's functions refuse calls.
 *
 * - User-scoped functions: `verifyAuth(req, { module: key })` (auth.ts).
 * - Functions without a user (public token functions, jobs): resolve the org
 *   from a database row, never from the request, then
 *   `requireModuleForOrg(serviceClient, orgId, key)`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { errorResponse } from './auth.ts'
import { logErrorCode } from './log.ts'

type RpcResult = { data: unknown; error: unknown }

function decide(
  { data, error }: RpcResult,
  moduleKey: string,
  rpc: string,
): Response | null {
  if (error) {
    logErrorCode('requireModule', `${rpc} failed`, error)
    return errorResponse('internal', 'Module check failed', 500)
  }
  return data === true ? null : errorResponse(
    'module_disabled',
    `Module disabled: ${moduleKey}`,
    403,
  )
}

/**
 * null when the module is enabled for `orgId`, otherwise a Response (403/500).
 * Needs a service-role client (`module_enabled_for_org` is service-role only).
 */
export async function requireModuleForOrg(
  serviceClient: SupabaseClient,
  orgId: string,
  moduleKey: string,
): Promise<Response | null> {
  if (!orgId) {
    console.error('[requireModuleForOrg] called without an org id')
    return errorResponse('internal', 'Module check failed', 500)
  }
  const result = await serviceClient.rpc('module_enabled_for_org', {
    p_org_id: orgId,
    p_key: moduleKey,
  })
  return decide(result, moduleKey, 'module_enabled_for_org')
}
