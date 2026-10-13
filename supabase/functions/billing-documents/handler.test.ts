import { assert, assertEquals } from '@std/assert'
import { BATCH_LIMIT, createHandler, deliverOrg, JOB_KEY } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  emailContextFixture,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'
import { invoiceDoc, receiptDoc } from '../_shared/testing/billing-fixtures.ts'

const SECRET = 'local-dev-internal-function-secret'
const NOW = '2026-10-14T12:15:00Z'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const rid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PDF = new TextEncoder().encode('%PDF-1.3\n1 0 obj\n<<>>\nendobj\n%%EOF\n')

/** A claimed delivery as `billing_document_for_service` returns it. */
const delivery = (n: number, over: Record<string, unknown> = {}) => ({
  delivery_id: rid(n),
  kind: 'invoice',
  document_id: rid(1),
  explicit: false,
  attempts: 1,
  document: invoiceDoc(),
  stored: null,
  logo: null,
  email: { to: 'camille@exemple.test', first_name: 'Camille', language: 'fr' },
  skip_reason: null,
  ...over,
})

const VARIABLES = [
  'recipient.first_name',
  'client.first_name',
  'document.number',
  'document.amount',
  'clinic.name',
]
  .map((path) => ({
    path,
    label: path,
    sample: 'x',
    required: true,
    kind: 'text',
  }))

function harness(opts: {
  deliveries?: Record<string, unknown>[]
  moduleOpen?: boolean
  mailStatus?: number
  permissions?: string[]
  userRpc?: Record<string, RpcRoute>
  payLink?: boolean
  buttonLabel?: string | null
} = {}) {
  const docs = opts.deliveries ?? [delivery(11)]
  const service = fakeSupabase({
    rpc: {
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: { data: 'run-1' },
      finish_job_run: { data: null },
      module_enabled_for_org: { data: true },
      billing_deliveries_for_service: { data: docs.map((d) => d.delivery_id) },
      billing_document_for_service: (args) => ({
        data: docs.find((d) => d.delivery_id === args.p_delivery_id) ?? null,
      }),
      register_system_file: (args) => ({
        data: [{
          file_id: rid(500),
          object_path: `${ORG_ID}/billing/${args.p_subject_id}/${rid(500)}.pdf`,
        }],
      }),
      discard_billing_file_for_service: { data: null },
      issue_billing_link_for_service: { data: opts.payLink ?? false },
      finish_billing_delivery_for_service: { data: null },
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      get_email_context: (args) => ({
        data: emailContextFixture({
          module_key: 'billing',
          module_open: opts.moduleOpen ?? true,
          template: {
            key: String(args.p_template_key),
            subject: 'Facture {{document.number}} — {{clinic.name}}',
            body:
              'Bonjour {{recipient.first_name}}, voici la facture {{document.number}} de {{client.first_name}} : {{document.amount}}.',
            button_label: opts.buttonLabel ?? null,
            view_permission: 'billing.view',
            variables: VARIABLES,
            allows_attachments: true,
          },
        }),
      }),
      queue_email: { data: rid(800) },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
    },
    storage: {
      upload: () => ({ data: { path: 'x' }, error: null }),
      download: () => ({ data: new Blob([PDF]) }),
    },
  })
  const user = fakeSupabase({
    user: { id: rid(900) },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(
            opts.permissions ?? ['billing.view', 'billing.manage'],
          ),
          modules: ['billing'],
        },
      },
      get_billing_document: {
        data: { document: invoiceDoc({ number: null }), logo: null },
      },
      ...opts.userRpc,
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
    userClient: () => user.client,
  }
  return { handler: createHandler(deps), deps, service, user, http }
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
  return new Request('http://fn.test/functions/v1/billing-documents', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: jobKey, org_id: null, trigger: 'cron' }),
  })
}

const post = (body: unknown) =>
  new Request('http://fn.test/functions/v1/billing-documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    },
    body: JSON.stringify(body),
  })

const callsTo = (
  calls: { fn: string; args: Record<string, unknown> }[],
  fn: string,
) => calls.filter((c) => c.fn === fn).map((c) => c.args)

Deno.test('billing-documents: the job renders the PDF, stores it, emails it attached, then finishes sent with the file', async () => {
  await run(async () => {
    const { handler, service, http } = harness()
    const res = await handler(await jobRequest())
    assertEquals([res.status, await res.json()], [200, { runs: 1 }])
    assertEquals(callsTo(service.calls, 'billing_deliveries_for_service'), [{
      p_org_id: ORG_ID,
      p_limit: BATCH_LIMIT,
    }])
    const [registered] = callsTo(service.calls, 'register_system_file')
    assertEquals(
      [
        registered.p_bucket,
        registered.p_module_key,
        registered.p_purpose,
        registered.p_subject_type,
        registered.p_subject_id,
        registered.p_view_permission,
        registered.p_original_name,
      ],
      [
        'documents',
        'billing',
        'billing_document',
        'invoice',
        rid(1),
        'billing.view',
        'Facture 2026-412.pdf',
      ],
    )
    const upload = service.storageCalls.find((c) => c.method === 'upload')!
    assertEquals(upload.bucket, 'documents')
    const bytes = upload.args[1] as Uint8Array
    assertEquals(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-')
    assertEquals(
      callsTo(service.calls, 'get_email_context').map((a) => a.p_template_key),
      ['billing.invoice'],
    )
    assertEquals(http.calls.length, 1)
    assert(
      JSON.stringify(http.calls[0]).includes('Facture 2026-412.pdf'),
      'the PDF attached',
    )
    assertEquals(
      callsTo(service.calls, 'finish_billing_delivery_for_service'),
      [{
        p_org_id: ORG_ID,
        p_delivery_id: rid(11),
        p_file_id: rid(500),
        p_email_status: 'sent',
        p_skip_reason: null,
        p_email_log_id: rid(800),
        p_error: null,
      }],
    )
    const detail = callsTo(service.calls, 'finish_job_run').map((a) =>
      a.p_detail
    )
    assertEquals(detail, ['done=1 failed=0'])
  })
})

Deno.test('billing-documents: a stored PDF is reused (no new file); no address or not asked: set aside, the PDF still made', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      deliveries: [
        delivery(11, {
          kind: 'receipt',
          document: receiptDoc(),
          stored: {
            file_id: rid(501),
            bucket: 'documents',
            object_path: 'p.pdf',
          },
          email: null,
          skip_reason: 'no_email',
        }),
        delivery(12, { email: null, skip_reason: 'not_requested' }),
      ],
    })
    await handler(await jobRequest())
    assertEquals(http.calls.length, 0)
    assertEquals(
      service.storageCalls.filter((c) => c.method === 'download').length,
      1,
    )
    assertEquals(callsTo(service.calls, 'register_system_file').length, 1)
    assertEquals(
      callsTo(service.calls, 'finish_billing_delivery_for_service').map((
        a,
      ) => [a.p_file_id, a.p_email_status, a.p_skip_reason]),
      [[null, 'skipped', 'no_email'], [rid(500), 'skipped', 'not_requested']],
    )
  })
})

Deno.test('billing-documents: a reminder (F3) attaches its invoice\u2019s PDF, stored on the invoice, with the days and the balance', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      deliveries: [
        delivery(13, {
          kind: 'reminder',
          reminder: { step: 10, days: 12, balance_cents: 17349 },
        }),
      ],
    })
    await handler(await jobRequest())
    assertEquals(
      callsTo(service.calls, 'get_email_context').map((a) => a.p_template_key),
      ['billing.reminder'],
    )
    const [registered] = callsTo(service.calls, 'register_system_file')
    assertEquals([registered.p_subject_type, registered.p_subject_id], [
      'invoice',
      rid(1),
    ])
    const sent = JSON.stringify(http.calls[0])
    assert(sent.includes('Facture 2026-412.pdf'), 'the invoice attached')
    assertEquals(
      callsTo(service.calls, 'finish_billing_delivery_for_service').map((a) =>
        a.p_email_status
      ),
      ['sent'],
    )
  })
})

Deno.test('billing-documents: an email core holds (Facturation reserved, P3-40, CC-14) is set aside, never retried', async () => {
  await run(async () => {
    const { handler, service, http } = harness({ moduleOpen: false })
    await captureConsole('log', async () => {
      await handler(await jobRequest())
    })
    assertEquals(http.calls.length, 0)
    assertEquals(
      callsTo(service.calls, 'finish_billing_delivery_for_service').map((
        a,
      ) => [a.p_email_status, a.p_skip_reason, a.p_error]),
      [['skipped', 'reserved', null]],
    )
  })
})

Deno.test('billing-documents: a send that fails is a code, tried again by the database', async () => {
  await run(async () => {
    const { handler, service } = harness({ mailStatus: 500 })
    await captureConsole('error', async () => {
      await handler(await jobRequest())
    })
    const [finish] = callsTo(
      service.calls,
      'finish_billing_delivery_for_service',
    )
    assertEquals([finish.p_file_id, finish.p_email_status, finish.p_error], [
      rid(500),
      null,
      'provider_error',
    ])
    assertEquals(
      callsTo(service.calls, 'finish_job_run').map((a) => a.p_detail),
      ['done=0 failed=1'],
    )
  })
})

Deno.test('billing-documents: « deliver » needs billing.manage, then runs the caller’s clinic', async () => {
  await run(async () => {
    const viewer = harness({ permissions: ['billing.view'] })
    assertEquals(
      (await viewer.handler(post({ action: 'deliver' }))).status,
      403,
    )
    assertEquals(
      callsTo(viewer.service.calls, 'billing_deliveries_for_service'),
      [],
    )
    const { handler, service } = harness()
    const res = await handler(post({ action: 'deliver' }))
    assertEquals([res.status, await res.json()], [200, { done: 1, failed: 0 }])
    assertEquals(
      callsTo(service.calls, 'consume_rate_limit').map((a) => a.p_bucket)[0],
      'billing.deliver_user',
    )
  })
})

Deno.test('billing-documents: « preview » renders the caller’s document (a draft too), never stored', async () => {
  await run(async () => {
    const { handler, service, user } = harness({
      permissions: ['billing.view'],
    })
    const res = await handler(
      post({ action: 'preview', kind: 'invoice', id: rid(1) }),
    )
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const body = await res.json()
    assertEquals(atob(body.pdf).slice(0, 5), '%PDF-')
    assertEquals(body.filename, 'Aperçu du brouillon de facture.pdf')
    assertEquals(callsTo(user.calls, 'get_billing_document'), [{
      p_kind: 'invoice',
      p_id: rid(1),
    }])
    assertEquals(callsTo(service.calls, 'register_system_file'), [])
    const missing = harness({
      userRpc: {
        get_billing_document: { data: { document: null, logo: null } },
      },
    })
    assertEquals(
      (await missing.handler(
        post({ action: 'preview', kind: 'receipt', id: rid(2) }),
      )).status,
      404,
    )
  })
})

Deno.test('billing-documents: a claim that fails ends the run with a code', async () => {
  await run(async () => {
    const { deps, service } = harness()
    const broken = fakeSupabase({
      rpc: {
        module_enabled_for_org: { data: true },
        billing_deliveries_for_service: { error: { code: 'XX000' } },
      },
    })
    let code: string | undefined
    try {
      await deliverOrg(
        deps,
        ORG_ID,
        broken.client,
        new AbortController().signal,
      )
    } catch (error) {
      code = (error as { code?: string }).code
    }
    assertEquals(code, 'claim_failed')
    assertEquals(service.calls, [])
  })
})

Deno.test('billing-documents: an invoice to a payer without a card carries « Payer en ligne » (FS-4)', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      payLink: true,
      buttonLabel: 'Payer en ligne',
    })
    const res = await handler(await jobRequest())
    assertEquals(res.status, 200)
    await res.body?.cancel()
    const [issued] = callsTo(service.calls, 'issue_billing_link_for_service')
    assertEquals([issued.p_purpose, issued.p_subject_id, issued.p_actor], [
      'billing_pay',
      rid(1),
      null,
    ])
    const sent = JSON.stringify(http.calls[0])
    assert(
      sent.includes('http://localhost:5173/payer#t='),
      'the button opens the pay link',
    )
    assert(sent.includes('Payer en ligne'))
  })
})

Deno.test('billing-documents: no pay link (a card on file, Stripe not set): the button is left out, the email still sent', async () => {
  await run(async () => {
    const { handler, service, http } = harness({
      payLink: false,
      buttonLabel: 'Payer en ligne',
    })
    const res = await handler(await jobRequest())
    assertEquals(res.status, 200)
    await res.body?.cancel()
    assertEquals(http.calls.length, 1)
    assert(!JSON.stringify(http.calls[0]).includes('Payer en ligne'))
    assertEquals(
      callsTo(service.calls, 'finish_billing_delivery_for_service')[0]!
        .p_email_status,
      'sent',
    )
  })
})
