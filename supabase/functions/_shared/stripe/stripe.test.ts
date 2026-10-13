import { assert, assertEquals } from '@std/assert'
import { formEncode } from './client.ts'
import { isCheckoutUrl, stripeApiOrigin } from './env.ts'
import { signStripePayload, verifyStripeSignature } from './webhook.ts'

Deno.test("stripe: nested form encoding (Stripe's a[b][0][c])", () => {
  assertEquals(
    formEncode({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { unit_amount: 500 } }],
      expand: ['payment_method'],
      skip: null,
    }),
    'mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500&expand%5B0%5D=payment_method',
  )
})

Deno.test("stripe: the fake is honoured only while APP_URL is local; Checkout URLs are Stripe's", () => {
  const local = (k: string) =>
    ({
      APP_URL: 'http://localhost:5173',
      STRIPE_API_BASE_URL: 'http://host.docker.internal:55397',
    } as Record<string, string>)[k]
  const hosted = (k: string) =>
    ({
      APP_URL: 'https://app.cliniquemana.com',
      STRIPE_API_BASE_URL: 'http://evil.test',
    } as Record<string, string>)[k]
  assertEquals(stripeApiOrigin(local), 'http://host.docker.internal:55397')
  assertEquals(stripeApiOrigin(hosted), 'https://api.stripe.com')
  assert(isCheckoutUrl('https://checkout.stripe.com/c/pay/cs_1', hosted))
  assert(!isCheckoutUrl('http://127.0.0.1:55397/checkout/cs_1', hosted))
  assert(isCheckoutUrl('http://127.0.0.1:55397/checkout/cs_1', local))
  assert(!isCheckoutUrl('https://evil.test/checkout', local))
})

Deno.test('stripe: webhook signatures — the right secret, in time, any of several v1', async () => {
  const payload = '{"id":"evt_1"}'
  const header = await signStripePayload('whsec_a', payload, 1_000_000)
  assert(await verifyStripeSignature(header, payload, 'whsec_a', 1_000_100))
  assert(!(await verifyStripeSignature(header, payload, 'whsec_b', 1_000_100)))
  assert(
    !(await verifyStripeSignature(header, payload + ' ', 'whsec_a', 1_000_100)),
  )
  assert(!(await verifyStripeSignature(header, payload, 'whsec_a', 1_000_301)))
  assert(
    await verifyStripeSignature(
      `${header},v1=${'0'.repeat(64)}`,
      payload,
      'whsec_a',
      1_000_000,
    ),
  )
  assert(!(await verifyStripeSignature('t=1,v1=zz', payload, 'whsec_a', 1)))
  assert(!(await verifyStripeSignature(null, payload, 'whsec_a', 1)))
})
