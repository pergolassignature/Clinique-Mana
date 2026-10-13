import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { createHandler } from './handler.ts'
import {
  money,
  payoutInvoiceDocument,
  type PreparedInvoice,
} from './document.ts'
import type { Deps } from '../_shared/deps.ts'
import {
  fakeSupabase,
  type RpcRoute,
  type StorageRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/billing-payout-invoice'
const PERIOD = '7c4c2b4e-1d2a-4b5c-8d9e-0f1a2b3c4d5e'
const FILE = '8d5d3c5f-2e3b-4c6d-9e0f-1a2b3c4d5e6f'
const INVOICE = '9e6e4d60-3f4c-4d7e-8f10-2b3c4d5e6f70'

const PREPARED: PreparedInvoice = {
  org_id: ORG_ID,
  period_id: PERIOD,
  month: '2026-09-01',
  month_label: 'septembre 2026',
  total_cents: 71100,
  title_name: 'Psychologue',
  professional: {
    display_name: 'Pro Un',
    title_label: 'Psychologue',
    address_line1: '1 rue Principale',
    address_line2: null,
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H2X 1Y4',
    gst_number: '123456789RT0001',
    qst_number: null,
  },
  clinic: {
    name: 'Clinique MANA',
    address_line1: null,
    address_line2: null,
    city: null,
    province: null,
    postal_code: null,
  },
  today: '2026-10-01',
  lines: [
    {
      kind: 'session',
      occurred_on: '2026-09-03',
      client_number: 1042,
      service_code: 10150,
      service_name: 'Consultation individuelle 50 min',
      base_cents: 17500,
      retention_pct: 28,
      amount_cents: 12600,
      note: null,
    },
    {
      kind: 'adjustment',
      occurred_on: '2026-09-30',
      client_number: null,
      service_code: null,
      service_name: null,
      base_cents: null,
      retention_pct: null,
      amount_cents: 4500,
      note: 'Déplacement du 12 septembre',
    },
  ],
}

function setup(options: {
  modules?: string[]
  permissions?: string[]
  rpc?: Record<string, RpcRoute>
  storage?: Record<string, StorageRoute>
  user?: boolean
} = {}) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      prepare_professional_invoice: { data: PREPARED },
      register_system_file: {
        data: [{
          file_id: FILE,
          object_path: `${ORG_ID}/billing/${PERIOD}/${FILE}.pdf`,
        }],
      },
      record_generated_professional_invoice: { data: INVOICE },
      discard_system_file: { data: true },
      ...options.rpc,
    },
    storage: { upload: () => ({ data: { path: 'x' } }), ...options.storage },
  })
  const user = fakeSupabase({
    user: options.user === false ? undefined : { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? ['billing.self']),
          modules: options.modules ?? ['billing'],
        },
      },
    },
  })
  const clock = fixedClock('2026-10-01T12:00:00.000Z')
  const deps: Deps = {
    env: () => undefined,
    fetch: () => Promise.resolve(new Response('{}')),
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { service, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

const post = (body: unknown, token = 'token') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

Deno.test('billing-payout-invoice: POST only', () =>
  run(async () => {
    const res = await setup().handler(new Request(URL_, { method: 'GET' }))
    assertEquals(res.status, 405)
    await res.body?.cancel()
  }))

Deno.test('billing-payout-invoice: the module and billing.self are required', () =>
  run(async () => {
    const off = await setup({ modules: [] }).handler(
      post({ period_id: PERIOD, number: '2026-09' }),
    )
    assertEquals(off.status, 403)
    await off.body?.cancel()
    const none = await setup({ permissions: [] }).handler(
      post({ period_id: PERIOD, number: '2026-09' }),
    )
    assertEquals(none.status, 403)
    await none.body?.cancel()
    const anon = await setup({ user: false }).handler(
      post({ period_id: PERIOD, number: '2026-09' }),
    )
    assertEquals(anon.status, 401)
    await anon.body?.cancel()
  }))

Deno.test('billing-payout-invoice: a strict body', () =>
  run(async () => {
    const { handler, service } = setup()
    for (
      const body of [{ period_id: 'x', number: '1' }, {
        period_id: PERIOD,
        number: '',
      }, { period_id: PERIOD, number: '1', extra: 1 }]
    ) {
      const res = await handler(post(body))
      assertEquals(res.status, 400)
      await res.body?.cancel()
    }
    assertEquals(service.calls.length, 0)
  }))

Deno.test('billing-payout-invoice: renders, stores and records the invoice for the caller', () =>
  run(async () => {
    const { handler, service } = setup()
    const res = await handler(post({ period_id: PERIOD, number: '2026-09' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { invoice_id: INVOICE, file_id: FILE })
    const byName = Object.fromEntries(service.calls.map((c) => [c.fn, c.args]))
    assertEquals(byName.prepare_professional_invoice, {
      p_period_id: PERIOD,
      p_actor: ADMIN_ID,
    })
    assertEquals(
      byName.register_system_file.p_purpose,
      'billing_professional_invoice',
    )
    assertEquals(
      byName.register_system_file.p_view_permission,
      'billing.payroll',
    )
    assertEquals(byName.register_system_file.p_subject_id, PERIOD)
    assertEquals(
      byName.register_system_file.p_original_name,
      'Facture 2026-09 - septembre 2026.pdf',
    )
    assertEquals(byName.record_generated_professional_invoice, {
      p_period_id: PERIOD,
      p_file_id: FILE,
      p_number: '2026-09',
      p_issued_on: '2026-10-01',
      p_actor: ADMIN_ID,
    })
    const [upload] = service.storageCalls
    assertEquals(upload.bucket, 'documents')
    const bytes = upload.args[1] as Uint8Array
    assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
    assert(!service.calls.some((c) => c.fn === 'discard_system_file'))
  }))

Deno.test("billing-payout-invoice: the database's refusal is shown as written, nothing stored", () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: {
        prepare_professional_invoice: {
          error: {
            code: 'P0001',
            message:
              "Validez d'abord le sommaire : la facture suit le sommaire validé.",
          },
        },
      },
    })
    const res = await handler(post({ period_id: PERIOD, number: '2026-09' }))
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
    assertStringIncludes(body.error.message, 'Validez d')
    assert(!service.calls.some((c) => c.fn === 'register_system_file'))
  }))

Deno.test("billing-payout-invoice: another clinic's answer is refused", () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: {
        prepare_professional_invoice: { data: { ...PREPARED, org_id: PERIOD } },
      },
    })
    const res = await handler(post({ period_id: PERIOD, number: '2026-09' }))
    assertEquals(res.status, 500)
    await res.body?.cancel()
    assert(!service.calls.some((c) => c.fn === 'register_system_file'))
  }))

Deno.test('billing-payout-invoice: a failed upload or record discards the file', () =>
  run(async () => {
    const failed = setup({
      storage: { upload: () => ({ error: { message: 'boom' } }) },
    })
    const res = await failed.handler(
      post({ period_id: PERIOD, number: '2026-09' }),
    )
    assertEquals(res.status, 500)
    await res.body?.cancel()
    assert(failed.service.calls.some((c) => c.fn === 'discard_system_file'))
    assert(
      !failed.service.calls.some((c) =>
        c.fn === 'record_generated_professional_invoice'
      ),
    )

    const refused = setup({
      rpc: {
        record_generated_professional_invoice: {
          error: { code: 'P0001', message: 'Fichier introuvable.' },
        },
      },
    })
    const again = await refused.handler(
      post({ period_id: PERIOD, number: '2026-09', issued_on: '2026-10-02' }),
    )
    assertEquals(again.status, 400)
    await again.body?.cancel()
    assert(refused.service.calls.some((c) => c.fn === 'discard_system_file'))
  }))

Deno.test('payout invoice document: amounts in French, clients by file number only', () => {
  assertEquals(money(71100), '711,00 $')
  assertEquals(money(123456789), '1 234 567,89 $')
  assertEquals(money(-4500), '−45,00 $')
  const doc = payoutInvoiceDocument(PREPARED, '2026-09', '2026-10-01')
  const json = JSON.stringify(doc)
  assertStringIncludes(json, 'Facture 2026-09')
  assertStringIncludes(json, 'Dossier 1042')
  assertStringIncludes(json, '1 octobre 2026')
  assertStringIncludes(json, 'TPS : 123456789RT0001')
  assertStringIncludes(json, 'Ajustement : Déplacement du 12 septembre')
  assertStringIncludes(json, 'Total : 711,00 $')
  assert(!json.includes('Alice'))
  const table = doc.blocks.find((b) => b.type === 'table')
  assert(table?.type === 'table')
  assertEquals(table.rows[0], [
    '3 septembre 2026',
    'Dossier 1042',
    'Rencontre · 10150 Consultation individuelle 50 min',
    '175,00 $',
    '28 %',
    '126,00 $',
  ])
})
