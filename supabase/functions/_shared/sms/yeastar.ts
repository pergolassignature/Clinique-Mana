/**
 * The Yeastar P-Series OpenAPI, as the clinic's texts use it (batch SM; PS
 * Hub `_shared/yeastar.ts`, ported without its env defaults, its hard-coded
 * number and its token store):
 *
 * - `POST /openapi/v1.0/get_token` { username, password } → an access token
 *   (30 min) and a refresh token (24 h); `errcode` 60002 when the PBX holds
 *   too many live tokens (« MAX LIMITATION EXCEEDED »);
 * - `POST /openapi/v1.0/refresh_token` { refresh_token } → the same;
 * - `GET /openapi/v1.0/message_channel/list?access_token=…` → the message
 *   channels; the SMS one whose `number[]` ends with the clinic's DID is the
 *   channel to send from;
 * - `POST /openapi/v1.0/message/send?access_token=…` → `msg_id`, `session_id`.
 *
 * Every call: JSON, `Accept: application/json`, our user agent, 10 s, no
 * redirects. The PBX's `errcode` 0 means success. Failures are typed
 * (`YeastarError.code`): `provider_unreachable` (network, timeout),
 * `provider_error` (a 5xx or a body that is no JSON), `provider_rejected`
 * (a 4xx or a non-zero `errcode`), `token_limit`, `token_invalid` (the
 * access token was refused: the caller gets a new one and tries once more),
 * `channel_not_found`. An error carries the PBX's `errcode` at most: never
 * its message, the URL (it holds the token) or a body.
 *
 * Nothing here reads the database or the environment: the transport
 * (`transport.ts`) brings the base URL, the credentials and the token.
 */
import { lastDigits } from './phone.ts'

/** How long one PBX call may take. */
export const YEASTAR_TIMEOUT_MS = 10_000
/** Sent on every call; the PBX logs it. */
export const YEASTAR_USER_AGENT = 'CliniqueMANA-Yeastar/1.0'
/** A body larger than this is not a PBX answer. */
const MAX_ANSWER_BYTES = 262_144

export type YeastarErrorCode =
  | 'provider_unreachable'
  | 'provider_error'
  | 'provider_rejected'
  | 'token_limit'
  | 'token_invalid'
  | 'channel_not_found'

/** A failed PBX call; `errcode` is the PBX's own number, when it gave one. */
export class YeastarError extends Error {
  constructor(
    readonly code: YeastarErrorCode,
    readonly errcode: number | null = null,
    readonly status: number | null = null,
  ) {
    super(`yeastar: ${code}`)
    this.name = 'YeastarError'
  }
}

/** A session with the PBX. */
export interface YeastarTokens {
  accessToken: string
  refreshToken: string | null
  accessExpiresAt: Date
  refreshExpiresAt: Date | null
}

/** What a call needs besides its own arguments. */
export interface YeastarCall {
  /** `https://pbx.example.com`, no trailing slash. */
  baseUrl: string
  fetch: typeof fetch
  now: () => Date
  signal?: AbortSignal
}

/** `errcode` values that mean the access token is not accepted (the PBX's auth errors). */
const TOKEN_ERRCODES = new Set([10004, 10005, 10006, 10007, 10008])
/** « MAX LIMITATION EXCEEDED »: too many live tokens for the app. */
const TOKEN_LIMIT_ERRCODE = 60002

function timeout(signal: AbortSignal | undefined): AbortSignal {
  const own = AbortSignal.timeout(YEASTAR_TIMEOUT_MS)
  return signal ? AbortSignal.any([own, signal]) : own
}

/** The PBX's JSON answer, or a typed error. The body is read once, capped. */
async function call(
  ctx: YeastarCall,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; token?: string },
): Promise<Record<string, unknown>> {
  const url = new URL(`${ctx.baseUrl}/openapi/v1.0/${path}`)
  if (init.token) url.searchParams.set('access_token', init.token)
  let res: Response
  try {
    res = await ctx.fetch(url, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        'User-Agent': YEASTAR_USER_AGENT,
        ...(init.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: 'error',
      signal: timeout(ctx.signal),
    })
  } catch {
    throw new YeastarError('provider_unreachable')
  }
  const length = Number(res.headers.get('Content-Length'))
  if (length > MAX_ANSWER_BYTES) {
    await res.body?.cancel()
    throw new YeastarError('provider_error', null, res.status)
  }
  let data: unknown
  try {
    const text = await res.text()
    if (text.length > MAX_ANSWER_BYTES) throw new Error('too large')
    data = JSON.parse(text)
  } catch {
    throw new YeastarError(
      res.status >= 400 && res.status < 500
        ? 'provider_rejected'
        : 'provider_error',
      null,
      res.status,
    )
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new YeastarError('provider_error', null, res.status)
  }
  const body = data as Record<string, unknown>
  const errcode = typeof body.errcode === 'number' ? body.errcode : null
  if (errcode === TOKEN_LIMIT_ERRCODE) throw new YeastarError('token_limit', errcode, res.status)
  if (errcode !== null && TOKEN_ERRCODES.has(errcode)) {
    throw new YeastarError('token_invalid', errcode, res.status)
  }
  if (!res.ok || errcode !== 0) {
    throw new YeastarError(
      res.status >= 500 ? 'provider_error' : 'provider_rejected',
      errcode,
      res.status,
    )
  }
  return body
}

/** `now + seconds` (the PBX's `*_expire_time`), or `now + fallback` when it gave none. */
function expiry(now: Date, seconds: unknown, fallbackSeconds: number): Date {
  const n = Number(seconds)
  const s = Number.isFinite(n) && n > 0 ? n : fallbackSeconds
  return new Date(now.getTime() + s * 1000)
}

function tokensFrom(
  body: Record<string, unknown>,
  now: Date,
  previousRefresh: string | null,
): YeastarTokens {
  const access = body.access_token
  if (typeof access !== 'string' || access === '') {
    throw new YeastarError('provider_error')
  }
  const refresh = typeof body.refresh_token === 'string' && body.refresh_token
    ? body.refresh_token
    : previousRefresh
  return {
    accessToken: access,
    refreshToken: refresh,
    accessExpiresAt: expiry(now, body.access_token_expire_time, 1800),
    refreshExpiresAt: refresh
      ? expiry(now, body.refresh_token_expire_time, 86_400)
      : null,
  }
}

/** A new session from the app's credentials. */
export async function requestTokens(
  ctx: YeastarCall,
  credentials: { clientId: string; clientSecret: string },
): Promise<YeastarTokens> {
  const body = await call(ctx, 'get_token', {
    method: 'POST',
    body: { username: credentials.clientId, password: credentials.clientSecret },
  })
  return tokensFrom(body, ctx.now(), null)
}

/** The session renewed from its refresh token (kept when the PBX returns none). */
export async function refreshTokens(
  ctx: YeastarCall,
  refreshToken: string,
): Promise<YeastarTokens> {
  const body = await call(ctx, 'refresh_token', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  })
  return tokensFrom(body, ctx.now(), refreshToken)
}

/** The SMS channel of the clinic's number (its `channel` name), as the send needs it. */
export async function findSmsChannel(
  ctx: YeastarCall,
  token: string,
  did: string,
): Promise<string> {
  const body = await call(
    ctx,
    'message_channel/list?page=1&page_size=50&time_range=all',
    { method: 'GET', token },
  )
  const list = Array.isArray(body.list) ? body.list : []
  const target = lastDigits(did)
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const channel = item as Record<string, unknown>
    if (channel.type !== 'sms' || typeof channel.channel !== 'string') continue
    const numbers = Array.isArray(channel.number) ? channel.number : []
    if (
      numbers.some((n) => typeof n === 'string' && lastDigits(n) === target)
    ) return channel.channel
  }
  throw new YeastarError('channel_not_found')
}

/** The PBX's ids for a sent text. */
export interface SentMessage {
  msgId: number | null
  sessionId: number | null
}

/**
 * Sends one text as the API platform (`sender_type` 9, `sender_no` `api`:
 * the DID routes inbound texts to the platform, so the API owns every session
 * and the PBX threads the text into the number's session itself).
 */
export async function sendText(
  ctx: YeastarCall,
  token: string,
  message: {
    channel: string
    did: string
    to: string
    body: string
    /** Our idempotency key for the PBX (≤ 127 characters). */
    requestId: string
  },
): Promise<SentMessage> {
  const body = await call(ctx, 'message/send', {
    method: 'POST',
    token,
    body: {
      sender_type: 9,
      sender_no: 'api',
      channel: message.channel,
      did_number: message.did,
      to: message.to,
      msg_kind: 0,
      msg_type: 0,
      msg_body: message.body,
      request_id: message.requestId.slice(0, 127),
    },
  })
  const id = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string' && /^[0-9]{1,18}$/.test(value)
      ? Number(value)
      : null
  return { msgId: id(body.msg_id), sessionId: id(body.session_id) }
}
