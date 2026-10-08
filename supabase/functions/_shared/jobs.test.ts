import { assertEquals } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Deps } from './deps.ts'
import {
  type JobRequest,
  type PerOrg,
  runJob,
  type RunJobOptions,
  verifyJobSignature,
} from './jobs.ts'
import { captureConsole, withEnv } from './testing/env.ts'
import { fakeFetch } from './testing/fake-fetch.ts'
import { fakeSupabase, type RpcRoute } from './testing/fake-supabase.ts'
import { fixedClock } from './testing/fixed-clock.ts'

const SECRET = 'local-dev-internal-function-secret'
const JOB = 'core.test_job'
const ORG_A = '11111111-1111-1111-1111-111111111111'
const ORG_B = '22222222-2222-2222-2222-222222222222'
/** The fixed clock below, in unix seconds. */
const NOW = '2026-10-08T10:00:00Z'
const NOW_S = 1_791_453_600
// The process env stays free of keys: runJob reads `deps.env` only.
const ENV = {
  INTERNAL_FUNCTION_SECRET: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  SUPABASE_SECRET_KEYS: undefined,
  SENTRY_DSN: undefined,
}

function depsFor(
  client: SupabaseClient,
  env: Record<string, string | undefined> = {
    INTERNAL_FUNCTION_SECRET: SECRET,
  },
): Deps {
  return {
    env: (key) => env[key],
    fetch: fakeFetch({}).fetch,
    now: fixedClock(NOW).now,
    serviceClient: () => client,
    userClient: () => new Response(null, { status: 500 }),
  }
}

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

/** `X-Job-Signature` for `fields`, as `private.invoke_job_function` builds it. */
async function signature(
  fields: Partial<JobRequest>,
  t = NOW_S,
  secret = SECRET,
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = `${t}.${fields.job_key ?? ''}.${fields.org_id ?? ''}.${
    fields.trigger ?? ''
  }`
  return `t=${t},v1=${
    hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  }`
}

const requestWith = (body: unknown, headers: Record<string, string>) =>
  new Request('https://fn.test/job', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

/** A request whose body is signed with the right secret and the current time. */
const jobRequest = async (body: Partial<JobRequest>) =>
  requestWith(body, { 'X-Job-Signature': await signature(body) })

const CRON = { job_key: JOB, org_id: null, trigger: 'cron' }

function setup(rpc: Record<string, RpcRoute>) {
  const fake = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_A, ORG_B] },
      start_job_run: (args) => ({ data: `run-${args.p_org_id}` }),
      finish_job_run: { data: null },
      ...rpc,
    },
  })
  const perOrgCalls: string[] = []
  return { ...fake, deps: depsFor(fake.client), perOrgCalls }
}

/** Runs the job with env set and console.error captured. */
async function run(
  deps: Deps,
  req: Request,
  perOrg: PerOrg,
  options?: RunJobOptions,
) {
  let res = new Response()
  const errors = await captureConsole('error', async () => {
    await withEnv(ENV, async () => {
      res = await runJob(deps, req, JOB, perOrg, options)
    })
  })
  return { res, errors }
}

const finishes = (calls: Array<{ fn: string; args: unknown }>) =>
  calls.filter((c) => c.fn === 'finish_job_run').map((c) => c.args)

/** Runs `req` and checks it was refused 401 with no detail, touching nothing. */
async function assertRefused(req: Request | Promise<Request>) {
  const { deps, calls } = setup({})
  const { res } = await run(deps, await req, () => {
    throw new Error('must not run')
  })
  assertEquals(res.status, 401)
  assertEquals(await res.json(), {
    error: { code: 'unauthenticated', message: 'Unauthorized' },
  })
  assertEquals(calls, [])
}

// ---------------------------------------------------------------------------
// X-Job-Signature
// ---------------------------------------------------------------------------

// Computed independently (node:crypto `createHmac('sha256', secret)`, checked
// with `openssl dgst -sha256 -hmac`): pins the exact message format.
const VECTORS = [
  {
    body: { job_key: JOB, org_id: ORG_A, trigger: 'manual' },
    message: `1791453600.core.test_job.${ORG_A}.manual`,
    header:
      't=1791453600,v1=f7d1d5521c31a55e3fbb368324c121d1bdf4ffb4bbb935b91a6941b53c741a46',
  },
  {
    body: { job_key: JOB, org_id: null, trigger: 'cron' },
    message: '1791453600.core.test_job..cron',
    header:
      't=1791453600,v1=b159b0987f6a1ad3fc3c650ba8b33a87acafe0ea6ca40e60aa56f7b291ced6f7',
  },
]

Deno.test('verifyJobSignature: accepts the independently computed vectors', async () => {
  for (const { body, header } of VECTORS) {
    const req = requestWith(body, { 'X-Job-Signature': header })
    assertEquals(
      await verifyJobSignature(req, body, SECRET, new Date(NOW)),
      null,
    )
    // The test signer agrees with the vector.
    assertEquals(await signature(body), header)
  }
})

Deno.test('verifyJobSignature: the vector fails with another secret', async () => {
  const { body, header } = VECTORS[0]
  const req = requestWith(body, { 'X-Job-Signature': header })
  const res = await verifyJobSignature(req, body, `${SECRET}x`, new Date(NOW))
  assertEquals(res?.status, 401)
})

Deno.test('runJob: a valid signature passes, for cron and manual runs', async () => {
  for (const { body, header } of VECTORS) {
    const { deps } = setup({})
    const { res } = await run(
      deps,
      requestWith(body, { 'X-Job-Signature': header }),
      () => Promise.resolve('ok'),
    )
    assertEquals(res.status, 200)
  }
})

Deno.test('runJob: a timestamp up to 300 s off passes; 301 s off fails', async () => {
  for (const t of [NOW_S - 300, NOW_S + 300]) {
    const { deps } = setup({})
    const req = requestWith(CRON, {
      'X-Job-Signature': await signature(CRON, t),
    })
    const { res } = await run(deps, req, () => Promise.resolve('ok'))
    assertEquals(res.status, 200)
  }
  for (const t of [NOW_S - 301, NOW_S + 301, 0]) {
    await assertRefused(
      requestWith(CRON, { 'X-Job-Signature': await signature(CRON, t) }),
    )
  }
})

Deno.test('runJob: a body that differs from the signed fields fails', async () => {
  const signed = { job_key: JOB, org_id: ORG_A, trigger: 'manual' }
  const header = await signature(signed)
  for (
    const tampered of [
      { ...signed, org_id: ORG_B },
      { ...signed, org_id: null, trigger: 'cron' },
      { ...signed, trigger: 'cron' },
      { ...signed, job_key: 'core.other_job' },
    ]
  ) {
    await assertRefused(requestWith(tampered, { 'X-Job-Signature': header }))
  }
  // A signature made for another job does not cover this job's body.
  const other = { ...CRON, job_key: 'core.other_job' }
  await assertRefused(
    requestWith(CRON, { 'X-Job-Signature': await signature(other) }),
  )
})

Deno.test('runJob: a malformed or missing header fails before the body is read', async () => {
  const good = await signature(CRON)
  const mac = good.split(',v1=')[1]
  for (
    const header of [
      '',
      `v1=${mac},t=${NOW_S}`,
      `t=${NOW_S},v1=${mac.toUpperCase()}`,
      `t=${NOW_S},v1=${mac.slice(1)}`,
      `t=${NOW_S},v1=${mac}0`,
      `t=${NOW_S},v1=${mac.slice(1)}g`,
      `t=-${NOW_S},v1=${mac}`,
      `t=${NOW_S}.0,v1=${mac}`,
      `t=${NOW_S}, v1=${mac}`,
      `${good},v0=00`,
      `${good};`,
      `t=${NOW_S}`,
      `Bearer ${SECRET}`,
    ]
  ) {
    await assertRefused(requestWith(CRON, { 'X-Job-Signature': header }))
  }
  await assertRefused(requestWith(CRON, {}))
  // Format first: an unsigned request with a bad body is 401, not 400.
  await assertRefused(requestWith({ trigger: 'later' }, {}))
})

Deno.test('runJob: a raw Authorization: Bearer <secret> alone no longer passes', async () => {
  await assertRefused(requestWith(CRON, { Authorization: `Bearer ${SECRET}` }))
})

Deno.test('runJob: a missing secret gives 503 not_configured, reported, touching nothing', async () => {
  for (const value of [undefined, '']) {
    const { calls, client } = setup({})
    const deps = depsFor(client, { INTERNAL_FUNCTION_SECRET: value })
    const { res, errors } = await run(
      deps,
      await jobRequest(CRON),
      () => Promise.reject(new Error('must not run')),
    )
    assertEquals(res.status, 503)
    assertEquals((await res.json()).error.code, 'not_configured')
    assertEquals(calls, [])
    assertEquals(JSON.parse(String(errors[0][0])), {
      fn: JOB,
      code: 'job_signature_not_configured',
    })
  }
})

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

Deno.test('runJob: cron runs every listed org; a throwing org is finished as error', async () => {
  const { deps, calls } = setup({})
  const { res, errors } = await run(deps, await jobRequest(CRON), (orgId) => {
    if (orgId === ORG_B) {
      return Promise.reject(
        Object.assign(new Error('Resend said no to ana@example.test'), {
          code: 'provider_error',
        }),
      )
    }
    return Promise.resolve('3 courriels envoyés')
  })
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { runs: 2 })
  assertEquals(calls.map((c) => c.fn), [
    'list_job_orgs',
    'start_job_run',
    'finish_job_run',
    'start_job_run',
    'finish_job_run',
  ])
  assertEquals(calls[0].args, { p_key: JOB })
  assertEquals(calls[1].args, {
    p_key: JOB,
    p_org_id: ORG_A,
    p_trigger: 'cron',
  })
  assertEquals(finishes(calls), [
    { p_id: `run-${ORG_A}`, p_status: 'ok', p_detail: '3 courriels envoyés' },
    { p_id: `run-${ORG_B}`, p_status: 'error', p_detail: 'provider_error' },
  ])
  // Reported with ids only: the error message (and its address) never leaves.
  assertEquals(errors.length, 1)
  assertEquals(JSON.parse(String(errors[0][0])), {
    fn: JOB,
    code: 'provider_error',
    ids: { org_id: ORG_B, run_id: `run-${ORG_B}` },
  })
})

Deno.test('runJob: start_job_run returning null skips the org (no perOrg, no finish)', async () => {
  const { deps, calls } = setup({
    start_job_run: (args) => ({
      data: args.p_org_id === ORG_A ? null : 'run-b',
    }),
  })
  const seen: string[] = []
  const { res } = await run(deps, await jobRequest(CRON), (orgId) => {
    seen.push(orgId)
    return Promise.resolve('ok')
  })
  assertEquals(await res.json(), { runs: 1 })
  assertEquals(seen, [ORG_B])
  assertEquals(finishes(calls), [
    { p_id: 'run-b', p_status: 'ok', p_detail: 'ok' },
  ])
})

Deno.test('runJob: a manual run uses the body org only, without list_job_orgs', async () => {
  const { deps, calls } = setup({})
  const { res } = await run(
    deps,
    await jobRequest({ job_key: JOB, org_id: ORG_B, trigger: 'manual' }),
    () => Promise.resolve('done'),
  )
  assertEquals(await res.json(), { runs: 1 })
  assertEquals(calls.map((c) => c.fn), ['start_job_run', 'finish_job_run'])
  assertEquals(calls[0].args, {
    p_key: JOB,
    p_org_id: ORG_B,
    p_trigger: 'manual',
  })
})

Deno.test('runJob: a manual run without an org, or a bad body, gives 400', async () => {
  for (
    const body of [
      { job_key: JOB, org_id: null, trigger: 'manual' },
      { trigger: 'later' },
      { org_id: 'not-a-uuid', trigger: 'manual' },
    ]
  ) {
    const { deps, calls } = setup({})
    const { res } = await run(
      deps,
      await jobRequest(body as Partial<JobRequest>),
      () => Promise.resolve(''),
    )
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error.code, 'invalid_request')
    assertEquals(calls, [])
  }
})

Deno.test('runJob: an error without a safe code is recorded as internal', async () => {
  for (
    const thrown of [
      new Error('row for ana@example.test'),
      { code: 'a code with spaces' },
      'plain string',
    ]
  ) {
    const { deps, calls } = setup({ list_job_orgs: { data: [ORG_A] } })
    await run(deps, await jobRequest(CRON), () => Promise.reject(thrown))
    assertEquals(finishes(calls), [
      { p_id: `run-${ORG_A}`, p_status: 'error', p_detail: 'internal' },
    ])
  }
})

Deno.test('runJob: the detail is capped at 500 characters', async () => {
  const { deps, calls } = setup({ list_job_orgs: { data: [ORG_A] } })
  await run(
    deps,
    await jobRequest(CRON),
    () => Promise.resolve('x'.repeat(600)),
  )
  assertEquals(
    (finishes(calls)[0] as { p_detail: string }).p_detail.length,
    500,
  )
})

Deno.test('runJob: list_job_orgs failing gives 500 internal, reported', async () => {
  const { deps } = setup({
    list_job_orgs: { error: { code: 'XX000', message: 'boom' } },
  })
  const { res, errors } = await run(
    deps,
    await jobRequest(CRON),
    () => Promise.resolve(''),
  )
  assertEquals(res.status, 500)
  assertEquals((await res.json()).error.code, 'internal')
  assertEquals(JSON.parse(String(errors[0][0])).code, 'job_orgs_unavailable')
})

Deno.test('runJob: a failing start_job_run or finish_job_run is reported and the next org still runs', async () => {
  const { deps, calls } = setup({
    start_job_run: (args) =>
      args.p_org_id === ORG_A
        ? { error: { code: 'XX000', message: 'boom' } }
        : { data: 'run-b' },
    finish_job_run: { error: { code: 'XX000', message: 'boom' } },
  })
  const seen: string[] = []
  const { res, errors } = await run(deps, await jobRequest(CRON), (orgId) => {
    seen.push(orgId)
    return Promise.resolve('ok')
  })
  assertEquals(await res.json(), { runs: 1 })
  assertEquals(seen, [ORG_B])
  assertEquals(finishes(calls).length, 1)
  assertEquals(errors.map((e) => JSON.parse(String(e[0])).code), [
    'job_run_start_failed',
    'job_run_finish_failed',
  ])
})

Deno.test('runJob: a missing service client configuration is returned as is', async () => {
  const deps = {
    ...depsFor(fakeSupabase({}).client),
    serviceClient: () => new Response(null, { status: 500 }),
  }
  const { res } = await run(
    deps,
    await jobRequest(CRON),
    () => Promise.resolve(''),
  )
  assertEquals(res.status, 500)
})

Deno.test('runJob: the detail is cut by code point, never inside an emoji', async () => {
  const { deps, calls } = setup({ list_job_orgs: { data: [ORG_A] } })
  // 499 letters then emoji: the 500th code point is a whole emoji (2 UTF-16 units).
  await run(
    deps,
    await jobRequest(CRON),
    () => Promise.resolve(`${'x'.repeat(499)}📨📨`),
  )
  const detail = (finishes(calls)[0] as { p_detail: string }).p_detail
  assertEquals(Array.from(detail).length, 500)
  assertEquals(detail, `${'x'.repeat(499)}📨`)
  assertEquals(detail.isWellFormed(), true)
})

Deno.test('runJob: a signed job_key other than this job, or none, gives 400 and touches nothing', async () => {
  for (
    const body of [{ ...CRON, job_key: 'core.other_job' }, { trigger: 'cron' }]
  ) {
    const { deps, calls } = setup({})
    const { res } = await run(
      deps,
      await jobRequest(body),
      () => Promise.reject(new Error('must not run')),
    )
    assertEquals(res.status, 400)
    assertEquals((await res.json()).error.code, 'invalid_request')
    assertEquals(calls, [])
  }
})

Deno.test('runJob: an org over its timeout is finished as error / timeout, aborted, and the next org runs', async () => {
  const { deps, calls } = setup({})
  let aborted = false
  const { res, errors } = await run(
    deps,
    await jobRequest(CRON),
    (orgId, _client, signal) => {
      if (orgId === ORG_B) return Promise.resolve('fait')
      // Never settles on its own; rejects late once aborted.
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('late'))
        })
      })
    },
    { perOrgTimeoutMs: 20 },
  )
  assertEquals(await res.json(), { runs: 2 })
  assertEquals(aborted, true)
  assertEquals(finishes(calls), [
    { p_id: `run-${ORG_A}`, p_status: 'error', p_detail: 'timeout' },
    { p_id: `run-${ORG_B}`, p_status: 'ok', p_detail: 'fait' },
  ])
  assertEquals(JSON.parse(String(errors[0][0])), {
    fn: JOB,
    code: 'timeout',
    ids: { org_id: ORG_A, run_id: `run-${ORG_A}` },
  })
})
