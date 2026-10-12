import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  gmailHarness,
  initialState,
  MAILBOX,
  ORG_ID,
  PUBSUB_TOKEN,
} from '../_shared/testing/gmail-fixtures.ts'

const BASE = 'http://fn.test/functions/v1/gmail-webhook'
const url = (org = ORG_ID, token: string | null = PUBSUB_TOKEN) =>
  `${BASE}?org=${org}${
    token === null ? '' : `&token=${encodeURIComponent(token)}`
  }`

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
const post = (body: string, target = url()) =>
  new Request(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

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
    assertEquals((await handler(post(push(), url(ORG_ID, null)))).status, 401)
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

Deno.test("gmail-webhook: one hit per IP, then the org's token compared timing-safe; missing or wrong → 401", () =>
  run(async () => {
    const compared: [string, string][] = []
    const h = gmailHarness()
    const handler = createHandler(h.deps, {
      timingSafeEqual: (a, b) => {
        compared.push([a, b])
        return a === b
      },
    })
    const req = post(push(), url(ORG_ID, 'wrong'))
    req.headers.set('x-forwarded-for', '198.51.100.7, 203.0.113.9')
    assertEquals((await handler(req)).status, 401)
    assertEquals(h.rpcNames(), ['consume_rate_limit', 'get_org_secret'])
    assertEquals(h.service.calls[0].args.p_bucket, 'webhooks.gmail_ip')
    assertEquals(compared, [['wrong', PUBSUB_TOKEN]])

    const none = gmailHarness({
      state: initialState({
        secrets: {
          google_oauth_client_id: null,
          google_oauth_client_secret: null,
          gmail_pubsub_token: null,
        },
      }),
    })
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
      'the secret was never read',
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
    assertEquals(h.google.calls.length, 0)

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

Deno.test('gmail-webhook: a sync under another lease is acked as skipped (the request stays), a provider failure fails the claim with 500', () =>
  run(async () => {
    const h = gmailHarness()
    h.state.sync.lease_token = '00000000-0000-4000-8000-00000000beef'
    h.state.sync.lease_until = Date.parse('2026-10-12T15:04:00.000Z')
    let res = await createHandler(h.deps)(post(push()))
    assertEquals(await res.json(), { outcome: 'skipped' })
    assert(h.state.sync.sync_requested_at !== null)
    assert(h.rpcNames().includes('complete_webhook_event'))

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
