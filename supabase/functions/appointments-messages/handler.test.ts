import { assert, assertEquals } from '@std/assert'
import { BATCH_LIMIT, createHandler, JOB_KEY, sendOrg } from './handler.ts'
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
const NOW = '2026-10-16T12:15:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const rid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const prepared = (
  kind: 'confirmation' | 'reminder' | 'changed' | 'cancelled' = 'reminder',
  language: 'fr' | 'en' = 'fr',
) => ({
  message_id: rid(1),
  appointment_id: rid(300),
  kind,
  language,
  email: 'camille@exemple.test',
  recipient_first_name: 'Camille',
  client_first_name: 'Léa',
  starts_at: '2026-10-19T14:00:00Z',
  professional_name: 'Félix Martin',
  access: 'Par vidéo : https://zoom.us/j/123',
  clinic_name: 'Clinique MANA',
  with_link: kind !== 'cancelled',
})

const VARIABLES = [
  'recipient.first_name',
  'client.first_name',
  'appointment.access',
  'professional.name',
  'clinic.name',
].map((path) => ({
  path,
  label: path,
  sample: 'x',
  required: true,
  kind: 'text',
}))
  .concat([{
    path: 'appointment.starts_at',
    label: 'Date',
    sample: 'x',
    required: true,
    kind: 'datetime',
  }])

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
      appointment_messages_for_service: opts.pass ??
        { data: { reminders: 4, email: [rid(1), rid(2)] } },
      prepare_appointment_message_for_service: opts.prepare ??
        { data: prepared() },
      finish_appointment_message_for_service: { data: null },
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      get_email_context: (args) => ({
        data: emailContextFixture({
          module_key: 'appointments',
          template: {
            key: String(args.p_template_key),
            subject: 'Rendez-vous — {{clinic.name}}',
            body:
              'Bonjour {{recipient.first_name}}, {{client.first_name}} voit {{professional.name}} le {{appointment.starts_at}}. {{appointment.access}}',
            button_label: String(args.p_template_key).startsWith(
                'appointments.cancelled',
              )
              ? null
              : 'Confirmer ma présence',
            view_permission: 'appointments.view',
            variables: VARIABLES,
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
  return new Request('http://fn.test/functions/v1/appointments-messages', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: jobKey, org_id: null, trigger: 'cron' }),
  })
}

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

Deno.test('appointments-messages: only a signed request for this job runs', async () => {
  await run(async () => {
    const { handler, service } = harness()
    assertEquals(
      (await handler(await jobRequest('clients.consent_reminders'))).status,
      400,
    )
    assertEquals(service.calls, [])
  })
})

Deno.test('appointments-messages: the pass, then each email prepared with a hashed token and sent with its link; counts only', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(callsTo(service.calls, 'appointment_messages_for_service'), [{
      p_org_id: ORG_ID,
      p_limit: BATCH_LIMIT,
    }])
    const prepares = callsTo(
      service.calls,
      'prepare_appointment_message_for_service',
    )
    assertEquals(prepares.map((p) => p.p_message_id), [rid(1), rid(2)])
    assert(
      prepares.every((p) => /^\\x[0-9a-f]{64}$/.test(String(p.p_token_hash))),
    )
    assert(prepares[0].p_token_hash !== prepares[1].p_token_hash)
    assertEquals(http.calls.length, 2)
    assertEquals(
      callsTo(service.calls, 'get_email_context').map((a) => a.p_template_key),
      ['appointments.reminder', 'appointments.reminder'],
    )
    assertEquals(
      callsTo(service.calls, 'finish_appointment_message_for_service').map((
        a,
      ) => [a.p_message_id, a.p_sent]),
      [[rid(1), true], [rid(2), true]],
    )
    assert(JSON.stringify(http.calls[0]).includes('/rendez-vous/confirmer#t='))
    const detail = callsTo(service.calls, 'finish_job_run').map((a) =>
      a.p_detail
    )
    assertEquals(detail, ['reminders=4 emailed=2 skipped=0 failed=0'])
    assert(!String(detail[0]).includes('@'))
  })
})

Deno.test('appointments-messages: English, a cancellation without a link; a message that may no longer go is skipped', async () => {
  await run(async () => {
    let n = 0
    const { handler, service, http } = harness({
      prepare: () =>
        ++n === 1 ? { data: null } : { data: prepared('cancelled', 'en') },
    })
    await handler(await jobRequest())
    assertEquals(http.calls.length, 1)
    assertEquals(
      callsTo(service.calls, 'get_email_context').map((a) => a.p_template_key),
      ['appointments.cancelled_en'],
    )
    assert(!JSON.stringify(http.calls[0]).includes('#t='))
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['reminders=4 emailed=1 skipped=1 failed=0'],
    )
  })
})

Deno.test('appointments-messages: a send that fails is finished not sent (tried again), counted failed', async () => {
  await run(async () => {
    const { handler, service } = harness({ mailStatus: 500 })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(
      callsTo(service.calls, 'finish_appointment_message_for_service').map((
        a,
      ) => a.p_sent),
      [false, false],
    )
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['reminders=4 emailed=0 skipped=0 failed=2'],
    )
  })
})

Deno.test('appointments-messages: module off, an RPC failure → the run fails with a code', async () => {
  await run(async () => {
    for (
      const [opts, code] of [
        [{ moduleEnabled: false }, 'module_disabled'],
        [{ pass: { error: { code: 'XX000' } } }, 'pass_failed'],
        [{ pass: { data: { email: 'x' } } }, 'pass_invalid'],
      ] as const
    ) {
      const { deps, service } = harness(opts as Parameters<typeof harness>[0])
      let got: string | undefined
      try {
        await sendOrg(
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
