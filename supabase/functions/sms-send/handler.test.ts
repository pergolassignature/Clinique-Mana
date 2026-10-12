import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import type { SmsTransport } from '../_shared/sms/transport.ts'
import { SmsTransportError } from '../_shared/sms/transport.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'

const URL_ = 'http://fn.test/functions/v1/sms-send'
const MESSAGE_ID = '6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }

function setup(
  options: {
    permissions?: string[]
    modules?: string[]
    rpc?: Record<string, RpcRoute>
    transport?: Partial<SmsTransport>
    limits?: Record<
      string,
      { allowed: boolean; hits: number; retry_after_seconds: number }
    >
  } = {},
) {
  const sent: Array<
    { orgId: string; to: string; body: string; requestId: string }
  > = []
  const transport: SmsTransport = {
    send: (orgId, text) => {
      sent.push({ orgId, ...text })
      return Promise.resolve({ msgId: 10325, sessionId: 3089 })
    },
    sessionOwner: () => Promise.resolve({ ours: true }),
    ...options.transport,
  }
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? ['communications.sms']),
          modules: options.modules ?? ['communications'],
        },
      },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: (args) => ({
        data: [options.limits?.[args.p_bucket as string] ?? ALLOWED],
      }),
      queue_sms_for_service: (args) => ({
        data: {
          id: MESSAGE_ID,
          to_e164: '+15145551234',
          body: args.p_body,
          request_id: `mana-${MESSAGE_ID}`,
        },
      }),
      get_sms_provider_context: {
        data: {
          consent_text:
            'Vous acceptez nos textos. Répondez ARRÊT pour arrêter.',
        },
      },
      mark_sms_sent: { data: null },
      mark_sms_failed: { data: null },
      module_open_to_all_for_org: { data: true },
      ...options.rpc,
    },
  })
  const deps: Deps = {
    env: (key) => key === 'APP_URL' ? 'http://localhost:5173' : undefined,
    fetch: () => Promise.reject(new Error('no network in this test')),
    now: fixedClock('2027-03-10T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  const inner = createHandler(deps, { transport: () => transport })
  const handler = async (req: Request) => {
    let res!: Response
    await withEnv(
      { INTERNAL_FUNCTION_SECRET: 'local-dev-test-secret' },
      async () => {
        res = await inner(req)
      },
    )
    return res
  }
  return { handler, service, user, sent }
}

const post = (body: unknown, token = 'jwt') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify(body),
  })

const rpcNames = (s: ReturnType<typeof setup>) =>
  s.service.calls.map((c) => c.fn)

Deno.test('a reply: queued and claimed by the RPC, sent through the transport, marked sent', async () => {
  const s = setup()
  const res = await s.handler(
    post({ to: '514 555-1234', body: 'Bonjour, à demain.' }),
  )
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { sms_message_id: MESSAGE_ID, status: 'sent' })
  assertEquals(s.sent, [{
    orgId: ORG_ID,
    to: '+15145551234',
    body: 'Bonjour, à demain.',
    requestId: `mana-${MESSAGE_ID}`,
  }])
  assertEquals(rpcNames(s), [
    'consume_rate_limit',
    'consume_rate_limit',
    'module_open_to_all_for_org',
    'queue_sms_for_service',
    'mark_sms_sent',
  ])
  const queued = s.service.calls[3].args
  assertEquals(queued.p_actor, ADMIN_ID)
  assertEquals(queued.p_kind, 'reply')
  assertEquals(queued.p_org_id, ORG_ID)
  assertEquals(s.service.calls[4].args.p_provider_msg_id, 10325)
})

Deno.test('a test: communications.sms_manage, the clinic consent text, kind test', async () => {
  const s = setup({ permissions: ['communications.sms_manage'] })
  const res = await s.handler(post({ test: true, to: '514 555-1234' }))
  assertEquals(res.status, 200)
  const queued =
    s.service.calls.find((c) => c.fn === 'queue_sms_for_service')!.args
  assertEquals(queued.p_kind, 'test')
  assert(String(queued.p_body).startsWith('Texto de test. Vous acceptez'))
  assertEquals(s.service.calls[0].args.p_bucket, 'sms.test_user')
  const denied = await setup({ permissions: ['communications.sms'] }).handler(
    post({ test: true, to: '514 555-1234' }),
  )
  assertEquals(denied.status, 403)
})

Deno.test('authentication, the module and the permission come first', async () => {
  const noToken = await setup().handler(
    new Request(URL_, { method: 'POST', body: '{}' }),
  )
  assertEquals(noToken.status, 400, 'an unreadable body is refused before auth')
  const unauth = await setup().handler(
    new Request(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '514 555-1234', body: 'x' }),
    }),
  )
  assertEquals(unauth.status, 401)
  const off = await setup({ modules: [] }).handler(
    post({ to: '514 555-1234', body: 'x' }),
  )
  assertEquals(off.status, 403)
  assertEquals((await off.json()).error.code, 'module_disabled')
  const noPermission = await setup({ permissions: ['communications.inbox'] })
    .handler(
      post({ to: '514 555-1234', body: 'x' }),
    )
  assertEquals(noPermission.status, 403)
  const get = await setup().handler(new Request(URL_, { method: 'GET' }))
  assertEquals(get.status, 405)
})

Deno.test('the body: a number that cannot be read is a French refusal; a text too long is 400', async () => {
  const s = setup()
  const bad = await s.handler(post({ to: '555-1234', body: 'x' }))
  assertEquals(bad.status, 400)
  const body = await bad.json()
  assertEquals(body.error.refusal, true)
  assert(
    body.error.message.startsWith('Le numéro de téléphone n’est pas valide'),
  )
  assertEquals(rpcNames(s), [], 'nothing consumed, nothing queued')
  const long = await s.handler(
    post({ to: '514 555-1234', body: 'x'.repeat(1601) }),
  )
  assertEquals(long.status, 400)
  const empty = await s.handler(post({ to: '514 555-1234', body: '' }))
  assertEquals(empty.status, 400)
})

Deno.test('the limits: the caller first, then the clinic day; a refusal queues nothing', async () => {
  const user = setup({
    limits: {
      'sms.send_user': { allowed: false, hits: 61, retry_after_seconds: 120 },
    },
  })
  const refused = await user.handler(post({ to: '514 555-1234', body: 'x' }))
  assertEquals(refused.status, 429)
  assertEquals(refused.headers.get('Retry-After'), '120')
  assertEquals(rpcNames(user), ['consume_rate_limit'])
  const org = setup({
    limits: {
      'sms.org_day': { allowed: false, hits: 501, retry_after_seconds: 3600 },
    },
  })
  assertEquals(
    (await org.handler(post({ to: '514 555-1234', body: 'x' }))).status,
    429,
  )
  assertEquals(rpcNames(org), ['consume_rate_limit', 'consume_rate_limit'])
})

Deno.test('the RPC refusals pass through: no consent (P0001 → 400 refusal), 42501 → 403', async () => {
  const s = setup({
    rpc: {
      queue_sms_for_service: {
        error: {
          code: 'P0001',
          message:
            'Aucun texto ne peut être envoyé à ce numéro : la personne n’a pas donné son consentement, ou l’a retiré.',
        },
      },
    },
  })
  const lines = await captureConsole('error', async () => {
    const res = await s.handler(post({ to: '514 555-1234', body: 'x' }))
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
    assert(body.error.message.includes('consentement'))
  })
  assertEquals(lines, [], 'an expected refusal is not reported')
  assertEquals(s.sent, [])
  const forbidden = setup({
    rpc: { queue_sms_for_service: { error: { code: '42501' } } },
  })
  assertEquals(
    (await forbidden.handler(post({ to: '514 555-1234', body: 'x' }))).status,
    403,
  )
})

Deno.test('a PBX failure: the row is marked failed, 502 with the code and the row id; setup failures are 503', async () => {
  const s = setup({
    transport: {
      send: () => Promise.reject(new SmsTransportError('provider_rejected')),
    },
  })
  const lines = await captureConsole('error', async () => {
    await withEnv({ SENTRY_DSN: undefined }, async () => {
      const res = await s.handler(post({ to: '514 555-1234', body: 'x' }))
      assertEquals(res.status, 502)
      const body = await res.json()
      assertEquals(body.error.code, 'provider_error')
      assertEquals(body.error.extra, {
        sms_message_id: MESSAGE_ID,
        code: 'provider_rejected',
      })
    })
  })
  assertEquals(lines.length, 1)
  const report = JSON.parse(String(lines[0][0]))
  assertEquals(report.code, 'sms_provider_rejected')
  assertEquals(report.ids, { org_id: ORG_ID, sms_message_id: MESSAGE_ID })
  assertEquals(s.service.calls.at(-1)?.fn, 'mark_sms_failed')
  assertEquals(s.service.calls.at(-1)?.args.p_error_code, 'provider_rejected')

  const unset = setup({
    transport: {
      send: () => Promise.reject(new SmsTransportError('not_configured')),
    },
  })
  const quiet = await captureConsole('error', async () => {
    const res = await unset.handler(post({ to: '514 555-1234', body: 'x' }))
    assertEquals(res.status, 503)
    assertEquals((await res.json()).error.code, 'not_configured')
  })
  assertEquals(quiet, [], 'a clinic setup gap is not an incident')
})

Deno.test('a reply while Communications is reserved for its testers: refused, nothing queued nor sent (R-72)', async () => {
  const s = setup({ rpc: { module_open_to_all_for_org: { data: false } } })
  const res = await s.handler(
    post({ to: '514 555-1234', body: 'Bonjour, à demain.' }),
  )
  assertEquals(res.status, 400)
  const json = await res.json()
  assertEquals(json.error.refusal, true)
  assert(!rpcNames(s).includes('queue_sms_for_service'))
  assertEquals(s.sent.length, 0)
})

Deno.test('the test to oneself still goes while Communications is reserved for its testers', async () => {
  const s = setup({
    permissions: ['communications.sms_manage'],
    rpc: { module_open_to_all_for_org: { data: false } },
  })
  const res = await s.handler(post({ test: true, to: '514 555-1234' }))
  assertEquals(res.status, 200)
  assert(!rpcNames(s).includes('module_open_to_all_for_org'))
  assertEquals(s.sent.length, 1)
})
