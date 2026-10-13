/**
 * `gmail-modify` (plan §11, CM2): the inbox's actions on threads — read,
 * unread, archive, back to the inbox, star, unstar, a user label
 * (`_shared/gmail/actions.ts`). User function: `verifyAuth` with module
 * `communications` and `communications.inbox`.
 *
 * 1. CORS; `POST` only; body `{ thread_ids: uuid[1..50], action }`, strict.
 * 2. One hit on `LIMITS.gmailModifyUser` (600 an hour per caller: opening an
 *    unread thread marks it read).
 * 3. `get_mail_threads_for_action` (the actor re-checked, conventions §8b):
 *    the threads of the clinic's connected mailboxes the caller may read;
 *    any other id is simply absent (an unknown or foreign thread → 404 when
 *    none is left).
 * 4. Per mailbox: its access token (`mailboxCredentials`; Google refused
 *    the refresh → the mailbox is marked, its threads fail with `conflict`),
 *    then per thread **Gmail first** (`threads.modify` or
 *    `messages.batchModify`), then at once its mirror
 *    (`apply_mail_label_changes`): the app never shows a state Gmail refused,
 *    and a later failure never leaves a change Gmail made unrecorded. A
 *    thread Gmail no longer has (404) is skipped (the next sync removes it).
 * 5. 200 `{ changed, failed }` (threads changed; the ids that were not).
 *    When none changed and one failed, the first failure answers: 409
 *    `conflict`, 502 `provider_error` or 500 `internal`, reported with ids
 *    only.
 */
import { z } from 'zod'
import {
  type ErrorCode,
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { rpcErrorResponse } from '../_shared/errors.ts'
import {
  mailActionSchema,
  planAction,
  type ThreadForAction,
} from '../_shared/gmail/actions.ts'
import { GmailClient, GmailError } from '../_shared/gmail/client.ts'
import {
  mailboxCredentials,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/gmail/credentials.ts'
import { gmailOrigins } from '../_shared/gmail/env.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-modify'

/** Why a thread was not changed; the first one answers when none was. */
interface Failure {
  code: ErrorCode
  message: string
  status: number
}

const bodySchema = z.strictObject({
  thread_ids: z.array(z.guid()).min(1).max(50),
  action: mailActionSchema,
})

const threadsSchema = z.array(z.object({
  thread_id: z.string(),
  connection_id: z.string(),
  gmail_thread_id: z.string(),
  messages: z.array(z.object({
    gmail_message_id: z.string(),
    label_ids: z.array(z.string()),
  })),
}))

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {
      module: 'communications',
      permission: 'communications.inbox',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 8_192)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.gmailModifyUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    const read = await service.rpc('get_mail_threads_for_action', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_thread_ids: [...new Set(input.thread_ids)],
    })
    if (read.error) {
      if (['42501', 'P0001'].includes(read.error.code ?? '')) {
        return rpcErrorResponse(read.error, req)
      }
      await report('threads_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const parsed = threadsSchema.safeParse(read.data)
    if (!parsed.success) {
      await report('threads_unusable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (parsed.data.length === 0) {
      return errorResponse('not_found', 'Thread not found', 404, req)
    }

    let app
    try {
      app = await oauthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (!app) {
      return errorResponse(
        'not_configured',
        'Google OAuth client is not set',
        503,
        req,
      )
    }

    const origins = gmailOrigins(deps.env)
    const byConnection = new Map<string, typeof parsed.data>()
    for (const t of parsed.data) {
      byConnection.set(t.connection_id, [
        ...(byConnection.get(t.connection_id) ?? []),
        t,
      ])
    }
    // Each thread on its own: Gmail, then at once its mirror, so a failure later on (another
    // thread, another mailbox) never leaves a change Gmail made unrecorded. A thread that fails
    // is named in `failed`; the request fails only when nothing changed.
    let changed = 0
    const failed: string[] = []
    const failures: Failure[] = []
    const fail = (threadIds: string[], failure: Failure) => {
      failed.push(...threadIds)
      failures.push(failure)
    }
    for (const [connectionId, threads] of byConnection) {
      ids.connection_id = connectionId
      delete ids.thread_id
      let gmail: GmailClient
      try {
        const credentials = await mailboxCredentials(
          {
            client: service,
            fetch: deps.fetch,
            origins,
            now: deps.now,
            orgId,
            signal: req.signal,
          },
          connectionId,
          app,
        )
        gmail = new GmailClient({
          fetch: deps.fetch,
          origin: origins.api,
          accessToken: credentials.accessToken,
          signal: req.signal,
        })
      } catch (error) {
        const threadIds = threads.map((t) => t.thread_id)
        if (error instanceof ReconnectNeeded) {
          fail(threadIds, {
            code: 'conflict',
            message: 'Mailbox needs reconnection',
            status: 409,
          })
        } else {
          await report('credentials_unavailable')
          fail(threadIds, {
            code: 'provider_error',
            message: 'Google unavailable',
            status: 502,
          })
        }
        continue
      }
      for (const thread of threads) {
        const plan = planAction(input.action, thread as ThreadForAction)
        if (!plan.gmail) continue
        ids.thread_id = thread.thread_id
        try {
          if (plan.gmail.type === 'thread') {
            await gmail.modifyThread(
              thread.gmail_thread_id,
              plan.gmail.add,
              plan.gmail.remove,
            )
          } else {
            await gmail.batchModify(
              plan.gmail.ids,
              plan.gmail.add,
              plan.gmail.remove,
            )
          }
        } catch (error) {
          if (error instanceof GmailError && error.code === 'not_found') {
            continue
          }
          await report(
            error instanceof GmailError
              ? `gmail_${error.code}`
              : 'gmail_failed',
          )
          fail([thread.thread_id], {
            code: 'provider_error',
            message: 'Google unavailable',
            status: 502,
          })
          continue
        }
        let recorded = true
        for (let i = 0; i < plan.mirror.length; i += 500) {
          const applied = await service.rpc('apply_mail_label_changes', {
            p_org_id: orgId,
            p_connection_id: connectionId,
            p_changes: plan.mirror.slice(i, i + 500),
          })
          if (applied.error) {
            recorded = false
            break
          }
        }
        if (!recorded) {
          // Gmail changed; the next sync brings the mirror along.
          await report('mirror_failed')
          fail([thread.thread_id], {
            code: 'internal',
            message: 'Request failed',
            status: 500,
          })
          continue
        }
        changed++
      }
    }
    const refused = failures[0]
    if (changed === 0 && refused) {
      return errorResponse(refused.code, refused.message, refused.status, req)
    }
    return jsonResponse({ changed, failed }, 200, req)
  }
}
