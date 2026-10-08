import { assert, assertEquals } from '@std/assert'
import { createHandler, JOB_KEY, MAX_PER_RUN } from './handler.ts'
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
  mailpit?: Responder
  env?: Record<string, string>
} = {}) {
  let logIds = 0
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: opts.start ?? { data: 'run-1' },
      finish_job_run: { data: null },
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
  return { handler: createHandler(deps), service, http }
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

Deno.test('professionals-invitation-reminders: one file first, then batches of 25', async () => {
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
    // Then 25 in parallel: several re-issues start before the batch's first
    // email (how many depends on when each token hash resolves), and the whole
    // batch ends before the next one starts.
    const second = new Set(ids.slice(1, 26))
    const firstQueued = order.indexOf('q', 2)
    assert(order.slice(2, firstQueued).length > 1)
    const lastOfSecond = events.findLastIndex((e) => second.has(e.id))
    const firstOfThird = events.findIndex((e) =>
      !second.has(e.id) && e.id !== pid(1)
    )
    assertEquals(lastOfSecond, 51)
    assertEquals(firstOfThird, 52)
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

Deno.test('professionals-invitation-reminders: an email setup failure stops the run after the first file', async () => {
  await run(async () => {
    const ids = [pid(1), pid(2), pid(3)]
    const { handler, service, http } = harness({
      ids,
      env: { EMAIL_TRANSPORT: 'carrier-pigeon' },
    })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(
      callsTo(service.calls, 'reissue_professional_invitation_for_service')
        .length,
      1,
    )
    assertEquals(http.calls, [])
    assertEquals(finished(service.calls), [['error', 'email_not_configured']])
  })
})

Deno.test('professionals-invitation-reminders: a failed re-issue or email is counted and reported with ids only; the run goes on', async () => {
  await run(async () => {
    const ids = [pid(1), pid(2), pid(3)]
    let mails = 0
    const { handler, service, http } = harness({
      ids,
      reissue: (id) => id === pid(2) ? { error: { code: 'XX000' } } : undefined,
      mailpit: () =>
        new Response(JSON.stringify({ ID: 'm' }), {
          status: mails++ === 0 ? 500 : 200,
        }),
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
    assert(lines.some((l) => l.code === 'reminder_email_provider_error'))
    const [[status, detail]] = finished(service.calls)
    assertEquals(status, 'ok')
    assertEquals(detail, 'listed=3 reminded=1 skipped=0 failed=2')
    // No token or address in any line.
    const text = JSON.stringify(logged)
    for (const call of http.calls) {
      assert(!text.includes(emailedToken(call.body)))
      assert(!text.includes(JSON.parse(call.body).To[0].Email))
    }
    assert(!text.includes('#t='))
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
