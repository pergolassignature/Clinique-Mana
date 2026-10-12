import { assert, assertEquals } from '@std/assert'
import { BATCH_LIMIT, createHandler, JOB_KEY, remindOrg } from './handler.ts'
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
const NOW = '2026-10-12T12:05:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const rid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const prepared = (requestId: string) => ({
  request_id: requestId,
  resent: true,
  language: 'fr',
  consent_name: 'Consentement général',
  client_first_name: 'Léa',
  clinic_name: 'Clinique MANA',
  expires_at: '2026-10-26T12:00:00Z',
  signers: [{
    role: 'client',
    signer_id: rid(900),
    first_name: 'Marc',
    full_name: 'Marc Gagnon',
    email: `marc+${requestId.slice(-2)}@exemple.test`,
    link_id: rid(901),
  }],
})

const emailContext = () =>
  emailContextFixture({
    module_key: 'clients',
    template: {
      key: 'clients.consent_request',
      subject: '{{consent.name}}',
      body: 'Bonjour {{signer.first_name}}',
      button_label: 'Lire et signer',
      view_permission: 'clients.view',
      variables: [{
        path: 'signer.first_name',
        label: 'Prénom',
        sample: 'x',
        required: true,
        kind: 'text',
      }, {
        path: 'consent.name',
        label: 'Nom',
        sample: 'x',
        required: true,
        kind: 'text',
      }],
    },
  })

function harness(opts: {
  due?: RpcRoute
  prepare?: RpcRoute
  moduleEnabled?: boolean
} = {}) {
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      client_consent_reminders_for_service: opts.due ??
        { data: { remind: [rid(1), rid(2)], overdue: 3 } },
      prepare_client_consent_request_for_service: opts.prepare ??
        ((args) => ({ data: prepared(String(args.p_request_id)) })),
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      get_email_context: { data: emailContext() },
      queue_email: { data: rid(800) },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
    },
  })
  const http = fakeFetch({
    [MAILPIT]: () => new Response(JSON.stringify({ ID: 'm' }), { status: 200 }),
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
  return new Request('http://fn.test/functions/v1/clients-consent-reminders', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: jobKey, org_id: null, trigger: 'cron' }),
  })
}

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

Deno.test('clients-consent-reminders: only a signed request for this job runs', async () => {
  await run(async () => {
    const { handler, service } = harness()
    assertEquals(
      (await handler(await jobRequest('professionals.invitation_reminders')))
        .status,
      400,
    )
    assertEquals(service.calls, [])
  })
})

Deno.test('clients-consent-reminders: each due request is sent again with no actor (new links), its signers emailed; counts only', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(
      callsTo(service.calls, 'client_consent_reminders_for_service'),
      [{ p_org_id: ORG_ID, p_limit: BATCH_LIMIT }],
    )
    const prepares = callsTo(
      service.calls,
      'prepare_client_consent_request_for_service',
    )
    assertEquals(
      prepares.map((p) => [p.p_actor, p.p_request_id, p.p_client_id]),
      [
        [null, rid(1), null],
        [null, rid(2), null],
      ],
    )
    assertEquals(http.calls.length, 2)
    const detail = callsTo(service.calls, 'finish_job_run').map((
      a,
    ) => [a.p_status, a.p_detail])
    assertEquals(detail, [['ok', 'reminded=2 failed=0 overdue=3']])
    assert(!String(detail[0][1]).includes('@'))
  })
})

Deno.test('clients-consent-reminders: a refusal (the file changed) is counted, unreported; the others go on', async () => {
  await run(async () => {
    let n = 0
    const { handler, service } = harness({
      prepare: (args) =>
        ++n === 1
          ? {
            error: {
              code: 'P0001',
              message: 'Ce dossier client n’est pas actif.',
              hint: 'client',
            },
          }
          : { data: prepared(String(args.p_request_id)) },
    })
    const lines = await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(lines, [])
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['reminded=1 failed=1 overdue=3'],
    )
  })
})

Deno.test('clients-consent-reminders: module off, an RPC failure → the run fails with a code', async () => {
  await run(async () => {
    for (
      const [opts, code] of [
        [{ moduleEnabled: false }, 'module_disabled'],
        [{ due: { error: { code: 'XX000' } } }, 'reminders_failed'],
        [{ due: { data: { remind: 'x' } } }, 'reminders_invalid'],
      ] as const
    ) {
      const { deps, service } = harness(opts as Parameters<typeof harness>[0])
      let got: string | undefined
      try {
        await remindOrg(
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
