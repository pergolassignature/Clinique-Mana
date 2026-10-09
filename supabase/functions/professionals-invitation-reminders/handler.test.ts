import { assert, assertEquals } from '@std/assert'
import {
  BATCH_SIZE,
  createHandler,
  JOB_KEY,
  MAX_PER_RUN,
  remindOrg,
  SOFT_DEADLINE_MS,
} from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { hashToken } from '../_shared/links.ts'
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
const NOW = '2026-10-08T12:05:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const APP = 'http://localhost:5173'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const ENV: Record<string, string> = {
  APP_URL: APP,
  EMAIL_TRANSPORT: 'mailpit',
  MAILPIT_URL: 'http://mailpit.test:8025',
  INTERNAL_FUNCTION_SECRET: SECRET,
}
const EXPIRES = '2026-10-15T12:05:00+00:00'

const pid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const addressOf = (id: string) => `p${id.slice(-4)}@exemple.test`

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
    'http://fn.test/functions/v1/professionals-invitation-reminders',
    {
      method: 'POST',
      headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
      body: JSON.stringify(body),
    },
  )
}

function harness(opts: {
  ids?: string[]
  list?: RpcRoute
  /** The re-issue answer per professional id (default: a fresh link). */
  reissue?: (
    id: string,
  ) => { data?: unknown; error?: { code: string } } | undefined
  start?: RpcRoute
  moduleEnabled?: boolean
  mailpit?: Responder
  env?: Record<string, string>
  /** Other service RPC routes (override the defaults). */
  rpc?: Record<string, RpcRoute>
} = {}) {
  let logIds = 0
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: opts.start ?? { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      list_professional_invitations_to_remind_for_service: opts.list ??
        { data: opts.ids ?? [pid(1)] },
      reissue_professional_invitation_for_service: (args) =>
        opts.reissue?.(String(args.p_id)) ?? {
          data: {
            link_id: pid(900),
            email: addressOf(String(args.p_id)),
            first_name: 'Nadia',
            expires_at: EXPIRES,
            clinic_name: 'Clinique MANA',
          },
        },
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

/** The token in an emailed invitation link. */
function emailedToken(body: string): string {
  const match = /\/invitation#t=([A-Za-z0-9_-]{43})/.exec(JSON.parse(body).Text)
  assert(match, 'no link in the email')
  return match[1]
}

Deno.test('professionals-invitation-reminders: only a signed request for this job runs; a bearer is ignored', async () => {
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
    const forged = await jobRequest()
    forged.headers.set('X-Job-Signature', `t=${NOW_S},v1=${'0'.repeat(64)}`)
    assertEquals((await handler(forged)).status, 401)
    const other = await handler(
      await jobRequest({
        job_key: 'core.storage_cleanup',
        org_id: null,
        trigger: 'cron',
      }),
    )
    assertEquals(other.status, 400)
    assertEquals(service.calls, [])
  })
})

Deno.test('professionals-invitation-reminders: re-issues each due file with a new token and emails it; skips the ones that no longer qualify', async () => {
  await run(async () => {
    const ids = [pid(1), pid(2), pid(3)]
    const { handler, service, http } = harness({
      ids,
      reissue: (id) => id === pid(2) ? { data: null } : undefined,
    })
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(
      callsTo(
        service.calls,
        'list_professional_invitations_to_remind_for_service',
      ),
      [
        { p_org: ORG_ID, p_limit: MAX_PER_RUN },
      ],
    )
    const reissued = callsTo(
      service.calls,
      'reissue_professional_invitation_for_service',
    )
    // The first file alone, then the batch in parallel: within the batch the
    // calls land in whatever order the token hashes resolve.
    assertEquals(
      [
        [reissued[0].p_org, reissued[0].p_id],
        ...reissued.slice(1).map((a) => [a.p_org, a.p_id]).sort((x, y) =>
          String(x[1]).localeCompare(String(y[1]))
        ),
      ],
      ids.map((id) => [ORG_ID, id]),
    )
    assertEquals(new Set(reissued.map((a) => a.p_token_hash)).size, 3)

    // Two emails, each with the token whose hash its re-issue stored.
    assertEquals(http.calls.length, 2)
    for (const call of http.calls) {
      const sent = JSON.parse(call.body)
      const to = sent.To[0].Email
      const id = [pid(1), pid(3)].find((i) => addressOf(i) === to)!
      const hash = reissued.find((a) => a.p_id === id)!.p_token_hash
      assertEquals(await hashToken(emailedToken(call.body)), hash)
      assertEquals(sent.Subject, 'Votre invitation vous attend')
      assert(sent.Text.includes('Bonjour Nadia'))
      assert(sent.Text.includes('Clinique MANA'))
    }
    const queued = callsTo(service.calls, 'queue_email')
    for (const q of queued) {
      assertEquals(q.p_template_key, 'professionals.invite_reminder')
      assertEquals(q.p_subject_type, 'professional')
      assertEquals(q.p_sent_by, null)
    }
    assertEquals(finished(service.calls), [[
      'ok',
      'listed=3 reminded=2 skipped=1 failed=0',
    ]])
  })
})

Deno.test('professionals-invitation-reminders: one file first, then batches of 2', async () => {
  await run(async () => {
    const ids = Array.from({ length: 30 }, (_, i) => pid(i + 1))
    const { handler, service } = harness({ ids })
    await handler(await jobRequest())
    const events = service.calls
      .filter((c) =>
        c.fn === 'reissue_professional_invitation_for_service' ||
        c.fn === 'queue_email'
      )
      .map((c) => ({
        kind: c.fn === 'queue_email' ? 'q' : 'r',
        id: String(c.args.p_id ?? c.args.p_subject_id),
      }))
    const order = events.map((e) => e.kind)
    // The first file is re-issued and queued alone.
    assertEquals(events.slice(0, 2), [
      { kind: 'r', id: pid(1) },
      { kind: 'q', id: pid(1) },
    ])
    // Then 2 in parallel (P4-424): both re-issues start before the batch's
    // first email, and the whole batch ends before the next one starts.
    const second = new Set(ids.slice(1, 1 + BATCH_SIZE))
    const firstQueued = order.indexOf('q', 2)
    assertEquals(order.slice(2, firstQueued).length, BATCH_SIZE)
    const lastOfSecond = events.findLastIndex((e) => second.has(e.id))
    const firstOfThird = events.findIndex((e) =>
      !second.has(e.id) && e.id !== pid(1)
    )
    assertEquals(lastOfSecond, 1 + 2 * BATCH_SIZE)
    assertEquals(firstOfThird, 2 + 2 * BATCH_SIZE)
    assertEquals(order.filter((o) => o === 'r').length, 30)
    assertEquals(finished(service.calls), [[
      'ok',
      'listed=30 reminded=30 skipped=0 failed=0',
    ]])
  })
})

Deno.test('professionals-invitation-reminders: already ran today (start_job_run null) → nothing listed', async () => {
  await run(async () => {
    const { handler, service, http } = harness({ start: { data: null } })
    const res = await handler(await jobRequest())
    assertEquals(await res.json(), { runs: 0 })
    assertEquals(
      callsTo(
        service.calls,
        'list_professional_invitations_to_remind_for_service',
      ),
      [],
    )
    assertEquals(http.calls, [])
  })
})

const reissuedIds = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  callsTo(calls, 'reissue_professional_invitation_for_service').map((a) =>
    String(a.p_id)
  )

/** Mailpit's answer by recipient: `status` for the listed files, else 200. */
const mailpitFailing =
  (failing: string[], status: number): Responder => async (req) => {
    const to = (await req.json()).To[0].Email
    return new Response(JSON.stringify({ ID: 'm' }), {
      status: failing.some((id) => addressOf(id) === to) ? status : 200,
    })
  }

const contextWith = (over: Record<string, unknown>): RpcRoute => (args) => ({
  data: {
    ...professionalsEmailContext(String(args.p_template_key)),
    ...over,
  },
})

Deno.test("professionals-invitation-reminders: the first file stops the run on any failure that is not its recipient's own; one link rotated at most", async () => {
  const ids = [pid(1), pid(2), pid(3)]
  const cases: [string, Parameters<typeof harness>[0], string][] = [
    [
      'not_configured',
      { env: { EMAIL_TRANSPORT: 'carrier-pigeon' } },
      'email_not_configured',
    ],
    [
      'module_disabled',
      { rpc: { get_email_context: contextWith({ module_enabled: false }) } },
      'email_not_configured',
    ],
    [
      'provider_error (unavailable)',
      { mailpit: mailpitFailing(ids, 500) },
      'reminders_stopped_provider_error',
    ],
    [
      'provider_error (rejected)',
      { mailpit: mailpitFailing(ids, 422) },
      'reminders_stopped_provider_error',
    ],
    [
      'rate_limited',
      {
        rpc: {
          consume_rate_limit: {
            data: [{ allowed: false, hits: 501, retry_after_seconds: 600 }],
          },
        },
      },
      'reminders_stopped_rate_limited',
    ],
    [
      'missing_variable',
      {
        reissue: (id) => ({
          data: {
            link_id: pid(900),
            email: addressOf(id),
            first_name: '',
            expires_at: 'pas une date',
            clinic_name: 'Clinique MANA',
          },
        }),
      },
      'reminders_stopped_missing_variable',
    ],
    [
      'internal (the send path threw)',
      { rpc: { get_email_context: { error: { code: 'XX000' } } } },
      'reminders_stopped_internal',
    ],
    [
      're-issue error',
      { reissue: () => ({ error: { code: 'XX000' } }) },
      'reminders_stopped_reissue_failed',
    ],
    [
      're-issue answer',
      { reissue: () => ({ data: { email: 'x' } }) },
      'reminders_stopped_reissue_invalid',
    ],
  ]
  await run(async () => {
    for (const [label, opts, code] of cases) {
      const { handler, service, http } = harness({ ids, ...opts })
      const logged = await captureConsole('error', async () => {
        const res = await handler(await jobRequest())
        assertEquals(res.status, 200, label)
      })
      assertEquals(reissuedIds(service.calls), [pid(1)], label)
      assertEquals(finished(service.calls), [['error', code]], label)
      assert(http.calls.length <= 1, label)
      // The run's code is reported with the org; nothing names the address.
      const lines = logged.map((l) => JSON.parse(String(l[0])))
      assert(lines.some((l) => l.code === code), label)
      assert(!JSON.stringify(logged).includes(addressOf(pid(1))), label)
    }
  })
})

Deno.test('professionals-invitation-reminders: a refused address or a skipped file does not end the probe: files go one at a time until a reminder has gone out', async () => {
  await run(async () => {
    const ids = Array.from({ length: 5 }, (_, i) => pid(i + 1))
    // pid 1 has an address the send refuses; pid 2 no longer qualifies.
    const { handler, service } = harness({
      ids,
      reissue: (id) =>
        id === pid(1)
          ? {
            data: {
              link_id: pid(900),
              email: 'pas une adresse',
              first_name: 'Nadia',
              expires_at: EXPIRES,
              clinic_name: 'Clinique MANA',
            },
          }
          : id === pid(2)
          ? { data: null }
          : undefined,
    })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    const events = service.calls
      .filter((c) =>
        c.fn === 'reissue_professional_invitation_for_service' ||
        c.fn === 'queue_email'
      )
      .map((c) =>
        c.fn === 'queue_email'
          ? 'q'
          : `r${Number(String(c.args.p_id).slice(-12))}`
      )
    // 1 (refused before queueing), 2 (skipped), 3 (sent) alone; then 4 and 5.
    assertEquals(events.slice(0, 4), ['r1', 'r2', 'r3', 'q'])
    assertEquals(events.slice(4, 6).sort(), ['r4', 'r5'])
    assertEquals(finished(service.calls), [[
      'ok',
      'listed=5 reminded=3 skipped=1 failed=1',
    ]])

    // During the probe, the second file is the first to reach the provider.
    const probe = harness({
      ids,
      reissue: (id) => id === pid(1) ? { data: null } : undefined,
      mailpit: mailpitFailing(ids, 500),
    })
    await captureConsole('error', async () => {
      await probe.handler(await jobRequest())
    })
    assertEquals(reissuedIds(probe.service.calls), [pid(1), pid(2)])
    assertEquals(finished(probe.service.calls), [[
      'error',
      'reminders_stopped_provider_error',
    ]])
  })
})

Deno.test('professionals-invitation-reminders: after the probe, a batch that hits provider_error or rate_limited stops the run before the next batch', async () => {
  await run(async () => {
    const ids = Array.from({ length: 60 }, (_, i) => pid(i + 1))
    let consumed = 0
    // [options, run code, files re-issued: the probe and every batch up to the failing one]
    const cases: [Parameters<typeof harness>[0], string, number][] = [
      [
        { ids, mailpit: mailpitFailing([pid(7)], 500) },
        'reminders_stopped_provider_error',
        7,
      ],
      [
        {
          ids,
          rpc: {
            // Two hits per send (emails.org_day, emails.same_address): after
            // the probe and nine more sends, the batch meets a refusal.
            consume_rate_limit: () => {
              const allowed = ++consumed <= 20
              return {
                data: [{
                  allowed,
                  hits: consumed,
                  retry_after_seconds: allowed ? 0 : 600,
                }],
              }
            },
          },
        },
        'reminders_stopped_rate_limited',
        11,
      ],
    ]
    for (const [opts, code, reissued] of cases) {
      const { handler, service } = harness(opts)
      const logged = await captureConsole('error', async () => {
        await handler(await jobRequest())
      })
      // The probe and the batches up to the failing one (2 files each), never the next.
      assertEquals(reissuedIds(service.calls).length, reissued, code)
      assertEquals(finished(service.calls), [['error', code]], code)
      const lines = logged.map((l) => JSON.parse(String(l[0])))
      assert(
        lines.some((l) =>
          l.code === code.replace('reminders_stopped_', 'reminder_email_')
        ),
        code,
      )
    }
  })
})

Deno.test("professionals-invitation-reminders: after the probe, a file's own failure (re-issue, address, template) is counted and reported with ids only; the run goes on", async () => {
  await run(async () => {
    const ids = [pid(1), pid(2), pid(3), pid(4)]
    const { handler, service, http } = harness({
      ids,
      reissue: (id) =>
        id === pid(2) ? { error: { code: 'XX000' } } : id === pid(3)
          ? {
            data: {
              link_id: pid(900),
              email: 'pas une adresse',
              first_name: 'Nadia',
              expires_at: EXPIRES,
              clinic_name: 'Clinique MANA',
            },
          }
          : undefined,
    })
    const logged = await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    const lines = logged.map((l) => JSON.parse(String(l[0])))
    const reissueFailed = lines.find((l) => l.code === 'reissue_failed')
    assertEquals(reissueFailed?.ids, {
      org_id: ORG_ID,
      professional_id: pid(2),
    })
    assert(lines.some((l) => l.code === 'reminder_email_invalid_recipient'))
    assertEquals(finished(service.calls), [[
      'ok',
      'listed=4 reminded=2 skipped=0 failed=2',
    ]])
    // No token or address in any line.
    const text = JSON.stringify(logged)
    for (const call of http.calls) {
      assert(!text.includes(emailedToken(call.body)))
      assert(!text.includes(JSON.parse(call.body).To[0].Email))
    }
    assert(!text.includes('pas une adresse'))
    assert(!text.includes('#t='))
  })
})

Deno.test('professionals-invitation-reminders: an abort before the re-issue rotates nothing; once a link has rotated, its email is still sent', async () => {
  await run(async () => {
    // Aborted before the run starts: nothing listed is re-issued.
    const early = harness({ ids: [pid(1), pid(2)] })
    const aborted = new AbortController()
    aborted.abort()
    assertEquals(
      await remindOrg(early.deps, ORG_ID, early.service.client, aborted.signal),
      'listed=2 reminded=0 skipped=0 failed=0',
    )
    assertEquals(reissuedIds(early.service.calls), [])
    assertEquals(early.http.calls, [])

    // The timeout fires during the batch's first re-issue: that file's link
    // has rotated, so its email goes out (no signal reaches the send); the
    // batch's other files see the abort before their re-issue.
    const ids = Array.from({ length: 10 }, (_, i) => pid(i + 1))
    const controller = new AbortController()
    let reissues = 0
    const mid = harness({
      ids,
      reissue: (id) => {
        if (++reissues === 2) controller.abort()
        return {
          data: {
            link_id: pid(900),
            email: addressOf(id),
            first_name: 'Nadia',
            expires_at: EXPIRES,
            clinic_name: 'Clinique MANA',
          },
        }
      },
    })
    const detail = await remindOrg(
      mid.deps,
      ORG_ID,
      mid.service.client,
      controller.signal,
    )
    assertEquals(detail, 'listed=10 reminded=2 skipped=0 failed=0')
    const reissued = reissuedIds(mid.service.calls)
    assertEquals(reissued.length, 2)
    assertEquals(reissued[0], pid(1))
    // Both rotated links were emailed, each with the token its hash stored.
    assertEquals(mid.http.calls.length, 2)
    for (const call of mid.http.calls) {
      const to = JSON.parse(call.body).To[0].Email
      const id = reissued.find((i) => addressOf(i) === to)!
      const hash = callsTo(
        mid.service.calls,
        'reissue_professional_invitation_for_service',
      ).find((a) => a.p_id === id)!.p_token_hash
      assertEquals(await hashToken(emailedToken(call.body)), hash)
    }
  })
})

Deno.test('professionals-invitation-reminders: the module off for the clinic → the run fails module_disabled before any list, link or email (P4-471)', async () => {
  await run(async () => {
    const off = harness({ ids: [pid(1), pid(2)], moduleEnabled: false })
    await captureConsole('error', async () => {
      await off.handler(await jobRequest())
    })
    assertEquals(finished(off.service.calls), [['error', 'module_disabled']])
    assertEquals(callsTo(off.service.calls, 'module_enabled_for_org'), [
      { p_org_id: ORG_ID, p_key: 'professionals' },
    ])
    assertEquals(
      callsTo(off.service.calls, 'list_professional_invitations_to_remind_for_service'),
      [],
    )
    assertEquals(reissuedIds(off.service.calls), [])
    assertEquals(off.http.calls, [])
  })
})

Deno.test('professionals-invitation-reminders: an APP_URL links cannot use, or a list failure, fails the run before any link', async () => {
  await run(async () => {
    const badUrl = harness({ env: { APP_URL: 'http://app.example.com' } })
    await captureConsole('error', async () => {
      await badUrl.handler(await jobRequest())
    })
    assertEquals(finished(badUrl.service.calls), [['error', 'app_url_invalid']])
    assertEquals(
      callsTo(
        badUrl.service.calls,
        'list_professional_invitations_to_remind_for_service',
      ),
      [],
    )

    for (
      const list of [{ error: { code: 'XX000' } }, { data: ['not-a-uuid'] }, {
        data: null,
      }]
    ) {
      const broken = harness({ list })
      await captureConsole('error', async () => {
        await broken.handler(await jobRequest())
      })
      assertEquals(finished(broken.service.calls), [[
        'error',
        'reminders_list_failed',
      ]])
      assertEquals(
        callsTo(
          broken.service.calls,
          'reissue_professional_invitation_for_service',
        ),
        [],
      )
    }
  })
})

Deno.test('professionals-invitation-reminders: a manual run (« Exécuter maintenant ») covers the signed org only', async () => {
  await run(async () => {
    const { handler, service } = harness()
    const res = await handler(
      await jobRequest({ job_key: JOB_KEY, org_id: ORG_ID, trigger: 'manual' }),
    )
    assertEquals(await res.json(), { runs: 1 })
    assertEquals(callsTo(service.calls, 'list_job_orgs'), [])
    assertEquals(callsTo(service.calls, 'start_job_run'), [
      { p_key: JOB_KEY, p_org_id: ORG_ID, p_trigger: 'manual' },
    ])
  })
})

Deno.test('professionals-invitation-reminders: no batch starts after the soft deadline; the files left wait (P4-424)', async () => {
  await run(async () => {
    const ids = Array.from({ length: 10 }, (_, i) => pid(i + 1))
    const clock = fixedClock(NOW)
    // Each re-issue takes 13 s of the run: the probe (13 s) leaves time for one batch of 2
    // (39 s in all), after which no batch starts.
    const h = harness({
      ids,
      reissue: (id) => {
        clock.advance(13_000)
        return {
          data: {
            link_id: pid(900),
            email: addressOf(id),
            first_name: 'Nadia',
            expires_at: EXPIRES,
            clinic_name: 'Clinique MANA',
          },
        }
      },
    })
    assert(13_000 + 13_000 * BATCH_SIZE >= SOFT_DEADLINE_MS)
    const detail = await remindOrg(
      { ...h.deps, now: clock.now },
      ORG_ID,
      h.service.client,
      new AbortController().signal,
    )
    assertEquals(
      detail,
      `listed=10 reminded=${1 + BATCH_SIZE} skipped=0 failed=0 deferred=${
        10 - 1 - BATCH_SIZE
      }`,
    )
    assertEquals(reissuedIds(h.service.calls).length, 1 + BATCH_SIZE)
    assertEquals(h.http.calls.length, 1 + BATCH_SIZE)
  })
})
