/**
 * `stripe-webhook` (Facturation FS): Stripe's events for a clinic. A webhook
 * function (CLAUDE.md §7): `?org=` names the org whose secret verifies the
 * signature; no CORS, `webhookResponse` only.
 *
 * 1. `POST` only; `?org=` a uuid; `Stripe-Signature` present; the body at
 *    most 256 KB, UTF-8.
 * 2. One hit per IP (`LIMITS.stripeWebhookIp`) before the secret is read.
 * 3. The org's `stripe_webhook_secret`; the signature checked
 *    (`verifyStripeSignature`: HMAC in constant time, 5 minutes).
 * 4. `claimEvent` (`stripe`, `<org>:<event id>`): a duplicate → 200, one in
 *    progress → 409; then the module check (`requireModuleForOrg`): off, a
 *    payment event is kept failed for Stripe's retries (503), another one is
 *    dropped. Amounts in CAD only; a payment is dated by the event's
 *    `created`; a charge's own id (`metadata.charge_id`) settles that charge.
 * 5. Handled:
 *    - `checkout.session.completed`, mode `setup`: the setup intent's card
 *      (brand, last four, expiry) → `record_stripe_card_for_service`;
 *    - `checkout.session.completed`, mode `payment`, paid: the invoice of
 *      its metadata (this org's) → `record_stripe_payment_for_service` (the
 *      PaymentIntent is the reference: recorded once);
 *    - `payment_intent.succeeded` with an invoice in its metadata (a charge
 *      whose job ended early) → the same;
 *    - `payment_intent.payment_failed` → `stripe_payment_failed_for_service`.
 *    Anything else → 200 `{ outcome: 'skipped' }`.
 * 6. `completeEvent`, or `failEvent` and 500 (Stripe retries).
 *
 * A key, a card number or an address never reaches a log or a report.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { readCapped } from '../_shared/http.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { UUID } from '../_shared/patterns.ts'
import { clientIp, consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { createReportThrottle } from '../_shared/report-throttle.ts'
import { StripeError } from '../_shared/stripe/client.ts'
import { clinicStripe } from '../_shared/stripe/clinic.ts'
import { SECRET_WEBHOOK } from '../_shared/stripe/env.ts'
import { verifyStripeSignature } from '../_shared/stripe/webhook.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'

const FN = 'stripe-webhook'
const MAX_BODY = 256 * 1024

const metadataSchema = z.looseObject({
  org_id: z.string().optional(),
  invoice_id: z.string().optional(),
  charge_id: z.string().optional(),
}).nullable().optional()

const eventSchema = z.looseObject({
  id: z.string().regex(/^evt_[A-Za-z0-9]{1,64}$/),
  type: z.string().max(100),
  created: z.number().int().positive().optional(),
  data: z.looseObject({
    object: z.looseObject({
      id: z.string().max(100).optional(),
      mode: z.string().optional(),
      status: z.string().optional(),
      payment_status: z.string().optional(),
      customer: z.string().nullable().optional(),
      setup_intent: z.string().nullable().optional(),
      payment_intent: z.string().nullable().optional(),
      amount_total: z.number().int().nullable().optional(),
      amount_received: z.number().int().nullable().optional(),
      currency: z.string().nullable().optional(),
      metadata: metadataSchema,
      last_payment_error: z.looseObject({
        code: z.string().optional(),
        decline_code: z.string().optional(),
      }).nullable().optional(),
    }),
  }),
})

type StripeEvent = z.infer<typeof eventSchema>

class HandlingFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const SAFE_CODE = /^[a-z0-9_]{1,64}$/

type StripeObject = StripeEvent['data']['object']

/** The metadata, when it is this org's (never another org's ids). */
function ownMetadata(object: StripeObject, orgId: string) {
  const meta = object.metadata
  if (!meta || (meta.org_id ?? '').toLowerCase() !== orgId.toLowerCase()) {
    return null
  }
  return meta
}

/** The invoice an object pays, when it is this org's. */
function invoiceOf(object: StripeObject, orgId: string): string | null {
  const id = ownMetadata(object, orgId)?.invoice_id
  return id && UUID.test(id) ? id : null
}

/** The charge a PaymentIntent was made for (the job or « Prélever maintenant »). */
function chargeOf(object: StripeObject, orgId: string): string | null {
  const id = ownMetadata(object, orgId)?.charge_id
  return id && UUID.test(id) ? id : null
}

/** Amounts are recorded only in Canadian dollars. */
const isCad = (object: StripeObject) =>
  (object.currency ?? 'cad').toLowerCase() === 'cad'

/** Events that bring money: kept for a retry while the module is off. */
const MONEY_EVENTS = new Set([
  'checkout.session.completed',
  'payment_intent.succeeded',
])

async function handle(
  event: StripeEvent,
  orgId: string,
  client: SupabaseClient,
  deps: Deps,
  now: Date,
): Promise<string> {
  const object = event.data.object
  // When Stripe made the event (its retries keep the payment's day).
  const paidAt = event.created ? new Date(event.created * 1000) : now
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new HandlingFailure(`${fn}_failed`)
    return data
  }

  if (event.type === 'checkout.session.completed' && object.mode === 'setup') {
    if (!object.setup_intent) return 'skipped'
    const stripe = await clinicStripe(client, deps, orgId)
    if (!stripe) throw new HandlingFailure('stripe_not_configured')
    const card = await stripe.setupIntentCard(object.setup_intent)
    if (!card || !card.customerId) return 'skipped'
    const saved = await rpc('record_stripe_card_for_service', {
      p_org_id: orgId,
      p_customer_id: card.customerId,
      p_payment_method_id: card.paymentMethodId,
      p_brand: card.brand,
      p_last4: card.last4,
      p_exp_month: card.expMonth,
      p_exp_year: card.expYear,
    }) as
      | { payer_client_id?: string; replaced_payment_method_id?: string | null }
      | null
    if (!saved?.payer_client_id) return 'skipped'
    // The card it replaces is detached at Stripe (best effort: gone here).
    if (saved.replaced_payment_method_id) {
      await stripe.detachPaymentMethod(saved.replaced_payment_method_id)
        .catch(() => {})
    }
    return 'card_saved'
  }

  if (
    event.type === 'checkout.session.completed' && object.mode === 'payment'
  ) {
    const invoice = invoiceOf(object, orgId)
    if (
      object.payment_status !== 'paid' || !invoice || !object.payment_intent ||
      !object.amount_total || !isCad(object)
    ) return 'skipped'
    await rpc('record_stripe_payment_for_service', {
      p_org_id: orgId,
      p_invoice_id: invoice,
      p_payment_intent_id: object.payment_intent,
      p_amount_cents: object.amount_total,
      p_paid_at: paidAt.toISOString(),
      p_charge_id: null,
    })
    return 'payment_recorded'
  }

  if (event.type === 'payment_intent.succeeded') {
    const invoice = invoiceOf(object, orgId)
    const amount = object.amount_received ?? 0
    if (
      !invoice || !object.id?.startsWith('pi_') || amount < 1 || !isCad(object)
    ) {
      return 'skipped'
    }
    await rpc('record_stripe_payment_for_service', {
      p_org_id: orgId,
      p_invoice_id: invoice,
      p_payment_intent_id: object.id,
      p_amount_cents: amount,
      p_paid_at: paidAt.toISOString(),
      p_charge_id: chargeOf(object, orgId),
    })
    return 'payment_recorded'
  }

  if (event.type === 'payment_intent.payment_failed') {
    if (!object.id?.startsWith('pi_')) return 'skipped'
    const raw = object.last_payment_error?.decline_code ??
      object.last_payment_error?.code ?? 'declined'
    await rpc('stripe_payment_failed_for_service', {
      p_org_id: orgId,
      p_payment_intent_id: object.id,
      p_failure_code: SAFE_CODE.test(raw) ? raw : 'declined',
      p_charge_id: chargeOf(object, orgId),
    })
    return 'charge_failed'
  }

  return 'skipped'
}

/** The webhook handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const reportMissingSecret = createReportThrottle()
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const orgId = new URL(req.url).searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const signature = req.headers.get('stripe-signature')
    if (!signature) return webhookResponse(401)
    const bytes = await readCapped(req, MAX_BODY)
    if (bytes === null) return webhookResponse(413)
    let rawBody: string
    try {
      rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return webhookResponse(400)
    }

    const client = deps.serviceClient()
    if (client instanceof Response) return webhookResponse(500)
    const limit = await consume(client, LIMITS.stripeWebhookIp, [clientIp(req)])
    if (!limit.allowed) {
      if (limit.reason === 'unavailable') return webhookResponse(503)
      const res = webhookResponse(429)
      res.headers.set('Retry-After', String(limit.retryAfter))
      return res
    }
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: SECRET_WEBHOOK,
    })
    if (secret.error) {
      await report('stripe_webhook_secret_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      if (reportMissingSecret(orgId.toLowerCase(), deps.now().getTime())) {
        await report('stripe_webhook_secret_missing')
      }
      return webhookResponse(401)
    }
    const now = deps.now()
    if (
      !(await verifyStripeSignature(
        signature,
        rawBody,
        secret.data,
        Math.floor(now.getTime() / 1000),
      ))
    ) {
      return webhookResponse(401)
    }

    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      return webhookResponse(400)
    }
    const parsed = eventSchema.safeParse(json)
    if (!parsed.success) return webhookResponse(400)
    const event = parsed.data

    let claim
    try {
      claim = await claimEvent(client, {
        provider: 'stripe',
        eventId: `${orgId}:${event.id}`,
        orgId,
        eventType: event.type,
        payload: { event_id: event.id, type: event.type },
      })
    } catch {
      await report('claim_failed')
      return webhookResponse(500)
    }
    if (claim.status === 'duplicate') {
      return webhookResponse(200, { outcome: 'duplicate' })
    }
    if (claim.status === 'in_progress') return webhookResponse(409)

    const gate = await requireModuleForOrg(client, orgId, 'billing')
    if (gate) {
      // Money Stripe took is never dropped: Stripe retries until it is back.
      if (MONEY_EVENTS.has(event.type)) {
        await failEvent(client, claim.id, claim.token, 'module_disabled')
          .catch(() => false)
        return webhookResponse(503)
      }
      await completeEvent(client, claim.id, claim.token).catch(() => false)
      return webhookResponse(200, { outcome: 'module_disabled' })
    }

    try {
      const outcome = await handle(event, orgId, client, deps, now)
      await completeEvent(client, claim.id, claim.token)
      return webhookResponse(200, { outcome })
    } catch (error) {
      const code = error instanceof HandlingFailure
        ? error.code
        : error instanceof StripeError
        ? `stripe_${error.code}`
        : 'handling_failed'
      await report(code)
      await failEvent(client, claim.id, claim.token, code).catch(() => false)
      return webhookResponse(500)
    }
  }
}
