import { assert, assertEquals } from '@std/assert'
import { consentText, createHandler } from './handler.ts'
import { generateToken } from '../_shared/links.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  INVOICE,
  ORG_ID,
  PAYER,
  stripeHarness,
  type StripeHarnessOptions,
} from '../_shared/testing/stripe-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/billing-stripe-checkout'
const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)
const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const valid = (over: Record<string, unknown> = {}) => ({
  data: {
    state: 'valid',
    org_id: ORG_ID,
    mode: 'payment',
    payer_client_id: PAYER,
    customer_id: null,
    name: 'Alice Tremblay',
    email: 'alice@exemple.test',
    language: 'fr',
    invoice_id: INVOICE,
    invoice_number: '2026-3',
    amount_cents: 20000,
    clinic_name: 'Clinique MANA',
    ...over,
  },
})

function setup(begin: unknown, opts: StripeHarnessOptions = {}) {
  const h = stripeHarness({
    ...opts,
    rpc: {
      begin_billing_checkout_for_service: begin as never,
      save_stripe_customer_for_service: { data: null },
      ...opts.rpc,
    },
  })
  return { ...h, handler: createHandler(h.deps) }
}

Deno.test('billing-stripe-checkout: a malformed or unknown token is 410, like an expired one', () =>
  run(async () => {
    const { handler, service } = setup({ data: { state: 'invalid' } })
    const a = await handler(post({ token: 'nope' }))
    assertEquals(a.status, 410)
    await a.body?.cancel()
    assert(
      !service.calls.some((c) => c.fn === 'begin_billing_checkout_for_service'),
      'no lookup for a malformed token',
    )
    const b = await handler(post({ token: generateToken() }))
    assertEquals(b.status, 410)
    await b.body?.cancel()
  }))

Deno.test('billing-stripe-checkout: a paid invoice says so', () =>
  run(async () => {
    const { handler } = setup({ data: { state: 'paid' } })
    const res = await handler(post({ token: generateToken() }))
    assertEquals(await res.json(), { state: 'paid' })
  }))

Deno.test('billing-stripe-checkout: « Payer en ligne » opens a payment checkout for the balance, back to /payer', () =>
  run(async () => {
    const { handler, stripe } = setup(valid())
    const res = await handler(post({ token: generateToken() }))
    const body = await res.json()
    assertEquals(body.state, 'valid')
    assert(String(body.url).startsWith('http://127.0.0.1:55397/checkout/cs_'))
    const session = [...stripe.sessions.values()][0]!
    assertEquals(session.mode, 'payment')
    assertEquals(session.amount, 20000)
    assertEquals(session.metadata, { org_id: ORG_ID, invoice_id: INVOICE })
    assertEquals(session.successUrl, 'http://localhost:5173/payer?etat=merci')
    const call = stripe.calls.find((c) => c.path === '/v1/checkout/sessions')!
    assertEquals(call.params.get('customer_email'), 'alice@exemple.test')
    assertEquals(call.params.get('line_items[0][price_data][currency]'), 'cad')
    assertEquals(
      call.params.get('payment_intent_data[metadata][invoice_id]'),
      INVOICE,
    )
  }))

Deno.test('billing-stripe-checkout: « Enregistrer ma carte » makes the customer, then a setup checkout with the consent', () =>
  run(async () => {
    const { handler, stripe, service } = setup(
      valid({
        mode: 'setup',
        invoice_id: null,
        invoice_number: null,
        amount_cents: null,
      }),
    )
    const res = await handler(post({ token: generateToken() }))
    assertEquals((await res.json()).state, 'valid')
    assert(
      service.calls.some((c) => c.fn === 'save_stripe_customer_for_service'),
    )
    const call = stripe.calls.find((c) => c.path === '/v1/checkout/sessions')!
    assertEquals(call.params.get('mode'), 'setup')
    assert(String(call.params.get('customer')).startsWith('cus_fake'))
    assertEquals(
      call.params.get('custom_text[submit][message]'),
      consentText('Clinique MANA', 'fr'),
    )
    assertEquals(
      call.params.get('success_url'),
      'http://localhost:5173/carte?etat=merci',
    )
    assertEquals(call.params.get('metadata[payer_client_id]'), PAYER)
  }))

Deno.test('billing-stripe-checkout: Stripe not set is 503; Stripe failing is 502', () =>
  run(async () => {
    const noKey = setup(valid(), { secretKey: null })
    const a = await noKey.handler(post({ token: generateToken() }))
    assertEquals(a.status, 503)
    await a.body?.cancel()
    const refused = setup(valid(), { secretKey: 'sk_test_refused' })
    refused.deps.fetch = () =>
      Promise.resolve(
        Response.json({ error: { code: 'api_key_invalid' } }, { status: 401 }),
      )
    const b = await createHandler(refused.deps)(
      post({ token: generateToken() }),
    )
    assertEquals(b.status, 503)
    await b.body?.cancel()
  }))
