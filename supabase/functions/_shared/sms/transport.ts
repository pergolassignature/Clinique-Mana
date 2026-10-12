/**
 * The SMS transport (batch SM, SM-9): one interface, one provider for now,
 * the clinic's Yeastar PBX (`yeastar.ts`). A second provider would implement
 * `SmsTransport` and be chosen here from the clinic's settings.
 *
 * `createYeastarTransport(deps).send(orgId, text)`:
 * 1. `get_sms_provider_context(org)` (service role): the module gate, the
 *    settings (`sms_base_url`, `sms_client_id`, `sms_did`), the client secret
 *    and the stored session, in one read. Anything missing → `not_configured`
 *    (the clinic has not finished « Textos »); the module off →
 *    `module_disabled`. With a local `APP_URL`, `YEASTAR_BASE_URL` replaces
 *    the clinic's address (the local fake, `scripts/fake-yeastar.ts`).
 * 2. A token: the stored access token while it has over a minute left and
 *    was issued for this address; else, under the clinic's refresh lease
 *    (`acquire_sms_provider_lock`, polled up to 20 s: function isolates run
 *    in parallel and the PBX caps live tokens), the context is read again
 *    (another isolate may just have refreshed), then the refresh token is
 *    used, or new tokens are requested; the result is stored
 *    (`store_sms_provider_session`: Vault) and the lease released.
 * 3. The SMS channel of the clinic's number, from the context's 10-minute
 *    cache or `message_channel/list` (then `set_sms_provider_channel`).
 * 4. `message/send`. A `token_invalid` answer (the PBX dropped the session)
 *    gets one retry with tokens requested afresh.
 *
 * Failures are `SmsTransportError`s with a code the caller records on the
 * row (`mark_sms_failed`) and reports with ids only: the PBX's address, the
 * credentials, the tokens and the number never reach a log or a report.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isLocalAppUrl } from '../local.ts'
import { UUID } from '../patterns.ts'
import { reportError } from '../report.ts'
import { lastDigits } from './phone.ts'
import {
  findSmsChannel,
  getSession,
  refreshTokens,
  requestTokens,
  sendText,
  type SentMessage,
  YeastarError,
  type YeastarErrorCode,
  type YeastarTokens,
} from './yeastar.ts'

export type SmsTransportErrorCode =
  | YeastarErrorCode
  | 'not_configured'
  | 'module_disabled'
  | 'lock_timeout'
  | 'internal'

/** A failed send, by code (never a value of the PBX's answer). */
export class SmsTransportError extends Error {
  constructor(readonly code: SmsTransportErrorCode) {
    super(`sms transport: ${code}`)
    this.name = 'SmsTransportError'
  }
}

/** One text to send. */
export interface OutboundText {
  /** E.164, as the database stored it. */
  to: string
  body: string
  /** The row's `request_id`: the PBX's idempotency key. */
  requestId: string
}

/** Whose number a PBX session runs on (SM-13). */
export interface SessionOwner {
  /** True when the session's DID is the clinic's number. */
  ours: boolean
}

export interface SmsTransport {
  send(
    orgId: string,
    text: OutboundText,
    signal?: AbortSignal,
  ): Promise<SentMessage>
  /**
   * Whether a PBX message session belongs to the clinic (its DID is the
   * clinic's number): the 30031 event names no channel, and the PBX may be
   * shared with other tenants. Same failures as `send`.
   */
  sessionOwner(
    orgId: string,
    sessionId: number,
    signal?: AbortSignal,
  ): Promise<SessionOwner>
}

/** What the transport needs: a service-role client, the outside world. */
export interface TransportDeps {
  client: SupabaseClient
  fetch: typeof fetch
  now: () => Date
  env: (key: string) => string | undefined
}

/** A stored session still usable in a minute; the base URL must be the one it was issued for. */
const TOKEN_MARGIN_MS = 60_000
/** How long a send waits for the clinic's refresh lease. */
const LOCK_WAIT_MS = 20_000
/** The lease's length: longer than the token calls it covers. */
const LOCK_TTL_S = 60

const contextSchema = z.object({
  module_enabled: z.boolean(),
  clinic_name: z.string(),
  base_url: z.string().nullable(),
  client_id: z.string().nullable(),
  client_secret: z.string().nullable(),
  did: z.string().nullable(),
  session: z.object({
    base_url: z.string().nullable(),
    access_token: z.string(),
    refresh_token: z.string().nullable(),
    access_expires_at: z.string().nullable(),
    refresh_expires_at: z.string().nullable(),
  }).nullable(),
  channel: z.string().nullable(),
})
type ProviderContext = z.output<typeof contextSchema>

/** The clinic's PBX settings, complete, or null. */
interface Credentials {
  baseUrl: string
  clientId: string
  clientSecret: string
  did: string
}

/** The PBX context (`get_sms_provider_context`), or a typed failure. */
export async function readProviderContext(
  deps: TransportDeps,
  orgId: string,
): Promise<ProviderContext> {
  const { data, error } = await deps.client.rpc('get_sms_provider_context', {
    p_org_id: orgId,
  })
  if (error) throw new SmsTransportError('internal')
  const parsed = contextSchema.safeParse(data)
  if (!parsed.success) throw new SmsTransportError('internal')
  return parsed.data
}

/** The address the functions call: the clinic's, or the local fake's with a local `APP_URL`. */
function effectiveBaseUrl(
  deps: TransportDeps,
  configured: string | null,
): string | null {
  const override = deps.env('YEASTAR_BASE_URL')
  if (override && isLocalAppUrl(deps.env('APP_URL'))) {
    return override.replace(/\/$/, '')
  }
  return configured ? configured.replace(/\/$/, '') : null
}

function credentialsOf(
  deps: TransportDeps,
  context: ProviderContext,
): Credentials {
  const baseUrl = effectiveBaseUrl(deps, context.base_url)
  if (
    !baseUrl || !context.client_id || !context.client_secret || !context.did
  ) throw new SmsTransportError('not_configured')
  return {
    baseUrl,
    clientId: context.client_id,
    clientSecret: context.client_secret,
    did: context.did,
  }
}

/** A stored token still good for a minute, for this address. */
function usableToken(
  context: ProviderContext,
  baseUrl: string,
  now: Date,
): string | null {
  const session = context.session
  if (!session || session.base_url !== baseUrl) return null
  const at = session.access_expires_at
    ? Date.parse(session.access_expires_at)
    : NaN
  return Number.isFinite(at) && at > now.getTime() + TOKEN_MARGIN_MS
    ? session.access_token
    : null
}

function usableRefresh(
  context: ProviderContext,
  baseUrl: string,
  now: Date,
): string | null {
  const session = context.session
  if (!session || session.base_url !== baseUrl || !session.refresh_token) {
    return null
  }
  const at = session.refresh_expires_at
    ? Date.parse(session.refresh_expires_at)
    : NaN
  return Number.isFinite(at) && at > now.getTime() + TOKEN_MARGIN_MS
    ? session.refresh_token
    : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `true` when the owner now holds the clinic's refresh lease (polled up to LOCK_WAIT_MS). */
async function acquireLock(
  deps: TransportDeps,
  orgId: string,
  owner: string,
): Promise<boolean> {
  const started = deps.now().getTime()
  let attempt = 0
  for (;;) {
    const { data, error } = await deps.client.rpc('acquire_sms_provider_lock', {
      p_org_id: orgId,
      p_owner: owner,
      p_ttl_seconds: LOCK_TTL_S,
    })
    if (error) throw new SmsTransportError('internal')
    if (data === true) return true
    if (deps.now().getTime() - started > LOCK_WAIT_MS) return false
    attempt++
    await sleep(Math.min(250 + attempt * 100, 1_000))
  }
}

async function releaseLock(
  deps: TransportDeps,
  orgId: string,
  owner: string,
): Promise<void> {
  const { error } = await deps.client.rpc('release_sms_provider_lock', {
    p_org_id: orgId,
    p_owner: owner,
  })
  if (error) {
    await reportError(
      {
        fn: 'sms-transport',
        code: 'lock_release_failed',
        ids: { org_id: orgId },
      },
      deps.fetch,
    )
  }
}

async function storeSession(
  deps: TransportDeps,
  orgId: string,
  baseUrl: string,
  tokens: YeastarTokens,
): Promise<void> {
  const { error } = await deps.client.rpc('store_sms_provider_session', {
    p_org_id: orgId,
    p_base_url: baseUrl,
    p_access_token: tokens.accessToken,
    p_refresh_token: tokens.refreshToken,
    p_access_expires_at: tokens.accessExpiresAt.toISOString(),
    p_refresh_expires_at: tokens.refreshExpiresAt?.toISOString() ?? null,
  })
  if (error) throw new SmsTransportError('internal')
}

/**
 * An access token for the clinic: the stored one while usable, else a new
 * session under the lease. `forceNew` skips the stored token and the refresh
 * (the PBX just refused the token).
 */
async function accessToken(
  deps: TransportDeps,
  orgId: string,
  context: ProviderContext,
  credentials: Credentials,
  signal: AbortSignal | undefined,
  forceNew: boolean,
): Promise<string> {
  const now = deps.now()
  if (!forceNew) {
    const stored = usableToken(context, credentials.baseUrl, now)
    if (stored) return stored
  }
  const owner = crypto.randomUUID()
  if (!(await acquireLock(deps, orgId, owner))) {
    throw new SmsTransportError('lock_timeout')
  }
  try {
    const call = {
      baseUrl: credentials.baseUrl,
      fetch: deps.fetch,
      now: deps.now,
      signal,
    }
    if (!forceNew) {
      // Another isolate may have refreshed while this one waited.
      const fresh = await readProviderContext(deps, orgId)
      const stored = usableToken(fresh, credentials.baseUrl, deps.now())
      if (stored) return stored
      const refresh = usableRefresh(fresh, credentials.baseUrl, deps.now())
      if (refresh) {
        try {
          const tokens = await refreshTokens(call, refresh)
          await storeSession(deps, orgId, credentials.baseUrl, tokens)
          return tokens.accessToken
        } catch (error) {
          // A refused refresh (expired, revoked): new tokens below.
          if (!(error instanceof YeastarError)) throw error
          if (error.code === 'provider_unreachable') throw error
        }
      }
    }
    const tokens = await requestTokens(call, {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    })
    await storeSession(deps, orgId, credentials.baseUrl, tokens)
    return tokens.accessToken
  } finally {
    await releaseLock(deps, orgId, owner)
  }
}

/** The SMS channel of the clinic's number: the cached name, else the PBX's list. */
async function smsChannel(
  deps: TransportDeps,
  orgId: string,
  context: ProviderContext,
  credentials: Credentials,
  token: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (context.channel) return context.channel
  const channel = await findSmsChannel(
    { baseUrl: credentials.baseUrl, fetch: deps.fetch, now: deps.now, signal },
    token,
    credentials.did,
  )
  const { error } = await deps.client.rpc('set_sms_provider_channel', {
    p_org_id: orgId,
    p_channel_name: channel,
  })
  if (error) {
    await reportError(
      {
        fn: 'sms-transport',
        code: 'channel_cache_failed',
        ids: { org_id: orgId },
      },
      deps.fetch,
    )
  }
  return channel
}

/** The clinic's context and credentials, or the typed failure. */
async function prepare(
  deps: TransportDeps,
  orgId: string,
): Promise<{ context: ProviderContext; credentials: Credentials }> {
  if (!UUID.test(orgId)) throw new SmsTransportError('internal')
  const context = await readProviderContext(deps, orgId)
  if (!context.module_enabled) throw new SmsTransportError('module_disabled')
  return { context, credentials: credentialsOf(deps, context) }
}

/**
 * Runs `work` with a token; a `token_invalid` answer gets one retry with
 * tokens requested afresh. PBX failures become `SmsTransportError`s.
 */
async function withToken<T>(
  deps: TransportDeps,
  orgId: string,
  context: ProviderContext,
  credentials: Credentials,
  signal: AbortSignal | undefined,
  work: (token: string) => Promise<T>,
): Promise<T> {
  const attempt = async (forceNew: boolean) =>
    await work(
      await accessToken(deps, orgId, context, credentials, signal, forceNew),
    )
  try {
    try {
      return await attempt(false)
    } catch (error) {
      if (error instanceof YeastarError && error.code === 'token_invalid') {
        return await attempt(true)
      }
      throw error
    }
  } catch (error) {
    if (error instanceof YeastarError) throw new SmsTransportError(error.code)
    throw error
  }
}

/** The Yeastar transport; see the module comment. */
export function createYeastarTransport(deps: TransportDeps): SmsTransport {
  return {
    async send(orgId, text, signal) {
      const { context, credentials } = await prepare(deps, orgId)
      const call = {
        baseUrl: credentials.baseUrl,
        fetch: deps.fetch,
        now: deps.now,
        signal,
      }
      return await withToken(
        deps,
        orgId,
        context,
        credentials,
        signal,
        async (token) => {
          const channel = await smsChannel(
            deps,
            orgId,
            context,
            credentials,
            token,
            signal,
          )
          return await sendText(call, token, {
            channel,
            did: credentials.did,
            to: text.to,
            body: text.body,
            requestId: text.requestId,
          })
        },
      )
    },
    async sessionOwner(orgId, sessionId, signal) {
      const { context, credentials } = await prepare(deps, orgId)
      const call = {
        baseUrl: credentials.baseUrl,
        fetch: deps.fetch,
        now: deps.now,
        signal,
      }
      const session = await withToken(
        deps,
        orgId,
        context,
        credentials,
        signal,
        (token) => getSession(call, token, sessionId),
      )
      const did = lastDigits(session.didNumber)
      return { ours: did !== '' && did === lastDigits(credentials.did) }
    },
  }
}
