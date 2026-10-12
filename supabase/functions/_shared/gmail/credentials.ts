/**
 * The OAuth side of a mailbox: the clinic's Google application (two org
 * secrets, set in « Courriels Gmail »), the code exchange at connection,
 * the access token the sync uses (refreshed when it expires within 5
 * minutes, stored back encrypted through `set_mail_access_token`), and the
 * revocation at disconnection.
 *
 * Only `invalid_grant` marks the mailbox `needs_reconnect` (the refresh
 * token was revoked or expired); a transient failure of Google is a
 * `GmailError` and the next sync tries again (PS Hub deactivated the
 * connection on any non-2xx, roadmap §2.4 bis).
 *
 * Google's error bodies are read for one enum field (`error`), never kept.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { GmailError } from './client.ts'
import {
  type GmailOrigins,
  SECRET_CLIENT_ID,
  SECRET_CLIENT_SECRET,
} from './env.ts'

/** The refresh window: a token expiring within this is refreshed first. */
const REFRESH_AHEAD_MS = 5 * 60_000
const TOKEN_TIMEOUT_MS = 15_000
const MAX_TOKEN_ANSWER = 64 * 1024

/** The clinic's OAuth client. */
export interface OAuthApp {
  clientId: string
  clientSecret: string
}

/** Thrown when the mailbox must be connected again (recorded as `needs_reconnect`). */
export class ReconnectNeeded extends Error {
  constructor(
    readonly reason: 'invalid_grant' | 'scope_missing' | 'unauthorized',
  ) {
    super(reason)
    this.name = 'ReconnectNeeded'
  }
}

/** Thrown when the connection row is gone or disconnected. */
export class ConnectionGone extends Error {
  constructor() {
    super('connection_gone')
    this.name = 'ConnectionGone'
  }
}

/** The clinic's Google application, or null when either secret is missing. */
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
  if (id.error || secret.error) throw new GmailError('provider_error')
  if (
    typeof id.data !== 'string' || !id.data ||
    typeof secret.data !== 'string' || !secret.data
  ) {
    return null
  }
  return { clientId: id.data, clientSecret: secret.data }
}

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})
export type TokenResponse = z.infer<typeof tokenSchema>

const errorSchema = z.looseObject({ error: z.string().optional() })

/** A call to the token endpoint; `invalid_grant` is answered as such. */
async function tokenCall(
  fetchFn: typeof fetch,
  origins: GmailOrigins,
  form: Record<string, string>,
  signal?: AbortSignal,
): Promise<
  { ok: true; token: TokenResponse } | { ok: false; invalidGrant: boolean }
> {
  let res: Response
  try {
    const signals = [AbortSignal.timeout(TOKEN_TIMEOUT_MS)]
    if (signal) signals.push(signal)
    res = await fetchFn(`${origins.oauth}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    throw new GmailError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'timeout'
        : 'unreachable',
    )
  }
  if (Number(res.headers.get('Content-Length')) > MAX_TOKEN_ANSWER) {
    await res.body?.cancel()
    throw new GmailError('unusable_answer')
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
    if (!parsed.success) throw new GmailError('unusable_answer')
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
    throw new GmailError('provider_error', res.status)
  }
  return { ok: false, invalidGrant: false }
}

/** The authorization code → tokens (at connection). A refused code throws `bad_request`. */
export async function exchangeCode(
  fetchFn: typeof fetch,
  origins: GmailOrigins,
  app: OAuthApp,
  code: string,
  redirectUri: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const result = await tokenCall(fetchFn, origins, {
    grant_type: 'authorization_code',
    code,
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: redirectUri,
  }, signal)
  if (!result.ok) throw new GmailError('bad_request', 400)
  return result.token
}

/** Best effort: Google forgets the grant (`users.stop` is the caller's). Never throws. */
export async function revokeToken(
  fetchFn: typeof fetch,
  origins: GmailOrigins,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${origins.oauth}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

const credentialsSchema = z.array(z.object({
  connection_id: z.string(),
  email_address: z.string(),
  kind: z.string(),
  status: z.string(),
  scopes: z.array(z.string()),
  access_token: z.string(),
  refresh_token: z.string(),
  access_token_expires_at: z.string(),
})).max(1)

/** A usable access token of the mailbox, with what the sync needs to know. */
export interface MailboxCredentials {
  connectionId: string
  emailAddress: string
  accessToken: string
  scopes: string[]
}

export interface CredentialsContext {
  client: SupabaseClient
  fetch: typeof fetch
  origins: GmailOrigins
  now: () => Date
  orgId: string
  signal?: AbortSignal
}

/**
 * The mailbox's access token, refreshed first when it expires within 5
 * minutes. Throws `ConnectionGone` (no row), `ReconnectNeeded` (Google
 * refused the refresh token: the mailbox is marked), or a `GmailError`.
 */
export async function mailboxCredentials(
  ctx: CredentialsContext,
  connectionId: string,
  app: OAuthApp,
): Promise<MailboxCredentials> {
  const read = await ctx.client.rpc('get_mail_connection_credentials', {
    p_org_id: ctx.orgId,
    p_connection_id: connectionId,
  })
  const parsed = credentialsSchema.safeParse(read.data)
  if (read.error || !parsed.success) throw new GmailError('provider_error')
  const row = parsed.data[0]
  if (!row) throw new ConnectionGone()
  const base = {
    connectionId,
    emailAddress: row.email_address,
    scopes: row.scopes,
  }
  const expiresAt = Date.parse(row.access_token_expires_at)
  if (
    Number.isFinite(expiresAt) &&
    expiresAt - ctx.now().getTime() > REFRESH_AHEAD_MS
  ) {
    return { ...base, accessToken: row.access_token }
  }
  const result = await tokenCall(ctx.fetch, ctx.origins, {
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: app.clientId,
    client_secret: app.clientSecret,
  }, ctx.signal)
  if (!result.ok) {
    if (result.invalidGrant) {
      await markReconnect(ctx.client, ctx.orgId, connectionId, 'invalid_grant')
      throw new ReconnectNeeded('invalid_grant')
    }
    throw new GmailError('provider_error')
  }
  const expires = new Date(
    ctx.now().getTime() + (result.token.expires_in ?? 3_600) * 1000,
  )
  const stored = await ctx.client.rpc('set_mail_access_token', {
    p_org_id: ctx.orgId,
    p_connection_id: connectionId,
    p_access_token: result.token.access_token,
    p_expires_at: expires.toISOString(),
  })
  if (stored.error) throw new GmailError('provider_error')
  return { ...base, accessToken: result.token.access_token }
}

/** Marks the mailbox `needs_reconnect` with its reason (the settings page says so). */
export async function markReconnect(
  client: SupabaseClient,
  orgId: string,
  connectionId: string,
  reason: ReconnectNeeded['reason'],
): Promise<void> {
  await client.rpc('set_mail_connection_status', {
    p_org_id: orgId,
    p_connection_id: connectionId,
    p_status: 'needs_reconnect',
    p_reason: reason,
  })
}
