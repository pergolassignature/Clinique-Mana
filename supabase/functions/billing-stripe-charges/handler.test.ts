import { assertEquals, assertMatch } from '@std/assert'
import { createHandler } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  NOW,
  ORG_ID,
  stripeHarness,
  type StripeHarnessOptions,
} from '../_shared/testing/stripe-fixtures.ts'

const SECRET = 'local-dev-internal-function-secret'
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const run = (fn: () => Promise<void>) =>
  withEnv({ SENTRY_DSN: undefined, INTERNAL_FUNCTION_SECRET: SECRET }, fn)
const rid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')
async function jobRequest(): Promise<Request> {
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
      encoder.encode(`${NOW_S}.billing.stripe_charges..cron`),
    ),
  )
  return new Request('http://fn.test/functions/v1/billing-stripe-charges', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({
      job_key: 'billing.stripe_charges',
      org_id: null,
      trigger: 'cron',
    }),
  })
}

function setup(opts: StripeHarnessOptions = {}) {
  let n = 0
  const h = stripeHarness({
    ...opts,
    rpc: {
      stripe_charges_due_for_service: {
        data: [{ invoice_id: rid(1) }, { invoice_id: rid(2) }, {
          invoice_id: rid(3),
        }],
      },
      begin_stripe_charge_for_service: (args) => {
        n += 1
        if (args.p_invoice_id === rid(3)) return { data: null }
        return {
          data: {
            charge_id: rid(100 + n),
            amount_cents: 13000,
            invoice_number: '2026-1',
            customer_id: 'cus_fake1',
            payment_method_id: args.p_invoice_id === rid(2)
              ? 'pm_fakeDeclined'
              : 'pm_fake1',
            clinic_name: 'Clinique MANA',
          },
        }
      },
      finish_stripe_charge_for_service: { data: { status: 'succeeded' } },
      ...opts.rpc,
    },
  })
  h.stripe.paymentMethods.set('pm_fake1', {
    customer: 'cus_fake1',
    detached: false,
    declined: false,
  })
  return { ...h, handler: createHandler(h.deps) }
}

Deno.test('billing-stripe-charges: without the job signature, 401', () =>
  run(async () => {
    const { handler } = setup()
    const res = await handler(
      new Request('http://fn.test/x', { method: 'POST' }),
    )
    assertEquals(res.status, 401)
    await res.body?.cancel()
  }))

Deno.test('billing-stripe-charges: each due invoice charged once (auto), its outcome finished; one no longer due is left', () =>
  run(async () => {
    const { handler, service, stripe } = setup()
    const res = await handler(await jobRequest())
    assertEquals(res.status, 200)
    await res.body?.cancel()
    const begins = service.calls.filter((c) =>
      c.fn === 'begin_stripe_charge_for_service'
    )
    assertEquals(begins.map((c) => c.args.p_kind), ['auto', 'auto', 'auto'])
    assertEquals(begins[0]!.args.p_org_id, ORG_ID)
    const intents = stripe.calls.filter((c) => c.path === '/v1/payment_intents')
    assertEquals(intents.length, 2)
    assertMatch(String(intents[0]!.idempotencyKey), /^charge:/)
    const finished = service.calls.filter((c) =>
      c.fn === 'finish_stripe_charge_for_service'
    ).map((c) => c.args.p_status)
    assertEquals(finished, ['succeeded', 'failed'])
    const run = service.calls.find((c) => c.fn === 'finish_job_run')
    assertMatch(
      String(run?.args.p_detail ?? ''),
      /1 réussis, 1 refusés, 0 en attente/,
    )
  }))

Deno.test('billing-stripe-charges: Stripe not set charges nothing', () =>
  run(async () => {
    const { handler, service } = setup({ secretKey: null })
    const res = await handler(await jobRequest())
    assertEquals(res.status, 200)
    await res.body?.cancel()
    assertEquals(
      service.calls.filter((c) => c.fn === 'stripe_charges_due_for_service')
        .length,
      0,
    )
  }))
