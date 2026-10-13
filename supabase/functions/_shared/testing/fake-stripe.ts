/**
 * An in-memory Stripe (Facturation FS) for the Deno tests and the local server
 * (`scripts/fake-stripe.ts`, `npm run fake:stripe`): customers, Checkout
 * sessions (setup and payment) with a page that completes them and sends the
 * signed `checkout.session.completed` webhook, setup intents, payment methods
 * (detach), off-session PaymentIntents (`pm_fakeDeclined` is refused) and
 * refunds (`FAKE_PENDING_REFUND_CENTS` stays pending: the webhook settles it).
 * Test-only and the local fake: no `index.ts` imports this folder.
 */
import { signStripePayload } from '../stripe/webhook.ts'

/** The fake's keys (the seed's org secrets hold the same values). */
export const FAKE_STRIPE_SECRET_KEY = 'sk_test_local_dev'
export const FAKE_STRIPE_WEBHOOK_SECRET = 'whsec_local_dev'
/** The card a fake checkout saves, and the one that is always refused. */
export const FAKE_CARD = {
  brand: 'visa',
  last4: '4242',
  exp_month: 12,
  exp_year: 2030,
}
export const FAKE_DECLINED_PM = 'pm_fakeDeclined'
/** A card whose charge stays `processing` (the webhook settles it). */
export const FAKE_PROCESSING_PM = 'pm_fakeProcessing'
/** A refund of this amount stays `pending` (the webhook settles it). */
export const FAKE_PENDING_REFUND_CENTS = 1313

interface Session {
  id: string
  mode: 'setup' | 'payment'
  customer: string | null
  amount: number | null
  metadata: Record<string, string>
  clientReference: string | null
  successUrl: string
  cancelUrl: string
  completed: boolean
}

export interface FakeStripeOptions {
  /** Where the checkout pages are reached by a browser. */
  publicOrigin?: string
  /** Where completed checkouts are announced (the app's stripe-webhook), and its secret. */
  webhookUrl?: string
  webhookSecret?: string
  /** Sends the webhook (the server's own fetch; tests pass theirs). */
  send?: typeof fetch
  now?: () => Date
}

export interface FakeStripe {
  handler(req: Request): Promise<Response>
  fetch: typeof fetch
  calls: Array<
    {
      method: string
      path: string
      params: URLSearchParams
      idempotencyKey: string | null
    }
  >
  customers: Map<
    string,
    { name: string; email: string; metadata: Record<string, string> }
  >
  sessions: Map<string, Session>
  paymentMethods: Map<
    string,
    { customer: string | null; detached: boolean; declined: boolean }
  >
  paymentIntents: Map<
    string,
    { amount: number; status: string; metadata: Record<string, string> }
  >
  refunds: Map<
    string,
    {
      payment_intent: string
      amount: number
      status: string
      metadata: Record<string, string>
    }
  >
  /** Completes a session as its page would (tests): the webhook's event. */
  complete(
    sessionId: string,
    card?: 'ok' | 'declined',
  ): Promise<Record<string, unknown>>
}

const json = (body: unknown, status = 200) => Response.json(body, { status })
const stripeError = (
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
) =>
  json({
    error: {
      type: status === 402 ? 'card_error' : 'invalid_request_error',
      code,
      ...extra,
    },
  }, status)

/** `metadata[a]=b` → { a: b } for one prefix. */
function nested(
  params: URLSearchParams,
  prefix: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) {
    const m = key.match(
      new RegExp(`^${prefix.replace(/[[\]]/g, '\\$&')}\\[([a-z_]+)\\]$`),
    )
    if (m) out[m[1]!] = value
  }
  return out
}

export function fakeStripe(options: FakeStripeOptions = {}): FakeStripe {
  const publicOrigin = options.publicOrigin ?? 'http://127.0.0.1:55397'
  const now = options.now ?? (() => new Date())
  let n = 0
  const id = (prefix: string) =>
    `${prefix}_fake${(++n).toString().padStart(6, '0')}`
  const calls: FakeStripe['calls'] = []
  const customers: FakeStripe['customers'] = new Map()
  const sessions: FakeStripe['sessions'] = new Map()
  const setupIntents = new Map<
    string,
    { customer: string | null; payment_method: string }
  >()
  const paymentMethods: FakeStripe['paymentMethods'] = new Map()
  const paymentIntents: FakeStripe['paymentIntents'] = new Map()
  const refunds: FakeStripe['refunds'] = new Map()
  const refundJson = (id: string) => {
    const r = refunds.get(id)!
    return {
      id,
      object: 'refund',
      status: r.status,
      amount: r.amount,
      payment_intent: r.payment_intent,
      failure_reason: null,
      metadata: r.metadata,
    }
  }
  const idempotent = new Map<string, Response>()

  const card = (pm: string) => ({
    id: pm,
    customer: paymentMethods.get(pm)?.customer ?? null,
    card: FAKE_CARD,
  })

  async function complete(
    sessionId: string,
    cardKind: 'ok' | 'declined' = 'ok',
  ): Promise<Record<string, unknown>> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error('fake-stripe: no such session')
    session.completed = true
    let object: Record<string, unknown>
    if (session.mode === 'setup') {
      const pm = cardKind === 'declined' ? FAKE_DECLINED_PM : id('pm')
      paymentMethods.set(pm, {
        customer: session.customer,
        detached: false,
        declined: cardKind === 'declined',
      })
      const seti = id('seti')
      setupIntents.set(seti, { customer: session.customer, payment_method: pm })
      object = {
        id: session.id,
        object: 'checkout.session',
        mode: 'setup',
        customer: session.customer,
        setup_intent: seti,
        metadata: session.metadata,
        status: 'complete',
      }
    } else {
      const pi = id('pi')
      paymentIntents.set(pi, {
        amount: session.amount ?? 0,
        status: 'succeeded',
        metadata: session.metadata,
      })
      object = {
        id: session.id,
        object: 'checkout.session',
        mode: 'payment',
        customer: session.customer,
        payment_intent: pi,
        payment_status: 'paid',
        amount_total: session.amount,
        client_reference_id: session.clientReference,
        metadata: session.metadata,
        status: 'complete',
      }
    }
    const event = {
      id: id('evt'),
      object: 'event',
      type: 'checkout.session.completed',
      data: { object },
    }
    if (options.webhookUrl && options.webhookSecret) {
      const payload = JSON.stringify(event)
      const signature = await signStripePayload(
        options.webhookSecret,
        payload,
        Math.floor(now().getTime() / 1000),
      )
      await (options.send ?? fetch)(options.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signature,
        },
        body: payload,
      }).then((r) => r.body?.cancel()).catch(() => {})
    }
    return event
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const params = req.method === 'GET'
      ? url.searchParams
      : new URLSearchParams(await req.text())
    const idempotencyKey = req.headers.get('Idempotency-Key')
    if (path.startsWith('/v1/')) {
      calls.push({ method: req.method, path, params, idempotencyKey })
      if (!(req.headers.get('Authorization') ?? '').startsWith('Bearer sk_')) {
        return stripeError(401, 'api_key_invalid')
      }
    }

    // The checkout page (browser).
    const page = path.match(/^\/checkout\/(cs_[A-Za-z0-9]+)(\/complete)?$/)
    if (page) {
      const session = sessions.get(page[1]!)
      if (!session) return new Response('Session inconnue', { status: 404 })
      if (page[2] && req.method === 'POST') {
        await complete(
          session.id,
          params.get('card') === 'declined' ? 'declined' : 'ok',
        )
        return new Response(null, {
          status: 303,
          headers: { Location: session.successUrl },
        })
      }
      const what = session.mode === 'setup'
        ? 'Enregistrer la carte de test 4242'
        : `Payer ${((session.amount ?? 0) / 100).toFixed(2)} $`
      const html =
        `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Stripe (local)</title>
<h1>Stripe local (faux)</h1><form method="post" action="/checkout/${session.id}/complete">
<button name="card" value="ok">${what}</button> <button name="card" value="declined">Carte refusée</button></form>
<p><a href="${session.cancelUrl}">Annuler</a></p></html>`
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    if (req.method === 'POST' && path === '/v1/customers') {
      const cus = id('cus')
      customers.set(cus, {
        name: params.get('name') ?? '',
        email: params.get('email') ?? '',
        metadata: nested(params, 'metadata'),
      })
      return json({ id: cus, object: 'customer' })
    }
    if (req.method === 'POST' && path === '/v1/checkout/sessions') {
      const mode = params.get('mode') === 'setup' ? 'setup' : 'payment'
      const cs = id('cs')
      const amount = params.get('line_items[0][price_data][unit_amount]')
      sessions.set(cs, {
        id: cs,
        mode,
        customer: params.get('customer'),
        amount: amount ? Number(amount) : null,
        metadata: nested(params, 'metadata'),
        clientReference: params.get('client_reference_id'),
        successUrl: params.get('success_url') ?? '',
        cancelUrl: params.get('cancel_url') ?? '',
        completed: false,
      })
      return json({
        id: cs,
        object: 'checkout.session',
        url: `${publicOrigin}/checkout/${cs}`,
      })
    }
    const seti = path.match(/^\/v1\/setup_intents\/([A-Za-z0-9_]+)$/)
    if (req.method === 'GET' && seti) {
      const intent = setupIntents.get(seti[1]!)
      if (!intent) return stripeError(404, 'resource_missing')
      return json({
        id: seti[1],
        status: 'succeeded',
        customer: intent.customer,
        payment_method: card(intent.payment_method),
      })
    }
    const pmGet = path.match(/^\/v1\/payment_methods\/([A-Za-z0-9_]+)$/)
    if (req.method === 'GET' && pmGet) {
      if (!paymentMethods.has(pmGet[1]!)) {
        return stripeError(404, 'resource_missing')
      }
      return json(card(pmGet[1]!))
    }
    const detach = path.match(
      /^\/v1\/payment_methods\/([A-Za-z0-9_]+)\/detach$/,
    )
    if (req.method === 'POST' && detach) {
      const pm = paymentMethods.get(detach[1]!)
      if (!pm) return stripeError(404, 'resource_missing')
      pm.detached = true
      return json({ id: detach[1], customer: null })
    }
    if (req.method === 'POST' && path === '/v1/payment_intents') {
      if (idempotencyKey && idempotent.has(idempotencyKey)) {
        return idempotent.get(idempotencyKey)!.clone()
      }
      const pm = params.get('payment_method') ?? ''
      const method = paymentMethods.get(pm)
      const pi = id('pi')
      const amount = Number(params.get('amount') ?? 0)
      let res: Response
      if (pm === FAKE_DECLINED_PM || method?.declined || method?.detached) {
        paymentIntents.set(pi, {
          amount,
          status: 'requires_payment_method',
          metadata: nested(params, 'metadata'),
        })
        res = stripeError(402, 'card_declined', {
          decline_code: 'insufficient_funds',
          payment_intent: { id: pi, status: 'requires_payment_method' },
        })
      } else {
        const status = pm === FAKE_PROCESSING_PM ? 'processing' : 'succeeded'
        paymentIntents.set(pi, {
          amount,
          status,
          metadata: nested(params, 'metadata'),
        })
        res = json({ id: pi, object: 'payment_intent', status, amount })
      }
      if (idempotencyKey) idempotent.set(idempotencyKey, res.clone())
      return res
    }
    if (req.method === 'POST' && path === '/v1/refunds') {
      if (idempotencyKey && idempotent.has(idempotencyKey)) {
        return idempotent.get(idempotencyKey)!.clone()
      }
      const pi = params.get('payment_intent') ?? ''
      const intent = paymentIntents.get(pi)
      if (!intent || intent.status !== 'succeeded') {
        return stripeError(404, 'resource_missing')
      }
      const amount = Number(params.get('amount') ?? intent.amount)
      const refunded = [...refunds.values()].filter((r) =>
        r.payment_intent === pi && r.status !== 'failed' &&
        r.status !== 'canceled'
      ).reduce((sum, r) => sum + r.amount, 0)
      if (amount < 1 || refunded + amount > intent.amount) {
        return stripeError(400, 'amount_too_large')
      }
      const re = id('re')
      refunds.set(re, {
        payment_intent: pi,
        amount,
        status: amount === FAKE_PENDING_REFUND_CENTS ? 'pending' : 'succeeded',
        metadata: nested(params, 'metadata'),
      })
      const res = json(refundJson(re))
      if (idempotencyKey) idempotent.set(idempotencyKey, res.clone())
      return res
    }
    if (req.method === 'GET' && path === '/v1/refunds') {
      const pi = params.get('payment_intent')
      return json({
        object: 'list',
        data: [...refunds.keys()].filter((k) =>
          !pi || refunds.get(k)!.payment_intent === pi
        ).map(refundJson),
      })
    }
    return stripeError(404, 'resource_missing')
  }

  async function handler(req: Request): Promise<Response> {
    return await route(req)
  }

  return {
    handler,
    fetch:
      ((input: RequestInfo | URL, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof fetch,
    calls,
    customers,
    sessions,
    paymentMethods,
    paymentIntents,
    refunds,
    complete,
  }
}
