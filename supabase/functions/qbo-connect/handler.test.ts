import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { verifyState } from '../_shared/oauth-state.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  ADMIN_ID,
  ORG_ID,
  qboHarness,
  REDIRECT,
} from '../_shared/testing/qbo-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/qbo-connect'
const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)

Deno.test('qbo-connect: gates — session, permission, module, body', () =>
  run(async () => {
    assertEquals(
      (await createHandler(qboHarness().deps)(post({ action: 'start' }, null)))
        .status,
      401,
    )
    assertEquals(
      (await createHandler(qboHarness({ permissions: ['settings.view'] }).deps)(
        post({ action: 'start' }),
      )).status,
      403,
    )
    assertEquals(
      (await createHandler(qboHarness({ modules: [] }).deps)(
        post({ action: 'start' }),
      )).status,
      403,
    )
    const h = qboHarness()
    for (
      const bad of [{ action: 'nope' }, {
        action: 'start',
        environment: 'staging',
      }, { action: 'start', extra: 1 }]
    ) {
      assertEquals((await createHandler(h.deps)(post(bad))).status, 400)
    }
  }))

Deno.test("qbo-connect: start answers Intuit's consent page with a signed state for this person and environment", () =>
  run(async () => {
    const h = qboHarness()
    const res = await createHandler(h.deps)(
      post({ action: 'start', environment: 'sandbox' }),
    )
    assertEquals(res.status, 200)
    const url = new URL((await res.json()).url)
    assertEquals(
      url.origin + url.pathname,
      'http://127.0.0.1:55395/connect/oauth2',
    )
    assertEquals(url.searchParams.get('client_id'), 'local-dev-qbo-client-id')
    assertEquals(
      url.searchParams.get('scope'),
      'com.intuit.quickbooks.accounting',
    )
    assertEquals(url.searchParams.get('redirect_uri'), REDIRECT)
    assertEquals(url.searchParams.get('response_type'), 'code')
    const state = await verifyState(
      'local-dev-internal-function-secret',
      url.searchParams.get('state')!,
      'qbo_connect',
      h.deps.now(),
    )
    assert(state.ok)
    assertEquals([
      state.state.orgId,
      state.state.userId,
      state.state.data?.environment,
    ], [ORG_ID, ADMIN_ID, 'sandbox'])
    assertFalse(url.toString().includes('secret'))

    h.state.secrets.qbo_client_secret = null
    const missing = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals([missing.status, (await missing.json()).error.code], [
      503,
      'not_configured',
    ])
  }))

Deno.test('qbo-connect: disconnect revokes at Intuit, then deletes the tokens; twice is 404', () =>
  run(async () => {
    const h = qboHarness({ connected: true })
    const refresh = h.state.connection!.refresh
    const res = await createHandler(h.deps)(post({ action: 'disconnect' }))
    assertEquals(await res.json(), { ok: true, revoked: true })
    assert(h.intuit.isRevoked(refresh))
    assertEquals(h.state.connection!.status, 'disconnected')
    assertEquals(
      h.service.calls.find((c) => c.fn === 'disconnect_qbo_connection')!.args
        .p_actor,
      ADMIN_ID,
    )
    assertEquals(
      (await createHandler(h.deps)(post({ action: 'disconnect' }))).status,
      404,
    )
  }))
