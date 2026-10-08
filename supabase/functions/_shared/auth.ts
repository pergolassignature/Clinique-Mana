/**
 * Shared auth for Edge Functions (adapted from PS Hub `_shared/auth.ts`).
 *
 * RULE: every function deployed with `verify_jwt = false` MUST call
 * `verifyAuth()` / `verifyServiceRoleAuth()` before doing anything else,
 * or verify a webhook signature (use `timingSafeEqual` for the comparison).
 *
 * Module gate:
 * - user-scoped functions: `verifyAuth(req, { module })` or
 *   `requireModule(auth.client, key)`;
 * - service-role / webhook / cron functions: resolve the org from a database
 *   row, then `requireModuleForOrg(serviceClient, orgId, key)`.
 *
 * Permissions come from `public.get_my_access()` (the same payload the web app
 * reads). The RLS helpers (`private.has_permission`, …) are not exposed over the
 * API. Never trust an org id sent by the client: use `AuthResult.access.org_id`.
 *
 * Errors are `{ error: { code, message } }` with a code from `ErrorCode`.
 * Browser-facing responses carry CORS headers (`jsonResponse`, `errorResponse`).
 * Webhooks are not called by browsers: they use their own response helper,
 * without CORS headers.
 */
import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { timingSafeEqual } from './timing-safe-equal.ts'

/**
 * Error codes stay English; the UI maps each one to a French text (P3-28).
 * Usual statuses: `invalid_request` 400 (413 for a body over the cap),
 * `unauthenticated` 401, `forbidden` / `module_disabled` 403, `not_found` 404,
 * `conflict` 409, `link_invalid` / `link_expired` / `link_used` 410,
 * `rate_limited` 429, `server_misconfigured` / `internal` 500,
 * `provider_error` 502, `auth_unavailable` / `not_configured` 503.
 */
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'module_disabled'
  | 'server_misconfigured'
  | 'auth_unavailable'
  | 'internal'
  | 'rate_limited'
  | 'invalid_request'
  | 'link_invalid'
  | 'link_expired'
  | 'link_used'
  | 'conflict'
  | 'not_found'
  | 'provider_error'
  | 'not_configured'

// ---------------------------------------------------------------------------
// CORS and responses
// ---------------------------------------------------------------------------

/** `ALLOWED_ORIGINS` (comma-separated), or null when unset (then `*`). */
function allowedOrigins(): string[] | null {
  const raw = Deno.env.get('ALLOWED_ORIGINS')
  if (raw === undefined) return null
  return raw.split(',').map((o) => o.trim()).filter(Boolean)
}

/**
 * CORS headers for a browser-facing response. With `ALLOWED_ORIGINS` set, the
 * request's `Origin` is echoed only when listed (plus `Vary: Origin`);
 * otherwise `*`. No `Content-Type` here: `jsonResponse` adds it.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
  const allowed = allowedOrigins()
  if (allowed === null) {
    headers['Access-Control-Allow-Origin'] = '*'
    return headers
  }
  headers['Vary'] = 'Origin'
  const origin = req?.headers.get('Origin')
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

/** JSON response with CORS headers (pass `req` to echo an allowed origin). */
export function jsonResponse(
  body: unknown,
  status = 200,
  req?: Request,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/** `{ error: { code, message } }` with CORS headers. */
export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  req?: Request,
): Response {
  return jsonResponse({ error: { code, message } }, status, req)
}

/** Call first in every browser-facing handler: answers the CORS preflight. */
export function handleCors(req: Request): Response | null {
  return req.method === 'OPTIONS'
    ? new Response(null, { headers: corsHeaders(req) })
    : null
}

/** The bearer token from the Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(
    req.headers.get('Authorization') ?? '',
  )
  return match?.[1] ?? null
}

function misconfigured(what: string, req?: Request): Response {
  console.error(`[edge-auth] server misconfigured: ${what} is not set`)
  return errorResponse(
    'server_misconfigured',
    'Server misconfigured',
    500,
    req,
  )
}

// ---------------------------------------------------------------------------
// Access decision (pure)
// ---------------------------------------------------------------------------

/** Subset of the `get_my_access()` payload that functions rely on. */
export interface CallerAccess {
  user_id: string
  org_id: string
  status: 'active'
  role: string | null
  permissions: string[]
  modules: string[]
}

export interface AccessOptions {
  /** Permission key the caller must hold. */
  permission?: string
  /** Module that must be enabled for the caller's org (no extra RPC). */
  module?: string
}

export type AccessDecision =
  | { ok: true; access: CallerAccess }
  | { ok: false; status: 401 | 403 | 500; code: ErrorCode; message: string }

type RpcResult = {
  data: unknown
  error: { code?: string; message?: string } | null
}

/**
 * Pure decision on a `get_my_access` RPC result. Fails closed:
 * - RPC error 42501 (caller is not `authenticated`) → 401; other errors → 500;
 * - `null` (no profile) or a malformed payload → 403;
 * - `status !== 'active'` → 403;
 * - `module` given and not enabled → 403 `module_disabled` (checked before the
 *   permission: a disabled module's permissions are absent anyway);
 * - `permission` given and not held → 403.
 */
export function evaluateAccess(
  result: RpcResult,
  options: AccessOptions = {},
): AccessDecision {
  if (result.error) {
    return result.error.code === '42501'
      ? {
        ok: false,
        status: 401,
        code: 'unauthenticated',
        message: 'Not authenticated',
      }
      : {
        ok: false,
        status: 500,
        code: 'internal',
        message: 'Permission check failed',
      }
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
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'No access profile',
    }
  }
  if (a.status !== 'active') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Account is not active',
    }
  }
  if (options.module && !a.modules.includes(options.module)) {
    return {
      ok: false,
      status: 403,
      code: 'module_disabled',
      message: `Module disabled: ${options.module}`,
    }
  }
  if (options.permission && !a.permissions.includes(options.permission)) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: `Permission required: ${options.permission}`,
    }
  }
  return { ok: true, access: a as CallerAccess }
}

// ---------------------------------------------------------------------------
// User-scoped auth
// ---------------------------------------------------------------------------

export interface AuthResult {
  user: User
  /** Caller's access payload (org, role, permissions, enabled modules). */
  access: CallerAccess
  /** RLS-respecting client acting as the caller. */
  client: SupabaseClient
}

function isAuthOutage(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 500
}

/**
 * `verifyAuth` minus client construction (exported for tests): validates the
 * token with Auth, then requires an active profile and the options.
 */
export async function authorizeCaller(
  client: SupabaseClient,
  token: string,
  options: AccessOptions = {},
  req?: Request,
): Promise<AuthResult | Response> {
  const { data, error } = await client.auth.getUser(token)
  if (error && isAuthOutage(error)) {
    console.error('[verifyAuth] Auth unavailable', error)
    return errorResponse(
      'auth_unavailable',
      'Authentication service unavailable',
      503,
      req,
    )
  }
  if (error || !data.user) {
    return errorResponse(
      'unauthenticated',
      'Invalid or expired token',
      401,
      req,
    )
  }

  const result = await client.rpc('get_my_access')
  const decision = evaluateAccess(result, options)
  if (!decision.ok) {
    // The token was valid, so a 42501 here likely means a missing grant.
    if (decision.status === 500 || decision.status === 401) {
      console.error('[verifyAuth] get_my_access failed', result.error)
    }
    return errorResponse(decision.code, decision.message, decision.status, req)
  }

  return { user: data.user, access: decision.access, client }
}

/**
 * Verifies the caller's JWT, requires an active profile, and optionally a
 * permission key and an enabled module. Returns AuthResult, or a Response to
 * return immediately.
 *
 * @example
 * const auth = await verifyAuth(req, { permission: 'professionals.view', module: 'professionals' })
 * if (auth instanceof Response) return auth
 */
export async function verifyAuth(
  req: Request,
  options: AccessOptions = {},
): Promise<AuthResult | Response> {
  const token = bearerToken(req)
  if (!token) {
    return errorResponse(
      'unauthenticated',
      'Missing Authorization header',
      401,
      req,
    )
  }
  const client = getUserClient(token, req)
  if (client instanceof Response) return client
  return await authorizeCaller(client, token, options, req)
}

// ---------------------------------------------------------------------------
// Service-role auth (cron, other functions)
// ---------------------------------------------------------------------------

/** Values of `SUPABASE_SECRET_KEYS`: comma-separated, or a JSON object of keys. */
function secretKeysFromEnv(): string[] {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim()
  if (!raw) return []
  if (raw.startsWith('{')) {
    try {
      return Object.values(JSON.parse(raw) as Record<string, unknown>)
        .filter((v): v is string => typeof v === 'string')
    } catch {
      return []
    }
  }
  return raw.split(',')
}

/**
 * Keys accepted by `verifyServiceRoleAuth`, empty values ignored:
 * `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT), each `SUPABASE_SECRET_KEYS` value
 * (`sb_secret_…`), and the optional `INTERNAL_FUNCTION_SECRET`.
 */
export function serviceKeys(): string[] {
  return [
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ...secretKeysFromEnv(),
    Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? '',
  ].map((k) => k.trim()).filter(Boolean)
}

/**
 * For internal-only functions called by a holder of a service key (another
 * function, an operator script). Contract: the caller sends
 * `Authorization: Bearer <key>` with one of `serviceKeys()`.
 * Returns null when authorised, otherwise a Response. Fails closed (500) when
 * no key is configured. Every key is compared in constant time.
 *
 * **Never for `pg_net` callers** (cron, « Exécuter maintenant »): pg_net keeps
 * queued request headers in `net.http_request_queue`, readable by every
 * database role, so a bearer sent from SQL leaks. Scheduled jobs verify a
 * short-lived `X-Job-Signature` instead (`runJob` in `jobs.ts`). No function
 * calls this one today.
 */
export function verifyServiceRoleAuth(req: Request): Response | null {
  const keys = serviceKeys()
  if (keys.length === 0) return misconfigured('service key', req)
  const token = bearerToken(req)
  if (!token) {
    return errorResponse(
      'unauthenticated',
      'Missing Authorization header',
      401,
      req,
    )
  }
  let match = false
  for (const key of keys) match = timingSafeEqual(token, key) || match
  return match
    ? null
    : errorResponse('unauthenticated', 'Service key required', 401, req)
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const serverOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

/**
 * Bypasses RLS. Only use AFTER verifyAuth / verifyServiceRoleAuth succeeded.
 * Returns a Response (500) when the environment is incomplete.
 */
export function getServiceRoleClient(req?: Request): SupabaseClient | Response {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    secretKeysFromEnv().map((k) => k.trim()).find(Boolean)
  if (!url) return misconfigured('SUPABASE_URL', req)
  if (!key) return misconfigured('service key', req)
  return createClient(url, key, serverOptions)
}

/**
 * RLS-respecting client acting as the caller (`Authorization: Bearer <token>`).
 * Returns a Response (500) when the environment is incomplete.
 */
export function getUserClient(
  token: string,
  req?: Request,
): SupabaseClient | Response {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url) return misconfigured('SUPABASE_URL', req)
  if (!anonKey) return misconfigured('SUPABASE_ANON_KEY', req)
  return createClient(url, anonKey, {
    ...serverOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}
