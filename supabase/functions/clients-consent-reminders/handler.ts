/**
 * `clients-consent-reminders` (Clients C5a): the job
 * `clients.consent_reminders`, daily at 8 h clinic time. A job function
 * (CLAUDE.md §7): `runJob` verifies `X-Job-Signature`, lists the clinics (job
 * and module enabled) and logs each clinic's run.
 *
 * Per clinic:
 * 1. `requireModuleForOrg` (`clients`).
 * 2. `client_consent_reminders_for_service`: the pending requests last sent
 *    `reminder_days` ago or more and never reminded (an envelope out is left
 *    alone: the signer is signing), and one notice per overdue request.
 * 3. Each is sent again, once: `prepare_client_consent_request_for_service`
 *    with no actor and the request id (new links, the old ones revoked,
 *    `reminded_at` set), then one email per signer. Requests one after the
 *    other; a refusal (the client archived, a signer without an address) is
 *    counted and the others go on.
 * 4. The detail: counts only (`reminded=… failed=… overdue=…`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  emailConsentSigners,
  prepareConsentRequest,
} from '../_shared/client-consents.ts'
import type { Deps } from '../_shared/deps.ts'
import { runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'clients-consent-reminders'
export const JOB_KEY = 'clients.consent_reminders'
/** Requests sent again per run and clinic. */
export const BATCH_LIMIT = 50

const dueSchema = z.object({
  remind: z.array(z.string()).max(200),
  overdue: z.number().int().min(0),
})

/** A failure that ends the clinic's run with this code. */
function stop(code: string): never {
  throw Object.assign(new Error(code), { code })
}

/** The job handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return (req) =>
    runJob(
      deps,
      req,
      JOB_KEY,
      (orgId, client, signal) => remindOrg(deps, orgId, client, signal),
    )
}

/** One clinic's run; exported for the tests. */
export async function remindOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'clients')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc(
    'client_consent_reminders_for_service',
    { p_org_id: orgId, p_limit: BATCH_LIMIT },
  )
  if (error) stop('reminders_failed')
  const due = dueSchema.safeParse(data)
  if (!due.success) stop('reminders_invalid')

  let reminded = 0
  let failed = 0
  for (const requestId of due.data.remind) {
    if (signal.aborted) stop('timeout')
    const result = await prepareConsentRequest(client, {
      orgId,
      actor: null,
      requestId,
    })
    if (!result.ok) {
      failed++
      // A refusal (P0001) is the file's state, not an incident.
      if (result.error?.code !== 'P0001') {
        await reportError(
          {
            fn: FN,
            code: 'prepare_failed',
            ids: { org_id: orgId, client_consent_request_id: requestId },
          },
          deps.fetch,
        )
      }
      continue
    }
    const outcomes = await emailConsentSigners(
      { fn: FN, client, env: deps.env, fetch: deps.fetch },
      orgId,
      result.prepared,
      result.tokens,
      null,
    )
    if (outcomes.every((o) => o.ok)) reminded++
    else failed++
  }
  return `reminded=${reminded} failed=${failed} overdue=${due.data.overdue}`
}
