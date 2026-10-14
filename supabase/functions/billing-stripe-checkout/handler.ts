/**
 * `billing-stripe-checkout` (Facturation FS): « Enregistrer ma carte »
 * (`/carte#t=…`) and « Payer en ligne » (`/payer#t=…`). A public token
 * function (CLAUDE.md §7): no user; the hashed link token is the credential,
 * and the org and module come from the link row.
 *
 * 1. CORS; `POST` only; body `{ token }` (never echoed).
 * 2. One hit per IP first (`LIMITS.billingCheckoutIp`), before any lookup.
 * 3. A malformed token → 410 `link_invalid`, like an unknown one.
 * 4. `begin_billing_checkout_for_service` (one use of the link): an unknown,
 *    used up, expired or revoked link, the module off or Stripe not set → 410
 *    `link_invalid`; an invoice already paid → 200 `{ state: 'paid' }`.
 * 5. A Stripe Checkout session: `setup` for the card (the payer's customer
 *    made first if need be; the consent text above the button), `payment` for
 *    the invoice's balance of the moment (CAD). It comes back to `/carte` or
 *    `/payer` with `?etat=merci` or `?etat=annule`; the webhook records the
 *    card or the payment.
 * 6. 200 `{ state: 'valid', url }`: Stripe's page only (`isCheckoutUrl`).
 *
 * One payment session per invoice and balance (BI-26, security review
 * 2026-10-14): a payment checkout carries an idempotency key from the invoice,
 * its balance and the half hour (`paymentWindow`), and expires at a time fixed
 * by that half hour, so two links opened together get the same Stripe session
 * (one payment) instead of two. A new balance is a new session.
 *
 * Status codes: 200; 400 `invalid_request`; 405; 410; 413; 429; 502
 * `provider_error`; 503 `not_configured`; 500 `internal`. Nothing logs or
 * reports a token, an address or an amount.
 */
import { z } from 'zod'
import { errorResponse, handleCors, jsonResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import {
  appOrigin,
  hashToken,
  isWellFormedToken,
  linkGoneResponse,
} from '../_shared/links.ts'
import {
  clientIp,
  consume,
  limitResponse,
  LIMITS,
} from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import type { Params } from '../_shared/stripe/client.ts'
import { StripeError } from '../_shared/stripe/client.ts'
import { clinicStripe } from '../_shared/stripe/clinic.ts'
import {
  CARD_PATH,
  CURRENCY,
  isCheckoutUrl,
  PAY_PATH,
} from '../_shared/stripe/env.ts'

const FN = 'billing-stripe-checkout'

const bodySchema = z.strictObject({ token: z.unknown() })

const beginSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('invalid') }),
  z.object({ state: z.literal('paid') }),
  z.object({
    state: z.literal('valid'),
    org_id: z.guid(),
    mode: z.enum(['setup', 'payment']),
    payer_client_id: z.guid(),
    customer_id: z.string().nullable(),
    name: z.string(),
    email: z.string().nullable(),
    language: z.string(),
    invoice_id: z.guid().nullable(),
    invoice_number: z.string().nullable(),
    amount_cents: z.number().int().nullable(),
    clinic_name: z.string(),
  }),
])

/** The authorization the payer reads above Stripe's button (FS-2). */
export function consentText(clinic: string, language: string): string {
  return language === 'en'
    ? `I authorize ${clinic} to charge this card for my invoices, the day after each appointment, until I ask for it to be removed.`
    : `J’autorise ${clinic} à prélever sur cette carte le montant de mes factures, le lendemain de chaque rendez-vous, jusqu’à ce que je demande de la retirer.`
}

/** Seconds in a payment window (the half hour a payment session is shared). */
const WINDOW_SECONDS = 30 * 60
/** Stripe wants a session to live 30 minutes at least: one more. */
const MIN_LIFE_SECONDS = 31 * 60

/**
 * The payment window of a moment: its idempotency key (the invoice, its
 * balance, the half hour) and the session's expiry, fixed by the half hour
 * (31 to 61 minutes from now), so the same key always carries the same
 * parameters.
 */
export function paymentWindow(
  invoiceId: string,
  amountCents: number,
  now: Date,
): { key: string; expiresAt: number } {
  const window = Math.floor(now.getTime() / 1000 / WINDOW_SECONDS)
  return {
    key: `checkout:${invoiceId}:${amountCents}:${window}`,
    expiresAt: (window + 1) * WINDOW_SECONDS + MIN_LIFE_SECONDS,
  }
}

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const input = await readJson(req, bodySchema, 1_024)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const byIp = limitResponse(
      await consume(service, LIMITS.billingCheckoutIp, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const begun = await service.rpc('begin_billing_checkout_for_service', {
      p_token_hash: await hashToken(input.token),
    })
    if (begun.error) {
      await reportError({ fn: FN, code: 'begin_failed' }, deps.fetch)
      return errorResponse('internal', 'The checkout could not start', 500, req)
    }
    const link = beginSchema.safeParse(begun.data)
    if (!link.success) {
      await reportError({ fn: FN, code: 'begin_invalid' }, deps.fetch)
      return errorResponse('internal', 'The checkout could not start', 500, req)
    }
    if (link.data.state === 'invalid') {
      return linkGoneResponse('link_invalid', req)
    }
    if (link.data.state === 'paid') {
      return jsonResponse({ state: 'paid' }, 200, req)
    }
    const l = link.data
    const ids: Record<string, string> = {
      org_id: l.org_id,
      client_id: l.payer_client_id,
    }
    if (l.invoice_id) ids.invoice_id = l.invoice_id
    const fail = async (
      code: string,
      status = 500,
      error: 'internal' | 'provider_error' | 'not_configured' = 'internal',
    ) => {
      await reportError({ fn: FN, code, ids }, deps.fetch)
      return errorResponse(error, 'The checkout could not start', status, req)
    }

    const origin = appOrigin(deps.env('APP_URL') ?? '')
    if (!origin) return await fail('app_url_invalid')
    try {
      const stripe = await clinicStripe(service, deps, l.org_id)
      if (!stripe) {
        return errorResponse(
          'not_configured',
          'Stripe is not configured',
          503,
          req,
        )
      }
      const locale = l.language === 'en' ? 'en' : 'fr-CA'
      // Back from Stripe, the page speaks the payer's language.
      const back = l.language === 'en' ? '&lang=en' : ''
      let params: Params
      let idempotencyKey: string | undefined
      if (l.mode === 'setup') {
        let customer = l.customer_id
        if (!customer) {
          if (!l.email) return await fail('payer_without_email')
          customer = await stripe.createCustomer({
            name: l.name,
            email: l.email,
            orgId: l.org_id,
            payerId: l.payer_client_id,
          })
          const saved = await service.rpc('save_stripe_customer_for_service', {
            p_org_id: l.org_id,
            p_payer_client_id: l.payer_client_id,
            p_customer_id: customer,
          })
          if (saved.error) return await fail('customer_save_failed')
        }
        const metadata = {
          org_id: l.org_id,
          payer_client_id: l.payer_client_id,
        }
        params = {
          mode: 'setup',
          customer,
          currency: CURRENCY,
          payment_method_types: ['card'],
          locale,
          success_url: `${origin}${CARD_PATH}?etat=merci${back}`,
          cancel_url: `${origin}${CARD_PATH}?etat=annule${back}`,
          metadata,
          setup_intent_data: { metadata },
          custom_text: {
            submit: {
              message: consentText(l.clinic_name, l.language).slice(0, 1200),
            },
          },
          // Saved within the half hour (Stripe's minimum is 30 minutes).
          expires_at: Math.floor(deps.now().getTime() / 1000) +
            MIN_LIFE_SECONDS,
        }
      } else {
        if (!l.invoice_id || !l.amount_cents || l.amount_cents < 1) {
          return linkGoneResponse('link_invalid', req)
        }
        const metadata = { org_id: l.org_id, invoice_id: l.invoice_id }
        const name = l.language === 'en'
          ? `Invoice ${l.invoice_number ?? ''}`
          : `Facture ${l.invoice_number ?? ''}`
        params = {
          mode: 'payment',
          ...(l.customer_id
            ? { customer: l.customer_id }
            : l.email
            ? { customer_email: l.email }
            : {}),
          line_items: [{
            quantity: 1,
            price_data: {
              currency: CURRENCY,
              unit_amount: l.amount_cents,
              product_data: {
                name: `${name} — ${l.clinic_name}`.slice(0, 250),
              },
            },
          }],
          payment_method_types: ['card'],
          locale,
          client_reference_id: l.invoice_id,
          success_url: `${origin}${PAY_PATH}?etat=merci${back}`,
          cancel_url: `${origin}${PAY_PATH}?etat=annule${back}`,
          metadata,
          payment_intent_data: { metadata },
        }
        // At the balance of the moment, one session per invoice, balance and
        // half hour (BI-26): opened twice, the same session.
        const w = paymentWindow(l.invoice_id, l.amount_cents, deps.now())
        params.expires_at = w.expiresAt
        idempotencyKey = w.key
      }
      const session = await stripe.createCheckoutSession(
        params,
        idempotencyKey,
      )
      if (!isCheckoutUrl(session.url, deps.env)) {
        return await fail('checkout_url_invalid', 502, 'provider_error')
      }
      return jsonResponse({ state: 'valid', url: session.url }, 200, req)
    } catch (error) {
      if (error instanceof StripeError) {
        return error.status === 401
          ? await fail('stripe_key_refused', 503, 'not_configured')
          : await fail(`stripe_${error.code}`, 502, 'provider_error')
      }
      return await fail('unexpected')
    }
  }
}
