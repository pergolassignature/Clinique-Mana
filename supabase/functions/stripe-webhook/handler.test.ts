import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { signStripePayload } from '../_shared/stripe/webhook.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
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
      record_stripe_card_for_service: { data: PAYER },
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
