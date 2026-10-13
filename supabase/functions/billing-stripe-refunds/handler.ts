/**
 * `billing-stripe-refunds` (Facturation FS-9): the job `billing.stripe_refunds`
 * (« Remboursements par Stripe », every 10 minutes, off until switched on in
 * Tâches planifiées). A job function (CLAUDE.md §7): `runJob` verifies
 * `X-Job-Signature` and runs once per org.
 *
 * For each org with Facturation on and Stripe set: the refunds of Stripe
 * payments still pending (`stripe_refunds_due_for_service`, oldest first, the
 * module open to everyone, P3-40), each made at Stripe once and settled
 * (`processRefund`): usually « Rembourser » did it already; the job takes what
 * a network failure or Stripe's « pending » left. A Stripe failure other than
 * a refusal leaves the refund pending for the next run. The run's detail counts
 * them.
 */
import { z } from 'zod'
import { errorResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import { reportError } from '../_shared/report.ts'
import { StripeError } from '../_shared/stripe/client.ts'
import { clinicStripe } from '../_shared/stripe/clinic.ts'
import { processRefund } from '../_shared/stripe/refunds.ts'

const FN = 'billing-stripe-refunds'
export const JOB = 'billing.stripe_refunds'
const JOB_TIMEOUT_MS = 120_000
const BATCH = 50

const dueSchema = z.array(z.object({
  refund_id: z.guid(),
  amount_cents: z.number().int().positive(),
  payment_intent_id: z.string().nullable(),
})).max(BATCH)

const failure = (code: string) => Object.assign(new Error(code), { code })

function refundOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    const stripe = await clinicStripe(client, deps, orgId)
    if (!stripe) return 'Stripe n’est pas configuré : aucun remboursement.'
    const due = await client.rpc('stripe_refunds_due_for_service', {
      p_org_id: orgId,
      p_limit: BATCH,
    })
    if (due.error) throw failure('due_failed')
    const refunds = dueSchema.safeParse(due.data)
    if (!refunds.success) throw failure('due_invalid')
    const counts = { recorded: 0, failed: 0, pending: 0 }
    for (const refund of refunds.data) {
      if (signal.aborted) break
      try {
        const outcome = await processRefund(stripe, client, orgId, refund)
        if (outcome === 'recorded') counts.recorded += 1
        else if (outcome === 'failed') counts.failed += 1
        else if (outcome === 'pending') counts.pending += 1
      } catch (error) {
        counts.pending += 1
        await reportError({
          fn: FN,
          code: error instanceof StripeError
            ? `stripe_${error.code}`
            : 'refund_failed',
          ids: { org_id: orgId, refund_id: refund.refund_id },
        }, deps.fetch)
        if (error instanceof StripeError && error.status === 401) {
          throw failure('stripe_key_refused')
        }
      }
    }
    return `Remboursements : ${counts.recorded} faits, ${counts.failed} refusés, ${counts.pending} en attente.`
  }
}

/** The handler (job mode only); see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = refundOrg(deps)
  return async (req) => {
    if (!req.headers.has('X-Job-Signature')) {
      return errorResponse('unauthenticated', 'Unauthorized', 401)
    }
    return await runJob(deps, req, JOB, perOrg, {
      perOrgTimeoutMs: JOB_TIMEOUT_MS,
    })
  }
}
