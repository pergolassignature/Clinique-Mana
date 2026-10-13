/**
 * An in-memory Zoom (RZ) for the Deno tests and the local server
 * (`scripts/fake-zoom.ts`, `npm run fake:zoom`): the consent page (answers
 * at once with a redirect carrying a code), the token endpoint (code
 * exchange, refresh with rotation, Basic client authentication), the
 * revocation, `users/me` and the meetings (create, patch, delete). Test-only
 * and the local fake: no `index.ts` imports this folder.
 */

/** The fake's Zoom app (the seed's org secrets hold the same values). */
export const FAKE_ZOOM_CLIENT_ID = 'local-dev-zoom-client-id'
export const FAKE_ZOOM_CLIENT_SECRET = 'local-dev-zoom-client-secret'
export const FAKE_ZOOM_USER = {
  id: 'fakeZoomUser01',
  email: 'pro.zoom@exemple.test',
  account_id: 'fakeZoomAccount01',
}
export const ACCESS_TTL_S = 3_600
/** Where the fake's meetings live (https, as Zoom's: never opened). */
export const FAKE_JOIN_ORIGIN = 'https://fake-zoom.test'

export interface FakeZoomMeeting {
  id: number
  owner: string
  start_time: string
  duration: number
  timezone: string
  join_url: string
  deleted: boolean
}

export interface FakeZoom {
  fetch: typeof fetch
  handler(req: Request): Promise<Response>
  calls: { method: string; path: string; status: number }[]
  meetings: Map<string, FakeZoomMeeting>
  /** Refresh token → its grant (rotated on each refresh: the old one is spent). */
  grants: Map<string, { user: string; revoked: boolean }>
  /** Access token → expiry (ms) and its user. */
  tokens: Map<string, { expiresAt: number; user: string; revoked: boolean }>
  issueCode(): string
  /** Forces the next API call(s) to answer this status (consumed in order). */
  failures: number[]
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export function fakeZoom(
  options: { now?: () => number } = {},
): FakeZoom {
  const now = options.now ?? (() => Date.now())
  const calls: FakeZoom['calls'] = []
  const codes = new Set<string>()
  const grants: FakeZoom['grants'] = new Map()
  const tokens: FakeZoom['tokens'] = new Map()
  const meetings: FakeZoom['meetings'] = new Map()
  const failures: number[] = []
  let counter = 1
  let meetingId = 88_000_000_000

  const issue = (user: string) => {
    const access = `zoom-access-${counter++}`
    const refresh = `zoom-refresh-${counter++}`
    grants.set(refresh, { user, revoked: false })
    tokens.set(access, {
      expiresAt: now() + ACCESS_TTL_S * 1000,
      user,
      revoked: false,
    })
    return {
      access_token: access,
      token_type: 'bearer',
      refresh_token: refresh,
      expires_in: ACCESS_TTL_S,
      scope:
        'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user',
    }
  }

  const appAuthorized = (req: Request) =>
    req.headers.get('Authorization') ===
      'Basic ' + btoa(`${FAKE_ZOOM_CLIENT_ID}:${FAKE_ZOOM_CLIENT_SECRET}`)

  const bearer = (req: Request) => {
    const header = req.headers.get('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const row = tokens.get(token)
    return row && !row.revoked && row.expiresAt > now() ? row.user : null
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    if (req.method === 'GET' && path === '/oauth/authorize') {
      const redirect = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state') ?? ''
      if (!redirect) return json(400, { reason: 'Invalid redirect' })
      const code = issueCode()
      const target = new URL(redirect)
      target.searchParams.set('code', code)
      target.searchParams.set('state', state)
      return new Response(null, {
        status: 302,
        headers: { Location: target.toString() },
      })
    }
    if (req.method === 'POST' && path === '/oauth/token') {
      if (!appAuthorized(req)) return json(401, { error: 'invalid_client' })
      const form = new URLSearchParams(await req.text())
      if (form.get('grant_type') === 'authorization_code') {
        const code = form.get('code') ?? ''
        if (!codes.delete(code)) return json(400, { error: 'invalid_grant' })
        return json(200, issue(FAKE_ZOOM_USER.id))
      }
      if (form.get('grant_type') === 'refresh_token') {
        const refresh = form.get('refresh_token') ?? ''
        const grant = grants.get(refresh)
        if (!grant || grant.revoked) {
          return json(400, { error: 'invalid_grant' })
        }
        grant.revoked = true // Rotated: the old refresh token is spent.
        return json(200, issue(grant.user))
      }
      return json(400, { error: 'unsupported_grant_type' })
    }
    if (req.method === 'POST' && path === '/oauth/revoke') {
      if (!appAuthorized(req)) return json(401, { error: 'invalid_client' })
      const token = new URLSearchParams(await req.text()).get('token') ?? ''
      const row = tokens.get(token)
      if (row) {
        row.revoked = true
        for (const grant of grants.values()) {
          if (grant.user === row.user) grant.revoked = true
        }
      }
      return json(200, { status: 'success' })
    }
    if (path.startsWith('/v2/')) {
      const forced = failures.shift()
      if (forced) return json(forced, { code: forced, message: 'forced' })
      const user = bearer(req)
      if (!user) {
        return json(401, { code: 124, message: 'Invalid access token.' })
      }
      if (req.method === 'GET' && path === '/v2/users/me') {
        return json(200, { ...FAKE_ZOOM_USER, id: user })
      }
      if (req.method === 'POST' && path === '/v2/users/me/meetings') {
        const body = await req.json() as Record<string, unknown>
        const id = meetingId++
        const meeting: FakeZoomMeeting = {
          id,
          owner: user,
          start_time: String(body.start_time),
          duration: Number(body.duration),
          timezone: String(body.timezone),
          join_url: `${FAKE_JOIN_ORIGIN}/j/${id}?pwd=fake`,
          deleted: false,
        }
        meetings.set(String(id), meeting)
        return json(201, {
          id,
          join_url: meeting.join_url,
          start_url: `${FAKE_JOIN_ORIGIN}/s/${id}`,
        })
      }
      const match = /^\/v2\/meetings\/([0-9]+)$/.exec(path)
      if (match) {
        const meeting = meetings.get(match[1])
        if (!meeting || meeting.deleted || meeting.owner !== user) {
          return json(404, { code: 3001, message: 'Meeting does not exist.' })
        }
        if (req.method === 'PATCH') {
          const body = await req.json() as Record<string, unknown>
          meeting.start_time = String(body.start_time)
          meeting.duration = Number(body.duration)
          meeting.timezone = String(body.timezone)
          return new Response(null, { status: 204 })
        }
        if (req.method === 'DELETE') {
          meeting.deleted = true
          return new Response(null, { status: 204 })
        }
      }
    }
    return json(404, { code: 404, message: 'Not found' })
  }

  async function handler(req: Request): Promise<Response> {
    const res = await route(req)
    calls.push({
      method: req.method,
      path: new URL(req.url).pathname,
      status: res.status,
    })
    return res
  }

  function issueCode(): string {
    const code = `zoom-code-${counter++}`
    codes.add(code)
    return code
  }

  return {
    fetch:
      ((input: RequestInfo | URL, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof fetch,
    handler,
    calls,
    meetings,
    grants,
    tokens,
    issueCode,
    failures,
  }
}
