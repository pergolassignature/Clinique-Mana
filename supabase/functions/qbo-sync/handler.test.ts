import { assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import {
  createHandler as refreshHandler,
  refreshOrg,
} from '../qbo-token-refresh/handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID, qboHarness } from '../_shared/testing/qbo-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/qbo-sync'
const post = (token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)

Deno.test('qbo-sync: gates — session, permission, module, the application, a connection', () =>
  run(async () => {
    assertEquals(
      (await createHandler(qboHarness().deps)(post(null))).status,
      401,
    )
    assertEquals(
      (await createHandler(qboHarness({ permissions: ['settings.view'] }).deps)(
        post(),
      )).status,
      403,
    )
    const notConfigured = qboHarness({ connected: true })
    notConfigured.state.secrets.qbo_client_id = null
    assertEquals((await createHandler(notConfigured.deps)(post())).status, 503)
    const res = await createHandler(qboHarness().deps)(post())
    assertEquals([res.status, (await res.json()).error.code], [
      404,
      'not_found',
    ])
  }))

Deno.test('qbo-sync: one pass answers counts only; a dead grant is 409', () =>
  run(async () => {
    const h = qboHarness({ connected: true })
    const errors = await captureConsole('error', async () => {
      const res = await createHandler(h.deps)(post())
      assertEquals(await res.json(), {
        status: 'ok',
        accounts: 10,
        customers: 6,
        matched: 6,
        pending: false,
      })
    })
    assertFalse(JSON.stringify(errors).includes('@example.test'))
    assertEquals(
      h.service.calls.filter((c) => c.fn === 'consume_rate_limit')[0].args
        .p_bucket,
      'qbo.sync_user',
    )

    const dead = qboHarness({ connected: true })
    dead.intuit.revokeAll()
    dead.state.connection!.expiresAt = '2026-10-13T12:01:00.000Z'
    const res = await createHandler(dead.deps)(post())
    assertEquals([res.status, (await res.json()).error.code], [409, 'conflict'])
    assertEquals(dead.state.connection!.status, 'needs_reconnect')
  }))

Deno.test('qbo-token-refresh: rotates daily; no connection says so; a dead grant fails the run', async () => {
  const h = qboHarness({ connected: true })
  const before = h.state.connection!.refresh
  const signal = new AbortController().signal
  assertEquals(
    await refreshOrg(h.deps)(ORG_ID, h.service.client, signal),
    'Connexion renouvelée',
  )
  assertFalse(h.state.connection!.refresh === before)

  const none = qboHarness()
  assertEquals(
    await refreshOrg(none.deps)(ORG_ID, none.service.client, signal),
    'Aucune connexion QuickBooks',
  )

  const dead = qboHarness({ connected: true })
  dead.intuit.revokeAll()
  let code: unknown = null
  try {
    await refreshOrg(dead.deps)(ORG_ID, dead.service.client, signal)
  } catch (error) {
    code = (error as { code?: unknown }).code
  }
  assertEquals(code, 'needs_reconnect')

  // The job refuses an unsigned call (runJob: X-Job-Signature, never a bearer key).
  const res = await refreshHandler(h.deps)(
    new Request('http://fn.test/functions/v1/qbo-token-refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer service-role-key' },
      body: '{}',
    }),
  )
  assertEquals(res.status, 401)
})
