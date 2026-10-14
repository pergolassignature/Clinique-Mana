import { assert, assertEquals } from '@std/assert'
import {
  BATCH_LIMIT,
  createHandler,
  JOB_KEY,
  sendCampaignBatch,
} from './handler.ts'
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
const NOW = '2026-10-14T13:15:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const rid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACTOR = rid(700)

const prepared = (clientId: string) => ({
  request_id: `${clientId.slice(0, -3)}9${clientId.slice(-2)}`,
  resent: false,
  language: 'fr',
  consent_name: 'Consentement général',
  client_first_name: 'Léa',
  clinic_name: 'Clinique MANA',
  expires_at: '2026-10-28T12:00:00Z',
  signers: [{
    role: 'client',
    signer_id: rid(900),
    first_name: 'Léa',
    full_name: 'Léa Essai',
    email: `lea+${clientId.slice(-2)}@exemple.test`,
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

const item = (n: number) => ({
  item_id: rid(n),
  client_id: rid(100 + n),
  consent_key: 'general',
  actor: ACTOR,
})

function harness(opts: {
  batch?: RpcRoute
  prepare?: RpcRoute
  moduleEnabled?: boolean
  mailpitStatus?: number
} = {}) {
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: opts.moduleEnabled ?? true },
      client_consent_campaign_batch_for_service: opts.batch ??
        { data: [item(1), item(2)] },
      prepare_client_consent_request_for_service: opts.prepare ??
        ((args) => ({ data: prepared(String(args.p_client_id)) })),
      finish_client_consent_campaign_item_for_service: { data: null },
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
    [MAILPIT]: () =>
      new Response(JSON.stringify({ ID: 'm' }), {
        status: opts.mailpitStatus ?? 200,
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
  return new Request('http://fn.test/functions/v1/clients-consent-campaign', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: jobKey, org_id: null, trigger: 'cron' }),
  })
}

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

Deno.test('clients-consent-campaign: only a signed request for this job runs', async () => {
  await run(async () => {
    const { handler, service } = harness()
    assertEquals(
      (await handler(await jobRequest('clients.consent_reminders'))).status,
      400,
    )
    assertEquals(service.calls, [])
  })
})

Deno.test('clients-consent-campaign: each item sent as « Envoyer » with the author as actor, then recorded; counts only', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(
      callsTo(service.calls, 'client_consent_campaign_batch_for_service'),
      [{ p_org_id: ORG_ID, p_limit: BATCH_LIMIT }],
    )
    assertEquals(
      callsTo(service.calls, 'prepare_client_consent_request_for_service').map((
        p,
      ) => [
        p.p_actor,
        p.p_client_id,
        p.p_consent_key,
        p.p_context_type,
        p.p_request_id,
      ]),
      [
        [ACTOR, rid(101), 'general', 'record', null],
        [ACTOR, rid(102), 'general', 'record', null],
      ],
    )
    assertEquals(http.calls.length, 2)
    assertEquals(
      callsTo(service.calls, 'finish_client_consent_campaign_item_for_service')
        .map((a) => [a.p_item_id, a.p_sent, a.p_failure]),
      [[rid(1), true, null], [rid(2), true, null]],
    )
    const detail = callsTo(service.calls, 'finish_job_run').map((a) =>
      a.p_detail
    )
    assertEquals(detail, ['sent=2 failed=0'])
    assert(!String(detail[0]).includes('@'))
  })
})

Deno.test('clients-consent-campaign: a refusal keeps its HINT, unreported; an email that did not leave is `email`; the others go on', async () => {
  await run(async () => {
    let n = 0
    const { handler, service } = harness({
      prepare: (args) =>
        ++n === 1
          ? {
            error: {
              code: 'P0001',
              message:
                'La personne qui doit signer n’a pas d’adresse courriel.',
              hint: 'signer_email',
            },
          }
          : { data: prepared(String(args.p_client_id)) },
      mailpitStatus: 500,
    })
    let lines: unknown[][] = []
    lines = await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assert(!lines.flat().join(' ').includes('prepare_failed'))
    assertEquals(
      callsTo(service.calls, 'finish_client_consent_campaign_item_for_service')
        .map((a) => [a.p_sent, a.p_failure]),
      [[false, 'signer_email'], [false, 'email']],
    )
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['sent=0 failed=2'],
    )
  })
})

Deno.test('clients-consent-campaign: the actor without clients.manage (42501) is `permission`', async () => {
  await run(async () => {
    const { handler, service } = harness({
      batch: { data: [item(1)] },
      prepare: {
        error: {
          code: '42501',
          message: 'Permission refusée : clients.manage',
        },
      },
    })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    assertEquals(
      callsTo(service.calls, 'finish_client_consent_campaign_item_for_service')
        .map((a) => a.p_failure),
      ['permission'],
    )
  })
})

Deno.test('clients-consent-campaign: module off, an RPC failure, a bad batch → the run fails with a code', async () => {
  await run(async () => {
    for (
      const [opts, code] of [
        [{ moduleEnabled: false }, 'module_disabled'],
        [{ batch: { error: { code: 'XX000' } } }, 'batch_failed'],
        [{ batch: { data: [{ item_id: 1 }] } }, 'batch_invalid'],
      ] as const
    ) {
      const { deps, service } = harness(opts as Parameters<typeof harness>[0])
      let got: string | undefined
      try {
        await sendCampaignBatch(
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
