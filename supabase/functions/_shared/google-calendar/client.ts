/**
 * Google busy times (R6, AP-41 … AP-44): the access token (refreshed when it
 * expires within 5 minutes, stored back encrypted through
 * `set_calendar_token_for_service`), the person's id at connection
 * (`/oauth2/v3/userinfo`: `sub` and the address), and the FreeBusy API
 * (`/calendar/v3/freeBusy`, her primary calendar): busy intervals only, never
 * a title. `syncConnection` does one connection's sync end to end.
 *
 * Only `invalid_grant` (or a 401 a fresh token does not cure, or the scope
 * missing) marks the connection `needs_reconnect`; Google down or slow is a
 * `CalendarError`: its code is recorded and the next run tries again.
 * Google's bodies are read for what is used, never kept or logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { OAuthApp } from '../gmail/credentials.ts'
import { type CalendarOrigins, FREEBUSY_SCOPE, SYNC_DAYS } from './env.ts'

const TIMEOUT_MS = 15_000
const MAX_ANSWER = 512 * 1024
const REFRESH_AHEAD_MS = 5 * 60_000

export type CalendarErrorCode =
  | 'timeout'
  | 'unreachable'
  | 'provider_error'
  | 'unusable_answer'
  | 'rate_limited'

/** A passing failure of Google (or of the answer): the next sync tries again. */
export class CalendarError extends Error {
  constructor(readonly code: CalendarErrorCode, readonly status?: number) {
    super(code)
    this.name = 'CalendarError'
  }
}

/** The grant is gone: the connection must be connected again. */
export class CalendarReconnect extends Error {
  constructor(
    readonly reason: 'invalid_grant' | 'unauthorized' | 'scope_missing',
  ) {
    super(reason)
    this.name = 'CalendarReconnect'
  }
}

async function call(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  let res: Response
  try {
    const signals = [AbortSignal.timeout(TIMEOUT_MS)]
    if (signal) signals.push(signal)
    res = await fetchFn(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    throw new CalendarError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'timeout'
        : 'unreachable',
    )
  }
  if (Number(res.headers.get('Content-Length')) > MAX_ANSWER) {
    await res.body?.cancel()
    throw new CalendarError('unusable_answer')
  }
  let json: unknown = null
  try {
    const text = await res.text()
    json = text === '' ? null : JSON.parse(text.slice(0, MAX_ANSWER))
  } catch {
    json = null
  }
  return { status: res.status, json }
}

const refreshSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
})
const errorSchema = z.looseObject({ error: z.string().optional() })

/** A new access token from the refresh token; `invalid_grant` → reconnect. */
export async function refreshAccessToken(
  fetchFn: typeof fetch,
  origins: CalendarOrigins,
  app: OAuthApp,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { status, json } = await call(fetchFn, `${origins.oauth}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }).toString(),
  }, signal)
  if (status >= 200 && status < 300) {
    const parsed = refreshSchema.safeParse(json)
    if (!parsed.success) throw new CalendarError('unusable_answer')
    return {
      accessToken: parsed.data.access_token,
      expiresIn: parsed.data.expires_in ?? 3_600,
    }
  }
  if (status === 400 || status === 401) {
    const error = errorSchema.safeParse(json)
    if (error.success && error.data.error === 'invalid_grant') {
      throw new CalendarReconnect('invalid_grant')
    }
    // The refresh token was issued to another application (the clinic changed it, AP-46).
    if (error.success && error.data.error === 'unauthorized_client') {
      throw new CalendarReconnect('unauthorized')
    }
  }
  if (status === 429) throw new CalendarError('rate_limited', status)
  throw new CalendarError('provider_error', status)
}

const userSchema = z.looseObject({
  sub: z.string().min(1).max(255),
  email: z.string().max(254).optional(),
})

/** Who connected: Google's stable id (`sub`) and her address. */
export async function userInfo(
  fetchFn: typeof fetch,
  origins: CalendarOrigins,
  accessToken: string,
  signal?: AbortSignal,
): Promise<{ sub: string; email: string | null }> {
  const { status, json } = await call(
    fetchFn,
    `${origins.calendar}/oauth2/v3/userinfo`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    signal,
  )
  if (status === 401) throw new CalendarReconnect('unauthorized')
  if (status < 200 || status >= 300) {
    throw new CalendarError('provider_error', status)
  }
  const parsed = userSchema.safeParse(json)
  if (!parsed.success) throw new CalendarError('unusable_answer')
  return {
    sub: parsed.data.sub,
    email: parsed.data.email?.trim().toLowerCase() || null,
  }
}

export interface BusyInterval {
  start: string
  end: string
}

const busySchema = z.looseObject({
  calendars: z.record(
    z.string(),
    z.looseObject({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).max(5_000)
        .default([]),
      errors: z.array(z.unknown()).optional(),
    }),
  ),
})

/** Her primary calendar's busy intervals between two instants (times only). */
export async function freeBusy(
  fetchFn: typeof fetch,
  origins: CalendarOrigins,
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  signal?: AbortSignal,
): Promise<BusyInterval[]> {
  const { status, json } = await call(
    fetchFn,
    `${origins.calendar}/calendar/v3/freeBusy`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }],
      }),
    },
    signal,
  )
  if (status === 401) throw new CalendarReconnect('unauthorized')
  if (status === 403) throw new CalendarReconnect('scope_missing')
  if (status === 429) throw new CalendarError('rate_limited', status)
  if (status < 200 || status >= 300) {
    throw new CalendarError('provider_error', status)
  }
  const parsed = busySchema.safeParse(json)
  if (!parsed.success) throw new CalendarError('unusable_answer')
  const primary = parsed.data.calendars['primary']
  if (!primary) throw new CalendarError('unusable_answer')
  if (primary.errors && primary.errors.length > 0) {
    throw new CalendarError('provider_error')
  }
  return primary.busy.filter((b) =>
    !Number.isNaN(Date.parse(b.start)) && !Number.isNaN(Date.parse(b.end)) &&
    Date.parse(b.end) > Date.parse(b.start)
  )
}

/** Whether a grant's scopes allow the sync. */
export function hasFreeBusyScope(scopes: readonly string[]): boolean {
  return scopes.includes(FREEBUSY_SCOPE)
}

const credentialsSchema = z.array(z.object({
  state: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  access_token_expires_at: z.string(),
  connected_at: z.string().nullable(),
})).max(1)

export interface SyncContext {
  client: SupabaseClient
  fetch: typeof fetch
  origins: CalendarOrigins
  app: OAuthApp
  now: () => Date
  signal?: AbortSignal
}

/**
 * One connection's sync: its token (refreshed when needed), FreeBusy for now →
 * 62 days, the busy times replaced. Answers what happened, as a code:
 * `synced:<n>`, `gone` (disconnected or reconnected meanwhile),
 * `reconnect:<reason>` (marked, she is told) or `error:<code>` (recorded, the
 * next run tries again). Never throws for Google's answers.
 */
export async function syncConnection(
  ctx: SyncContext,
  orgId: string,
  connectionId: string,
): Promise<string> {
  const read = await ctx.client.rpc('get_calendar_credentials_for_service', {
    p_org_id: orgId,
    p_connection_id: connectionId,
  })
  if (read.error) {
    throw Object.assign(new Error('credentials_unavailable'), {
      code: 'credentials_unavailable',
    })
  }
  const parsed = credentialsSchema.safeParse(read.data)
  if (!parsed.success) {
    throw Object.assign(new Error('credentials_unusable'), {
      code: 'credentials_unusable',
    })
  }
  const row = parsed.data[0]
  if (!row || row.state !== 'connected') return 'gone'
  const connectedAt = row.connected_at
  try {
    let accessToken = row.access_token
    if (
      Date.parse(row.access_token_expires_at) - ctx.now().getTime() <
        REFRESH_AHEAD_MS
    ) {
      const fresh = await refreshAccessToken(
        ctx.fetch,
        ctx.origins,
        ctx.app,
        row.refresh_token,
        ctx.signal,
      )
      accessToken = fresh.accessToken
      await ctx.client.rpc('set_calendar_token_for_service', {
        p_org_id: orgId,
        p_connection_id: connectionId,
        p_access_token: fresh.accessToken,
        p_access_token_expires_at: new Date(
          ctx.now().getTime() + fresh.expiresIn * 1000,
        ).toISOString(),
        p_connected_at: connectedAt,
      })
    }
    const from = ctx.now()
    const to = new Date(from.getTime() + SYNC_DAYS * 86_400_000)
    const busy = await freeBusy(
      ctx.fetch,
      ctx.origins,
      accessToken,
      from,
      to,
      ctx.signal,
    )
    const stored = await ctx.client.rpc('replace_calendar_busy_for_service', {
      p_org_id: orgId,
      p_connection_id: connectionId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_blocks: busy.slice(0, 2_000),
      p_connected_at: connectedAt,
    })
    if (stored.error) {
      throw Object.assign(new Error('store_failed'), { code: 'store_failed' })
    }
    return typeof stored.data === 'number' && stored.data >= 0
      ? `synced:${stored.data}`
      : 'gone'
  } catch (error) {
    if (error instanceof CalendarReconnect) {
      await ctx.client.rpc('mark_calendar_needs_reconnect_for_service', {
        p_org_id: orgId,
        p_connection_id: connectionId,
        p_reason: error.reason,
        p_connected_at: connectedAt,
      })
      return `reconnect:${error.reason}`
    }
    if (error instanceof CalendarError) {
      await ctx.client.rpc('record_calendar_sync_error_for_service', {
        p_org_id: orgId,
        p_connection_id: connectionId,
        p_error: error.code,
      })
      return `error:${error.code}`
    }
    throw error
  }
}
