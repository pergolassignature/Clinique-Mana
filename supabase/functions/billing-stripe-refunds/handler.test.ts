import { assertEquals, assertMatch } from '@std/assert'
import { createHandler } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import { FAKE_PENDING_REFUND_CENTS } from '../_shared/testing/fake-stripe.ts'
import {
  NOW,
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
      encoder.encode(`${NOW_S}.billing.stripe_refunds..cron`),
    ),
  )
  return new Request('http://fn.test/functions/v1/billing-stripe-refunds', {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({
      job_key: 'billing.stripe_refunds',
      org_id: null,
      trigger: 'cron',
    }),
  })
}

// Three refunds waiting: one Stripe refunds, one it keeps pending, one Stripe refuses (too much).
function setup(opts: StripeHarnessOptions = {}) {
  const h = stripeHarness({
    ...opts,
    rpc: {
      stripe_refunds_due_for_service: {
        data: [
          {
            refund_id: rid(1),
            amount_cents: 5000,
            payment_intent_id: 'pi_paid1',
            invoice_id: rid(9),
          },
          {
            refund_id: rid(2),
            amount_cents: FAKE_PENDING_REFUND_CENTS,
            payment_intent_id: 'pi_paid1',
            invoice_id: rid(9),
          },
          {
            refund_id: rid(3),
            amount_cents: 999999,
            payment_intent_id: 'pi_paid1',
            invoice_id: rid(9),
          },
        ],
      },
      settle_stripe_refund_for_service: { data: true },
      ...opts.rpc,
    },
  })
  h.stripe.paymentIntents.set('pi_paid1', {
    amount: 20000,
    status: 'succeeded',
    metadata: {},
  })
  return { ...h, handler: createHandler(h.deps) }
}

Deno.test('billing-stripe-refunds: without the job signature, 401', () =>
  run(async () => {
    const { handler } = setup()
    const res = await handler(
      new Request('http://fn.test/x', { method: 'POST' }),
    )
    assertEquals(res.status, 401)
    await res.body?.cancel()
  }))

Deno.test('billing-stripe-refunds: each waiting refund made once at Stripe; done and refused settled, pending left', () =>
  run(async () => {
    const { handler, service, stripe } = setup()
    const res = await handler(await jobRequest())
    assertEquals(res.status, 200)
    await res.body?.cancel()
    const made = stripe.calls.filter((c) => c.path === '/v1/refunds')
    assertEquals(made.map((c) => c.idempotencyKey), [
      `refund:${rid(1)}`,
      `refund:${rid(2)}`,
      `refund:${rid(3)}`,
    ])
    const settled = service.calls.filter((c) =>
      c.fn === 'settle_stripe_refund_for_service'
    )
      .map((c) => [c.args.p_refund_id, c.args.p_ok, c.args.p_error_code])
    assertEquals(settled, [[rid(1), true, null], [
      rid(3),
      false,
      'amount_too_large',
    ]])
    const detail = service.calls.find((c) => c.fn === 'finish_job_run')
    assertMatch(
      String(detail?.args.p_detail ?? ''),
      /1 faits, 1 refusés, 1 en attente/,
    )
  }))

Deno.test('billing-stripe-refunds: Stripe not set refunds nothing', () =>
  run(async () => {
    const { handler, service } = setup({ secretKey: null })
    const res = await handler(await jobRequest())
    assertEquals(res.status, 200)
    await res.body?.cancel()
    assertEquals(
      service.calls.filter((c) => c.fn === 'stripe_refunds_due_for_service')
        .length,
      0,
    )
  }))
