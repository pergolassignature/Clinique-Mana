/**
 * Shared auth for Edge Functions (adapted from PS Hub `_shared/auth.ts`).
 *
 * RULE: every function deployed with `verify_jwt = false` MUST call
 * `verifyAuth()` / `verifyServiceRoleAuth()` before doing anything else,
 * or verify a webhook signature (use `timingSafeEqual` for the comparison).
 *
 * Permissions come from `public.get_my_access()` (the same payload the web app
 * reads). The RLS helpers (`private.has_permission`, …) are not exposed over the
 * API. Never trust an org id sent by the client: use `AuthResult.access.org_id`.
 */
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from './timing-safe-equal.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status)
}

/** Call first in every handler: answers the CORS preflight. */
export function handleCors(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { headers: corsHeaders }) : null
}

/** The bearer token from the Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('Authorization') ?? '')
  return match?.[1] ?? null
}

/** Subset of the `get_my_access()` payload that functions rely on. */
export interface CallerAccess {
  user_id: string
  org_id: string
  status: 'active'
  role: string | null
  permissions: string[]
  modules: string[]
}

export type AccessDecision =
  | { ok: true; access: CallerAccess }
  | { ok: false; status: 401 | 403 | 500; message: string }

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

/**
 * Pure decision on a `get_my_access` RPC result. Fails closed:
 * - RPC error 42501 (caller is not `authenticated`) → 401; any other error → 500;
 * - `null` (no profile) or a malformed payload → 403;
 * - `status !== 'active'` → 403, checked before the permission;
 * - `permission` given and not in `permissions` → 403.
 */
export function evaluateAccess(result: RpcResult, permission?: string): AccessDecision {
  if (result.error) {
    return result.error.code === '42501'
      ? { ok: false, status: 401, message: 'Not authenticated' }
      : { ok: false, status: 500, message: 'Permission check failed' }
  }
  const a = result.data as Partial<CallerAccess> | null
  if (
    !a ||
    typeof a !== 'object' ||
    Array.isArray(a) ||
    typeof a.user_id !== 'string' ||
    typeof a.org_id !== 'string' ||
    !Array.isArray(a.permissions) ||
    !Array.isArray(a.modules)
  ) {
    return { ok: false, status: 403, message: 'No access profile' }
  }
  if (a.status !== 'active') return { ok: false, status: 403, message: 'Account is not active' }
  if (permission && !a.permissions.includes(permission)) {
    return { ok: false, status: 403, message: `Permission required: ${permission}` }
  }
  return { ok: true, access: a as CallerAccess }
}

export interface AuthResult {
  user: User
  /** Caller's access payload (org, role, permissions, enabled modules). */
  access: CallerAccess
  /** RLS-respecting client acting as the caller. */
  client: SupabaseClient
}

/**
 * `verifyAuth` minus client construction (exported for tests): validates the
 * token with Auth, then requires an active profile and, optionally, a permission.
 */
export async function authorizeCaller(
  client: SupabaseClient,
  token: string,
  options: { permission?: string } = {},
): Promise<AuthResult | Response> {
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return errorResponse('Invalid or expired token', 401)

  const decision = evaluateAccess(await client.rpc('get_my_access'), options.permission)
  if (!decision.ok) return errorResponse(decision.message, decision.status)

  return { user: data.user, access: decision.access, client }
}

/**
 * Verifies the caller's JWT, requires an active profile, and optionally a
 * permission key. Returns AuthResult, or a Response to return immediately.
 *
 * @example
 * const auth = await verifyAuth(req, { permission: 'professionals.view' })
 * if (auth instanceof Response) return auth
 * const blocked = await requireModule(auth.client, 'professionals')
 * if (blocked) return blocked
 */
export async function verifyAuth(
  req: Request,
  options: { permission?: string } = {},
): Promise<AuthResult | Response> {
  const token = bearerToken(req)
  if (!token) return errorResponse('Missing Authorization header', 401)
  return await authorizeCaller(getUserClient(req), token, options)
}

/** For internal-only functions (cron, other functions). Fails closed if the key is unset. */
export function verifyServiceRoleAuth(req: Request): Response | null {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!serviceKey) {
    console.error('[verifyServiceRoleAuth] SUPABASE_SERVICE_ROLE_KEY is not configured')
    return errorResponse('Server misconfigured', 500)
  }
  const token = bearerToken(req)
  if (!token) return errorResponse('Missing Authorization header', 401)
  if (!timingSafeEqual(token, serviceKey)) return errorResponse('Service role key required', 401)
  return null
}

const serverOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

/** Bypasses RLS. Only use AFTER verifyAuth / verifyServiceRoleAuth succeeded. */
export function getServiceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    serverOptions,
  )
}

/** RLS-respecting client that forwards the caller's Authorization header. */
export function getUserClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    ...serverOptions,
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
}
