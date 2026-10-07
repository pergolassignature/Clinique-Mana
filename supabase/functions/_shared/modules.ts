/**
 * Design §3: a disabled module's functions refuse calls.
 *
 * - User-scoped functions: `requireModule(auth.client, key)` after `verifyAuth`
 *   (or `verifyAuth(req, { module: key })`, which needs no extra RPC).
 * - Functions without a user (webhooks, cron): resolve the org from a database
 *   row, never from the request, then
 *   `requireModuleForOrg(serviceClient, orgId, key)`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { errorResponse } from './auth.ts'

type RpcResult = { data: unknown; error: unknown }

function decide(
  { data, error }: RpcResult,
  moduleKey: string,
  rpc: string,
  req?: Request,
): Response | null {
  if (error) {
    console.error(`[requireModule] ${rpc} failed`, error)
    return errorResponse('internal', 'Module check failed', 500, req)
  }
  return data === true ? null : errorResponse(
    'module_disabled',
    `Module disabled: ${moduleKey}`,
    403,
    req,
  )
}

/** null when the module is enabled for the caller's org, otherwise a Response (403/500). */
export async function requireModule(
  client: SupabaseClient,
  moduleKey: string,
  req?: Request,
): Promise<Response | null> {
  const result = await client.rpc('module_enabled', { p_key: moduleKey })
  return decide(result, moduleKey, 'module_enabled', req)
}

/**
 * null when the module is enabled for `orgId`, otherwise a Response (403/500).
 * Needs a service-role client (`module_enabled_for_org` is service-role only).
 */
export async function requireModuleForOrg(
  serviceClient: SupabaseClient,
  orgId: string,
  moduleKey: string,
  req?: Request,
): Promise<Response | null> {
  if (!orgId) {
    console.error('[requireModuleForOrg] called without an org id')
    return errorResponse('internal', 'Module check failed', 500, req)
  }
  const result = await serviceClient.rpc('module_enabled_for_org', {
    p_org_id: orgId,
    p_key: moduleKey,
  })
  return decide(result, moduleKey, 'module_enabled_for_org', req)
}
