/**
 * Shared auth for Edge Functions (adapted from PS Hub `_shared/auth.ts`).
 *
 * RULE: every function deployed with `verify_jwt = false` authenticates
 * itself before anything else: `verifyAuth()` (user functions), a webhook
 * signature compared with `timingSafeEqual`, `runJob`'s `X-Job-Signature`
 * (jobs), or a hashed single-use token (public token functions).
 *
 * Module gate:
 * - user-scoped functions: `verifyAuth(req, { module })`;
 * - service-role and job functions: resolve the org from a database row, then
 *   `requireModuleForOrg(serviceClient, orgId, key)`; webhooks take the org
 *   from `?org=` once its secret verified the signature.
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
import { logErrorCode } from './log.ts'
import { reportError } from './report.ts'

/**
 * Error codes stay English; the UI maps each one to a French text (P3-28).
 * Usual statuses: `invalid_request` 400 (413 for a body over the cap),
 * `missing_variable` 400 (a template value is missing), `weak_password`
 * 400 (Auth refused a password), `unauthenticated` 401, `forbidden` /
 * `module_disabled` 403, `not_found` 404, `conflict` 409,
 * `link_invalid` / `link_expired` / `link_used` 410, `rate_limited` 429,
 * `server_misconfigured` / `internal` 500, `provider_error` 502,
 * `auth_unavailable` / `not_configured` 503.
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
  | 'missing_variable'
  | 'weak_password'

// ---------------------------------------------------------------------------
// CORS and responses
// ---------------------------------------------------------------------------

/** `ALLOWED_ORIGINS` (comma-separated), or null when unset (then `*`). */
function allowedOrigins(): string[] | null {
  const raw = Deno.env.get('ALLOWED_ORIGINS')
  if (raw === undefined) return null
  return raw.split(',').map((o) => o.trim()).filter(Boolean)
}

/** How long a browser may cache a preflight answer, in seconds. */
const PREFLIGHT_MAX_AGE = '600'

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
])

/**
 * True when `appUrl` is a local `http` URL (`http://localhost:5173`): local
 * dev. Gates what only a dev machine may do (the console email transport,
 * the local Documenso fake, P3-34).
 */
export function isLocalAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl || !URL.canParse(appUrl.trim())) return false
  const url = new URL(appUrl.trim())
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}

/** True when `APP_URL` is set and is not a local origin. */
function deployedAppUrl(): boolean {
  const appUrl = Deno.env.get('APP_URL')
  if (!appUrl) return false
  try {
    return !LOCAL_HOSTS.has(new URL(appUrl).hostname)
  } catch {
    return true
  }
}

let originsUnsetReported = false

/**
 * `ALLOWED_ORIGINS` unset (so `*`) on a deployed project (`APP_URL` set and
 * not local) is a misconfiguration: reported `cors_origins_unset`, once per
 * isolate. The answer itself is unchanged (`*`).
 */
function reportOriginsUnset(): void {
  if (originsUnsetReported || !deployedAppUrl()) return
  originsUnsetReported = true
  const sent = reportError({ fn: 'cors', code: 'cors_origins_unset' })
  // Keep the isolate alive for the report when the edge runtime allows it.
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  runtime?.waitUntil?.(sent)
}

/** Tests only: lets `cors_origins_unset` be reported again. */
export function resetCorsReportForTests(): void {
  originsUnsetReported = false
}

/**
 * CORS headers for a browser-facing response. With `ALLOWED_ORIGINS` set, the
 * request's `Origin` is echoed only when listed (plus `Vary: Origin`);
 * otherwise `*` (reported once per isolate when `APP_URL` is not local, see
 * `reportOriginsUnset`). No `Content-Type` here: `jsonResponse` adds it.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // A 429's `Retry-After` must be readable by the app (« Réessayez dans … »).
    'Access-Control-Expose-Headers': 'Retry-After',
  }
  const allowed = allowedOrigins()
  if (allowed === null) {
    reportOriginsUnset()
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

/**
 * A refusal the user can act on: 400 (or `status`) `invalid_request` whose
 * French `message` the browser shows as is, flagged `refusal: true`
 * (`src/core/supabase/functions.ts` `refusalMessage` shows nothing else). For
 * a P0001 relayed from an RPC (`rpcErrorResponse`, `createSignatureRequest`)
 * or a function's own French sentence (`storage-confirm`). Every other
 * `invalid_request` carries an English message, never shown.
 */
export function refusalResponse(
  message: string,
  req?: Request,
  status = 400,
): Response {
  return jsonResponse(
    { error: { code: 'invalid_request', message, refusal: true } },
    status,
    req,
  )
}

/**
 * Call first in every browser-facing handler: answers the CORS preflight,
 * cacheable for 10 minutes (`Access-Control-Max-Age: 600`).
 */
export function handleCors(req: Request): Response | null {
  return req.method === 'OPTIONS'
    ? new Response(null, {
      headers: {
        ...corsHeaders(req),
        'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
      },
    })
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
  /** `profiles.email` (copied from Auth): the caller's own address. */
  email: string
  /** `profiles.display_name`: the caller's name, as others see it. */
  display_name: string
  /** The caller's organisation name (`organizations.name`). */
  org_name: string
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
    typeof a.email !== 'string' ||
    typeof a.display_name !== 'string' ||
    typeof a.org_name !== 'string' ||
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
    logErrorCode('verifyAuth', 'Auth unavailable', error)
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
      logErrorCode('verifyAuth', 'get_my_access failed', result.error)
    }
    return errorResponse(decision.code, decision.message, decision.status, req)
  }

  return { user: data.user, access: decision.access, client }
}

/**
 * Verifies the caller's JWT, requires an active profile, and optionally a
 * permission key and an enabled module. Returns AuthResult, or a Response to
 * return immediately. `makeClient` builds the caller's client (a handler
 * passes `deps.userClient`); it defaults to `getUserClient`.
 *
 * @example
 * const auth = await verifyAuth(req, { permission: 'professionals.view', module: 'professionals' })
 * if (auth instanceof Response) return auth
 */
export async function verifyAuth(
  req: Request,
  options: AccessOptions = {},
  makeClient: (token: string) => SupabaseClient | Response = (token) =>
    getUserClient(token, req),
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
  const client = makeClient(token)
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
 * Bypasses RLS. Only use once the caller is authenticated (or, for public
 * token functions, to rate-limit before the token lookup).
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
