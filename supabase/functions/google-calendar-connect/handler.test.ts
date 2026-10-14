import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { verifyState } from '../_shared/oauth-state.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  ADMIN_ID,
  CALENDAR_APP_SECRETS,
  calendarHarness,
  connected,
  FREEBUSY,
  ORG_ID,
  SECRET,
} from '../_shared/testing/google-calendar-fixtures.ts'
import {
  FAKE_CALENDAR_CLIENT_ID,
  FAKE_CLIENT_ID,
} from '../_shared/testing/fake-gmail.ts'

const URL_ = 'http://fn.test/functions/v1/google-calendar-connect'
const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer tok',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)

Deno.test('google-calendar-connect: start answers the consent URL with the free/busy scope, offline access and a signed state', () =>
  run(async () => {
    const h = calendarHarness()
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 200)
    const { url } = await res.json()
    const consent = new URL(url)
    assertEquals(consent.origin, 'http://127.0.0.1:55392')
    assertEquals(consent.pathname, '/o/oauth2/v2/auth')
    assertEquals(consent.searchParams.get('client_id'), FAKE_CLIENT_ID)
    assertEquals(
      consent.searchParams.get('redirect_uri'),
      'http://localhost:5173/mon-agenda/agenda-google',
    )
    assertEquals(
      consent.searchParams.get('scope'),
      `openid email ${FREEBUSY}`,
    )
    assertEquals(consent.searchParams.get('access_type'), 'offline')
    assertEquals(consent.searchParams.get('prompt'), 'consent')
    const verified = await verifyState(
      SECRET,
      consent.searchParams.get('state')!,
      'google_calendar_connect',
      h.deps.now(),
    )
    assert(verified.ok)
    assertEquals(verified.state.orgId, ORG_ID)
    assertEquals(verified.state.userId, ADMIN_ID)
    // Never the events' scope: busy times only.
    assert(!url.includes('calendar.readonly'))
    assert(!url.includes('calendar.events'))
  }))

Deno.test('google-calendar-connect: without the clinic Google application → 503 not_configured', () =>
  run(async () => {
    const h = calendarHarness({
      state: {
        secrets: {
          google_oauth_client_id: null,
          google_oauth_client_secret: null,
        },
      },
    })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 503)
    assertEquals((await res.json()).error.code, 'not_configured')
  }))

Deno.test('google-calendar-connect: without appointments.self → 403, nothing asked', () =>
  run(async () => {
    const h = calendarHarness({ permissions: ['appointments.view'] })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 403)
    assertEquals(h.service.calls.length, 0)
  }))

Deno.test('google-calendar-connect: Rendez-vous off → refused before anything', () =>
  run(async () => {
    const h = calendarHarness({ modules: [] })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assert(res.status >= 400)
    assertEquals(h.service.calls.length, 0)
  }))

Deno.test('google-calendar-connect: an unknown action or extra field → 400', () =>
  run(async () => {
    const h = calendarHarness()
    const handler = createHandler(h.deps)
    assertEquals((await handler(post({ action: 'other' }))).status, 400)
    assertEquals(
      (await handler(post({ action: 'start', org_id: ORG_ID }))).status,
      400,
    )
  }))

Deno.test('google-calendar-connect: disconnect revokes the grant at Google, then deletes the connection', () =>
  run(async () => {
    const h = calendarHarness({ state: { connection: connected() } })
    const res = await createHandler(h.deps)(post({ action: 'disconnect' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { ok: true, revoked: true })
    assertEquals(h.google.grants.get('1//fake-refresh-initial')?.revoked, true)
    assertEquals(h.state.connection?.state, 'disconnected')
    const disconnect = h.service.calls.find((c) =>
      c.fn === 'disconnect_my_calendar_connection'
    )!
    assertEquals(disconnect.args, { p_actor: ADMIN_ID, p_org_id: ORG_ID })
  }))

Deno.test('google-calendar-connect: disconnect with nothing connected → 404', () =>
  run(async () => {
    const h = calendarHarness()
    const res = await createHandler(h.deps)(post({ action: 'disconnect' }))
    assertEquals(res.status, 404)
    assertEquals(h.google.calls.length, 0)
  }))

Deno.test('google-calendar-connect: a refused RPC (not a professional) is passed on as a refusal', () =>
  run(async () => {
    const h = calendarHarness({
      rpc: {
        get_my_calendar_credentials_for_service: {
          error: {
            code: 'P0001',
            message: 'Votre compte n’est pas lié à une fiche de professionnel.',
          },
        },
      },
    })
    const res = await createHandler(h.deps)(post({ action: 'disconnect' }))
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
  }))

Deno.test('google-calendar-connect: the calendars’ own Google application when both of its secrets are set (AP-46)', () =>
  run(async () => {
    const h = calendarHarness({
      state: {
        secrets: {
          google_oauth_client_id: FAKE_CLIENT_ID,
          google_oauth_client_secret: 'local-dev-google-client-secret',
          ...CALENDAR_APP_SECRETS,
        },
      },
    })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    const consent = new URL((await res.json()).url)
    assertEquals(
      consent.searchParams.get('client_id'),
      FAKE_CALENDAR_CLIENT_ID,
    )
  }))

Deno.test('google-calendar-connect: half of the calendars’ application set → Gmail’s is used', () =>
  run(async () => {
    const h = calendarHarness({
      state: {
        secrets: {
          google_oauth_client_id: FAKE_CLIENT_ID,
          google_oauth_client_secret: 'local-dev-google-client-secret',
          google_calendar_client_id: FAKE_CALENDAR_CLIENT_ID,
        },
      },
    })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    const consent = new URL((await res.json()).url)
    assertEquals(consent.searchParams.get('client_id'), FAKE_CLIENT_ID)
  }))

Deno.test('google-calendar-connect: only the calendars’ application set (no Gmail) → it is used', () =>
  run(async () => {
    const h = calendarHarness({
      state: { secrets: { ...CALENDAR_APP_SECRETS } },
    })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 200)
    const consent = new URL((await res.json()).url)
    assertEquals(
      consent.searchParams.get('client_id'),
      FAKE_CALENDAR_CLIENT_ID,
    )
  }))
