import { assert, assertEquals, assertMatch } from '@std/assert'
import { createHandler } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  CHARGE,
  INVOICE,
  ORG_ID,
  PAYER,
  stripeHarness,
  type StripeHarnessOptions,
} from '../_shared/testing/stripe-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/billing-stripe'
const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)
const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const context = (over: Record<string, unknown> = {}) => ({
  data: {
    payer_client_id: PAYER,
    name: 'Alice Tremblay',
    first_name: 'Alice',
    email: 'alice@exemple.test',
    language: 'fr',
    clinic_name: 'Clinique MANA',
    customer_id: null,
    ...over,
  },
})

function setup(opts: StripeHarnessOptions = {}) {
  const h = stripeHarness({
    ...opts,
    rpc: {
      stripe_card_link_context_for_service: context(),
      save_stripe_customer_for_service: { data: null },
      issue_billing_link_for_service: { data: true },
      begin_stripe_charge_for_service: {
        data: {
          charge_id: CHARGE,
          amount_cents: 13000,
          invoice_number: '2026-1',
          customer_id: 'cus_fake1',
          payment_method_id: 'pm_fake1',
          clinic_name: 'Clinique MANA',
        },
      },
      finish_stripe_charge_for_service: { data: { status: 'succeeded' } },
      stripe_card_for_service: {
        data: { customer_id: 'cus_fake1', payment_method_id: 'pm_fake1' },
      },
      stripe_card_removed_for_service: { data: null },
      ...opts.rpc,
    },
  })
  return { ...h, handler: createHandler(h.deps) }
}

Deno.test('billing-stripe: card_link makes the customer once, issues the link and emails it', () =>
  run(async () => {
    const { handler, service, stripe, mails } = setup()
    const res = await handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { sent: true })
    const created = stripe.calls.find((c) => c.path === '/v1/customers')
    assertEquals(created?.idempotencyKey, `customer:${ORG_ID}:${PAYER}`)
    const saved = service.calls.find((c) =>
      c.fn === 'save_stripe_customer_for_service'
    )
    assertMatch(String(saved?.args.p_customer_id), /^cus_fake/)
    const issued = service.calls.find((c) =>
      c.fn === 'issue_billing_link_for_service'
    )
    assertEquals(issued?.args.p_purpose, 'billing_card_setup')
    assertEquals(mails.length, 1)
    const body = await mails[0]!.text()
    assert(
      body.includes('http://localhost:5173/carte#t='),
      'the link is the button',
    )
  }))

Deno.test('billing-stripe: an existing customer is reused; English payers get the English template', () =>
  run(async () => {
    const { handler, service, stripe } = setup({
      rpc: {
        stripe_card_link_context_for_service: context({
          customer_id: 'cus_known1',
          language: 'en',
        }),
      },
    })
    const res = await handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(res.status, 200)
    await res.body?.cancel()
    assert(!stripe.calls.some((c) => c.path === '/v1/customers'))
    assertEquals(
      service.calls.find((c) => c.fn === 'get_email_context')?.args
        .p_template_key,
      'billing.card_setup_en',
    )
  }))

Deno.test('billing-stripe: a refusal is shown as written; no key is 503; the module and billing.manage are required', () =>
  run(async () => {
    const refused = setup({
      rpc: {
        stripe_card_link_context_for_service: {
          error: {
            code: 'P0001',
            message:
              "Ce payeur n'a pas d'adresse courriel : ajoutez-la à son dossier.",
          },
        },
      },
    })
    const a = await refused.handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(a.status, 400)
    assertEquals((await a.json()).error.refusal, true)
    const noKey = setup({ secretKey: null })
    const b = await noKey.handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(b.status, 503)
    await b.body?.cancel()
    const noPerm = setup({ permissions: ['billing.view'] })
    const c = await noPerm.handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(c.status, 403)
    await c.body?.cancel()
    const off = setup({ modules: [] })
    const d = await off.handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(d.status, 403)
    await d.body?.cancel()
  }))

Deno.test('billing-stripe: a reserved module holds the email (P3-40)', () =>
  run(async () => {
    const { handler, mails } = setup({ moduleOpen: false })
    const res = await handler(
      post({ action: 'card_link', payer_client_id: PAYER }),
    )
    assertEquals(res.status, 409)
    await res.body?.cancel()
    assertEquals(mails.length, 0)
  }))

Deno.test('billing-stripe: charge_now charges once per charge and finishes it', () =>
  run(async () => {
    const { handler, service, stripe } = setup()
    stripe.paymentMethods.set('pm_fake1', {
      customer: 'cus_fake1',
      detached: false,
      declined: false,
    })
    const res = await handler(
      post({ action: 'charge_now', invoice_id: INVOICE }),
    )
    assertEquals(res.status, 200)
    assertEquals((await res.json()).status, 'succeeded')
    const intent = stripe.calls.find((c) => c.path === '/v1/payment_intents')
    assertEquals(intent?.idempotencyKey, `charge:${CHARGE}`)
    assertEquals(intent?.params.get('off_session'), 'true')
    assertEquals(intent?.params.get('metadata[invoice_id]'), INVOICE)
    const finished = service.calls.find((c) =>
      c.fn === 'finish_stripe_charge_for_service'
    )
    assertEquals(finished?.args.p_status, 'succeeded')
    assertMatch(String(finished?.args.p_payment_intent_id), /^pi_fake/)
  }))

Deno.test("billing-stripe: a declined card finishes the charge as failed, with Stripe's code", () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: {
        begin_stripe_charge_for_service: {
          data: {
            charge_id: CHARGE,
            amount_cents: 13000,
            invoice_number: '2026-1',
            customer_id: 'cus_fake1',
            payment_method_id: 'pm_fakeDeclined',
            clinic_name: 'Clinique MANA',
          },
        },
      },
    })
    const res = await handler(
      post({ action: 'charge_now', invoice_id: INVOICE }),
    )
    assertEquals((await res.json()).status, 'failed')
    const finished = service.calls.find((c) =>
      c.fn === 'finish_stripe_charge_for_service'
    )
    assertEquals(finished?.args.p_status, 'failed')
    assertEquals(finished?.args.p_failure_code, 'insufficient_funds')
  }))

Deno.test('billing-stripe: remove_card detaches, then records', () =>
  run(async () => {
    const { handler, service, stripe } = setup()
    stripe.paymentMethods.set('pm_fake1', {
      customer: 'cus_fake1',
      detached: false,
      declined: false,
    })
    const res = await handler(
      post({ action: 'remove_card', payer_client_id: PAYER }),
    )
    assertEquals(res.status, 200)
    await res.body?.cancel()
    assertEquals(stripe.paymentMethods.get('pm_fake1')?.detached, true)
    assert(
      service.calls.some((c) => c.fn === 'stripe_card_removed_for_service'),
    )
  }))

Deno.test('billing-stripe: a charge Stripe is still processing is pending, never finished nor refused', () =>
  run(async () => {
    const { handler, service } = setup({
      rpc: {
        begin_stripe_charge_for_service: {
          data: {
            charge_id: CHARGE,
            amount_cents: 13000,
            invoice_number: '2026-1',
            customer_id: 'cus_fake1',
            payment_method_id: 'pm_fakeProcessing',
            clinic_name: 'Clinique MANA',
          },
        },
      },
    })
    const res = await handler(
      post({ action: 'charge_now', invoice_id: INVOICE }),
    )
    assertEquals(await res.json(), { status: 'pending', failure_code: null })
    assert(
      !service.calls.some((c) => c.fn === 'finish_stripe_charge_for_service'),
    )
  }))

const REFUND = '00000000-0000-4000-8000-0000000000d1'
const pendingRefund = (over: Record<string, unknown> = {}) => ({
  data: {
    refund_id: REFUND,
    amount_cents: 5000,
    payment_intent_id: 'pi_paid1',
    invoice_id: INVOICE,
    module_open: true,
    ...over,
  },
})

Deno.test('billing-stripe: « Rembourser » refunds the card once at Stripe, then settles the refund (FS-9)', () =>
  run(async () => {
    const { handler, service, stripe } = setup({
      rpc: {
        stripe_refund_for_service: pendingRefund(),
        settle_stripe_refund_for_service: { data: true },
      },
    })
    stripe.paymentIntents.set('pi_paid1', {
      amount: 20000,
      status: 'succeeded',
      metadata: {},
    })
    const res = await handler(post({ action: 'refund', refund_id: REFUND }))
    assertEquals(await res.json(), { status: 'recorded' })
    const call = stripe.calls.find((c) => c.path === '/v1/refunds')!
    assertEquals(call.idempotencyKey, `refund:${REFUND}`)
    assertEquals(call.params.get('payment_intent'), 'pi_paid1')
    assertEquals(call.params.get('amount'), '5000')
    assertEquals(call.params.get('metadata[refund_id]'), REFUND)
    const settled = service.calls.find((c) =>
      c.fn === 'settle_stripe_refund_for_service'
    )!
    assertEquals(settled.args.p_ok, true)
    assertMatch(String(settled.args.p_provider_ref), /^re_fake/)

    // Twice: the same refund at Stripe (its key), never a second one.
    await (await handler(post({ action: 'refund', refund_id: REFUND }))).body
      ?.cancel()
    assertEquals(stripe.refunds.size, 1)
  }))

Deno.test('billing-stripe: a refund Stripe refuses, or a card payment without its PaymentIntent, settles as failed', () =>
  run(async () => {
    const refused = setup({
      rpc: {
        stripe_refund_for_service: pendingRefund({ amount_cents: 999999 }),
        settle_stripe_refund_for_service: { data: true },
      },
    })
    refused.stripe.paymentIntents.set('pi_paid1', {
      amount: 20000,
      status: 'succeeded',
      metadata: {},
    })
    const r = await refused.handler(
      post({ action: 'refund', refund_id: REFUND }),
    )
    assertEquals(await r.json(), { status: 'failed' })
    const settled = refused.service.calls.find((c) =>
      c.fn === 'settle_stripe_refund_for_service'
    )!
    assertEquals([settled.args.p_ok, settled.args.p_error_code], [
      false,
      'amount_too_large',
    ])

    const imported = setup({
      rpc: {
        stripe_refund_for_service: pendingRefund({
          payment_intent_id: 'gor:123',
        }),
        settle_stripe_refund_for_service: { data: true },
      },
    })
    const i = await imported.handler(
      post({ action: 'refund', refund_id: REFUND }),
    )
    assertEquals(await i.json(), { status: 'failed' })
    assert(!imported.stripe.calls.some((c) => c.path === '/v1/refunds'))
    assertEquals(
      imported.service.calls.find((c) =>
        c.fn === 'settle_stripe_refund_for_service'
      )?.args.p_error_code,
      'not_refundable_online',
    )
  }))

Deno.test('billing-stripe: a settled refund is said so; a reserved module moves no money (P3-40)', () =>
  run(async () => {
    const done = setup({ rpc: { stripe_refund_for_service: { data: null } } })
    const d = await done.handler(post({ action: 'refund', refund_id: REFUND }))
    assertEquals(await d.json(), { status: 'settled' })

    const reserved = setup({
      rpc: { stripe_refund_for_service: pendingRefund({ module_open: false }) },
    })
    const r = await reserved.handler(
      post({ action: 'refund', refund_id: REFUND }),
    )
    assertEquals(r.status, 409)
    await r.body?.cancel()
    assert(!reserved.stripe.calls.some((c) => c.path === '/v1/refunds'))
  }))
