/**
 * The OAuth side of the QuickBooks connection: the clinic's Intuit
 * application (two org secrets set in « QuickBooks »), the code exchange,
 * the access token every call uses (refreshed when it expires within 5
 * minutes), and the revocation at « Déconnecter ».
 *
 * Intuit rotates the refresh token at every refresh, so two passes refreshing
 * at once would leave one with a dead token (PS Hub's race, roadmap §2.6).
 * `set_qbo_tokens` writes a refresh only if it used the stored refresh token;
 * the loser reads the credentials again and uses the winner's. Only an
 * `invalid_grant` that no concurrent rotation explains marks the connection
 * `needs_reconnect`; a transient failure of Intuit is a `QboError`.
 *
 * Intuit's token answers are read for their tokens and one enum field
 * (`error`), never logged or returned.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { QboError } from './client.ts'
import {
  type QboEnvironment,
  type QboOrigins,
  SECRET_CLIENT_ID,
  SECRET_CLIENT_SECRET,
} from './env.ts'

const REFRESH_AHEAD_MS = 5 * 60_000
const TOKEN_TIMEOUT_MS = 15_000
const MAX_TOKEN_ANSWER = 64 * 1024

/** The clinic's Intuit application. */
export interface OAuthApp {
  clientId: string
  clientSecret: string
}

/** The connection must be made again (recorded as `needs_reconnect`). */
export class ReconnectNeeded extends Error {
  constructor(readonly reason: 'invalid_grant' | 'unauthorized') {
    super(reason)
    this.name = 'ReconnectNeeded'
  }
}

/** No connection (never made, or disconnected). */
export class NotConnected extends Error {
  constructor() {
    super('not_connected')
    this.name = 'NotConnected'
  }
}

/** The clinic's Intuit application, or null when either secret is missing. */
export async function oauthApp(
  client: SupabaseClient,
  orgId: string,
): Promise<OAuthApp | null> {
  const [id, secret] = await Promise.all([
    client.rpc('get_org_secret', { p_org_id: orgId, p_key: SECRET_CLIENT_ID }),
    client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: SECRET_CLIENT_SECRET,
    }),
  ])
  if (id.error || secret.error) throw new QboError('provider_error')
  if (
    typeof id.data !== 'string' || !id.data ||
    typeof secret.data !== 'string' || !secret.data
  ) return null
  return { clientId: id.data, clientSecret: secret.data }
}

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  x_refresh_token_expires_in: z.number().int().positive().optional(),
})
export type TokenResponse = z.infer<typeof tokenSchema>
const errorSchema = z.looseObject({ error: z.string().optional() })

function basic(app: OAuthApp): string {
  const bytes = new TextEncoder().encode(`${app.clientId}:${app.clientSecret}`)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `Basic ${btoa(binary)}`
}

/** A call to Intuit's token endpoint; `invalid_grant` is answered as such. */
async function tokenCall(
  fetchFn: typeof fetch,
  origins: QboOrigins,
  app: OAuthApp,
  form: Record<string, string>,
  signal?: AbortSignal,
): Promise<
  { ok: true; token: TokenResponse } | { ok: false; invalidGrant: boolean }
> {
  let res: Response
  try {
    const signals = [AbortSignal.timeout(TOKEN_TIMEOUT_MS)]
    if (signal) signals.push(signal)
    res = await fetchFn(`${origins.oauth}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: {
        Authorization: basic(app),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    throw new QboError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'timeout'
        : 'unreachable',
    )
  }
  if (Number(res.headers.get('Content-Length')) > MAX_TOKEN_ANSWER) {
    await res.body?.cancel()
    throw new QboError('unusable_answer')
  }
  let json: unknown = null
  try {
    const text = await res.text()
    json = text === '' ? null : JSON.parse(text.slice(0, MAX_TOKEN_ANSWER))
  } catch {
    json = null
  }
  if (res.ok) {
    const parsed = tokenSchema.safeParse(json)
    if (!parsed.success) throw new QboError('unusable_answer')
    return { ok: true, token: parsed.data }
  }
  if (res.status === 400 || res.status === 401) {
    const error = errorSchema.safeParse(json)
    return {
      ok: false,
      invalidGrant: error.success && error.data.error === 'invalid_grant',
    }
  }
  if (res.status === 429 || res.status >= 500) {
    throw new QboError('provider_error', res.status)
  }
  return { ok: false, invalidGrant: false }
}

/**
 * The authorization code → tokens. A refused code (`invalid_grant`: expired,
 * already used) throws `validation`; any other refusal (`invalid_client`: the
 * clinic's application is wrong) is the clinic's configuration and throws
 * `provider_error`.
 */
export async function exchangeCode(
  fetchFn: typeof fetch,
  origins: QboOrigins,
  app: OAuthApp,
  code: string,
  redirectUri: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const result = await tokenCall(fetchFn, origins, app, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }, signal)
  if (!result.ok) {
    throw result.invalidGrant
      ? new QboError('validation', 400)
      : new QboError('provider_error')
  }
  return result.token
}

/** Best effort: Intuit forgets the grant. Never throws. */
export async function revokeToken(
  fetchFn: typeof fetch,
  origins: QboOrigins,
  app: OAuthApp,
  refreshToken: string,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${origins.revoke}/v2/oauth2/tokens/revoke`, {
      method: 'POST',
      headers: {
        Authorization: basic(app),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: refreshToken }),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

/** The expiry instants of a token answer. */
export function tokenExpiries(
  token: TokenResponse,
  now: Date,
): { access: Date; refresh: Date | null } {
  return {
    access: new Date(now.getTime() + (token.expires_in ?? 3_600) * 1000),
    refresh: token.x_refresh_token_expires_in
      ? new Date(now.getTime() + token.x_refresh_token_expires_in * 1000)
      : null,
  }
}

const credentialsSchema = z.array(z.object({
  connection_id: z.string(),
  realm_id: z.string(),
  environment: z.enum(['production', 'sandbox']),
  status: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  access_token_expires_at: z.string(),
})).max(1)

/** A usable access token of the clinic's company. */
export interface QboCredentials {
  connectionId: string
  realmId: string
  environment: QboEnvironment
  accessToken: string
}

export interface CredentialsContext {
  client: SupabaseClient
  fetch: typeof fetch
  origins: QboOrigins
  now: () => Date
  orgId: string
  signal?: AbortSignal
}

async function readCredentials(ctx: CredentialsContext) {
  const read = await ctx.client.rpc('get_qbo_credentials', {
    p_org_id: ctx.orgId,
  })
  const parsed = credentialsSchema.safeParse(read.data)
  if (read.error || !parsed.success) throw new QboError('provider_error')
  const row = parsed.data[0]
  if (!row) throw new NotConnected()
  return row
}

/**
 * The company's access token, refreshed first when it expires within 5
 * minutes, or always with `force` (a 401, the daily keep-alive). Throws
 * `NotConnected`, `ReconnectNeeded` (the connection is marked) or a
 * `QboError`.
 */
export async function qboCredentials(
  ctx: CredentialsContext,
  app: OAuthApp,
  { force = false }: { force?: boolean } = {},
): Promise<QboCredentials> {
  const row = await readCredentials(ctx)
  const base = {
    connectionId: row.connection_id,
    realmId: row.realm_id,
    environment: row.environment,
  }
  const expiresAt = Date.parse(row.access_token_expires_at)
  if (
    !force && expiresAt - ctx.now().getTime() > REFRESH_AHEAD_MS &&
    row.status === 'connected'
  ) {
    return { ...base, accessToken: row.access_token }
  }
  const result = await tokenCall(ctx.fetch, ctx.origins, app, {
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  }, ctx.signal)
  if (!result.ok) {
    // Another pass may have rotated the token meanwhile: use its answer.
    const again = await readCredentials(ctx)
    if (again.refresh_token !== row.refresh_token) {
      return { ...base, accessToken: again.access_token }
    }
    const reason = result.invalidGrant ? 'invalid_grant' : 'unauthorized'
    await ctx.client.rpc('set_qbo_connection_status', {
      p_org_id: ctx.orgId,
      p_status: 'needs_reconnect',
      p_reason: reason,
    })
    throw new ReconnectNeeded(reason)
  }
  const expiries = tokenExpiries(result.token, ctx.now())
  const stored = await ctx.client.rpc('set_qbo_tokens', {
    p_org_id: ctx.orgId,
    p_connection_id: row.connection_id,
    p_previous_refresh: row.refresh_token,
    p_access_token: result.token.access_token,
    p_refresh_token: result.token.refresh_token,
    p_access_token_expires_at: expiries.access.toISOString(),
    p_refresh_token_expires_at: expiries.refresh?.toISOString() ?? null,
  })
  if (stored.error) throw new QboError('provider_error')
  if (stored.data === false) {
    // Lost the race: the winner's tokens are stored; ours are already dead at Intuit's.
    const again = await readCredentials(ctx)
    return { ...base, accessToken: again.access_token }
  }
  return { ...base, accessToken: result.token.access_token }
}
