/**
 * `sms-dispatch` (batch SM): the job `communications.sms_dispatch`, every
 * 15 minutes. A job function (CLAUDE.md §7): `runJob` verifies
 * `X-Job-Signature`, lists the clinics (job and module enabled) and logs each
 * clinic's run.
 *
 * Per clinic (`perOrg`):
 * 1. `requireModuleForOrg` (the second gate; `start_job_run` already refuses
 *    a disabled module).
 * 2. `claim_sms_batch_for_service(org, 20)`: the RPC fails the stale
 *    `sending` rows and the texts to withdrawn numbers, then claims the due
 *    texts (`queued`, `send_after` passed: reminders in business hours,
 *    replies and confirmations at once), oldest first.
 * 3. `sendClaimedText` for each, in batches of 2 (the PBX is one appliance):
 *    the transport, then `mark_sms_sent` / `mark_sms_failed`. A setup
 *    failure (`not_configured`, `module_disabled`) ends the run
 *    `sms_not_configured`: nothing else would leave either (the texts stay
 *    `failed` with that code, visible in « Textos »); a PBX outage
 *    (`provider_unreachable`, `token_limit`, `lock_timeout`) ends it
 *    `sms_stopped_<code>` after the batch, the rest waits for the next run;
 *    a refused number (`provider_rejected`) is counted and the others go on.
 *    No batch starts after SOFT_DEADLINE_MS, before `runJob`'s 60 s cut; the
 *    texts left are `deferred` (claimed, they fail `provider_unavailable`
 *    at the next run's sweep: a deferred text is not sent twice).
 * 4. The detail: counts only (`claimed=… sent=… failed=…`, plus
 *    `deferred=…`), never a number.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { runJob } from '../_shared/jobs.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { type ClaimedText, sendClaimedText } from '../_shared/sms/send.ts'
import {
  createYeastarTransport,
  type SmsTransport,
} from '../_shared/sms/transport.ts'

const FN = 'sms-dispatch'
export const JOB_KEY = 'communications.sms_dispatch'

/** Texts claimed per run and clinic. */
export const BATCH_LIMIT = 20
/** Sends in flight at once. */
export const BATCH_SIZE = 2
/** No new batch after this long in the clinic's run. */
export const SOFT_DEADLINE_MS = 40_000

const claimedSchema = z.array(z.object({
  id: z.guid(),
  to_e164: z.string(),
  body: z.string(),
  kind: z.string(),
  request_id: z.string(),
})).max(200)

/** A failure of the clinic's PBX setup: always ends the run. */
const SETUP_FAILURES = new Set(['not_configured', 'module_disabled'])
/** These end the run after their batch: the rest would fail the same way. */
const BATCH_STOP_FAILURES = new Set([
  'provider_unreachable',
  'token_limit',
  'lock_timeout',
])

export interface HandlerOptions {
  /** Injected by the tests; the Yeastar transport by default. */
  transport?: (client: SupabaseClient) => SmsTransport
}

/** A failure that ends the clinic's run with this code (`runJob` records it). */
function stop(code: string): never {
  throw Object.assign(new Error(code), { code })
}

/** The job handler; see the module comment. */
export function createHandler(
  deps: Deps,
  options: HandlerOptions = {},
): (req: Request) => Promise<Response> {
  return (req) =>
    runJob(
      deps,
      req,
      JOB_KEY,
      (orgId, client, signal) =>
        dispatchOrg(deps, orgId, client, signal, options),
    )
}

/** One clinic's run (`runJob`'s `perOrg`); exported for the tests. */
export async function dispatchOrg(
  deps: Deps,
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
  options: HandlerOptions = {},
): Promise<string> {
  if (await requireModuleForOrg(client, orgId, 'communications')) {
    stop('module_disabled')
  }
  const { data, error } = await client.rpc('claim_sms_batch_for_service', {
    p_org_id: orgId,
    p_limit: BATCH_LIMIT,
  })
  if (error) stop('claim_failed')
  const claimed = claimedSchema.safeParse(data)
  if (!claimed.success) stop('claim_invalid')
  const texts: ClaimedText[] = claimed.data
  if (texts.length === 0) return 'claimed=0 sent=0 failed=0'

  const transport = options.transport
    ? options.transport(client)
    : createYeastarTransport({
      client,
      fetch: deps.fetch,
      now: deps.now,
      env: deps.env,
    })
  const ctx = { fn: FN, client, transport, fetch: deps.fetch, signal }

  let sent = 0
  let failed = 0
  let deferred = 0
  const startedAt = deps.now().getTime()
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    if (signal.aborted) stop('timeout')
    if (deps.now().getTime() - startedAt >= SOFT_DEADLINE_MS) {
      deferred = texts.length - start
      break
    }
    const outcomes = await Promise.all(
      texts.slice(start, start + BATCH_SIZE).map((text) =>
        sendClaimedText(ctx, orgId, text)
      ),
    )
    const failures = outcomes.flatMap((o) => (o.ok ? [] : [o.code]))
    failed += failures.length
    sent += outcomes.length - failures.length
    if (failures.some((code) => SETUP_FAILURES.has(code))) {
      stop('sms_not_configured')
    }
    const fatal = failures.find((code) => BATCH_STOP_FAILURES.has(code))
    if (fatal) stop(`sms_stopped_${fatal}`)
  }
  const detail = `claimed=${texts.length} sent=${sent} failed=${failed}`
  return deferred > 0 ? `${detail} deferred=${deferred}` : detail
}
