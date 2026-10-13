import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { signState } from '../_shared/oauth-state.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  ADMIN_ID,
  NOW,
  ORG_ID,
  post,
  SECRET,
  zoomHarness,
} from '../_shared/testing/zoom-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/zoom-callback'
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SENTRY_DSN: undefined,
  }, fn)

const signed = async (
  over: { orgId?: string; userId?: string; purpose?: string; at?: string } = {},
) =>
  (await signState(SECRET, {
    purpose: over.purpose ?? 'zoom_connect',
    orgId: over.orgId ?? ORG_ID,
    userId: over.userId ?? ADMIN_ID,
  }, new Date(over.at ?? NOW))).state

Deno.test('zoom-callback: the code is exchanged, the account named, the connection stored for the caller; only the address is answered', () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(
      post(URL_, { code: h.zoom.issueCode(), state: await signed() }),
    )
    assertEquals([res.status, await res.json()], [200, {
      email: 'pro.zoom@exemple.test',
    }])
    assertEquals(h.zoom.calls.map((c) => c.path), [
      '/oauth/token',
      '/v2/users/me',
    ])
    const store = h.service.calls.find((c) => c.fn === 'store_zoom_connection')!
    assertEquals(store.args.p_actor, ADMIN_ID)
    assertEquals(store.args.p_org_id, ORG_ID)
    assertEquals(store.args.p_external_user_id, 'fakeZoomUser01')
    assertEquals(store.args.p_external_account_id, 'fakeZoomAccount01')
    assert(String(store.args.p_access_token).startsWith('zoom-access-'))
    assert(String(store.args.p_refresh_token).startsWith('zoom-refresh-'))
    assertEquals(
      store.args.p_access_token_expires_at,
      '2026-10-13T16:00:00.000Z',
    )
    assertEquals((store.args.p_scopes as string[]).length, 4)
    // The nonce was spent before Zoom was asked.
    const limits = h.service.calls.filter((c) => c.fn === 'consume_rate_limit')
    assertEquals(limits.map((c) => c.args.p_bucket), [
      'zoom.callback_user',
      'oauth.state_nonce',
    ])
  }))

Deno.test('zoom-callback: a state of someone else → 403; a forged one → 410; an expired one → 410 link_expired', () =>
  run(async () => {
    const h = zoomHarness()
    const handler = createHandler(h.deps)
    const other = await handler(post(URL_, {
      code: 'c',
      state: await signed({ userId: '00000000-0000-4000-8000-0000000000b2' }),
    }))
    assertEquals(other.status, 403)
    const forged = await handler(post(URL_, { code: 'c', state: 'abc.def' }))
    assertEquals(
      [forged.status, (await forged.json()).error.code],
      [410, 'link_invalid'],
    )
    const old = await handler(post(URL_, {
      code: 'c',
      state: await signed({ at: '2026-10-13T14:00:00.000Z' }),
    }))
    assertEquals([old.status, (await old.json()).error.code], [
      410,
      'link_expired',
    ])
    const gmail = await handler(post(URL_, {
      code: 'c',
      state: await signed({ purpose: 'gmail_connect' }),
    }))
    assertEquals(gmail.status, 410)
    assertEquals(h.zoom.calls, [])
  }))

Deno.test('zoom-callback: a replayed state → 410 link_used', () =>
  run(async () => {
    let nonceHits = 0
    const h = zoomHarness({
      rpc: {
        consume_rate_limit: (args) => {
          const allowed = args.p_bucket !== 'oauth.state_nonce' ||
            ++nonceHits === 1
          return {
            data: [{ allowed, hits: 1, retry_after_seconds: allowed ? 0 : 60 }],
          }
        },
      },
    })
    const handler = createHandler(h.deps)
    const state = await signed()
    assertEquals(
      (await handler(post(URL_, { code: h.zoom.issueCode(), state }))).status,
      200,
    )
    const again = await handler(post(URL_, { code: h.zoom.issueCode(), state }))
    assertEquals([again.status, (await again.json()).error.code], [
      410,
      'link_used',
    ])
  }))

Deno.test('zoom-callback: a code Zoom refuses → 400 in French, nothing stored', () =>
  run(async () => {
    const h = zoomHarness()
    const res = await createHandler(h.deps)(
      post(URL_, { code: 'not-issued', state: await signed() }),
    )
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
    assert(body.error.message.startsWith('Zoom a refusé'))
    assertEquals(
      h.service.calls.some((c) => c.fn === 'store_zoom_connection'),
      false,
    )
  }))

Deno.test("zoom-callback: the database's refusal (an account connected for another professional) is passed on", () =>
  run(async () => {
    const h = zoomHarness({
      rpc: {
        store_zoom_connection: {
          error: {
            code: 'P0001',
            message:
              'Ce compte Zoom est déjà connecté pour un autre professionnel de la clinique.',
          },
        },
      },
    })
    const res = await createHandler(h.deps)(
      post(URL_, { code: h.zoom.issueCode(), state: await signed() }),
    )
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error.refusal, true)
  }))

Deno.test('zoom-callback: Zoom down → 502, nothing stored', () =>
  run(async () => {
    const h = zoomHarness()
    h.zoom.failures.push(503)
    const res = await createHandler(h.deps)(
      post(URL_, { code: h.zoom.issueCode(), state: await signed() }),
    )
    assertEquals(res.status, 502)
    assertEquals(
      h.service.calls.some((c) => c.fn === 'store_zoom_connection'),
      false,
    )
  }))
