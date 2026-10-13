/**
 * `billing-stripe` (Facturation FS): the staff's Stripe actions on a dossier.
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `billing` and
 *    `billing.manage`.
 * 2. Body, strict, one of:
 *    - `{ action: 'card_link', payer_client_id }`: « Envoyer le lien pour
 *      enregistrer une carte ». The payer's context
 *      (`stripe_card_link_context_for_service`, which checks the actor and
 *      refuses a payer without an address or a clinic without Stripe), her
 *      Stripe customer made once (`createCustomer`, idempotent), a link
 *      (`/carte#t=…`, purpose `billing_card_setup`, 7 days) and the email
 *      `billing.card_setup` (`_en` for an English payer) to her address. A
 *      reserved module holds the email (P3-40, CC-14): 409 `module_reserved`.
 *    - `{ action: 'charge_now', invoice_id }`: « Prélever maintenant »:
 *      `begin_stripe_charge_for_service` (kind `manual`), the off-session
 *      PaymentIntent (idempotent per charge), then
 *      `finish_stripe_charge_for_service`; 200 `{ status }` (`succeeded`,
 *      `failed` with Stripe's `failure_code`, or `pending` while Stripe is
 *      processing: the webhook settles it). A charge still pending is resumed
 *      under its own idempotency key, never doubled.
 *    - `{ action: 'remove_card', payer_client_id }`: « Retirer la carte »:
 *      the card detached at Stripe (already gone is fine), then
 *      `stripe_card_removed_for_service`.
 *    - `{ action: 'refund', refund_id }` (FS-9): right after F3's
 *      `refund_payment` on a Stripe payment, the card refunded at Stripe
 *      (`processRefund`, once per refund) and the refund settled; 200
 *      `{ status }`: `recorded`, `failed` (Stripe refused, or a card payment
 *      without its PaymentIntent: refunded by hand), `pending` (the webhook or
 *      the job settles it), `settled` (already done, or not a Stripe refund).
 *      A reserved module moves no money (P3-40): 409 `module_reserved`.
 * 3. One hit on `LIMITS.billingStripeUser` (60 an hour per caller).
 *
 * Status codes: 200; 400 `invalid_request` (body, a French refusal); 401 /
 * 403 / 503 from `verifyAuth`; 403 (42501); 405; 409 `module_reserved`; 413;
 * 429; 502 `provider_error` (Stripe failed); 503 `not_configured` (no key);
 * 500 `internal`. A key, a card number or an address never reaches a log, a
 * report or an answer.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  refusalResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { readJson } from '../_shared/http.ts'
import { generateToken, hashToken, linkUrl } from '../_shared/links.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { StripeError } from '../_shared/stripe/client.ts'
import { clinicStripe } from '../_shared/stripe/clinic.ts'
import { CARD_PATH } from '../_shared/stripe/env.ts'
import { processRefund } from '../_shared/stripe/refunds.ts'

const FN = 'billing-stripe'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('card_link'), payer_client_id: z.guid() }),
  z.strictObject({ action: z.literal('charge_now'), invoice_id: z.guid() }),
  z.strictObject({
    action: z.literal('remove_card'),
    payer_client_id: z.guid(),
  }),
  z.strictObject({ action: z.literal('refund'), refund_id: z.guid() }),
])

const refundSchema = z.object({
  refund_id: z.guid(),
  amount_cents: z.number().int().positive(),
  payment_intent_id: z.string().nullable(),
  module_open: z.boolean(),
})

const contextSchema = z.object({
  payer_client_id: z.string(),
  name: z.string(),
  first_name: z.string(),
  email: z.string(),
  language: z.string(),
  clinic_name: z.string(),
  customer_id: z.string().nullable(),
})
const chargeSchema = z.object({
  charge_id: z.guid(),
  amount_cents: z.number().int().positive(),
  invoice_number: z.string().nullable(),
  customer_id: z.string(),
  payment_method_id: z.string(),
  clinic_name: z.string(),
})
const cardSchema = z.object({
  customer_id: z.string(),
  payment_method_id: z.string(),
})

interface RpcError {
  code?: string
  message?: string
}

function rpcFailure(error: RpcError, req: Request): Response | null {
  if (error.code === 'P0001' && error.message) {
    return refusalResponse(error.message, req)
  }
  if (error.code === '42501') {
    return errorResponse('forbidden', 'Forbidden', 403, req)
  }
  return null
}

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'billing',
      permission: 'billing.manage',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 1_024)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const actor = auth.user.id
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)
    const internal = async (code: string) => {
      await report(code)
      return errorResponse('internal', 'The Stripe action failed', 500, req)
    }

    const limited = limitResponse(
      await consume(service, LIMITS.billingStripeUser, [orgId, actor]),
      req,
    )
    if (limited) return limited

    let stripe
    try {
      stripe = await clinicStripe(service, deps, orgId)
    } catch {
      return await internal('secret_unavailable')
    }
    if (!stripe) {
      return errorResponse(
        'not_configured',
        'Stripe is not configured',
        503,
        req,
      )
    }

    try {
      if (input.action === 'card_link') {
        ids.client_id = input.payer_client_id
        const ctx = await service.rpc('stripe_card_link_context_for_service', {
          p_org_id: orgId,
          p_actor: actor,
          p_payer_client_id: input.payer_client_id,
        })
        if (ctx.error) {
          return rpcFailure(ctx.error, req) ?? await internal('context_failed')
        }
        const payer = contextSchema.safeParse(ctx.data)
        if (!payer.success) return await internal('context_invalid')
        let customerId = payer.data.customer_id
        if (!customerId) {
          customerId = await stripe.createCustomer({
            name: payer.data.name,
            email: payer.data.email,
            orgId,
            payerId: payer.data.payer_client_id,
          })
          const saved = await service.rpc('save_stripe_customer_for_service', {
            p_org_id: orgId,
            p_payer_client_id: payer.data.payer_client_id,
            p_customer_id: customerId,
          })
          if (saved.error) return await internal('customer_save_failed')
        }
        const token = generateToken()
        const issued = await service.rpc('issue_billing_link_for_service', {
          p_org_id: orgId,
          p_purpose: 'billing_card_setup',
          p_subject_id: payer.data.payer_client_id,
          p_token_hash: await hashToken(token),
          p_actor: actor,
        })
        if (issued.error) {
          return rpcFailure(issued.error, req) ?? await internal('link_failed')
        }
        if (issued.data !== true) {
          return errorResponse(
            'not_configured',
            'Stripe is not configured',
            503,
            req,
          )
        }
        const result = await sendTemplatedEmail(
          { fn: FN, client: service, env: deps.env, fetch: deps.fetch },
          {
            orgId,
            templateKey: payer.data.language === 'en'
              ? 'billing.card_setup_en'
              : 'billing.card_setup',
            to: { email: payer.data.email, profileId: null },
            subject: { type: 'client', id: payer.data.payer_client_id },
            values: {
              recipient: { first_name: payer.data.first_name },
              clinic: { name: payer.data.clinic_name },
            },
            actionUrl: linkUrl(deps.env('APP_URL') ?? '', CARD_PATH, token),
            sentBy: actor,
          },
        )
        if (result.ok) return jsonResponse({ sent: true }, 200, req)
        if (result.code === 'module_reserved') {
          return errorResponse(
            'conflict',
            'The module is reserved for its testers',
            409,
            req,
          )
        }
        return await internal(`email_${result.code}`)
      }

      if (input.action === 'charge_now') {
        ids.invoice_id = input.invoice_id
        const begun = await service.rpc('begin_stripe_charge_for_service', {
          p_org_id: orgId,
          p_invoice_id: input.invoice_id,
          p_kind: 'manual',
          p_actor: actor,
        })
        if (begun.error) {
          return rpcFailure(begun.error, req) ??
            await internal('charge_begin_failed')
        }
        const charge = chargeSchema.safeParse(begun.data)
        if (!charge.success) return await internal('charge_invalid')
        ids.charge_id = charge.data.charge_id
        const intent = await stripe.chargeCard({
          amountCents: charge.data.amount_cents,
          customerId: charge.data.customer_id,
          paymentMethodId: charge.data.payment_method_id,
          description: `Facture ${
            charge.data.invoice_number ?? ''
          } — ${charge.data.clinic_name}`.slice(0, 200),
          metadata: {
            org_id: orgId,
            invoice_id: input.invoice_id,
            charge_id: charge.data.charge_id,
          },
          idempotencyKey: `charge:${charge.data.charge_id}`,
        })
        if (intent.status === 'processing') {
          // Not refused: the webhook settles it (never a second charge).
          return jsonResponse(
            { status: 'pending', failure_code: null },
            200,
            req,
          )
        }
        const succeeded = intent.status === 'succeeded'
        const finished = await service.rpc('finish_stripe_charge_for_service', {
          p_org_id: orgId,
          p_charge_id: charge.data.charge_id,
          p_status: succeeded ? 'succeeded' : 'failed',
          p_payment_intent_id: intent.id || null,
          p_failure_code: succeeded ? null : intent.failureCode,
        })
        if (finished.error) return await internal('charge_finish_failed')
        return jsonResponse(
          {
            status: succeeded ? 'succeeded' : 'failed',
            failure_code: succeeded ? null : intent.failureCode,
          },
          200,
          req,
        )
      }

      if (input.action === 'refund') {
        ids.refund_id = input.refund_id
        const found = await service.rpc('stripe_refund_for_service', {
          p_org_id: orgId,
          p_refund_id: input.refund_id,
        })
        if (found.error) return await internal('refund_read_failed')
        if (found.data === null) {
          return jsonResponse({ status: 'settled' }, 200, req)
        }
        const pending = refundSchema.safeParse(found.data)
        if (!pending.success) return await internal('refund_invalid')
        if (!pending.data.module_open) {
          return errorResponse(
            'conflict',
            'The module is reserved for its testers',
            409,
            req,
          )
        }
        const status = await processRefund(stripe, service, orgId, pending.data)
        return jsonResponse({ status }, 200, req)
      }

      ids.client_id = input.payer_client_id
      const card = await service.rpc('stripe_card_for_service', {
        p_org_id: orgId,
        p_actor: actor,
        p_payer_client_id: input.payer_client_id,
      })
      if (card.error) {
        return rpcFailure(card.error, req) ?? await internal('card_read_failed')
      }
      const parsed = cardSchema.safeParse(card.data)
      if (!parsed.success) return await internal('card_invalid')
      await stripe.detachPaymentMethod(parsed.data.payment_method_id)
      const removed = await service.rpc('stripe_card_removed_for_service', {
        p_org_id: orgId,
        p_payer_client_id: input.payer_client_id,
        p_actor: actor,
      })
      if (removed.error) return await internal('card_remove_failed')
      return jsonResponse({ removed: true }, 200, req)
    } catch (error) {
      if (error instanceof StripeError) {
        await report(`stripe_${error.code}`)
        return errorResponse(
          error.status === 401 ? 'not_configured' : 'provider_error',
          'Stripe did not answer as expected',
          error.status === 401 ? 503 : 502,
          req,
        )
      }
      return await internal('unexpected')
    }
  }
}
