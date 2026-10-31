import { assertEquals } from '@std/assert'
import { createHandler, JOB_KEY } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'

const SECRET = 'local-dev-internal-function-secret'
const NOW = '2027-03-14T11:25:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

/** A request signed as `private.invoke_job_function` signs it. */
async function jobRequest(
  body: { job_key: string; org_id: string | null; trigger: string } = {
    job_key: JOB_KEY,
    org_id: null,
    trigger: 'cron',
  },
  signed = true,
): Promise<Request> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = `${NOW_S}.${body.job_key}.${
    body.org_id ?? ''
  }.${body.trigger}`
  const mac = hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(message)),
  )
  return new Request(
    'http://fn.test/functions/v1/professionals-birthday-notice',
    {
      method: 'POST',
      headers: signed ? { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` } : {},
      body: JSON.stringify(body),
    },
  )
}

function harness(opts: {
  run?: RpcRoute
  start?: RpcRoute
  moduleEnabled?: boolean
} = {}) {
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: opts.start ?? { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      run_professionals_birthday_notices_for_service: opts.run ?? { data: 2 },
    },
  })
  const deps: Deps = {
    env: (key) => (key === 'INTERNAL_FUNCTION_SECRET' ? SECRET : undefined),
    fetch: () => Promise.reject(new Error('no network in this job')),
    now: fixedClock(NOW).now,
    serviceClient: () => service.client,
    userClient: () => new Response(null, { status: 500 }),
  }
  return { handler: createHandler(deps), service }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

const finished = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  callsTo(calls, 'finish_job_run').map((a) => [a.p_status, a.p_detail])

Deno.test('professionals-birthday-notice: each clinic runs its notices once, the run says how many — never a name', async () => {
  await run(async () => {
    const h = harness()
    const res = await h.handler(await jobRequest())
    assertEquals(res.status, 200)
    assertEquals(
      callsTo(
        h.service.calls,
        'run_professionals_birthday_notices_for_service',
      ),
      [{ p_org_id: ORG_ID }],
    )
    assertEquals(finished(h.service.calls), [['ok', 'birthdays=2']])
  })
})

Deno.test('professionals-birthday-notice: already ran today (start_job_run null) → nothing run', async () => {
  await run(async () => {
    const h = harness({ start: { data: null } })
    assertEquals((await h.handler(await jobRequest())).status, 200)
    assertEquals(
      callsTo(
        h.service.calls,
        'run_professionals_birthday_notices_for_service',
      ),
      [],
    )
  })
})

Deno.test('professionals-birthday-notice: module off, an RPC failure or a bad answer → the run fails with a code', async () => {
  await run(async () => {
    const off = harness({ moduleEnabled: false })
    await off.handler(await jobRequest())
    assertEquals(finished(off.service.calls)[0]?.[0], 'error')
    assertEquals(
      callsTo(
        off.service.calls,
        'run_professionals_birthday_notices_for_service',
      ),
      [],
    )

    const failed = harness({
      run: { error: { code: 'XX000', message: 'boom' } },
    })
    await failed.handler(await jobRequest())
    assertEquals(finished(failed.service.calls), [['error', 'notices_failed']])

    const odd = harness({ run: { data: 'two' } })
    await odd.handler(await jobRequest())
    assertEquals(finished(odd.service.calls), [['error', 'notices_invalid']])
  })
})

Deno.test('professionals-birthday-notice: an unsigned request or another job key never runs', async () => {
  await run(async () => {
    const h = harness()
    assertEquals(
      (await h.handler(await jobRequest(undefined, false))).status,
      401,
    )
    assertEquals(
      (await h.handler(
        await jobRequest({
          job_key: 'professionals.insurance_expiry_notice',
          org_id: null,
          trigger: 'cron',
        }),
      )).status,
      400,
    )
    assertEquals(
      callsTo(
        h.service.calls,
        'run_professionals_birthday_notices_for_service',
      ),
      [],
    )
  })
})
