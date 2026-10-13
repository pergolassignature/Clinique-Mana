import { assert, assertEquals } from '@std/assert'
import { BATCH_LIMIT, createHandler, followUpOrg, JOB_KEY } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  emailContextFixture,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const SECRET = 'local-dev-internal-function-secret'
const NOW = '2026-10-13T11:15:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const rid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const prepared = (language: 'fr' | 'en' = 'fr') => ({
  demande_id: rid(500),
  email: 'bruno@exemple.test',
  first_name: 'Bruno',
  language,
  clinic_name: 'Clinique MANA',
  list_name: 'Psychologie',
  link_expires_at: '2026-10-27T11:15:00Z',
})

function harness(opts: {
  pass?: RpcRoute
  prepare?: RpcRoute
  moduleEnabled?: boolean
  mailStatus?: number
} = {}) {
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      waitlist_followup_for_service: opts.pass ??
        {
          data: {
            promoted: 1,
            to_call: 3,
            no_answer: 2,
            email: [rid(1), rid(2)],
          },
        },
      prepare_waitlist_followup_for_service: opts.prepare ??
        { data: prepared() },
      mark_waitlist_followup_sent_for_service: { data: null },
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      get_email_context: (args) => ({
        data: emailContextFixture({
          module_key: 'demandes',
          template: {
            key: String(args.p_template_key),
            subject: 'Toujours sur la liste ? — {{clinic.name}}',
            body: 'Bonjour {{person.first_name}} ({{waitlist.name}})',
            button_label: 'Répondre',
            view_permission: 'demandes.view',
            variables: ['person.first_name', 'clinic.name', 'waitlist.name']
              .map((path) => ({
                path,
                label: path,
                sample: 'x',
                required: true,
                kind: 'text',
              })),
          },
        }),
      }),
      queue_email: { data: rid(800) },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
    },
  })
  const http = fakeFetch({
    [MAILPIT]: () =>
      new Response(JSON.stringify({ ID: 'm' }), {
        status: opts.mailStatus ?? 200,
      }),
  })
  const env: Record<string, string> = {
    APP_URL: 'http://localhost:5173',
    EMAIL_TRANSPORT: 'mailpit',
    MAILPIT_URL: 'http://mailpit.test:8025',
    INTERNAL_FUNCTION_SECRET: SECRET,
  }
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

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

async function jobRequest(jobKey = JOB_KEY): Promise<Request> {
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
      encoder.encode(`${NOW_S}.${jobKey}..cron`),
    ),
  )
  return new Request('http://fn.test/functions/v1/demandes-waitlist-followup', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: jobKey, org_id: null, trigger: 'cron' }),
  })
}

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

Deno.test('demandes-waitlist-followup: only a signed request for this job runs', async () => {
  await run(async () => {
    const { handler, service } = harness()
    assertEquals(
      (await handler(await jobRequest('clients.consent_reminders'))).status,
      400,
    )
    assertEquals(service.calls, [])
  })
})

Deno.test('demandes-waitlist-followup: the pass, then each entry prepared with a hashed token and emailed with its link; counts only', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(callsTo(service.calls, 'waitlist_followup_for_service'), [{
      p_org_id: ORG_ID,
      p_limit: BATCH_LIMIT,
    }])
    const prepares = callsTo(
      service.calls,
      'prepare_waitlist_followup_for_service',
    )
    assertEquals(prepares.map((p) => p.p_entry_id), [rid(1), rid(2)])
    assert(
      prepares.every((p) => /^\\x[0-9a-f]{64}$/.test(String(p.p_token_hash))),
    )
    assert(prepares[0].p_token_hash !== prepares[1].p_token_hash)
    assertEquals(http.calls.length, 2)
    assertEquals(
      callsTo(service.calls, 'mark_waitlist_followup_sent_for_service').map((
        a,
      ) => [a.p_entry_id, a.p_sent]),
      [[rid(1), true], [rid(2), true]],
    )
    const sent = JSON.stringify(http.calls[0])
    assert(sent.includes('/liste-attente/reponse#t='))
    const detail = callsTo(service.calls, 'finish_job_run').map((a) =>
      a.p_detail
    )
    assertEquals(detail, [
      'promoted=1 to_call=3 no_answer=2 emailed=2 skipped=0 failed=0',
    ])
    assert(!String(detail[0]).includes('@'))
  })
})

Deno.test('demandes-waitlist-followup: English, the English template; an entry that may no longer go is skipped', async () => {
  await run(async () => {
    let n = 0
    const { handler, service, http } = harness({
      prepare: () => ++n === 1 ? { data: null } : { data: prepared('en') },
    })
    await handler(await jobRequest())
    assertEquals(http.calls.length, 1)
    assertEquals(
      callsTo(service.calls, 'get_email_context').map((a) => a.p_template_key),
      ['demandes.waitlist_still_waiting_en'],
    )
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['promoted=1 to_call=3 no_answer=2 emailed=1 skipped=1 failed=0'],
    )
  })
})

Deno.test('demandes-waitlist-followup: a send that fails is marked not sent (its link revoked), counted failed', async () => {
  await run(async () => {
    const { handler, service } = harness({ mailStatus: 500 })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(
      callsTo(service.calls, 'mark_waitlist_followup_sent_for_service').map((
        a,
      ) => a.p_sent),
      [false, false],
    )
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['promoted=1 to_call=3 no_answer=2 emailed=0 skipped=0 failed=2'],
    )
  })
})

Deno.test('demandes-waitlist-followup: no email to send — the pass alone', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      pass: { data: { promoted: 0, to_call: 1, no_answer: 0, email: [] } },
    })
    await handler(await jobRequest())
    assertEquals(http.calls.length, 0)
    assertEquals(
      callsTo(service.calls, 'prepare_waitlist_followup_for_service'),
      [],
    )
  })
})

Deno.test('demandes-waitlist-followup: module off, an RPC failure → the run fails with a code', async () => {
  await run(async () => {
    for (
      const [opts, code] of [
        [{ moduleEnabled: false }, 'module_disabled'],
        [{ pass: { error: { code: 'XX000' } } }, 'followup_failed'],
        [{ pass: { data: { email: 'x' } } }, 'followup_invalid'],
      ] as const
    ) {
      const { deps, service } = harness(opts as Parameters<typeof harness>[0])
      let got: string | undefined
      try {
        await followUpOrg(
          deps,
          ORG_ID,
          service.client,
          new AbortController().signal,
        )
      } catch (error) {
        got = (error as { code?: string }).code
      }
      assertEquals(got, code)
    }
  })
})
