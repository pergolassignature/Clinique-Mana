/**
 * Stripe refunds (Facturation FS-9): one pending refund of a Stripe payment
 * made at Stripe, once (`Idempotency-Key: refund:<id>`, the refund's id in the
 * metadata), then settled through `settle_stripe_refund_for_service` (F3's
 * `finish_refund_for_service`: the invoice's paid amount lowered, QuickBooks
 * told; a failure tells `billing.manage`). Shared by `billing-stripe`
 * (« Rembourser », right away), the job `billing.stripe_refunds` and the
 * webhook (`charge.refunded`, `refund.updated`).
 *
 * Outcomes: `recorded` (Stripe refunded), `failed` (Stripe refused, or the
 * payment has no PaymentIntent: an imported card payment is refunded by hand),
 * `pending` (Stripe is not done: the webhook or the job settles it), `settled`
 * (another path did it first). A network failure or a 5xx throws: the refund
 * stays pending for the job.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { type RefundResult, type StripeApi, StripeError } from './client.ts'

export type RefundOutcome = 'recorded' | 'failed' | 'pending' | 'settled'

/** F3's error codes: lower-case letters and `_` only. */
const ERROR_CODE = /^[a-z_]{1,60}$/
const asErrorCode = (raw: string | null | undefined, fallback: string) =>
  raw && ERROR_CODE.test(raw) ? raw : fallback

const PAYMENT_INTENT = /^pi_[A-Za-z0-9]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PendingRefund {
  refund_id: string
  amount_cents: number
  payment_intent_id: string | null
}

async function settle(
  client: SupabaseClient,
  orgId: string,
  refundId: string,
  ok: boolean,
  providerRef: string | null,
  errorCode: string | null,
): Promise<RefundOutcome> {
  const { data, error } = await client.rpc('settle_stripe_refund_for_service', {
    p_org_id: orgId,
    p_refund_id: refundId,
    p_ok: ok,
    p_provider_ref: providerRef,
    p_error_code: ok ? null : errorCode,
  })
  if (error) throw new Error('settle_failed')
  if (data !== true) return 'settled'
  return ok ? 'recorded' : 'failed'
}

/** Settles a refund from what Stripe says of it (final states only). */
export async function settleFromStripe(
  client: SupabaseClient,
  orgId: string,
  refundId: string,
  refund: RefundResult,
): Promise<RefundOutcome> {
  if (refund.status === 'succeeded') {
    return await settle(client, orgId, refundId, true, refund.id, null)
  }
  if (refund.status === 'failed' || refund.status === 'canceled') {
    return await settle(
      client,
      orgId,
      refundId,
      false,
      refund.id,
      asErrorCode(
        refund.failureCode,
        refund.status === 'canceled' ? 'canceled' : 'declined',
      ),
    )
  }
  return 'pending'
}

/** Makes one pending refund at Stripe, then settles it. */
export async function processRefund(
  stripe: StripeApi,
  client: SupabaseClient,
  orgId: string,
  pending: PendingRefund,
): Promise<RefundOutcome> {
  if (
    !pending.payment_intent_id ||
    !PAYMENT_INTENT.test(pending.payment_intent_id)
  ) {
    return await settle(
      client,
      orgId,
      pending.refund_id,
      false,
      null,
      'not_refundable_online',
    )
  }
  let refund: RefundResult
  try {
    refund = await stripe.createRefund({
      paymentIntentId: pending.payment_intent_id,
      amountCents: pending.amount_cents,
      metadata: { org_id: orgId, refund_id: pending.refund_id },
      idempotencyKey: `refund:${pending.refund_id}`,
    })
  } catch (error) {
    // Stripe's refusal (4xx but the key): settled as failed with its code. Anything else throws.
    if (
      error instanceof StripeError && error.status >= 400 &&
      error.status < 500 && error.status !== 401 && error.status !== 429
    ) {
      return await settle(
        client,
        orgId,
        pending.refund_id,
        false,
        null,
        asErrorCode(error.code, 'refused'),
      )
    }
    throw error
  }
  return await settleFromStripe(client, orgId, pending.refund_id, refund)
}

/** The clinic's refund a Stripe refund was made for (its metadata), when this org's. */
export function refundIdOf(refund: RefundResult, orgId: string): string | null {
  const meta = refund.metadata
  if ((meta.org_id ?? '').toLowerCase() !== orgId.toLowerCase()) return null
  return meta.refund_id && UUID.test(meta.refund_id) ? meta.refund_id : null
}
