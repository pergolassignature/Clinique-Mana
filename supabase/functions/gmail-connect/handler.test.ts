import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { verifyState } from '../_shared/oauth-state.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  ADMIN_ID,
  CONNECTION_ID,
  gmailHarness,
  initialState,
  ORG_ID,
} from '../_shared/testing/gmail-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-connect'
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

/** The env the shared helpers read themselves (`consume` hashes with the secret; CORS echoes the origin). */
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)
Deno.test('gmail-connect: method, auth, module and permission gates, body', () =>
  run(async () => {
    const h = gmailHarness()
    const handler = createHandler(h.deps)
    assertEquals((await handler(new Request(URL_))).status, 405)
    assertEquals((await handler(post({ action: 'start' }, null))).status, 401)
    const noModule = createHandler(gmailHarness({ modules: [] }).deps)
    assertEquals((await noModule(post({ action: 'start' }))).status, 403)
    const noPermission = createHandler(
      gmailHarness({ permissions: ['communications.inbox'] }).deps,
    )
    assertEquals((await noPermission(post({ action: 'start' }))).status, 403)
    assertEquals((await handler(post({ action: 'nope' }))).status, 400)
    assertEquals((await handler(post('{not json'))).status, 400)
    assertEquals(h.service.calls.length, 0, 'nothing reached the database')
  }))

Deno.test('gmail-connect: start → the consent URL with the two scopes, the fixed redirect and a signed state for the caller', () =>
  run(async () => {
    const h = gmailHarness()
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 200)
    const { url } = await res.json() as { url: string }
    const parsed = new URL(url)
    assertEquals(
      parsed.origin,
      'http://127.0.0.1:55392',
      'the consent page as the browser reaches it',
    )
    assertEquals(parsed.pathname, '/o/oauth2/v2/auth')
    assertEquals(
      parsed.searchParams.get('redirect_uri'),
      'http://localhost:5173/courriels/retour-google',
    )
    assertEquals(
      parsed.searchParams.get('scope'),
      'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
    )
    assertEquals(parsed.searchParams.get('access_type'), 'offline')
    assertEquals(parsed.searchParams.get('prompt'), 'consent')
    assertEquals(parsed.searchParams.get('response_type'), 'code')
    const state = await verifyState(
      'local-dev-internal-function-secret',
      parsed.searchParams.get('state')!,
      'gmail_connect',
      h.deps.now(),
    )
    assert(state.ok)
    assertEquals([state.state.orgId, state.state.userId, state.state.data], [
      ORG_ID,
      ADMIN_ID,
      { kind: 'shared' },
    ])
    assertEquals(h.rpcNames(), [
      'consume_rate_limit',
      'get_org_secret',
      'get_org_secret',
    ])
    assertEquals(h.service.calls[0].args.p_bucket, 'gmail.connect_user')
    assertFalse(url.includes('client-secret'), 'the client secret never leaves')
  }))

Deno.test("gmail-connect: on a hosted project the URL is Google's, and a stray fake base URL is ignored", async () => {
  const h = gmailHarness({ env: { APP_URL: 'https://app.cliniquemana.com' } })
  const res = await createHandler(h.deps)(
    post({ action: 'start', kind: 'personal' }),
  )
  const { url } = await res.json() as { url: string }
  assert(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  assert(
    url.includes(
      'redirect_uri=https%3A%2F%2Fapp.cliniquemana.com%2Fcourriels%2Fretour-google',
    ),
  )
})

Deno.test('gmail-connect: no OAuth application → 503 not_configured; no usable APP_URL → 500', () =>
  run(async () => {
    const h = gmailHarness({
      state: initialState({
        secrets: {
          google_oauth_client_id: null,
          google_oauth_client_secret: 'x',
          gmail_pubsub_token: null,
        },
      }),
    })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 503)
    assertEquals((await res.json()).error.code, 'not_configured')
    const bad = gmailHarness({ env: { APP_URL: 'http://evil.test' } })
    await captureConsole('error', async () => {
      assertEquals(
        (await createHandler(bad.deps)(post({ action: 'start' }))).status,
        500,
      )
    })
  }))

Deno.test('gmail-connect: disconnect stops the watch, revokes the grant at Google and marks the row; a second call → 404', () =>
  run(async () => {
    const h = gmailHarness()
    const handler = createHandler(h.deps)
    const res = await handler(
      post({ action: 'disconnect', connection_id: CONNECTION_ID }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { ok: true, revoked: true })
    assertEquals(h.google.calls.map((c) => c.path), [
      '/gmail/v1/users/me/stop',
      '/revoke',
    ])
    assert(h.google.grants.get('1//fake-refresh-initial')!.revoked)
    assertEquals(h.state.connection!.status, 'disconnected')
    const disconnect = h.service.calls.find((c) =>
      c.fn === 'disconnect_mail_connection'
    )!
    assertEquals(disconnect.args, {
      p_actor: ADMIN_ID,
      p_org_id: ORG_ID,
      p_connection_id: CONNECTION_ID,
    })
    assertEquals(
      (await handler(
        post({ action: 'disconnect', connection_id: CONNECTION_ID }),
      )).status,
      404,
    )
  }))

Deno.test('gmail-connect: the rate limit answers 429 before Google is asked', () =>
  run(async () => {
    const h = gmailHarness({
      rpc: {
        consume_rate_limit: {
          data: [{ allowed: false, hits: 21, retry_after_seconds: 120 }],
        },
      },
    })
    const res = await createHandler(h.deps)(post({ action: 'start' }))
    assertEquals(res.status, 429)
    assertEquals(res.headers.get('Retry-After'), '120')
    assertEquals(h.google.calls.length, 0)
  }))
