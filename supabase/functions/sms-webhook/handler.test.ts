import { assert, assertEquals } from '@std/assert'
import { createHandler, yeastarEventId } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import type { SmsTransport } from '../_shared/sms/transport.ts'
import { SmsTransportError } from '../_shared/sms/transport.ts'
import {
  normalizeMessageEvent,
  signYeastarBody,
} from '../_shared/sms/webhook.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fakeYeastar, signedWebhook } from '../_shared/testing/fake-yeastar.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'

const SECRET = 'local-test-yeastar-webhook-secret'
const URL_ = `http://fn.test/functions/v1/sms-webhook?org=${ORG_ID}`
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const MESSAGE_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const ACK_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5f'
const EVENT_ID = '7a2d2c3f-4e5b-4c6d-9e0f-1a2b3c4d5e6f'
const CLAIM_TOKEN = '8b3e3d40-5f6c-4d7e-8f10-2b3c4d5e6f70'
const FROM = '+15145551234'

function setup(
  options: {
    secret?: string | null
    known?: RpcRoute
    rpc?: Record<string, RpcRoute>
    transport?: Partial<SmsTransport>
    limit?: { allowed: boolean; hits: number; retry_after_seconds: number }
  } = {},
) {
  const sent: Array<{ orgId: string; to: string; body: string }> = []
  const owners: number[] = []
  const transport: SmsTransport = {
    send: (orgId, text) => {
      sent.push({ orgId, to: text.to, body: text.body })
      return Promise.resolve({ msgId: 10500, sessionId: 3100 })
    },
    sessionOwner: (_orgId, sessionId) => {
      owners.push(sessionId)
      return Promise.resolve({ ours: true })
    },
    ...options.transport,
  }
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [options.limit ?? ALLOWED] },
      get_org_secret: {
        data: options.secret === undefined ? SECRET : options.secret,
      },
      sms_event_known_for_service: options.known ?? { data: 'session' },
      claim_webhook_event: {
        data: [{ status: 'claimed', id: EVENT_ID, claim_token: CLAIM_TOKEN }],
      },
      complete_webhook_event: { data: true },
      fail_webhook_event: { data: true },
      record_inbound_sms: {
        data: { outcome: 'recorded', message_id: MESSAGE_ID, keyword: null },
      },
      apply_sms_delivery_event: { data: 'applied' },
      mark_sms_sent: { data: null },
      mark_sms_failed: { data: null },
      ...options.rpc,
    },
  })
  const deps: Deps = {
    env: (key) => key === 'APP_URL' ? 'http://localhost:5173' : undefined,
    fetch: () => Promise.reject(new Error('no network in this test')),
    now: fixedClock('2027-03-10T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => {
      throw new Error('no user client in a webhook')
    },
  }
  const inner = createHandler(deps, { transport: () => transport })
  // `consume` (the per-IP limit) reads its HMAC key from the env.
  const handler = async (req: Request): Promise<Response> => {
    let res!: Response
    await withEnv(
      {
        INTERNAL_FUNCTION_SECRET: 'local-dev-test-secret',
        SENTRY_DSN: undefined,
      },
      async () => {
        res = await inner(req)
      },
    )
    return res
  }
  return { handler, service, sent, owners }
}

/** The calls after the per-IP limit. */
const rpcNames = (s: ReturnType<typeof setup>) =>
  s.service.calls.map((c) => c.fn).filter((fn) => fn !== 'consume_rate_limit')
const argsOf = (s: ReturnType<typeof setup>, fn: string) =>
  s.service.calls.find((c) => c.fn === fn)?.args

async function outcome(res: Response) {
  return { status: res.status, ...(await res.json().catch(() => ({}))) }
}

const pbx = fakeYeastar()
const inbound = (body = 'Bonjour', msgId = 20_001, sessionId = 3_001) =>
  pbx.inboundEvent({ from: FROM, body, msgId, sessionId })

Deno.test('sms-webhook: an inbound text from the clinic session → record_inbound_sms, claimed and completed', async () => {
  const s = setup()
  const res = await s.handler(await signedWebhook(URL_, inbound(), SECRET))
  assertEquals(await outcome(res), { status: 200, outcome: 'recorded' })
  assertEquals(rpcNames(s), [
    'get_org_secret',
    'sms_event_known_for_service',
    'claim_webhook_event',
    'record_inbound_sms',
    'complete_webhook_event',
  ])
  const claim = argsOf(s, 'claim_webhook_event')!
  assertEquals(claim.p_provider, 'yeastar')
  assertEquals(claim.p_event_id, `${ORG_ID}:30031:20001`)
  assertEquals(claim.p_event_type, '30031')
  assertEquals(
    claim.p_payload,
    { type: 30031, msg_id: 20001, session_id: 3001, delivery_status: 1 },
    'ids only: never the number or the body',
  )
  const recorded = argsOf(s, 'record_inbound_sms')!
  assertEquals(recorded.p_org_id, ORG_ID)
  assertEquals(recorded.p_from, FROM)
  assertEquals(recorded.p_body, 'Bonjour')
  assertEquals(recorded.p_provider_msg_id, 20001)
  assertEquals(recorded.p_provider_session_id, 3001)
  assertEquals(s.owners, [], 'a known session needs no PBX lookup')
})

Deno.test('sms-webhook: « ARRÊT » → the acknowledgement the RPC claimed is sent at once and marked sent', async () => {
  const s = setup({
    rpc: {
      record_inbound_sms: {
        data: {
          outcome: 'recorded',
          message_id: MESSAGE_ID,
          keyword: 'stop',
          ack: {
            id: ACK_ID,
            to_e164: FROM,
            body: 'Vous ne recevrez plus de textos.',
            request_id: `mana-${ACK_ID}`,
          },
        },
      },
    },
  })
  const res = await s.handler(
    await signedWebhook(URL_, inbound('ARRÊT'), SECRET),
  )
  assertEquals(await outcome(res), { status: 200, outcome: 'recorded' })
  assertEquals(s.sent, [{
    orgId: ORG_ID,
    to: FROM,
    body: 'Vous ne recevrez plus de textos.',
  }])
  assertEquals(argsOf(s, 'mark_sms_sent')!.p_id, ACK_ID)
  assertEquals(rpcNames(s).at(-1), 'complete_webhook_event')
})

Deno.test('sms-webhook: an acknowledgement the PBX refuses is marked failed; the withdrawal stands (200)', async () => {
  const s = setup({
    transport: {
      send: () => Promise.reject(new SmsTransportError('provider_rejected')),
    },
    rpc: {
      record_inbound_sms: {
        data: {
          outcome: 'recorded',
          message_id: MESSAGE_ID,
          keyword: 'stop',
          ack: {
            id: ACK_ID,
            to_e164: FROM,
            body: 'x',
            request_id: `mana-${ACK_ID}`,
          },
        },
      },
    },
  })
  const lines = await captureConsole('error', async () => {
    const res = await s.handler(
      await signedWebhook(URL_, inbound('STOP'), SECRET),
    )
    assertEquals(await outcome(res), { status: 200, outcome: 'recorded' })
  })
  assertEquals(argsOf(s, 'mark_sms_failed')!.p_error_code, 'provider_rejected')
  assertEquals(lines.length, 1)
  const report = JSON.parse(String(lines[0][0]))
  assertEquals(report.code, 'sms_provider_rejected')
  assertEquals(report.ids, { org_id: ORG_ID, sms_message_id: ACK_ID })
  assert(!String(lines[0][0]).includes(FROM), 'never the number')
})

Deno.test('sms-webhook: a delivery report → apply_sms_delivery_event (sent / failed with the PBX code); the claim id carries the status', async () => {
  const ok = setup({ known: { data: 'message' } })
  const delivered = await ok.handler(
    await signedWebhook(
      URL_,
      pbx.deliveryEvent({ msgId: 10325, status: 1, sessionId: 3089 }),
      SECRET,
    ),
  )
  assertEquals(await outcome(delivered), { status: 200, outcome: 'applied' })
  assertEquals(argsOf(ok, 'apply_sms_delivery_event'), {
    p_org_id: ORG_ID,
    p_provider_msg_id: 10325,
    p_status: 'sent',
    p_error_code: null,
  })
  assertEquals(
    argsOf(ok, 'claim_webhook_event')!.p_event_id,
    `${ORG_ID}:30032:10325:1`,
  )

  const ko = setup({ known: { data: 'message' } })
  await ko.handler(
    await signedWebhook(
      URL_,
      pbx.deliveryEvent({ msgId: 10326, status: 2, error: 'Invalid Phone' }),
      SECRET,
    ),
  )
  assertEquals(argsOf(ko, 'apply_sms_delivery_event')!.p_status, 'failed')
  assertEquals(
    argsOf(ko, 'apply_sms_delivery_event')!.p_error_code,
    'invalid_phone',
  )
})

Deno.test('sms-webhook: SM-13, an event the clinic does not hold → its session is asked of the PBX; another tenant → ignored, nothing claimed', async () => {
  const foreign = setup({
    known: { data: 'none' },
    transport: {
      sessionOwner: () => Promise.resolve({ ours: false }),
    },
  })
  const res = await foreign.handler(
    await signedWebhook(URL_, inbound('Bonjour', 20_002, 4_444), SECRET),
  )
  assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
  assertEquals(rpcNames(foreign), [
    'get_org_secret',
    'sms_event_known_for_service',
  ])

  const ours = setup({ known: { data: 'none' } })
  const kept = await ours.handler(
    await signedWebhook(URL_, inbound('Bonjour', 20_003, 4_445), SECRET),
  )
  assertEquals(await outcome(kept), { status: 200, outcome: 'recorded' })
  assertEquals(ours.owners, [4445])

  // A delivery report of a text the clinic never sent: no lookup, no claim.
  const report = setup({ known: { data: 'none' } })
  const unknown = await report.handler(
    await signedWebhook(
      URL_,
      pbx.deliveryEvent({ msgId: 99, status: 1, sessionId: 4_446 }),
      SECRET,
    ),
  )
  assertEquals(await outcome(unknown), { status: 200, outcome: 'ignored' })
  assertEquals(report.owners, [])
  assertEquals(rpcNames(report), [
    'get_org_secret',
    'sms_event_known_for_service',
  ])
})

Deno.test('sms-webhook: SM-13, a clinic that cannot ask its PBX → ignored and reported once; a PBX outage → 500', async () => {
  const unset = setup({
    known: { data: 'none' },
    transport: {
      sessionOwner: () =>
        Promise.reject(new SmsTransportError('not_configured')),
    },
  })
  const lines = await captureConsole('error', async () => {
    for (const id of [20_010, 20_011]) {
      const res = await unset.handler(
        await signedWebhook(URL_, inbound('x', id, 5_000 + id), SECRET),
      )
      assertEquals(await outcome(res), { status: 200, outcome: 'ignored' })
    }
  })
  assertEquals(lines.length, 1, 'once an hour per org')
  assertEquals(JSON.parse(String(lines[0][0])).code, 'sms_inbound_unverifiable')
  assertEquals(rpcNames(unset).includes('claim_webhook_event'), false)

  const down = setup({
    known: { data: 'none' },
    transport: {
      sessionOwner: () =>
        Promise.reject(new SmsTransportError('provider_unreachable')),
    },
  })
  await captureConsole('error', async () => {
    const res = await down.handler(
      await signedWebhook(URL_, inbound('x', 20_020, 6_000), SECRET),
    )
    assertEquals(res.status, 500)
  })
  assertEquals(rpcNames(down).includes('claim_webhook_event'), false)
})

Deno.test('sms-webhook: our own echo, a bulk failure, an unknown delivery status, a test push and a call event → acked, nothing claimed', async () => {
  const echo = {
    type: 30031,
    sn: 'x',
    msg: {
      msg_id: 1,
      session_id: 2,
      msg_body: 'x',
      sender: { user_type: 9, user_no: 'api' },
    },
  }
  const cases: [string, unknown, string][] = [
    ['echo', echo, 'echo'],
    ['bulk', { type: 30030, sn: 'x', msg: { msg_id: 5 } }, 'skipped'],
    [
      'status 0',
      { type: 30032, sn: 'x', msg: { msg_id: 6, delivery_status: 0 } },
      'skipped',
    ],
    ['test', { event: 'test' }, 'skipped'],
    ['call', { type: 30011, sn: 'x', msg: { call_id: '1' } }, 'skipped'],
    ['no msg id', { type: 30031, sn: 'x', msg: { msg_body: 'x' } }, 'skipped'],
  ]
  for (const [label, envelope, expected] of cases) {
    const s = setup()
    const res = await s.handler(await signedWebhook(URL_, envelope, SECRET))
    assertEquals(await outcome(res), { status: 200, outcome: expected }, label)
    assertEquals(rpcNames(s), ['get_org_secret'], label)
  }
})

Deno.test('sms-webhook: method, org hint, signature header, size and encoding come before any read', async () => {
  const s = setup()
  assertEquals(
    (await s.handler(new Request(URL_, { method: 'GET' }))).status,
    405,
  )
  assertEquals(
    (await s.handler(
      await signedWebhook(
        'http://fn.test/functions/v1/sms-webhook?org=nope',
        inbound(),
        SECRET,
      ),
    )).status,
    400,
  )
  const unsigned = new Request(URL_, {
    method: 'POST',
    body: JSON.stringify(inbound()),
  })
  assertEquals((await s.handler(unsigned)).status, 401)
  const huge = new Request(URL_, {
    method: 'POST',
    headers: { 'X-Signature': 'x' },
    body: 'x'.repeat(70 * 1024),
  })
  assertEquals((await s.handler(huge)).status, 413)
  const latin1 = new Request(URL_, {
    method: 'POST',
    headers: { 'X-Signature': 'x' },
    body: new Uint8Array([0xff, 0xfe, 0x41]),
  })
  assertEquals((await s.handler(latin1)).status, 400)
  assertEquals(s.service.calls, [], 'not even the rate limit')
})

Deno.test('sms-webhook: a wrong signature → 401, nothing past the secret; a malformed body → 400', async () => {
  const s = setup()
  const forged = await signedWebhook(URL_, inbound(), 'another-secret')
  assertEquals((await s.handler(forged)).status, 401)
  assertEquals(rpcNames(s), ['get_org_secret'])
  assertEquals(argsOf(s, 'get_org_secret'), {
    p_org_id: ORG_ID,
    p_key: 'yeastar_webhook_secret',
  })
  const body = 'not json'
  const bad = new Request(URL_, {
    method: 'POST',
    headers: { 'X-Signature': await signYeastarBody(body, SECRET) },
    body,
  })
  assertEquals((await s.handler(bad)).status, 400)
})

Deno.test('sms-webhook: no secret for the org → 401, reported once an hour; a secret read error → 500', async () => {
  const s = setup({ secret: null })
  const errors = await captureConsole('error', async () => {
    await captureConsole('warn', async () => {
      for (let i = 0; i < 3; i++) {
        assertEquals(
          (await s.handler(await signedWebhook(URL_, inbound(), SECRET)))
            .status,
          401,
        )
      }
    })
  })
  assertEquals(errors.length, 1)
  assertEquals(
    JSON.parse(String(errors[0][0])).code,
    'yeastar_webhook_secret_missing',
  )
  const broken = setup({
    rpc: { get_org_secret: { error: { code: 'XX000' } } },
  })
  await captureConsole('error', async () => {
    assertEquals(
      (await broken.handler(await signedWebhook(URL_, inbound(), SECRET)))
        .status,
      500,
    )
  })
})

Deno.test('sms-webhook: the per-IP limit comes before the secret; refused → 429 Retry-After, unavailable → 503', async () => {
  const refused = setup({
    limit: { allowed: false, hits: 601, retry_after_seconds: 30 },
  })
  const res = await refused.handler(
    await signedWebhook(URL_, inbound(), SECRET),
  )
  assertEquals(res.status, 429)
  assertEquals(res.headers.get('Retry-After'), '30')
  assertEquals(rpcNames(refused), [])
  assertEquals(
    refused.service.calls[0].args.p_bucket,
    'webhooks.yeastar_ip',
  )
  const down = setup({
    rpc: { consume_rate_limit: { error: { code: 'XX000' } } },
  })
  await captureConsole('error', async () => {
    assertEquals(
      (await down.handler(await signedWebhook(URL_, inbound(), SECRET)))
        .status,
      503,
    )
  })
})

Deno.test('sms-webhook: a duplicate → 200, a held lease → 409; nothing recorded', async () => {
  const dup = setup({
    rpc: { claim_webhook_event: { data: [{ status: 'duplicate' }] } },
  })
  assertEquals(
    await outcome(
      await dup.handler(await signedWebhook(URL_, inbound(), SECRET)),
    ),
    { status: 200, outcome: 'duplicate' },
  )
  const held = setup({
    rpc: { claim_webhook_event: { data: [{ status: 'in_progress' }] } },
  })
  assertEquals(
    (await held.handler(await signedWebhook(URL_, inbound(), SECRET))).status,
    409,
  )
  for (const s of [dup, held]) {
    assertEquals(rpcNames(s).includes('record_inbound_sms'), false)
  }
})

Deno.test('sms-webhook: a failure after the claim → failEvent with the step and 500, so the PBX retries', async () => {
  const s = setup({
    rpc: { record_inbound_sms: { error: { code: 'XX000' } } },
  })
  const lines = await captureConsole('error', async () => {
    const res = await s.handler(await signedWebhook(URL_, inbound(), SECRET))
    assertEquals(res.status, 500)
  })
  assertEquals(argsOf(s, 'fail_webhook_event'), {
    p_id: EVENT_ID,
    p_claim_token: CLAIM_TOKEN,
    p_error: 'record_inbound_sms_failed',
  })
  const report = JSON.parse(String(lines[0][0]))
  assertEquals(report.ids, { org_id: ORG_ID, webhook_event_id: EVENT_ID })
  assert(!String(lines[0][0]).includes(FROM))

  const bad = setup({
    known: { data: 'message' },
    rpc: { apply_sms_delivery_event: { data: 'what' } },
  })
  await captureConsole('error', async () => {
    const res = await bad.handler(
      await signedWebhook(
        URL_,
        pbx.deliveryEvent({ msgId: 1, status: 1 }),
        SECRET,
      ),
    )
    assertEquals(res.status, 500)
  })
  assertEquals(
    argsOf(bad, 'fail_webhook_event')!.p_error,
    'apply_sms_delivery_event_failed',
  )

  const knownFails = setup({
    known: { error: { code: 'XX000' } },
  })
  await captureConsole('error', async () => {
    assertEquals(
      (await knownFails.handler(await signedWebhook(URL_, inbound(), SECRET)))
        .status,
      500,
    )
  })
})

Deno.test('yeastarEventId: org, type and msg id; the delivery outcome for a report', () => {
  const ev = normalizeMessageEvent({
    type: 30032,
    sn: null,
    event: null,
    msg: { msg_id: 7, delivery_status: 2 },
  })!
  assertEquals(yeastarEventId(ORG_ID.toUpperCase(), ev), `${ORG_ID}:30032:7:2`)
  const inboundEv = normalizeMessageEvent({
    type: 30031,
    sn: null,
    event: null,
    msg: { msg_id: 8, sender: { user_type: 2, user_no: FROM } },
  })!
  assertEquals(yeastarEventId(ORG_ID, inboundEv), `${ORG_ID}:30031:8`)
})
