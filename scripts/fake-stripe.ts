// A local, in-memory Stripe for « Paiements en ligne » (Facturation FS): customers, Checkout
// sessions with a page that completes them (« Enregistrer la carte de test 4242 », « Payer »,
// « Carte refusée ») and sends the signed webhook to the app, setup intents, payment methods and
// off-session PaymentIntents. Save a card, pay an invoice or run the next-day charge without a
// Stripe account.
//
//   npm run fake:stripe
//
// One fake: this script only listens. The behaviour is
// supabase/functions/_shared/testing/fake-stripe.ts (the one the Deno tests use).
//
// The functions reach it through supabase/functions/.env (honoured only while APP_URL is local):
//   STRIPE_API_BASE_URL=http://host.docker.internal:55397
// and the seed org's secrets (supabase/seed.sql) hold the fake's keys. Completed checkouts are
// announced to FAKE_STRIPE_WEBHOOK_URL (default: the local stripe-webhook for the seed org).
// The server listens on 127.0.0.1:55397 (FAKE_STRIPE_HOST / FAKE_STRIPE_PORT).
//
// Logs carry the method, the path's kind and the status only: never a key.

import { FAKE_STRIPE_WEBHOOK_SECRET, fakeStripe } from '../supabase/functions/_shared/testing/fake-stripe.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_STRIPE_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_STRIPE_PORT') ?? 55397)
const webhookUrl = env('FAKE_STRIPE_WEBHOOK_URL') ??
  'http://127.0.0.1:55321/functions/v1/stripe-webhook?org=00000000-0000-0000-0000-000000000001'
const fake = fakeStripe({
  publicOrigin: `http://${hostname}:${port}`,
  webhookUrl,
  webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET,
})

const kindOf = (pathname: string): string => {
  if (pathname.startsWith('/checkout/')) return '/checkout/:id'
  return pathname.replace(/\/(cus|cs|seti|pm|pi)_[A-Za-z0-9]+/g, '/:id')
}

Deno.serve({
  hostname,
  port,
  onListen: () => console.log(`[fake-stripe] listening on http://${hostname}:${port}`),
}, async (req) => {
  const { pathname } = new URL(req.url)
  let res: Response
  try {
    res = await fake.handler(req)
  } catch (error) {
    console.error('[fake-stripe] handler error', error instanceof Error ? error.name : 'Error')
    res = Response.json({ error: { code: 'internal' } }, { status: 500 })
  }
  fake.calls.length = 0
  console.log(`[fake-stripe] ${req.method} ${kindOf(pathname)} ${res.status}`)
  return res
})
