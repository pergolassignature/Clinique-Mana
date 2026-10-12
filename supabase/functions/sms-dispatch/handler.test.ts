import { assert, assertEquals } from '@std/assert'
import {
  BATCH_LIMIT,
  BATCH_SIZE,
  createHandler,
  dispatchOrg,
  JOB_KEY,
  SOFT_DEADLINE_MS,
} from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import type { OutboundText, SmsTransport } from '../_shared/sms/transport.ts'
import { SmsTransportError } from '../_shared/sms/transport.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'

const SECRET = 'local-dev-internal-function-secret'
const NOW = '2027-03-24T14:15:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)

const mid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
/** A claimed row as `claim_sms_batch_for_service` answers it. */
const text = (n: number, to = `+1514555${String(1000 + n)}`) => ({
  id: mid(n),
  to_e164: to,
  body: `Rappel ${n}`,
  kind: 'reminder',
  request_id: `mana-${mid(n)}`,
})

function harness(opts: {
  claimed?: ReturnType<typeof text>[]
  claim?: RpcRoute
  start?: RpcRoute
  moduleEnabled?: boolean
  /** The transport's answer per text; ok by default. */
  send?: (t: OutboundText) => Promise<{ msgId: number; sessionId: number }>
  /** How long each send takes on the clock. */
  sendMs?: number
} = {}) {
  const clock = fixedClock(NOW)
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: opts.start ?? { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      claim_sms_batch_for_service: opts.claim ??
        { data: opts.claimed ?? [text(1), text(2), text(3)] },
      mark_sms_sent: { data: null },
      mark_sms_failed: { data: null },
      release_sms_claims_for_service: (args) => ({
        data: (args.p_ids as string[]).length,
      }),
    },
  })
  const sent: OutboundText[] = []
  let nextMsg = 10_000
  const transport: SmsTransport = {
    send: async (_orgId, t) => {
      sent.push(t)
      clock.advance(opts.sendMs ?? 0)
      if (opts.send) return await opts.send(t)
      return { msgId: nextMsg++, sessionId: 3_000 }
    },
    sessionOwner: () => Promise.resolve({ ours: true }),
  }
  const deps: Deps = {
    env: (key) =>
      ({ APP_URL: 'http://localhost:5173', INTERNAL_FUNCTION_SECRET: SECRET })[
        key
      ],
    fetch: () => Promise.reject(new Error('no network in this test')),
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => new Response(null, { status: 500 }),
  }
  return {
    handler: createHandler(deps, { transport: () => transport }),
    deps,
    service,
    sent,
    transport,
    clock,
  }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

/** A request signed as `private.invoke_job_function` signs it. */
async function jobRequest(job_key = JOB_KEY): Promise<Request> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${NOW_S}.${job_key}..cron`),
    ),
  )
  return new Request('http://fn.test/functions/v1/sms-dispatch', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key, org_id: null, trigger: 'cron' }),
  })
}

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

const finished = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  callsTo(calls, 'finish_job_run').map((a) => [a.p_status, a.p_detail])

Deno.test('sms-dispatch: only a signed request for this job runs; a bearer is ignored', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const unsigned = await handler(
      new Request('http://fn.test/x', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ job_key: JOB_KEY, trigger: 'cron' }),
      }),
    )
    assertEquals(unsigned.status, 401)
    const other = await handler(await jobRequest('communications.sms_purge'))
    assertEquals(other.status, 400)
    assertEquals(service.calls, [])
  })
})

Deno.test('sms-dispatch: the clinic batch is claimed, each text sent with its request id and marked sent; counts only in the detail', async () => {
  await run(async () => {
    const { handler, service, sent } = harness()
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(callsTo(service.calls, 'claim_sms_batch_for_service'), [{
      p_org_id: ORG_ID,
      p_limit: BATCH_LIMIT,
    }])
    assertEquals(
      callsTo(service.calls, 'module_enabled_for_org'),
      [{ p_org_id: ORG_ID, p_key: 'communications' }],
    )
    assertEquals(
      sent.map((t) => [t.to, t.requestId]),
      [1, 2, 3].map((n) => [text(n).to_e164, `mana-${mid(n)}`]),
    )
    assertEquals(
      callsTo(service.calls, 'mark_sms_sent').map((a) => a.p_id).sort(),
      [mid(1), mid(2), mid(3)],
    )
    const detail = finished(service.calls)
    assertEquals(detail, [['ok', 'claimed=3 sent=3 failed=0']])
    assert(!String(detail[0][1]).includes('+1'), 'never a number')
  })
})

Deno.test('sms-dispatch: nothing due → claimed=0, no transport', async () => {
  await run(async () => {
    const { handler, service, sent } = harness({ claimed: [] })
    await handler(await jobRequest())
    assertEquals(sent, [])
    assertEquals(finished(service.calls), [['ok', 'claimed=0 sent=0 failed=0']])
  })
})

Deno.test('sms-dispatch: already ran (start_job_run null) → nothing claimed', async () => {
  await run(async () => {
    const { handler, service } = harness({ start: { data: null } })
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 0 }])
    assertEquals(callsTo(service.calls, 'claim_sms_batch_for_service'), [])
  })
})

Deno.test('sms-dispatch: module off, claim error, bad claim answer → the run fails with a code; nothing sent', async () => {
  const cases: [string, Parameters<typeof harness>[0], string][] = [
    ['module off', { moduleEnabled: false }, 'module_disabled'],
    ['claim error', { claim: { error: { code: 'XX000' } } }, 'claim_failed'],
    [
      'bad answer',
      { claim: { data: [{ id: 'x', to_e164: 1 }] } },
      'claim_invalid',
    ],
  ]
  await run(async () => {
    for (const [label, opts, code] of cases) {
      const { handler, service, sent } = harness(opts)
      await captureConsole('error', async () => {
        const res = await handler(await jobRequest())
        assertEquals(res.status, 200, label)
      })
      assertEquals(finished(service.calls), [['error', code]], label)
      assertEquals(sent, [], label)
    }
  })
})

Deno.test('sms-dispatch: a release that fails is reported (ids only); the run still ends with its code', async () => {
  await run(async () => {
    const s = harness({
      claimed: [text(1), text(2), text(3)],
      send: () => Promise.reject(new SmsTransportError('token_limit')),
    })
    const failing = fakeSupabase({
      rpc: {
        module_enabled_for_org: { data: true },
        claim_sms_batch_for_service: { data: [text(1), text(2), text(3)] },
        mark_sms_failed: { data: null },
        release_sms_claims_for_service: { error: { code: 'XX000' } },
      },
    })
    const lines = await captureConsole('error', async () => {
      let code: string | undefined
      try {
        await dispatchOrg(
          s.deps,
          ORG_ID,
          failing.client,
          new AbortController().signal,
          { transport: () => s.transport },
        )
      } catch (error) {
        code = (error as { code?: string }).code
      }
      assertEquals(code, 'sms_stopped_token_limit')
    })
    const codes = lines.map((l) => JSON.parse(String(l[0])).code)
    assert(codes.includes('release_sms_claims_failed'))
    assert(!lines.some((l) => String(l[0]).includes('+1514')), 'never a number')
  })
})

Deno.test('sms-dispatch: a refused number is marked failed and counted; the others go on', async () => {
  await run(async () => {
    const refused = text(2).to_e164
    const { handler, service, sent } = harness({
      send: (t) =>
        t.to === refused
          ? Promise.reject(new SmsTransportError('provider_rejected'))
          : Promise.resolve({ msgId: 1, sessionId: 2 }),
    })
    const lines = await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(sent.length, 3)
    assertEquals(callsTo(service.calls, 'mark_sms_failed'), [{
      p_org_id: ORG_ID,
      p_id: mid(2),
      p_error_code: 'provider_rejected',
    }])
    assertEquals(finished(service.calls), [['ok', 'claimed=3 sent=2 failed=1']])
    assertEquals(lines.length, 1)
    assert(!String(lines[0][0]).includes(refused), 'never the number')
  })
})

Deno.test('sms-dispatch: a clinic setup gap ends the run sms_not_configured, unreported; nothing else is sent', async () => {
  await run(async () => {
    const { handler, service, sent } = harness({
      claimed: [text(1), text(2), text(3), text(4)],
      send: () => Promise.reject(new SmsTransportError('not_configured')),
    })
    const lines = await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(sent.length, BATCH_SIZE, 'the first batch only')
    assertEquals(
      callsTo(service.calls, 'mark_sms_failed').map((a) => a.p_error_code),
      ['not_configured', 'not_configured'],
    )
    assertEquals(finished(service.calls), [['error', 'sms_not_configured']])
    assertEquals(
      callsTo(service.calls, 'release_sms_claims_for_service'),
      [{ p_org_id: ORG_ID, p_ids: [mid(3), mid(4)] }],
      'the texts never handed to the PBX are queued again',
    )
    assertEquals(
      lines.filter((l) => String(l[0]).includes('sms_not_configured')).length,
      1,
      'the run failure only (runJob reports it); the texts themselves are not incidents',
    )
  })
})

Deno.test('sms-dispatch: a PBX outage ends the run after its batch; the rest waits for the next run', async () => {
  await run(async () => {
    const { handler, service, sent } = harness({
      claimed: [text(1), text(2), text(3), text(4), text(5)],
      send: () => Promise.reject(new SmsTransportError('provider_unreachable')),
    })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(sent.length, BATCH_SIZE)
    assertEquals(finished(service.calls), [[
      'error',
      'sms_stopped_provider_unreachable',
    ]])
    assertEquals(
      callsTo(service.calls, 'release_sms_claims_for_service'),
      [{ p_org_id: ORG_ID, p_ids: [mid(3), mid(4), mid(5)] }],
      'the rest waits for the next run, never failed unsent',
    )
  })
})

Deno.test('sms-dispatch: no batch starts after the soft deadline; the texts left are counted deferred', async () => {
  // Each send takes 12 s: two batches of 2 (48 s) pass the 40 s deadline, no third starts.
  assert(12_000 < SOFT_DEADLINE_MS)
  assert(12_000 * 2 * 2 >= SOFT_DEADLINE_MS)
  const s = harness({
    claimed: [1, 2, 3, 4, 5, 6, 7].map((n) => text(n)),
    sendMs: 12_000,
  })
  const detail = await dispatchOrg(
    s.deps,
    ORG_ID,
    s.service.client,
    new AbortController().signal,
    { transport: () => s.transport },
  )
  assertEquals(s.sent.length, 4)
  assertEquals(detail, 'claimed=7 sent=4 failed=0 deferred=3')
  assertEquals(
    callsTo(s.service.calls, 'release_sms_claims_for_service'),
    [{ p_org_id: ORG_ID, p_ids: [mid(5), mid(6), mid(7)] }],
  )
})

Deno.test('sms-dispatch: an aborted signal (runJob cut) stops before the next batch', async () => {
  const s = harness()
  const controller = new AbortController()
  controller.abort()
  let code: string | undefined
  try {
    await dispatchOrg(s.deps, ORG_ID, s.service.client, controller.signal, {
      transport: () => s.transport,
    })
  } catch (error) {
    code = (error as { code?: string }).code
  }
  assertEquals(code, 'timeout')
  assertEquals(s.sent, [])
  assertEquals(
    callsTo(s.service.calls, 'release_sms_claims_for_service').map((a) =>
      (a.p_ids as string[]).length
    ),
    [3],
  )
})
