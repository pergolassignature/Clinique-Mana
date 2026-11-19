/**
 * `gmail-search` (CM-30; design `docs/plans/2026-11-19-communications-gmail-search.md`):
 * « Dans Gmail », the search beyond the mirror. The mirror starts 45 days
 * before the connection (CM-7) and its search reads the subject, the sender
 * and the snippet; Gmail finds older mail, a word in a message's text and its
 * own operators. A user function: `verifyAuth` with module `communications`
 * and `communications.inbox`.
 *
 * 1. CORS; `POST` only; the body, strict: `{ action: 'search', connection_id,
 *    query }` (2 to 200 characters) or `{ action: 'open', connection_id,
 *    gmail_thread_id }`.
 * 2. One hit on `LIMITS.gmailSearchUser` (30 a minute per caller: a search
 *    follows typing).
 * 3. `get_mail_search_threads_for_service` (the actor re-checked, conventions
 *    §8b): the caller holds `communications.inbox` and reads the mailbox
 *    (connected; shared, or their own), else 403 before anything reaches Gmail.
 * 4. The mailbox's access token (`mailboxCredentials`; Google refused the
 *    refresh, or the mailbox went → 409 `conflict`).
 * 5. `search`: Gmail `messages.list` with `q = <query> newer_than:24m` (the
 *    mirror's 24 months, CM-8), 25 messages at most; the threads the mirror
 *    holds are dropped (the RPC again); then `messages.get` `format=metadata`
 *    for the newest message of each thread left. 200 `{ threads: [{
 *    gmail_thread_id, subject, from_name, from_address, date, snippet }] }`,
 *    newest first. **Nothing is written.**
 * 6. `open`: a thread the mirror holds is answered at once. Otherwise Gmail
 *    `threads.get` (`minimal`), its messages within the 24 months each through
 *    `mirrorMessage` (as `gmail-send` copies a sent message; the attachments
 *    are copied by the next sync pass), then the RPC answers the mirror's id:
 *    200 `{ thread_id }`. A thread Gmail no longer has, or with no message in
 *    the window → 404.
 *
 * Nothing logs or reports a subject, an address or the query (ids and codes only).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { rpcErrorResponse } from '../_shared/errors.ts'
import { GmailClient, GmailError } from '../_shared/gmail/client.ts'
import {
  ConnectionGone,
  mailboxCredentials,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/gmail/credentials.ts'
import { gmailOrigins } from '../_shared/gmail/env.ts'
import { header, parseAddress } from '../_shared/gmail/mime.ts'
import { mirrorMessage } from '../_shared/gmail/sync.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-search'

/** The mirror's retention (CM-8): Gmail is asked within it, and an open copies nothing older. */
export const WINDOW_MONTHS = 24
/** Messages asked of Gmail per search. */
export const SEARCH_MAX = 25

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('search'),
    connection_id: z.guid(),
    query: z.string().trim().min(2).max(200),
  }),
  z.strictObject({
    action: z.literal('open'),
    connection_id: z.guid(),
    gmail_thread_id: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  }),
])

const heldSchema = z.array(z.object({
  gmail_thread_id: z.string(),
  thread_id: z.string(),
}))

/** What the mirror holds of some Gmail threads, or why the RPC refused. */
type Held =
  | { ok: true; rows: z.infer<typeof heldSchema> }
  | { ok: false; error: { code?: string; message?: string } }

/** The oldest moment the window keeps. */
function windowStart(now: Date): Date {
  const start = new Date(now)
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS)
  return start
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
      module: 'communications',
      permission: 'communications.inbox',
    }, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, 4_096)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const orgId = auth.access.org_id
    const ids: Record<string, string> = {
      org_id: orgId,
      connection_id: input.connection_id,
    }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const limited = limitResponse(
      await consume(service, LIMITS.gmailSearchUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    /** Which of these Gmail threads the mirror holds; the caller's right checked each time. */
    const held = async (gmailThreadIds: string[]): Promise<Held> => {
      const read = await service.rpc('get_mail_search_threads_for_service', {
        p_actor: auth.user.id,
        p_org_id: orgId,
        p_connection_id: input.connection_id,
        p_gmail_thread_ids: gmailThreadIds,
      })
      if (read.error) return { ok: false, error: read.error }
      const parsed = heldSchema.safeParse(read.data)
      if (!parsed.success) return { ok: false, error: { code: 'unusable' } }
      return { ok: true, rows: parsed.data }
    }
    const heldFailure = async (error: { code?: string; message?: string }) => {
      if (['42501', '22023'].includes(error.code ?? '')) {
        return rpcErrorResponse(error, req)
      }
      await report('threads_unavailable')
      return errorResponse('internal', 'Request failed', 500, req)
    }

    const first = await held(
      input.action === 'open' ? [input.gmail_thread_id] : [],
    )
    if (!first.ok) return heldFailure(first.error)
    if (input.action === 'open' && first.rows.length > 0) {
      return jsonResponse({ thread_id: first.rows[0]!.thread_id }, 200, req)
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
        input.connection_id,
        app,
      )
      gmail = new GmailClient({
        fetch: deps.fetch,
        origin: origins.api,
        accessToken: credentials.accessToken,
        signal: req.signal,
      })
    } catch (error) {
      if (error instanceof ReconnectNeeded || error instanceof ConnectionGone) {
        return errorResponse('conflict', 'Mailbox needs reconnection', 409, req)
      }
      await report('credentials_unavailable')
      return errorResponse('provider_error', 'Google unavailable', 502, req)
    }
    const gmailFailed = async (error: unknown) => {
      await report(
        error instanceof GmailError ? `gmail_${error.code}` : 'gmail_failed',
      )
      return errorResponse('provider_error', 'Google unavailable', 502, req)
    }

    if (input.action === 'search') {
      let list
      try {
        list = await gmail.listMessages({
          q: `${input.query} newer_than:${WINDOW_MONTHS}m`,
          maxResults: SEARCH_MAX,
        })
      } catch (error) {
        return gmailFailed(error)
      }
      // Gmail answers newest first: the first message seen of a thread is its newest.
      const newest = new Map<string, string>()
      for (const ref of list.messages ?? []) {
        if (ref.threadId && !newest.has(ref.threadId)) {
          newest.set(ref.threadId, ref.id)
        }
      }
      if (newest.size === 0) return jsonResponse({ threads: [] }, 200, req)
      const inMirror = await held([...newest.keys()])
      if (!inMirror.ok) return heldFailure(inMirror.error)
      for (const row of inMirror.rows) newest.delete(row.gmail_thread_id)
      const threads = []
      try {
        for (const [gmailThreadId, messageId] of newest) {
          const message = await gmail.getMessage(messageId, 'metadata')
          const from = parseAddress(
            header(message.payload?.headers, 'From') ?? '',
          )
          threads.push({
            gmail_thread_id: gmailThreadId,
            subject: header(message.payload?.headers, 'Subject') ?? '',
            from_name: from?.name ?? null,
            from_address: from?.address ?? null,
            date: message.internalDate
              ? new Date(Number(message.internalDate)).toISOString()
              : null,
            snippet: message.snippet ?? '',
          })
        }
      } catch (error) {
        return gmailFailed(error)
      }
      return jsonResponse({ threads }, 200, req)
    }

    // `open`: the thread copied into the mirror, within the window.
    ids.gmail_thread_id = input.gmail_thread_id
    let thread
    try {
      thread = await gmail.getThread(input.gmail_thread_id, 'minimal')
    } catch (error) {
      if (error instanceof GmailError && error.code === 'not_found') {
        return errorResponse('not_found', 'Thread not found', 404, req)
      }
      return gmailFailed(error)
    }
    const start = windowStart(deps.now()).getTime()
    const kept = (thread.messages ?? []).filter((m) =>
      Number(m.internalDate ?? 0) >= start
    )
    if (kept.length === 0) {
      return errorResponse('not_found', 'Thread not found', 404, req)
    }
    try {
      for (const message of kept) {
        await mirrorMessage(
          service,
          gmail,
          orgId,
          input.connection_id,
          message.id,
          deps.now(),
        )
      }
    } catch (error) {
      if (error instanceof GmailError) return gmailFailed(error)
      await report('mirror_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const after = await held([input.gmail_thread_id])
    if (!after.ok) return heldFailure(after.error)
    if (after.rows.length === 0) {
      await report('mirror_missing')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    return jsonResponse({ thread_id: after.rows[0]!.thread_id }, 200, req)
  }
}
