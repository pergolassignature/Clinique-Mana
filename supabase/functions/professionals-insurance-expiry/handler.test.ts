import { assert, assertEquals } from '@std/assert'
import {
  BATCH_SIZE,
  createHandler,
  JOB_KEY,
  noticeOrg,
  SOFT_DEADLINE_MS,
} from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch, type Responder } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID } from '../_shared/testing/email-fixtures.ts'
import { professionalsEmailContext } from '../_shared/testing/professionals-fixtures.ts'

const SECRET = 'local-dev-internal-function-secret'
const NOW = '2027-03-24T10:15:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const APP = 'http://localhost:5173'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: APP,
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
  INTERNAL_FUNCTION_SECRET: SECRET,
}

const pid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const did = (n: number) =>
  `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const addressOf = (id: string) => `p${id.slice(-4)}@exemple.test`

type Template =
  | 'professionals.document_expiring'
  | 'professionals.document_expired'
  | 'professionals.document_expired_reminder'

/** One email row as the RPC answers it. */
const due = (n: number, template: Template = 'professionals.document_expiring') => ({
  document_id: did(n),
  professional_id: pid(n),
  profile_id: n % 2 === 0 ? null : pid(100 + n),
  email: addressOf(pid(n)),
  first_name: 'Nadia',
  template_key: template,
  expires_on: '2027-03-31',
})

/** The RPC's answer with these emails (counts are the SQL's). */
const runAnswer = (emails: ReturnType<typeof due>[], over: Record<string, unknown> = {}) => ({
  data: {
    today: '2027-03-24',
    clinic_name: 'Clinique MANA',
    marked: 2,
    expiring: 3,
    expired: 1,
    missing: 4,
    emails,
    ...over,
  },
})

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
    'http://fn.test/functions/v1/professionals-insurance-expiry',
    {
      method: 'POST',
      headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
      body: JSON.stringify(body),
    },
  )
}

function harness(opts: {
  emails?: ReturnType<typeof due>[]
  run?: RpcRoute
  start?: RpcRoute
  moduleEnabled?: boolean
  mailpit?: Responder
  env?: Record<string, string>
  rpc?: Record<string, RpcRoute>
} = {}) {
  let logIds = 0
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: opts.start ?? { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      run_professionals_document_notices_for_service: opts.run ??
        runAnswer(opts.emails ?? [due(1)]),
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      get_email_context: (args) => ({
        data: professionalsEmailContext(String(args.p_template_key)),
      }),
      queue_email: () => ({
        data: `6f1c1b2e-3d4a-4b5c-8d9e-${String(++logIds).padStart(12, '0')}`,
      }),
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
      ...opts.rpc,
    },
  })
  const http = fakeFetch({
    [MAILPIT]: opts.mailpit ??
      (() => new Response(JSON.stringify({ ID: 'm' }), { status: 200 })),
  })
  const env = { ...ENV, ...opts.env }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: http.fetch,
    now: fixedClock(NOW).now,
    serviceClient: () => service.client,
    userClient: () => new Response(null, { status: 500 }),
  }
  return { handler: createHandler(deps), deps, service, http }
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

/** The finished run's status and detail. */
const finished = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  callsTo(calls, 'finish_job_run').map((a) => [a.p_status, a.p_detail])

/** Mailpit's answer by recipient: `status` for the listed professionals, else 200. */
const mailpitFailing =
  (failing: string[], status: number): Responder => async (req) => {
    const to = (await req.json()).To[0].Email
    return new Response(JSON.stringify({ ID: 'm' }), {
      status: failing.some((id) => addressOf(id) === to) ? status : 200,
    })
  }

Deno.test('professionals-insurance-expiry: only a signed request for this job runs; a bearer is ignored', async () => {
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
    const other = await handler(
      await jobRequest({
        job_key: 'professionals.invitation_reminders',
        org_id: null,
        trigger: 'cron',
      }),
    )
    assertEquals(other.status, 400)
    assertEquals(service.calls, [])
  })
})

Deno.test('professionals-insurance-expiry: one RPC for the clinic, then each due email to the professional with « Mes documents »', async () => {
  await run(async () => {
    const emails = [
      due(1),
      due(2, 'professionals.document_expired'),
      due(3, 'professionals.document_expired_reminder'),
    ]
    const { handler, service, http } = harness({ emails })
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(
      callsTo(service.calls, 'run_professionals_document_notices_for_service'),
      [{ p_org: ORG_ID }],
    )
    assertEquals(
      callsTo(service.calls, 'module_enabled_for_org'),
      [{ p_org_id: ORG_ID, p_key: 'professionals' }],
    )
    // Queued per row: its template, the professional as subject and recipient profile, no sender.
    const queued = callsTo(service.calls, 'queue_email')
      .sort((a, b) => String(a.p_subject_id).localeCompare(String(b.p_subject_id)))
    assertEquals(
      queued.map((q) => [q.p_template_key, q.p_subject_type, q.p_subject_id, q.p_to_email, q.p_to_profile_id, q.p_sent_by]),
      emails.map((e) => [e.template_key, 'professional', e.professional_id, e.email, e.profile_id, null]),
    )
    assertEquals(http.calls.length, 3)
    for (const call of http.calls) {
      const sent = JSON.parse(call.body)
      // The date-only value as written (no time zone), the clinic's name, the button.
      assert(sent.Text.includes('31 mars 2027'), sent.Text)
      assert(sent.Text.includes('Clinique MANA'), sent.Text)
      assert(sent.Text.includes('Bonjour Nadia'), sent.Text)
      assert(sent.Text.includes(`${APP}/mes-documents`), sent.Text)
    }
    assertEquals(finished(service.calls), [[
      'ok',
      'marked=2 expiring=3 expired=1 missing=4 emails=3 sent=3 failed=0',
    ]])
  })
})

Deno.test('professionals-insurance-expiry: nothing due → the counts only, no email and no APP_URL needed', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      emails: [],
      env: { APP_URL: '' },
    })
    await handler(await jobRequest())
    assertEquals(http.calls, [])
    assertEquals(callsTo(service.calls, 'queue_email'), [])
    assertEquals(finished(service.calls), [[
      'ok',
      'marked=2 expiring=3 expired=1 missing=4 emails=0 sent=0 failed=0',
    ]])
  })
})

Deno.test('professionals-insurance-expiry: already ran today (start_job_run null) → no RPC, no email', async () => {
  await run(async () => {
    const { handler, service, http } = harness({ start: { data: null } })
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 0 }])
    assertEquals(callsTo(service.calls, 'run_professionals_document_notices_for_service'), [])
    assertEquals(finished(service.calls), [])
    assertEquals(http.calls, [])
  })
})

Deno.test('professionals-insurance-expiry: module off, RPC failure, bad answer, unusable APP_URL → the run fails with a code; nothing sent', async () => {
  const cases: [string, Parameters<typeof harness>[0], string, boolean][] = [
    ['module off', { moduleEnabled: false }, 'module_disabled', false],
    ['RPC error', { run: { error: { code: 'XX000' } } }, 'notices_failed', true],
    ['bad answer', { run: { data: { emails: 'x' } } }, 'notices_invalid', true],
    [
      'an address the schema refuses',
      { run: runAnswer([{ ...due(1), template_key: 'core.staff_invite' as Template }]) },
      'notices_invalid',
      true,
    ],
    ['APP_URL', { env: { APP_URL: 'http://evil.test' } }, 'app_url_invalid', true],
  ]
  await run(async () => {
    for (const [label, opts, code, called] of cases) {
      const { handler, service, http } = harness(opts)
      const logged = await captureConsole('error', async () => {
        const res = await handler(await jobRequest())
        assertEquals(res.status, 200, label)
      })
      assertEquals(
        callsTo(service.calls, 'run_professionals_document_notices_for_service').length,
        called ? 1 : 0,
        label,
      )
      assertEquals(finished(service.calls), [['error', code]], label)
      assertEquals(http.calls, [], label)
      assert(!JSON.stringify(logged).includes('@exemple.test'), label)
    }
  })
})

Deno.test('professionals-insurance-expiry: batches of 2 in parallel (P4-424: the provider takes about 2 a second)', async () => {
  await run(async () => {
    const emails = Array.from({ length: 30 }, (_, i) => due(i + 1))
    let inFlight = 0
    let peak = 0
    const { handler, service, http } = harness({
      emails,
      mailpit: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return new Response(JSON.stringify({ ID: 'm' }), { status: 200 })
      },
    })
    await handler(await jobRequest())
    assertEquals(http.calls.length, 30)
    assert(peak <= BATCH_SIZE, `peak ${peak}`)
    assert(peak > 1, 'sends run in parallel')
    assertEquals(BATCH_SIZE, 2)
    assertEquals(finished(service.calls), [[
      'ok',
      'marked=2 expiring=3 expired=1 missing=4 emails=30 sent=30 failed=0',
    ]])
  })
})

Deno.test('professionals-insurance-expiry: no batch starts after the soft deadline; the emails left are counted deferred (P4-470)', async () => {
  await run(async () => {
    const emails = Array.from({ length: 30 }, (_, i) => due(i + 1))
    const clock = fixedClock(NOW)
    // Each send takes 7 s of the run: two batches of 2 (28 s) pass the deadline, no third starts.
    const h = harness({
      emails,
      mailpit: () => {
        clock.advance(7_000)
        return new Response(JSON.stringify({ ID: 'm' }), { status: 200 })
      },
    })
    assert(7_000 * BATCH_SIZE < SOFT_DEADLINE_MS)
    assert(7_000 * BATCH_SIZE * 2 >= SOFT_DEADLINE_MS)
    const detail = await noticeOrg(
      { ...h.deps, now: clock.now },
      ORG_ID,
      h.service.client,
      new AbortController().signal,
    )
    assertEquals(
      detail,
      `marked=2 expiring=3 expired=1 missing=4 emails=30 sent=${2 * BATCH_SIZE} failed=0 deferred=${30 - 2 * BATCH_SIZE}`,
    )
    assertEquals(h.http.calls.length, 2 * BATCH_SIZE)
    // A deferred email is never queued: nothing in email_log, so the RPC answers it again tomorrow.
    assertEquals(callsTo(h.service.calls, 'queue_email').length, 2 * BATCH_SIZE)
  })
})

Deno.test('professionals-insurance-expiry: a setup failure ends the run; a provider outage or the quota ends it after the batch', async () => {
  const emails = Array.from({ length: 30 }, (_, i) => due(i + 1))
  const cases: [string, Parameters<typeof harness>[0], string, number][] = [
    ['not configured', { env: { EMAIL_TRANSPORT: 'carrier-pigeon' } }, 'email_not_configured', 0],
    ['provider outage', { mailpit: mailpitFailing(emails.map((e) => e.professional_id), 500) }, 'emails_stopped_provider_error', BATCH_SIZE],
    [
      'quota',
      {
        rpc: {
          consume_rate_limit: {
            data: [{ allowed: false, hits: 501, retry_after_seconds: 600 }],
          },
        },
      },
      'emails_stopped_rate_limited',
      0,
    ],
  ]
  await run(async () => {
    for (const [label, opts, code, mails] of cases) {
      const { handler, service, http } = harness({ emails, ...opts })
      const logged = await captureConsole('error', async () => {
        await handler(await jobRequest())
      })
      assertEquals(finished(service.calls), [['error', code]], label)
      // Never past the first batch.
      assertEquals(http.calls.length, mails, label)
      assert(callsTo(service.calls, 'get_email_context').length <= BATCH_SIZE, label)
      assert(!JSON.stringify(logged).includes('@exemple.test'), label)
    }
  })
})

Deno.test("professionals-insurance-expiry: one address refused is counted and reported with ids only; the others go out", async () => {
  await run(async () => {
    const emails = [due(1), { ...due(2), email: 'pas une adresse' }, due(3)]
    const { handler, service, http } = harness({ emails })
    const logged = await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(http.calls.length, 2)
    assertEquals(finished(service.calls), [[
      'ok',
      'marked=2 expiring=3 expired=1 missing=4 emails=3 sent=2 failed=1',
    ]])
    const lines = logged.map((l) => JSON.parse(String(l[0])))
    assert(lines.some((l) => l.code === 'expiry_email_invalid_recipient' && l.ids?.professional_id === pid(2)))
    assert(!JSON.stringify(logged).includes('pas une adresse'))
    assert(!JSON.stringify(logged).includes('@exemple.test'))
  })
})

Deno.test('professionals-insurance-expiry: a manual run (« Exécuter maintenant ») covers the signed org only', async () => {
  await run(async () => {
    const { handler, service } = harness()
    await handler(
      await jobRequest({ job_key: JOB_KEY, org_id: ORG_ID, trigger: 'manual' }),
    )
    assertEquals(callsTo(service.calls, 'list_job_orgs'), [])
    assertEquals(callsTo(service.calls, 'start_job_run'), [
      { p_key: JOB_KEY, p_org_id: ORG_ID, p_trigger: 'manual' },
    ])
    assertEquals(
      callsTo(service.calls, 'run_professionals_document_notices_for_service'),
      [{ p_org: ORG_ID }],
    )
  })
})
