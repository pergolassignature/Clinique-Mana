import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  gmailHarness,
  MAILBOX,
  NOW,
  ORG_ID,
  PUSH_ACCOUNT,
  PUSH_SIGNER,
} from '../_shared/testing/gmail-fixtures.ts'
import { pushClaims } from '../_shared/testing/google-oidc-signer.ts'
import { pushAudience } from '../_shared/gmail/env.ts'

const BASE = 'http://fn.test/functions/v1/gmail-webhook'
const url = (org = ORG_ID) => `${BASE}?org=${org}`
const nowS = Date.parse(NOW) / 1000
/** The token Pub/Sub puts on a push to the clinic's endpoint. */
const TOKEN = await PUSH_SIGNER.sign(
  pushClaims(pushAudience(ORG_ID), PUSH_ACCOUNT, nowS),
)

/** A Pub/Sub push body for `emailAddress`. */
function push(
  emailAddress = MAILBOX,
  messageId = 'pubsub-1',
  historyId = '12345',
): string {
  const data = btoa(JSON.stringify({ emailAddress, historyId }))
  return JSON.stringify({
    message: { data, messageId, publishTime: '2026-10-12T15:00:00Z' },
    subscription: 'projects/x/subscriptions/y',
  })
}
const post = (
  body: string,
  target = url(),
  token: string | null = TOKEN,
) =>
  new Request(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body,
  })
/** Google's calls but the keys' (read once, then cached by the verifier). */
const apiCalls = (calls: { path: string }[]) =>
  calls.filter((c) => c.path !== '/oauth2/v3/certs')

/** The env the shared helpers read themselves (`consume` hashes with the secret; CORS echoes the origin). */
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)
Deno.test('gmail-webhook: method, org, token, size and payload checks before anything is read', () =>
  run(async () => {
    const h = gmailHarness()
    const handler = createHandler(h.deps)
    assertEquals((await handler(new Request(url()))).status, 405)
    assertEquals((await handler(post(push(), url('nope')))).status, 400)
    assertEquals((await handler(post(push(), url(), null))).status, 401)
    assertEquals(h.service.calls.length, 0)
    assertEquals((await handler(post('x'.repeat(64 * 1024 + 1)))).status, 413)
    assertEquals((await handler(post('{not json'))).status, 400)
    assertEquals(
      (await handler(
        post(
          JSON.stringify({
            message: { data: btoa('{"nope":1}'), messageId: '1' },
          }),
        ),
      )).status,
      400,
    )
    assertFalse(h.rpcNames().includes('claim_webhook_event'))
  }))

Deno.test("gmail-webhook: one hit per IP, then Google's signed token for the clinic's service account and audience; anything else → 401", () =>
  run(async () => {
    const h = gmailHarness()
    const handler = createHandler(h.deps)
    const forged = `${TOKEN.slice(0, -4)}AAAA`
    const req = post(push(), url(), forged)
    req.headers.set('x-forwarded-for', '198.51.100.7, 203.0.113.9')
    await captureConsole('warn', async () => {
      assertEquals((await handler(req)).status, 401)
    })
    assertEquals(h.rpcNames(), [
      'consume_rate_limit',
      'get_communications_settings_for_org',
    ])
    assertEquals(h.service.calls[0].args.p_bucket, 'webhooks.gmail_ip')

    // Another audience (another clinic's subscription), another service account, expired.
    for (
      const over of [
        { aud: pushAudience('00000000-0000-4000-8000-000000000002') },
        { email: 'someone@other-project.iam.gserviceaccount.com' },
        { exp: nowS - 600 },
      ]
    ) {
      const warned = await captureConsole('warn', async () => {
        assertEquals(
          (await handler(post(push(), url(), await h.pushToken(over))))
            .status,
          401,
        )
      })
      assertFalse(
        JSON.stringify(warned).includes('eyJ'),
        'the token never reaches a log',
      )
    }
    assertFalse(h.rpcNames().includes('claim_webhook_event'))

    // No service account set: fail closed.
    const none = gmailHarness()
    none.state.settings.pubsub_service_account = null
    await captureConsole('warn', async () => {
      assertEquals((await createHandler(none.deps)(post(push()))).status, 401)
    })
    const limited = gmailHarness({
      rpc: {
        consume_rate_limit: {
          data: [{ allowed: false, hits: 601, retry_after_seconds: 30 }],
        },
      },
    })
    const res = await createHandler(limited.deps)(post(push()))
    assertEquals([res.status, res.headers.get('Retry-After')], [429, '30'])
    assertEquals(
      limited.rpcNames(),
      ['consume_rate_limit'],
      'the settings were never read',
    )
  }))

Deno.test('gmail-webhook: a push for a connected mailbox syncs it inline and completes the claim', () =>
  run(async () => {
    const h = gmailHarness()
    h.google.deliver({
      from: 'a@example.test',
      subject: 'Nouveau',
      text: 'bonjour',
    })
    const res = await createHandler(h.deps)(post(push()))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { outcome: 'synced' })
    assertEquals(h.state.upserted.length, 1)
    const claim = h.service.calls.find((c) => c.fn === 'claim_webhook_event')!
    assertEquals(claim.args.p_provider, 'gmail')
    assertEquals(claim.args.p_event_id, `${ORG_ID}:pubsub-1`)
    assertEquals(claim.args.p_payload, { message_id: 'pubsub-1' })
    assert(h.rpcNames().includes('complete_webhook_event'))
    assertFalse(
      JSON.stringify(
        h.service.calls.find((c) => c.fn === 'claim_webhook_event')!.args,
      ).includes(MAILBOX),
      'no address in the claim',
    )
  }))

Deno.test('gmail-webhook: a mailbox not connected here is acked as unknown; a disabled module is acked as ignored; a duplicate is acked', () =>
  run(async () => {
    const h = gmailHarness()
    let res = await createHandler(h.deps)(post(push('other@clinique.test')))
    assertEquals(await res.json(), { outcome: 'unknown_mailbox' })
    assertEquals(apiCalls(h.google.calls).length, 0)

    const off = gmailHarness({
      rpc: { module_enabled_for_org: { data: false } },
    })
    res = await createHandler(off.deps)(post(push()))
    assertEquals(await res.json(), { outcome: 'ignored' })
    assertFalse(off.rpcNames().includes('claim_webhook_event'))

    const dup = gmailHarness({
      rpc: { claim_webhook_event: { data: [{ status: 'duplicate' }] } },
    })
    res = await createHandler(dup.deps)(post(push()))
    assertEquals(await res.json(), { outcome: 'duplicate' })
    const busy = gmailHarness({
      rpc: { claim_webhook_event: { data: [{ status: 'in_progress' }] } },
    })
    assertEquals((await createHandler(busy.deps)(post(push()))).status, 409)
  }))

Deno.test('gmail-webhook: a sync under another lease fails the claim with 503 (Pub/Sub redelivers), a provider failure fails it with 500', () =>
  run(async () => {
    const h = gmailHarness()
    h.state.sync.lease_token = '00000000-0000-4000-8000-00000000beef'
    h.state.sync.lease_until = Date.parse('2026-10-12T15:04:00.000Z')
    let res = await createHandler(h.deps)(post(push()))
    assertEquals(res.status, 503)
    assert(h.state.sync.sync_requested_at !== null)
    assertFalse(h.rpcNames().includes('complete_webhook_event'))
    assertEquals(
      h.service.calls.find((c) => c.fn === 'fail_webhook_event')!.args.p_error,
      'lease_held',
    )

    const down = gmailHarness()
    down.deps.fetch = (() =>
      Promise.reject(new TypeError('refused'))) as unknown as typeof fetch
    await captureConsole('error', async () => {
      res = await createHandler(down.deps)(post(push()))
    })
    assertEquals(res.status, 500)
    const failed = down.service.calls.find((c) =>
      c.fn === 'fail_webhook_event'
    )!
    assertEquals(failed.args.p_error, 'gmail_unreachable')
  }))
