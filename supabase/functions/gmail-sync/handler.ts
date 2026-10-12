/**
 * `gmail-sync` (plan §11, CM1): the sync of the clinic's mailboxes
 * (`_shared/gmail/sync.ts`), as the 15-minute job and as « Synchroniser ».
 *
 * **Job mode** (`X-Job-Signature`, `communications.gmail_sync`, every 15
 * minutes: the fallback when a Pub/Sub push was lost, and the continuation
 * of a long first pass): `runJob`, then per org every connected mailbox in
 * turn (`list_mail_connections_to_sync`), each under its lease, sharing a
 * 100 s budget (`perOrgTimeoutMs` 120 s). The run's detail counts boxes,
 * messages and attachments; a mailbox that needs reconnection or whose
 * lease is held is counted, not an error; a provider or database failure
 * makes the run `error` with that code (the next run retries).
 *
 * **User mode** (« Synchroniser », `communications.mailboxes_manage`):
 * 1. CORS; `POST` only; `verifyAuth` with the module.
 * 2. Body `{ connection_id, full? }`, strict: `full` forgets the history id
 *    (`reset_mail_history`), so the 45-day pass runs again (known messages
 *    are updated in place).
 * 3. One hit on `LIMITS.gmailSyncUser` (60 an hour per caller).
 * 4. The mailbox among the org's connected ones (else 404), then
 *    `syncMailbox` with a 50 s budget.
 * 5. 200 `{ outcome, messages, attachments, initial_pending, code? }`:
 *    `synced`, `skipped` (a sync is under way), `needs_reconnect`, or
 *    `error` with its code (the state is recorded either way; the page
 *    words it).
 *
 * Status mapping: 200; 400 `invalid_request`; 401 / 403 / 503 from
 * `verifyAuth`; 404 `not_found`; 405; 413; 429 `rate_limited`; 500
 * `internal` (reported, ids only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { gmailOrigins } from '../_shared/gmail/env.ts'
import {
  listMailboxes,
  pubsubTopic,
  runFailureCode,
  type SyncContext,
  syncDetail,
  syncMailbox,
  type SyncOutcome,
} from '../_shared/gmail/sync.ts'
import { readJson } from '../_shared/http.ts'
import { type PerOrg, runJob } from '../_shared/jobs.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-sync'
const JOB = 'communications.gmail_sync'
/** The job's budget per org (every mailbox), and `runJob`'s cut. */
export const JOB_BUDGET_MS = 100_000
export const JOB_TIMEOUT_MS = 120_000
/** « Synchroniser »'s budget (the edge wall clock is 150 s). */
export const USER_BUDGET_MS = 50_000

const bodySchema = z.strictObject({
  connection_id: z.guid(),
  full: z.boolean().default(false),
})

/** An error whose `code` `runJob` records. */
const failure = (code: string) => Object.assign(new Error(code), { code })

/** The job's `perOrg`: every connected mailbox of the org, in turn. */
export function syncOrg(deps: Deps): PerOrg {
  return async (orgId, client, signal) => {
    const [mailboxes, topic] = await Promise.all([
      listMailboxes(client, orgId),
      pubsubTopic(client, orgId),
    ])
    const ctx: SyncContext = {
      client,
      fetch: deps.fetch,
      origins: gmailOrigins(deps.env),
      now: deps.now,
      orgId,
      signal,
      softDeadline: Date.now() + JOB_BUDGET_MS,
      pubsubTopic: topic,
    }
    const outcomes: SyncOutcome[] = []
    for (const mailbox of mailboxes) {
      if (signal.aborted) break
      outcomes.push(await syncMailbox(ctx, mailbox))
    }
    if (mailboxes.length === 0) return 'Aucune boîte connectée'
    const code = runFailureCode(outcomes)
    if (code) {
      await reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)
      throw failure(code)
    }
    return syncDetail(outcomes)
  }
}

/** The handler (job or user mode); see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const perOrg = syncOrg(deps)
  return async (req) => {
    if (req.headers.has('X-Job-Signature')) {
      return await runJob(deps, req, JOB, perOrg, {
        perOrgTimeoutMs: JOB_TIMEOUT_MS,
      })
    }
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'communications',
      permission: 'communications.mailboxes_manage',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 2_048)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids = { org_id: orgId, connection_id: input.connection_id }

    const limited = limitResponse(
      await consume(service, LIMITS.gmailSyncUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    try {
      const [mailboxes, topic] = await Promise.all([
        listMailboxes(service, orgId),
        pubsubTopic(service, orgId),
      ])
      const mailbox = mailboxes.find((m) =>
        m.connection_id === input.connection_id
      )
      if (!mailbox) {
        return errorResponse('not_found', 'Mailbox not found', 404, req)
      }
      if (input.full) {
        const reset = await service.rpc('reset_mail_history', {
          p_org_id: orgId,
          p_connection_id: input.connection_id,
        })
        if (reset.error) throw failure('reset_failed')
        mailbox.history_id = null
        mailbox.initial_sync_done = false
        mailbox.initial_sync_page_token = null
      }
      const outcome = await syncMailbox({
        client: service,
        fetch: deps.fetch,
        origins: gmailOrigins(deps.env),
        now: deps.now,
        orgId,
        signal: req.signal,
        softDeadline: Date.now() + USER_BUDGET_MS,
        pubsubTopic: topic,
      }, mailbox)
      if (outcome.status === 'error') {
        await reportError(
          { fn: FN, code: outcome.code ?? 'sync_failed', ids },
          deps.fetch,
        )
      }
      return jsonResponse(
        {
          outcome: outcome.status === 'ok' ? 'synced' : outcome.status,
          messages: outcome.messages,
          attachments: outcome.attachments,
          initial_pending: outcome.initialPending,
          ...(outcome.code ? { code: outcome.code } : {}),
        },
        200,
        req,
      )
    } catch (error) {
      const raw = (error as { code?: unknown }).code
      await reportError({
        fn: FN,
        code: typeof raw === 'string' ? raw : 'sync_failed',
        ids,
      }, deps.fetch)
      return errorResponse('internal', 'Sync failed', 500, req)
    }
  }
}
