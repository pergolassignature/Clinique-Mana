/**
 * `billing-stripe-charges` (Facturation FS): the job `billing.stripe_charges`
 * (« Prélèvements des cartes au dossier », at the clinic's hour, off until
 * switched on in Tâches planifiées). A job function (CLAUDE.md §7): `runJob`
 * verifies `X-Job-Signature` and runs once per org.
 *
 * For each org with Facturation on and Stripe set: the invoices due
 * (`stripe_charges_due_for_service`: issued, a balance, the payer's card on
 * file since before the invoice, the last 14 days, never charged by the job,
 * the module open to everyone, P3-40), each charged once:
 * `begin_stripe_charge_for_service` (kind `auto`), the off-session
 * PaymentIntent (idempotent per charge), `finish_stripe_charge_for_service`
 * (a success records the payment and its receipt; a refusal leaves the
 * invoice unpaid and tells `billing.manage`). A Stripe failure other than a
 * refusal leaves the charge pending: the webhook settles it, or the
 * administration sees it in the dossier. The run's detail counts them.
 */
import { z } from 'zod'
import { errorResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import { reportError } from '../_shared/report.ts'
import { StripeError } from '../_shared/stripe/client.ts'
import { clinicStripe } from '../_shared/stripe/clinic.ts'

const FN = 'billing-stripe-charges'
export const JOB = 'billing.stripe_charges'
const JOB_TIMEOUT_MS = 120_000
const BATCH = 100

const dueSchema = z.array(z.object({ invoice_id: z.guid() })).max(BATCH)
const chargeSchema = z.object({
  charge_id: z.guid(),
  amount_cents: z.number().int().positive(),
  invoice_number: z.string().nullable(),
  customer_id: z.string(),
  payment_method_id: z.string(),
  clinic_name: z.string(),
})

const failure = (code: string) => Object.assign(new Error(code), { code })

function chargeOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    const stripe = await clinicStripe(client, deps, orgId)
    if (!stripe) return 'Stripe n’est pas configuré : aucun prélèvement.'
    const due = await client.rpc('stripe_charges_due_for_service', {
      p_org_id: orgId,
      p_limit: BATCH,
    })
    if (due.error) throw failure('due_failed')
    const invoices = dueSchema.safeParse(due.data)
    if (!invoices.success) throw failure('due_invalid')
    const counts = { succeeded: 0, failed: 0, pending: 0 }
    for (const { invoice_id } of invoices.data) {
      if (signal.aborted) break
      const begun = await client.rpc('begin_stripe_charge_for_service', {
        p_org_id: orgId,
        p_invoice_id: invoice_id,
        p_kind: 'auto',
        p_actor: null,
      })
      if (begun.error) {
        await reportError({
          fn: FN,
          code: 'charge_begin_failed',
          ids: { org_id: orgId, invoice_id },
        }, deps.fetch)
        continue
      }
      if (begun.data === null) continue
      const charge = chargeSchema.safeParse(begun.data)
      if (!charge.success) continue
      try {
        const intent = await stripe.chargeCard({
          amountCents: charge.data.amount_cents,
          customerId: charge.data.customer_id,
          paymentMethodId: charge.data.payment_method_id,
          description: `Facture ${
            charge.data.invoice_number ?? ''
          } — ${charge.data.clinic_name}`.slice(0, 200),
          metadata: {
            org_id: orgId,
            invoice_id,
            charge_id: charge.data.charge_id,
          },
          idempotencyKey: `charge:${charge.data.charge_id}`,
        })
        const succeeded = intent.status === 'succeeded'
        if (intent.status === 'processing') {
          counts.pending += 1
          continue
        }
        const finished = await client.rpc('finish_stripe_charge_for_service', {
          p_org_id: orgId,
          p_charge_id: charge.data.charge_id,
          p_status: succeeded ? 'succeeded' : 'failed',
          p_payment_intent_id: intent.id || null,
          p_failure_code: succeeded ? null : intent.failureCode,
        })
        if (finished.error) {
          await reportError({
            fn: FN,
            code: 'charge_finish_failed',
            ids: { org_id: orgId, charge_id: charge.data.charge_id },
          }, deps.fetch)
          counts.pending += 1
        } else if (succeeded) counts.succeeded += 1
        else counts.failed += 1
      } catch (error) {
        counts.pending += 1
        const code = error instanceof StripeError
          ? `stripe_${error.code}`
          : 'charge_failed'
        await reportError({
          fn: FN,
          code,
          ids: { org_id: orgId, charge_id: charge.data.charge_id },
        }, deps.fetch)
        if (error instanceof StripeError && error.status === 401) {
          throw failure('stripe_key_refused')
        }
      }
    }
    return `Prélèvements : ${counts.succeeded} réussis, ${counts.failed} refusés, ${counts.pending} en attente.`
  }
}

/** The handler (job mode only); see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = chargeOrg(deps)
  return async (req) => {
    if (!req.headers.has('X-Job-Signature')) {
      return errorResponse('unauthenticated', 'Unauthorized', 401)
    }
    return await runJob(deps, req, JOB, perOrg, {
      perOrgTimeoutMs: JOB_TIMEOUT_MS,
    })
  }
}
