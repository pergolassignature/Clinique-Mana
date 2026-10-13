/**
 * Zoom (RZ): the clinic's OAuth application (two org secrets), the token
 * endpoint (code exchange, refresh, revocation) and the four API calls the
 * functions make: who connected (`users/me`), create, move and delete a
 * meeting.
 *
 * - OAuth calls authenticate the app with HTTP Basic (Zoom's rule); Zoom
 *   rotates the refresh token on every refresh, so the caller stores both.
 * - Only `invalid_grant` (a revoked or lapsed grant) means « reconnect »; a
 *   transient failure (timeout, 429, 5xx) is `provider_error` and the job
 *   tries again (PS Hub deactivated on any non-2xx, roadmap §2.4 bis).
 * - API errors are mapped to a few codes: `unauthorized` (401: the access
 *   token; the caller refreshes once), `not_found` (404: the meeting is gone),
 *   `bad_request` (another 4xx), `provider_error` (429, 5xx), `timeout`,
 *   `unreachable`, `unusable_answer`. Zoom's error bodies are never kept.
 * - Answers are capped (64 KB) and parsed with Zod; the join URL must be https.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  MEETING_TOPIC,
  SECRET_CLIENT_ID,
  SECRET_CLIENT_SECRET,
  type ZoomOrigins,
} from './env.ts'

const TIMEOUT_MS = 15_000
const MAX_ANSWER = 64 * 1024

export type ZoomErrorCode =
  | 'timeout'
  | 'unreachable'
  | 'unusable_answer'
  | 'provider_error'
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'

/** A failure of Zoom or of the way to it; `code` is safe to record. */
export class ZoomError extends Error {
  constructor(readonly code: ZoomErrorCode, readonly status?: number) {
    super(code)
    this.name = 'ZoomError'
  }
}

/** Zoom refused the grant: the connection must be made again. */
export class ReconnectNeeded extends Error {
  constructor(readonly reason: 'invalid_grant' | 'unauthorized') {
    super(reason)
    this.name = 'ReconnectNeeded'
  }
}

/** The clinic's Zoom application. */
export interface OAuthApp {
  clientId: string
  clientSecret: string
}

/** The clinic's Zoom application, or null when either secret is missing. */
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
  if (id.error || secret.error) throw new ZoomError('provider_error')
  if (
    typeof id.data !== 'string' || !id.data ||
    typeof secret.data !== 'string' || !secret.data
  ) {
    return null
  }
  return { clientId: id.data, clientSecret: secret.data }
}

/** One fetch with the timeout and the caller's signal; a network failure is a `ZoomError`. */
async function send(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const signals = [AbortSignal.timeout(TIMEOUT_MS)]
  if (signal) signals.push(signal)
  try {
    return await fetchFn(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    throw new ZoomError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'timeout'
        : 'unreachable',
    )
  }
}

/** The answer's JSON (capped), or null for an empty or unreadable body. */
async function readAnswer(res: Response): Promise<unknown> {
  if (Number(res.headers.get('Content-Length')) > MAX_ANSWER) {
    await res.body?.cancel()
    throw new ZoomError('unusable_answer', res.status)
  }
  try {
    const text = await res.text()
    if (text.length > MAX_ANSWER) throw new ZoomError('unusable_answer')
    return text === '' ? null : JSON.parse(text)
  } catch (error) {
    if (error instanceof ZoomError) throw error
    return null
  }
}

const basic = (app: OAuthApp) =>
  'Basic ' + btoa(`${app.clientId}:${app.clientSecret}`)

const tokenSchema = z.looseObject({
  access_token: z.string().min(1).max(4_096),
  refresh_token: z.string().min(1).max(4_096),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().max(2_048).optional(),
})
export type TokenResponse = z.infer<typeof tokenSchema>

const errorSchema = z.looseObject({ error: z.string().optional() })

async function tokenCall(
  fetchFn: typeof fetch,
  origins: ZoomOrigins,
  app: OAuthApp,
  form: Record<string, string>,
  signal?: AbortSignal,
): Promise<
  { ok: true; token: TokenResponse } | { ok: false; invalidGrant: boolean }
> {
  const res = await send(fetchFn, `${origins.oauth}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basic(app),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  }, signal)
  const json = await readAnswer(res)
  if (res.ok) {
    const parsed = tokenSchema.safeParse(json)
    if (!parsed.success) throw new ZoomError('unusable_answer', res.status)
    return { ok: true, token: parsed.data }
  }
  if (res.status === 429 || res.status >= 500) {
    throw new ZoomError('provider_error', res.status)
  }
  const error = errorSchema.safeParse(json)
  return {
    ok: false,
    invalidGrant: error.success && error.data.error === 'invalid_grant',
  }
}

/**
 * The authorization code → tokens. A refused code (`invalid_grant`: expired,
 * used) throws `bad_request`; another refusal (`invalid_client`: the
 * clinic's app is wrong) is the clinic's configuration and throws
 * `provider_error`.
 */
export async function exchangeCode(
  fetchFn: typeof fetch,
  origins: ZoomOrigins,
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
      ? new ZoomError('bad_request', 400)
      : new ZoomError('provider_error')
  }
  return result.token
}

/** New tokens from the refresh token; `ReconnectNeeded` when Zoom refuses the grant. */
export async function refreshTokens(
  fetchFn: typeof fetch,
  origins: ZoomOrigins,
  app: OAuthApp,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const result = await tokenCall(fetchFn, origins, app, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }, signal)
  if (!result.ok) {
    if (result.invalidGrant) throw new ReconnectNeeded('invalid_grant')
    throw new ZoomError('provider_error')
  }
  return result.token
}

/** Best effort: Zoom forgets the grant. Never throws. */
export async function revokeToken(
  fetchFn: typeof fetch,
  origins: ZoomOrigins,
  app: OAuthApp,
  token: string,
): Promise<boolean> {
  try {
    const res = await send(fetchFn, `${origins.oauth}/oauth/revoke`, {
      method: 'POST',
      headers: {
        Authorization: basic(app),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }).toString(),
    })
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

const userSchema = z.looseObject({
  id: z.string().min(1).max(64),
  email: z.string().max(254).optional(),
  account_id: z.string().max(64).optional(),
})
export type ZoomUser = z.infer<typeof userSchema>

const meetingSchema = z.looseObject({
  id: z.union([z.number().int().positive(), z.string().regex(/^[0-9]{1,30}$/)]),
  join_url: z.string().max(1_000).refine((url) => url.startsWith('https://')),
})

/** A meeting at Zoom, as the database keeps it. */
export interface Meeting {
  externalId: string
  joinUrl: string
}

/** When and how long, in the clinic's time zone. */
export interface MeetingTimes {
  startsAt: string
  endsAt: string
  timezone: string
}

/** Zoom's `start_time` (UTC, seconds) and a duration in whole minutes (at least 1). */
export function meetingFields(times: MeetingTimes): Record<string, unknown> {
  const start = new Date(times.startsAt)
  const minutes = Math.max(
    1,
    Math.round((Date.parse(times.endsAt) - start.getTime()) / 60_000),
  )
  return {
    start_time: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: minutes,
    timezone: times.timezone,
  }
}

/** The API calls, with one access token. */
export class ZoomApi {
  constructor(
    private readonly opts: {
      fetch: typeof fetch
      origin: string
      accessToken: string
      signal?: AbortSignal
    },
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const res = await send(this.opts.fetch, `${this.opts.origin}/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.accessToken}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, this.opts.signal)
    const json = await readAnswer(res)
    if (res.ok) return { status: res.status, json }
    if (res.status === 401) throw new ZoomError('unauthorized', 401)
    if (res.status === 404) throw new ZoomError('not_found', 404)
    if (res.status === 429 || res.status >= 500) {
      throw new ZoomError('provider_error', res.status)
    }
    throw new ZoomError('bad_request', res.status)
  }

  /** The connected account. */
  async me(): Promise<ZoomUser> {
    const { json } = await this.call('GET', '/users/me')
    const parsed = userSchema.safeParse(json)
    if (!parsed.success) throw new ZoomError('unusable_answer')
    return parsed.data
  }

  /** A scheduled meeting on the connected account; the clients wait for the host. */
  async createMeeting(times: MeetingTimes): Promise<Meeting> {
    const { json } = await this.call('POST', '/users/me/meetings', {
      topic: MEETING_TOPIC,
      type: 2,
      ...meetingFields(times),
      settings: {
        join_before_host: false,
        waiting_room: true,
        approval_type: 2,
        host_video: true,
        participant_video: true,
      },
    })
    const parsed = meetingSchema.safeParse(json)
    if (!parsed.success) throw new ZoomError('unusable_answer')
    return { externalId: String(parsed.data.id), joinUrl: parsed.data.join_url }
  }

  /** Moves a meeting (its address stays). `not_found` when it is gone. */
  async updateMeeting(externalId: string, times: MeetingTimes): Promise<void> {
    await this.call(
      'PATCH',
      `/meetings/${encodeURIComponent(externalId)}`,
      meetingFields(times),
    )
  }

  /** Deletes a meeting; one already gone counts as deleted. */
  async deleteMeeting(externalId: string): Promise<void> {
    try {
      await this.call(
        'DELETE',
        `/meetings/${
          encodeURIComponent(externalId)
        }?schedule_for_reminder=false`,
      )
    } catch (error) {
      if (error instanceof ZoomError && error.code === 'not_found') return
      throw error
    }
  }
}
