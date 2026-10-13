import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { signStripePayload } from '../_shared/stripe/webhook.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  CHARGE,
  FAKE_STRIPE_WEBHOOK_SECRET,
  INVOICE,
  NOW,
  ORG_ID,
  PAYER,
  stripeHarness,
  type StripeHarnessOptions,
} from '../_shared/testing/stripe-fixtures.ts'

const URL_ = `http://fn.test/functions/v1/stripe-webhook?org=${ORG_ID}`
const NOW_S = Math.floor(Date.parse(NOW) / 1000)
const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

async function signed(
  event: unknown,
  opts: { secret?: string; at?: number; url?: string } = {},
) {
  const payload = JSON.stringify(event)
  const signature = await signStripePayload(
    opts.secret ?? FAKE_STRIPE_WEBHOOK_SECRET,
    payload,
    opts.at ?? NOW_S,
  )
  return new Request(opts.url ?? URL_, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: payload,
  })
}

const event = (type: string, object: Record<string, unknown>) => ({
  id: 'evt_test1',
  object: 'event',
  type,
  data: { object },
})

function setup(opts: StripeHarnessOptions = {}) {
  const h = stripeHarness({
    ...opts,
    rpc: {
      record_stripe_card_for_service: {
        data: { payer_client_id: PAYER, replaced_payment_method_id: null },
      },
      record_stripe_payment_for_service: {
        data: { receipt_id: 'r', recorded_cents: 20000, excess_cents: 0 },
      },
      stripe_payment_failed_for_service: { data: null },
      ...opts.rpc,
    },
  })
  return { ...h, handler: createHandler(h.deps) }
}

Deno.test('stripe-webhook: a bad org, a missing or wrong signature, an old timestamp are refused before any work', () =>
  run(async () => {
    const { handler, service } = setup()
    const e = event('checkout.session.completed', { mode: 'payment' })
    assertEquals(
      (await handler(
        await signed(e, {
          url: 'http://fn.test/functions/v1/stripe-webhook?org=nope',
        }),
      )).status,
      400,
    )
    assertEquals(
      (await handler(new Request(URL_, { method: 'POST', body: '{}' }))).status,
      401,
    )
    assertEquals(
      (await handler(await signed(e, { secret: 'whsec_other' }))).status,
      401,
    )
    assertEquals(
      (await handler(await signed(e, { at: NOW_S - 600 }))).status,
      401,
    )
    assert(!service.calls.some((c) => c.fn === 'claim_webhook_event'))
  }))

Deno.test("stripe-webhook: a paid checkout records the invoice's payment once, with the PaymentIntent as reference", () =>
  run(async () => {
    const { handler, service } = setup()
    const res = await handler(
      await signed(event('checkout.session.completed', {
        id: 'cs_1',
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: 'pi_link1',
        amount_total: 20000,
        metadata: { org_id: ORG_ID, invoice_id: INVOICE },
      })),
    )
    assertEquals(res.status, 200)
    assertEquals((await res.json()).outcome, 'payment_recorded')
    const claim = service.calls.find((c) => c.fn === 'claim_webhook_event')!
    assertEquals(claim.args.p_provider, 'stripe')
    assertEquals(claim.args.p_event_id, `${ORG_ID}:evt_test1`)
    const recorded = service.calls.find((c) =>
      c.fn === 'record_stripe_payment_for_service'
    )!
    assertEquals(recorded.args.p_payment_intent_id, 'pi_link1')
    assertEquals(recorded.args.p_amount_cents, 20000)
    assertEquals(recorded.args.p_charge_id, null)
    assert(service.calls.some((c) => c.fn === 'complete_webhook_event'))
  }))

Deno.test("stripe-webhook: another org's metadata is never recorded", () =>
  run(async () => {
    const { handler, service } = setup()
    const res = await handler(
      await signed(event('checkout.session.completed', {
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: 'pi_x',
        amount_total: 100,
        metadata: {
          org_id: '00000000-0000-4000-8000-0000000000ff',
          invoice_id: INVOICE,
        },
      })),
    )
    assertEquals((await res.json()).outcome, 'skipped')
    assert(
      !service.calls.some((c) => c.fn === 'record_stripe_payment_for_service'),
    )
  }))

Deno.test('stripe-webhook: a setup checkout brings back the card (never its number)', () =>
  run(async () => {
    const { handler, service, stripe } = setup()
    stripe.sessions.set('cs_setup', {
      id: 'cs_setup',
      mode: 'setup',
      customer: 'cus_fake1',
      amount: null,
      metadata: {},
      clientReference: null,
      successUrl: '',
      cancelUrl: '',
      completed: false,
    })
    const completed = await stripe.complete('cs_setup')
    const res = await handler(await signed(completed))
    assertEquals((await res.json()).outcome, 'card_saved')
    const card = service.calls.find((c) =>
      c.fn === 'record_stripe_card_for_service'
    )!
    assertEquals(card.args.p_customer_id, 'cus_fake1')
    assertEquals(card.args.p_last4, '4242')
    assertEquals(card.args.p_brand, 'visa')
  }))

Deno.test('stripe-webhook: a failed PaymentIntent fails its charge; a duplicate is 200; an unknown type is skipped', () =>
  run(async () => {
    const { handler, service } = setup()
    const res = await handler(
      await signed(event('payment_intent.payment_failed', {
        id: 'pi_bad1',
        last_payment_error: {
          code: 'card_declined',
          decline_code: 'expired_card',
        },
      })),
    )
    assertEquals((await res.json()).outcome, 'charge_failed')
    assertEquals(
      service.calls.find((c) => c.fn === 'stripe_payment_failed_for_service')
        ?.args.p_failure_code,
      'expired_card',
    )

    const dup = setup({
      rpc: {
        claim_webhook_event: {
          data: [{ status: 'duplicate', id: null, claim_token: null }],
        },
      },
    })
    const d = await dup.handler(
      await signed(event('payment_intent.succeeded', { id: 'pi_1' })),
    )
    assertEquals((await d.json()).outcome, 'duplicate')

    const other = setup()
    const o = await other.handler(
      await signed(event('customer.created', { id: 'cus_1' })),
    )
    assertEquals((await o.json()).outcome, 'skipped')
  }))

Deno.test('stripe-webhook: a failure in the database fails the event (500, Stripe retries)', () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: { record_stripe_payment_for_service: { error: { code: 'XX000' } } },
    })
    const res = await handler(
      await signed(event('payment_intent.succeeded', {
        id: 'pi_ok1',
        amount_received: 500,
        metadata: { org_id: ORG_ID, invoice_id: INVOICE },
      })),
    )
    assertEquals(res.status, 500)
    assertEquals(
      service.calls.find((c) => c.fn === 'fail_webhook_event')?.args.p_error,
      'record_stripe_payment_for_service_failed',
    )
  }))

Deno.test("stripe-webhook: a charge's PaymentIntent settles its own charge, dated by the event", () =>
  run(async () => {
    const { handler, service } = setup()
    const created = NOW_S - 3 * 86400
    const res = await handler(
      await signed({
        ...event('payment_intent.succeeded', {
          id: 'pi_job1',
          amount_received: 20000,
          currency: 'cad',
          metadata: { org_id: ORG_ID, invoice_id: INVOICE, charge_id: CHARGE },
        }),
        created,
      }),
    )
    assertEquals((await res.json()).outcome, 'payment_recorded')
    const recorded = service.calls.find((c) =>
      c.fn === 'record_stripe_payment_for_service'
    )!
    assertEquals(recorded.args.p_charge_id, CHARGE)
    assertEquals(
      recorded.args.p_paid_at,
      new Date(created * 1000).toISOString(),
    )

    const failed = setup()
    await failed.handler(
      await signed(event('payment_intent.payment_failed', {
        id: 'pi_job2',
        metadata: { org_id: ORG_ID, invoice_id: INVOICE, charge_id: CHARGE },
      })),
    )
    assertEquals(
      failed.service.calls.find((c) =>
        c.fn === 'stripe_payment_failed_for_service'
      )?.args.p_charge_id,
      CHARGE,
    )
  }))

Deno.test('stripe-webhook: an amount in another currency is never recorded', () =>
  run(async () => {
    const { handler, service } = setup()
    const res = await handler(
      await signed(event('payment_intent.succeeded', {
        id: 'pi_usd1',
        amount_received: 500,
        currency: 'usd',
        metadata: { org_id: ORG_ID, invoice_id: INVOICE },
      })),
    )
    assertEquals((await res.json()).outcome, 'skipped')
    assert(
      !service.calls.some((c) => c.fn === 'record_stripe_payment_for_service'),
    )
  }))

Deno.test('stripe-webhook: module off, a payment is kept for a retry (503), a failure is dropped', () =>
  run(async () => {
    const off = { rpc: { module_enabled_for_org: { data: false } } }
    const pay = setup(off)
    const res = await pay.handler(
      await signed(event('payment_intent.succeeded', {
        id: 'pi_off1',
        amount_received: 500,
        metadata: { org_id: ORG_ID, invoice_id: INVOICE },
      })),
    )
    assertEquals(res.status, 503)
    assertEquals(
      pay.service.calls.find((c) => c.fn === 'fail_webhook_event')?.args
        .p_error,
      'module_disabled',
    )
    assert(
      !pay.service.calls.some((c) =>
        c.fn === 'record_stripe_payment_for_service'
      ),
    )

    const other = setup(off)
    const o = await other.handler(
      await signed(event('payment_intent.payment_failed', { id: 'pi_off2' })),
    )
    assertEquals(o.status, 200)
    assertEquals((await o.json()).outcome, 'module_disabled')
  }))

Deno.test('stripe-webhook: a new card detaches the one it replaces at Stripe', () =>
  run(async () => {
    const { handler, stripe } = setup({
      rpc: {
        record_stripe_card_for_service: {
          data: {
            payer_client_id: PAYER,
            replaced_payment_method_id: 'pm_old1',
          },
        },
      },
    })
    stripe.paymentMethods.set('pm_old1', {
      customer: 'cus_fake1',
      detached: false,
      declined: false,
    })
    stripe.sessions.set('cs_setup2', {
      id: 'cs_setup2',
      mode: 'setup',
      customer: 'cus_fake1',
      amount: null,
      metadata: {},
      clientReference: null,
      successUrl: '',
      cancelUrl: '',
      completed: false,
    })
    const res = await handler(await signed(await stripe.complete('cs_setup2')))
    assertEquals((await res.json()).outcome, 'card_saved')
    assertEquals(stripe.paymentMethods.get('pm_old1')?.detached, true)
  }))

const REFUND_ID = '00000000-0000-4000-8000-0000000000d1'

Deno.test("stripe-webhook: charge.refunded reads back the PaymentIntent's refunds and settles this clinic's (FS-9)", () =>
  run(async () => {
    const { handler, service, stripe } = setup({
      rpc: { settle_stripe_refund_for_service: { data: true } },
    })
    stripe.paymentIntents.set('pi_paid1', {
      amount: 20000,
      status: 'succeeded',
      metadata: {},
    })
    stripe.refunds.set('re_mine1', {
      payment_intent: 'pi_paid1',
      amount: 5000,
      status: 'succeeded',
      metadata: { org_id: ORG_ID, refund_id: REFUND_ID },
    })
    // Another clinic's refund on the same PaymentIntent is never touched.
    stripe.refunds.set('re_other1', {
      payment_intent: 'pi_paid1',
      amount: 1000,
      status: 'succeeded',
      metadata: {
        org_id: '00000000-0000-4000-8000-0000000000ff',
        refund_id: REFUND_ID,
      },
    })
    const res = await handler(
      await signed(
        event('charge.refunded', { id: 'ch_1', payment_intent: 'pi_paid1' }),
      ),
    )
    assertEquals((await res.json()).outcome, 'refund_settled')
    const settled = service.calls.filter((c) =>
      c.fn === 'settle_stripe_refund_for_service'
    )
    assertEquals(settled.length, 1)
    assertEquals([settled[0]!.args.p_refund_id, settled[0]!.args.p_ok], [
      REFUND_ID,
      true,
    ])
  }))

Deno.test("stripe-webhook: refund.failed settles the refund as failed with Stripe's reason; settled already is fine", () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: { settle_stripe_refund_for_service: { data: true } },
    })
    const res = await handler(
      await signed(event('refund.failed', {
        id: 're_bad1',
        status: 'failed',
        amount: 5000,
        failure_reason: 'expired_or_canceled_card',
        metadata: { org_id: ORG_ID, refund_id: REFUND_ID },
      })),
    )
    assertEquals((await res.json()).outcome, 'refund_settled')
    const settled = service.calls.find((c) =>
      c.fn === 'settle_stripe_refund_for_service'
    )!
    assertEquals([
      settled.args.p_ok,
      settled.args.p_error_code,
      settled.args.p_provider_ref,
    ], [
      false,
      'expired_or_canceled_card',
      're_bad1',
    ])

    const again = setup({
      rpc: { settle_stripe_refund_for_service: { data: false } },
    })
    const a = await again.handler(
      await signed(event('refund.updated', {
        id: 're_ok1',
        status: 'succeeded',
        amount: 5000,
        metadata: { org_id: ORG_ID, refund_id: REFUND_ID },
      })),
    )
    assertEquals(a.status, 200)
    assertEquals((await a.json()).outcome, 'skipped')
  }))

Deno.test('stripe-webhook: module off, a refund event is kept for a retry (503)', () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: { module_enabled_for_org: { data: false } },
    })
    const res = await handler(
      await signed(
        event('refund.updated', {
          id: 're_1',
          status: 'succeeded',
          metadata: { org_id: ORG_ID, refund_id: REFUND_ID },
        }),
      ),
    )
    assertEquals(res.status, 503)
    assert(
      !service.calls.some((c) => c.fn === 'settle_stripe_refund_for_service'),
    )
  }))
