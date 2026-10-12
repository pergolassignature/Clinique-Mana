import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { signState } from '../_shared/oauth-state.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  ADMIN_ID,
  CONNECTION_ID,
  gmailHarness,
  initialState,
  MAILBOX,
  ORG_ID,
} from '../_shared/testing/gmail-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-callback'
const SECRET = 'local-dev-internal-function-secret'
const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

/** A harness with no connection yet (the flow creates it). */
const fresh = (over: Parameters<typeof gmailHarness>[0] = {}) =>
  gmailHarness({ state: initialState({ connection: null }), ...over })

async function signed(
  h: ReturnType<typeof gmailHarness>,
  over: { orgId?: string; userId?: string; purpose?: string; kind?: string } =
    {},
) {
  return (await signState(SECRET, {
    purpose: over.purpose ?? 'gmail_connect',
    orgId: over.orgId ?? ORG_ID,
    userId: over.userId ?? ADMIN_ID,
    data: { kind: over.kind ?? 'shared' },
  }, h.deps.now())).state
}

/** The env the shared helpers read themselves (`consume` hashes with the secret; CORS echoes the origin). */
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)
Deno.test('gmail-callback: the happy path stores the connection with its tokens and answers the mailbox only', () =>
  run(async () => {
    const h = fresh()
    const code = h.google.issueCode()
    const res = await createHandler(h.deps)(
      post({ code, state: await signed(h) }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      connection_id: CONNECTION_ID,
      email_address: MAILBOX,
    })
    const store = h.service.calls.find((c) => c.fn === 'store_mail_connection')!
    assertEquals(store.args.p_actor, ADMIN_ID)
    assertEquals(store.args.p_org_id, ORG_ID)
    assertEquals(store.args.p_email_address, MAILBOX)
    assertEquals(store.args.p_kind, 'shared')
    assert(String(store.args.p_access_token).startsWith('ya29.fake-'))
    assert(String(store.args.p_refresh_token).startsWith('1//fake-refresh-'))
    assertEquals(store.args.p_scopes, [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ])
    assertEquals(h.google.calls.map((c) => c.path), [
      '/token',
      '/gmail/v1/users/me/profile',
    ])
    const exchange = h.google.calls[0]
    assertEquals(exchange.status, 200)
    // The nonce was spent on its own bucket before Google was asked.
    const limits = h.service.calls.filter((c) => c.fn === 'consume_rate_limit')
      .map((c) => c.args.p_bucket)
    assertEquals(limits, ['gmail.callback_user', 'oauth.state_nonce'])
  }))

Deno.test("gmail-callback: a forged, expired or replayed state, or someone else's, is refused before Google is asked", () =>
  run(async () => {
    const h = fresh()
    const handler = createHandler(h.deps)
    const code = h.google.issueCode()
    const good = await signed(h)
    const forged = `${good.slice(0, -3)}xyz`
    let res = await handler(post({ code, state: forged }))
    assertEquals([res.status, (await res.json()).error.code], [
      410,
      'link_invalid',
    ])
    h.advance(11 * 60_000)
    res = await handler(post({ code, state: good }))
    assertEquals([res.status, (await res.json()).error.code], [
      410,
      'link_expired',
    ])
    h.advance(-11 * 60_000)
    res = await handler(
      post({
        code,
        state: await signed(h, {
          userId: '00000000-0000-4000-8000-0000000000b2',
        }),
      }),
    )
    assertEquals([res.status, (await res.json()).error.code], [
      403,
      'forbidden',
    ])
    res = await handler(
      post({
        code,
        state: await signed(h, {
          orgId: '00000000-0000-4000-8000-000000000002',
        }),
      }),
    )
    assertEquals(res.status, 403)
    res = await handler(
      post({ code, state: await signed(h, { purpose: 'zoom_connect' }) }),
    )
    assertEquals(res.status, 410)
    assertEquals(h.google.calls.length, 0)

    // A replay: the nonce bucket refuses the second hit.
    const replay = fresh({
      rpc: {
        consume_rate_limit: (args) => ({
          data: [
            args.p_bucket === 'oauth.state_nonce'
              ? { allowed: false, hits: 2, retry_after_seconds: 500 }
              : { allowed: true, hits: 1, retry_after_seconds: 0 },
          ],
        }),
      },
    })
    res = await createHandler(replay.deps)(
      post({ code: replay.google.issueCode(), state: await signed(replay) }),
    )
    assertEquals([res.status, (await res.json()).error.code], [
      410,
      'link_used',
    ])
    assertEquals(replay.google.calls.length, 0)
  }))

Deno.test('gmail-callback: a code Google refuses → a French refusal; a grant missing gmail.modify → a French refusal, nothing stored', () =>
  run(async () => {
    const h = fresh()
    const handler = createHandler(h.deps)
    let res = await handler(
      post({ code: '4/not-a-code', state: await signed(h) }),
    )
    assertEquals(res.status, 400)
    let body = await res.json()
    assertEquals(body.error.refusal, true)
    assert(String(body.error.message).startsWith('Google a refusé'))
    res = await handler(
      post({
        code: h.google.issueCode('https://www.googleapis.com/auth/gmail.send'),
        state: await signed(h),
      }),
    )
    assertEquals(res.status, 400)
    body = await res.json()
    assert(String(body.error.message).includes('accès demandés'))
    assertFalse(h.rpcNames().includes('store_mail_connection'))
    assertEquals(h.state.connection, null)
  }))

Deno.test("gmail-callback: the RPC's own refusal is passed on; no OAuth application → 503; a wrong client secret → 502 reported", () =>
  run(async () => {
    const refused = fresh({
      rpc: {
        store_mail_connection: {
          error: {
            code: 'P0001',
            message:
              'Cette boîte est déjà connectée comme boîte personnelle d’une autre personne.',
          },
        },
      },
    })
    let res = await createHandler(refused.deps)(
      post({ code: refused.google.issueCode(), state: await signed(refused) }),
    )
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error.refusal, true)

    const unset = fresh({
      state: initialState({
        connection: null,
        secrets: {
          google_oauth_client_id: null,
          google_oauth_client_secret: null,
          gmail_pubsub_token: null,
        },
      }),
    })
    res = await createHandler(unset.deps)(
      post({ code: 'x', state: await signed(unset) }),
    )
    assertEquals(res.status, 503)

    const wrong = fresh({
      state: initialState({
        connection: null,
        secrets: {
          google_oauth_client_id: 'other-client',
          google_oauth_client_secret: 'other',
          gmail_pubsub_token: null,
        },
      }),
    })
    const errors = await captureConsole('error', async () => {
      res = await createHandler(wrong.deps)(
        post({ code: wrong.google.issueCode(), state: await signed(wrong) }),
      )
    })
    assertEquals(res.status, 502)
    assert(JSON.stringify(errors).includes('token_provider_error'))
    assertFalse(
      JSON.stringify(errors).includes('FAKE-GOOGLE-ERROR-BODY'),
      "Google's error body is never reported",
    )
  }))
