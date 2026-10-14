/**
 * `clients-consent-campaign` (Clients C5b.4, CC-20): the job
 * `clients.consent_campaign`, daily at 9 h clinic time, off until switched on.
 * A job function (CLAUDE.md §7): `runJob` verifies `X-Job-Signature`, lists
 * the clinics (job and module enabled) and logs each clinic's run.
 *
 * Per clinic:
 * 1. `requireModuleForOrg` (`clients`).
 * 2. `client_consent_campaign_batch_for_service`: the items to send now, at
 *    most 100 a day per clinic, each claimed (`sending`); none while Clients
 *    is reserved for its testers (P3-40).
 * 3. Each through the same path as « Envoyer »:
 *    `prepare_client_consent_request_for_service` with the campaign's author
 *    as the actor (the record as context), then one email per signer. A
 *    refusal (the file archived, no authorised parent, no address, no text in
 *    the client's language…) ends the item `failed` with its HINT; the others
 *    go on.
 * 4. `finish_client_consent_campaign_item_for_service` records each outcome
 *    (the campaign is done when none is left).
 * 5. The detail: counts only (`sent=… failed=…`).
 *
 * Nothing logs or reports a name, an address or a token: ids only.
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

const FN = 'clients-consent-campaign'
export const JOB_KEY = 'clients.consent_campaign'
/** Items per run and clinic: the clinic's daily cap is the database's (100). */
export const BATCH_LIMIT = 100

const batchSchema = z.array(z.object({
  item_id: z.string(),
  client_id: z.string(),
  consent_key: z.string(),
  actor: z.string().nullable(),
})).max(BATCH_LIMIT)

/** A HINT kept as the item's failure; anything else is `other`. */
const FAILURE = /^[a-z_]{1,40}$/

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
      (orgId, client, signal) => sendCampaignBatch(deps, orgId, client, signal),
    )
}

/** One clinic's run; exported for the tests. */
export async function sendCampaignBatch(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'clients')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc(
    'client_consent_campaign_batch_for_service',
    { p_org_id: orgId, p_limit: BATCH_LIMIT },
  )
  if (error) stop('batch_failed')
  const batch = batchSchema.safeParse(data)
  if (!batch.success) stop('batch_invalid')

  let sent = 0
  let failed = 0
  for (const item of batch.data) {
    if (signal.aborted) stop('timeout')
    const ids = { org_id: orgId, client_consent_campaign_item_id: item.item_id }
    const result = await prepareConsentRequest(client, {
      orgId,
      actor: item.actor,
      clientId: item.client_id,
      consentKey: item.consent_key,
      contextType: 'record',
      contextId: item.client_id,
    })
    let ok = false
    let requestId: string | null = null
    let failure: string | null = null
    if (!result.ok) {
      // A refusal (P0001) is the file's state, not an incident.
      if (result.error?.code !== 'P0001') {
        await reportError({ fn: FN, code: 'prepare_failed', ids }, deps.fetch)
      }
      const hint = result.error?.hint ?? ''
      failure = FAILURE.test(hint)
        ? hint
        : result.error?.code === '42501'
        ? 'permission'
        : 'other'
    } else {
      const outcomes = await emailConsentSigners(
        { fn: FN, client, env: deps.env, fetch: deps.fetch },
        orgId,
        result.prepared,
        result.tokens,
        item.actor,
      )
      requestId = result.prepared.request_id
      ok = outcomes.some((o) => o.ok)
      if (!ok) failure = 'email'
    }
    const finished = await client.rpc(
      'finish_client_consent_campaign_item_for_service',
      {
        p_org_id: orgId,
        p_item_id: item.item_id,
        p_sent: ok,
        p_request_id: requestId,
        p_failure: failure,
      },
    )
    if (finished.error) {
      await reportError({ fn: FN, code: 'finish_failed', ids }, deps.fetch)
    }
    if (ok) sent++
    else failed++
  }
  return `sent=${sent} failed=${failed}`
}
