import { assert, assertEquals } from '@std/assert'
import { createHandler, STATE_PURPOSE } from './handler.ts'
import { verifyState } from '../_shared/oauth-state.ts'
import { withEnv } from '../_shared/testing/env.ts'
import { FAKE_ZOOM_CLIENT_ID } from '../_shared/testing/fake-zoom.ts'
import {
  ADMIN_ID,
  NOW,
  ORG_ID,
  post,
  SECRET,
  zoomHarness,
} from '../_shared/testing/zoom-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/zoom-connect'
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SENTRY_DSN: undefined,
  }, fn)
const connected = {
  state: 'connected' as const,
  access: 'zoom-access-initial',
  refresh: 'zoom-refresh-initial',
  expiresAt: '2026-10-13T16:00:00.000Z',
}

Deno.test("zoom-connect: start answers Zoom's consent page with the fixed return path and a signed state for the caller", () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(post(URL_, { action: 'start' }))
    assertEquals(res.status, 200)
    const url = new URL((await res.json()).url)
    assertEquals(
      url.origin + url.pathname,
      'http://127.0.0.1:55394/oauth/authorize',
    )
    assertEquals(url.searchParams.get('client_id'), FAKE_ZOOM_CLIENT_ID)
    assertEquals(url.searchParams.get('response_type'), 'code')
    assertEquals(
      url.searchParams.get('redirect_uri'),
      'http://localhost:5173/mon-agenda/videoconference',
    )
    const state = await verifyState(
      SECRET,
      url.searchParams.get('state')!,
      STATE_PURPOSE,
      new Date(NOW),
    )
    assert(state.ok)
    assertEquals([state.state.orgId, state.state.userId], [ORG_ID, ADMIN_ID])
    assertEquals(h.zoom.calls, [])
  }))

Deno.test('zoom-connect: no Zoom app set → 503 not_configured', () =>
  run(async () => {
    const h = zoomHarness({
      state: { secrets: { zoom_client_id: null, zoom_client_secret: null } },
    })
    const res = await createHandler(h.deps)(post(URL_, { action: 'start' }))
    assertEquals(res.status, 503)
    assertEquals((await res.json()).error.code, 'not_configured')
  }))

Deno.test('zoom-connect: the module and appointments.self are required', () =>
  run(async () => {
    const off = zoomHarness({ modules: [] })
    assertEquals(
      (await createHandler(off.deps)(post(URL_, { action: 'start' }))).status,
      403,
    )
    const staff = zoomHarness({ permissions: ['appointments.view'] })
    assertEquals(
      (await createHandler(staff.deps)(post(URL_, { action: 'start' })))
        .status,
      403,
    )
    assertEquals(staff.service.calls, [])
  }))

Deno.test('zoom-connect: a body other than the two actions → 400', () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(
      post(URL_, { action: 'start', redirect: 'https://evil.test' }),
    )
    assertEquals(res.status, 400)
  }))

Deno.test('zoom-connect: disconnect revokes the grant at Zoom, then ends the connection as the caller', () =>
  run(async () => {
    const h = zoomHarness({ state: { connection: { ...connected } } })
    const res = await createHandler(h.deps)(
      post(URL_, { action: 'disconnect' }),
    )
    assertEquals([res.status, await res.json()], [200, {
      ok: true,
      revoked: true,
    }])
    assertEquals(h.zoom.calls.map((c) => c.path), ['/oauth/revoke'])
    const done = h.service.calls.find((c) =>
      c.fn === 'disconnect_my_zoom_connection'
    )!
    assertEquals(done.args, { p_actor: ADMIN_ID, p_org_id: ORG_ID })
    assertEquals(h.state.connection?.state, 'disconnected')
  }))

Deno.test('zoom-connect: disconnect with nothing connected → 404', () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(
      post(URL_, { action: 'disconnect' }),
    )
    assertEquals(res.status, 404)
    assertEquals(h.zoom.calls, [])
  }))

Deno.test("zoom-connect: a caller who is not a professional gets the database's refusal", () =>
  run(async () => {
    const h = zoomHarness({
      rpc: {
        get_my_zoom_credentials_for_service: {
          error: {
            code: 'P0001',
            message:
              'Seul un professionnel de la clinique peut connecter son compte Zoom.',
          },
        },
      },
    })
    const res = await createHandler(h.deps)(
      post(URL_, { action: 'disconnect' }),
    )
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
  }))
