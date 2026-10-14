import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { signState } from '../_shared/oauth-state.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { FAKE_ERROR_MARKER } from '../_shared/testing/fake-qbo.ts'
import {
  ADMIN_ID,
  ORG_ID,
  qboHarness,
  REDIRECT,
} from '../_shared/testing/qbo-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/qbo-callback'
const SECRET = 'local-dev-internal-function-secret'
const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer tok',
    },
    body: JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)

async function signed(
  h: ReturnType<typeof qboHarness>,
  over: { userId?: string; environment?: string } = {},
) {
  return (await signState(SECRET, {
    purpose: 'qbo_connect',
    orgId: ORG_ID,
    userId: over.userId ?? ADMIN_ID,
    data: { environment: over.environment ?? 'sandbox' },
  }, h.deps.now())).state
}

Deno.test('qbo-callback: a good return stores the company, its tokens never answered', () =>
  run(async () => {
    const h = qboHarness()
    const res = await createHandler(h.deps)(
      post({
        code: h.intuit.issueCode(REDIRECT),
        state: await signed(h),
        realm_id: h.intuit.realmId,
      }),
    )
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.company_name, 'Clinique MANA (bac à sable)')
    const store = h.service.calls.find((c) =>
      c.fn === 'store_qbo_connection'
    )!.args
    assertEquals([store.p_actor, store.p_realm_id, store.p_environment], [
      ADMIN_ID,
      h.intuit.realmId,
      'sandbox',
    ])
    assert(
      typeof store.p_refresh_token === 'string' &&
        typeof store.p_refresh_token_expires_at === 'string',
    )
    assertFalse(JSON.stringify(body).includes(String(store.p_access_token)))
  }))

Deno.test("qbo-callback: forged, expired or someone else's states are refused and spend nothing", () =>
  run(async () => {
    const h = qboHarness()
    const call = (state: string) =>
      createHandler(h.deps)(
        post({
          code: h.intuit.issueCode(REDIRECT),
          state,
          realm_id: h.intuit.realmId,
        }),
      )
    let res = await call('forged.state')
    assertEquals([res.status, (await res.json()).error.code], [
      410,
      'link_invalid',
    ])
    const old = await signed(h)
    h.advance(11 * 60_000)
    res = await call(old)
    assertEquals([res.status, (await res.json()).error.code], [
      410,
      'link_expired',
    ])
    res = await call(
      await signed(h, { userId: '00000000-0000-4000-8000-0000000000ff' }),
    )
    assertEquals(res.status, 403)
    res = await call(await signed(h, { environment: 'staging' }))
    assertEquals([res.status, (await res.json()).error.code], [
      410,
      'link_invalid',
    ])

    assertFalse(h.rpcNames().includes('store_qbo_connection'))
    assertFalse(h.rpcNames().includes('spend_oauth_state_nonce_for_service'))
  }))

Deno.test('qbo-callback: a state used once is refused when replayed, even minutes later; the check unavailable → 503', () =>
  run(async () => {
    const h = qboHarness()
    const handler = createHandler(h.deps)
    const state = await signed(h)
    const call = () =>
      handler(
        post({
          code: h.intuit.issueCode(REDIRECT),
          state,
          realm_id: h.intuit.realmId,
        }),
      )
    let res = await call()
    assertEquals(res.status, 200)
    for (const minutes of [0, 9]) {
      h.advance(minutes * 60_000)
      res = await call()
      assertEquals([res.status, (await res.json()).error.code], [
        410,
        'link_used',
      ])
    }
    assertEquals(
      h.rpcNames().filter((n) => n === 'store_qbo_connection').length,
      1,
    )

    const down = qboHarness({
      rpc: {
        spend_oauth_state_nonce_for_service: {
          error: { code: '22023', message: 'Arguments invalides.' },
        },
      },
    })
    await withEnv({ SENTRY_DSN: undefined }, async () => {
      await captureConsole('error', async () => {
        res = await createHandler(down.deps)(
          post({
            code: down.intuit.issueCode(REDIRECT),
            state: await signed(down),
            realm_id: down.intuit.realmId,
          }),
        )
      })
    })
    assertEquals([res.status, (await res.json()).error.code], [
      503,
      'not_configured',
    ])
    assertFalse(down.rpcNames().includes('store_qbo_connection'))
  }))

Deno.test('qbo-callback: a used code is a French refusal; a realm the token does not open is refused and revoked', () =>
  run(async () => {
    const h = qboHarness()
    const code = h.intuit.issueCode(REDIRECT)
    await createHandler(h.deps)(
      post({ code, state: await signed(h), realm_id: h.intuit.realmId }),
    )
    let res = await createHandler(h.deps)(
      post({ code, state: await signed(h), realm_id: h.intuit.realmId }),
    )
    let body = await res.json()
    assertEquals([res.status, body.error.refusal], [400, true])
    assert(body.error.message.startsWith('Intuit a refusé le code'))

    const other = qboHarness()
    const errors = await captureConsole('error', async () => {
      res = await createHandler(other.deps)(
        post({
          code: other.intuit.issueCode(REDIRECT),
          state: await signed(other),
          realm_id: '123',
        }),
      )
    })
    body = await res.json()
    assertEquals([res.status, body.error.refusal], [400, true])
    assertFalse(JSON.stringify(body).includes(FAKE_ERROR_MARKER))
    assertFalse(JSON.stringify(errors).includes(FAKE_ERROR_MARKER))
    assertEquals(
      other.intuit.calls.filter((c) => c.path === '/v2/oauth2/tokens/revoke')
        .length,
      1,
    )
    assertFalse(other.rpcNames().includes('store_qbo_connection'))
  }))

Deno.test('qbo-callback: another company while one is connected — the refusal passed on, the new grant revoked', () =>
  run(async () => {
    const h = qboHarness({ connected: true })
    h.state.connection!.realm = '42'
    const res = await createHandler(h.deps)(
      post({
        code: h.intuit.issueCode(REDIRECT),
        state: await signed(h),
        realm_id: h.intuit.realmId,
      }),
    )
    const body = await res.json()
    assertEquals([res.status, body.error.refusal], [400, true])
    assertEquals(
      h.intuit.calls.filter((c) => c.path === '/v2/oauth2/tokens/revoke')
        .length,
      1,
    )
  }))
