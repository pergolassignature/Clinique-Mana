import { assert, assertEquals } from '@std/assert'
import { consentText, createHandler, paymentWindow } from './handler.ts'
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
    // The balance of the moment: the session lapses with its half hour (at
    // 15:00 exactly, 31 minutes after 15:30).
    assertEquals(
      call.params.get('expires_at'),
      String(Math.floor(Date.parse('2026-11-03T15:00:00Z') / 1000) + 61 * 60),
    )
    assertEquals(
      call.idempotencyKey,
      `checkout:${INVOICE}:20000:${
        Math.floor(Date.parse('2026-11-03T15:00:00Z') / 1000 / 1800)
      }`,
    )
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

Deno.test('billing-stripe-checkout: an English payer comes back to the English page (&lang=en), Stripe in English', () =>
  run(async () => {
    const { handler, stripe } = setup(valid({ language: 'en' }))
    const res = await handler(post({ token: generateToken() }))
    assertEquals((await res.json()).state, 'valid')
    const session = [...stripe.sessions.values()][0]!
    assertEquals(
      session.successUrl,
      'http://localhost:5173/payer?etat=merci&lang=en',
    )
    assertEquals(
      session.cancelUrl,
      'http://localhost:5173/payer?etat=annule&lang=en',
    )
    const call = stripe.calls.find((c) => c.path === '/v1/checkout/sessions')!
    assertEquals(call.params.get('locale'), 'en')
  }))

Deno.test('billing-stripe-checkout: two links of one invoice opened together give one session (one payment)', () =>
  run(async () => {
    const { handler, stripe } = setup(valid())
    const a = await (await handler(post({ token: generateToken() }))).json()
    const b = await (await handler(post({ token: generateToken() }))).json()
    assertEquals(a.state, 'valid')
    assertEquals(b.url, a.url)
    assertEquals(stripe.sessions.size, 1)
  }))

Deno.test('billing-stripe-checkout: a new balance is a new session', () =>
  run(async () => {
    const amounts = [20000, 15000]
    const { handler, stripe } = setup(() =>
      valid({ amount_cents: amounts.shift() })
    )
    const a = await (await handler(post({ token: generateToken() }))).json()
    const b = await (await handler(post({ token: generateToken() }))).json()
    assert(a.url !== b.url, 'another session for another amount')
    assertEquals(stripe.sessions.size, 2)
  }))

Deno.test('billing-stripe-checkout: the payment window: same key and expiry within the half hour, 31 to 61 minutes ahead', () => {
  const at = (iso: string) => paymentWindow(INVOICE, 20000, new Date(iso))
  const start = at('2026-11-03T15:00:00Z')
  const late = at('2026-11-03T15:29:59Z')
  assertEquals(late, start)
  const next = at('2026-11-03T15:30:00Z')
  assert(next.key !== start.key)
  const now = Date.parse('2026-11-03T15:29:59Z') / 1000
  assert(late.expiresAt - now >= 31 * 60 && late.expiresAt - now <= 61 * 60)
  assert(
    paymentWindow(INVOICE, 19999, new Date('2026-11-03T15:00:00Z')).key !==
      start.key,
  )
})
