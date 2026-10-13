/**
 * `gmail-send` (plan §11, CM3): sends one message the composer wrote, from a
 * clinic mailbox, through Gmail, and mirrors it at once. User function:
 * `verifyAuth` with module `communications` and `communications.inbox`.
 *
 * 1. CORS; `POST` only; body strict (the composer's fields, ids, at most
 *    10 file ids, an HTML body of 512 KB at most): no URL, no file bytes.
 * 2. One hit on `LIMITS.gmailSendUser` (60 an hour per caller) and on
 *    `LIMITS.gmailSendOrgDay` (500 a day per clinic).
 * 3. `prepare_mail_send` (the actor re-checked, CM-14 … CM-16): the mailbox,
 *    the thread, the recipients, the file, the placeholders, the files (our
 *    stored files only: an upload of the caller's, or a mirrored attachment
 *    she may read) and P3-40; a refusal is passed on as written (400,
 *    `refusal`). The same `send_key` again answers what the first did
 *    (already sent: 200 without a second send; still running: a refusal).
 * 4. The files are read from storage with the service role (`client.storage`,
 *    paths from the database only); one that cannot be read fails the send
 *    (never a message sent without its attachment, PS Hub's flaw).
 * 5. The placeholders are filled here (HTML-escaped in the body), the HTML is
 *    hardened, a text alternative written, the MIME built
 *    (`_shared/gmail/compose.ts`) with the send's own Message-ID
 *    (`<send_id@domain>`, the same on every try), then Gmail `messages.send`
 *    (never retried, never cut short by the browser leaving: Gmail may have
 *    sent before failing to answer). A try after an unanswered one
 *    (`verify_first`) first asks Gmail for that Message-ID: found, it is not
 *    sent twice.
 * 6. The sent message is mirrored at once (`mirrorMessage`; a failure is left
 *    to the next sync), then `complete_mail_send` closes the send (draft
 *    deleted, uploads kept, the new thread linked to the file).
 * 7. 200 `{ status: 'sent', thread_id, gmail_message_id }`. Failures: 409
 *    `conflict` (the mailbox needs reconnecting), 502 `provider_error` with
 *    `outcome`: `refused` (Gmail answered no: marked `failed`) or `unknown`
 *    (no usable answer, maybe sent: marked `unknown`; the same key looks
 *    first), 503 `not_configured`, 500 `internal`; reported with ids and codes
 *    only, never an address, a subject or a body.
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
import {
  GmailClient,
  GmailError,
  type GmailErrorCode,
} from '../_shared/gmail/client.ts'
import {
  buildMime,
  fillPlaceholders,
  hardenHtml,
  htmlToText,
  type OutgoingAttachment,
} from '../_shared/gmail/compose.ts'
import {
  mailboxCredentials,
  oauthApp,
  ReconnectNeeded,
} from '../_shared/gmail/credentials.ts'
import { gmailOrigins } from '../_shared/gmail/env.ts'
import { mirrorMessage } from '../_shared/gmail/sync.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'gmail-send'

/** Gmail answered, and not with a send: nothing went (the rest may have sent). */
const REFUSED: readonly GmailErrorCode[] = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'too_large',
]

const addresses = z.array(z.string().trim().min(3).max(254)).max(50)

const bodySchema = z.strictObject({
  send_key: z.guid(),
  connection_id: z.guid(),
  mode: z.enum(['new', 'reply', 'reply_all', 'forward']),
  thread_id: z.guid().nullable().optional(),
  reply_to_message_id: z.guid().nullable().optional(),
  client_id: z.guid().nullable().optional(),
  draft_id: z.guid().nullable().optional(),
  template_key: z.string().max(100).nullable().optional(),
  to: addresses,
  cc: addresses.default([]),
  bcc: addresses.default([]),
  subject: z.string().max(250),
  body_html: z.string().max(524_288),
  file_ids: z.array(z.guid()).max(10).default([]),
})

const fileSchema = z.object({
  id: z.string(),
  bucket: z.string(),
  object_path: z.string(),
  name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
})

const preparedSchema = z.union([
  z.object({
    send_id: z.string(),
    already_sent: z.literal(true),
    gmail_message_id: z.string().nullable(),
    gmail_thread_id: z.string().nullable(),
  }),
  z.object({
    send_id: z.string(),
    already_sent: z.literal(false),
    verify_first: z.boolean(),
    from_name: z.string(),
    from_address: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()),
    bcc: z.array(z.string()),
    subject: z.string(),
    gmail_thread_id: z.string().nullable(),
    in_reply_to: z.string().nullable(),
    references: z.string().nullable(),
    values: z.record(z.string(), z.string().nullable()),
    files: z.array(fileSchema),
  }),
])

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
    const input = await readJson(req, bodySchema, 600_000)
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

    const [perUser, perOrg] = await Promise.all([
      consume(service, LIMITS.gmailSendUser, [orgId, auth.user.id]),
      consume(service, LIMITS.gmailSendOrgDay, [orgId]),
    ])
    const limited = limitResponse(perUser, req) ?? limitResponse(perOrg, req)
    if (limited) return limited

    const prepared = await service.rpc('prepare_mail_send', {
      p_actor: auth.user.id,
      p_org_id: orgId,
      p_send: input,
    })
    if (prepared.error) {
      if (['42501', 'P0001', '22023'].includes(prepared.error.code ?? '')) {
        return rpcErrorResponse(prepared.error, req)
      }
      await report('prepare_failed')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const parsed = preparedSchema.safeParse(prepared.data)
    if (!parsed.success) {
      await report('prepare_unusable')
      return errorResponse('internal', 'Request failed', 500, req)
    }
    const send = parsed.data
    ids.send_id = send.send_id
    if (send.already_sent) {
      return jsonResponse(
        {
          status: 'sent',
          thread_id: null,
          gmail_message_id: send.gmail_message_id,
        },
        200,
        req,
      )
    }

    /**
     * Marks the send `failed` (nothing went) or `unknown` (maybe sent), then
     * answers; the same key may try again (after `unknown`, it looks first).
     */
    const fail = async (
      code: string,
      response: Response,
      status: 'failed' | 'unknown' = 'failed',
    ): Promise<Response> => {
      const closed = await service.rpc('complete_mail_send', {
        p_org_id: orgId,
        p_send_id: send.send_id,
        p_status: status,
        p_error_code: code,
      })
      if (closed.error) await report('close_failed')
      return response
    }
    const providerResponse = (outcome: 'refused' | 'unknown') =>
      jsonResponse(
        {
          error: {
            code: 'provider_error',
            message: outcome === 'refused'
              ? 'Google refused the send'
              : 'Google did not answer',
          },
          outcome,
        },
        502,
        req,
      )

    // The files, from our storage (paths from the database only).
    const attachments: OutgoingAttachment[] = []
    for (const file of send.files) {
      const read = await service.storage.from(file.bucket).download(
        file.object_path,
      )
      const bytes = read.data
        ? new Uint8Array(await read.data.arrayBuffer())
        : null
      if (read.error || !bytes || bytes.byteLength !== file.size_bytes) {
        ids.file_id = file.id
        await report('attachment_unavailable')
        return fail(
          'attachment_unavailable',
          errorResponse('internal', 'Attachment unavailable', 500, req),
        )
      }
      attachments.push({ name: file.name, mimeType: file.mime_type, bytes })
    }

    let raw: Uint8Array
    try {
      const html = hardenHtml(
        fillPlaceholders(input.body_html, send.values, { html: true }),
      )
      raw = buildMime({
        from: { name: send.from_name, address: send.from_address },
        to: send.to,
        cc: send.cc,
        bcc: send.bcc,
        subject: fillPlaceholders(send.subject, send.values, { html: false }),
        html: `<div dir="ltr">${html}</div>`,
        text: htmlToText(html),
        inReplyTo: send.in_reply_to,
        references: send.references,
        attachments,
        messageId: send.send_id,
        random: () => crypto.randomUUID(),
        date: deps.now(),
      })
    } catch {
      await report('compose_failed')
      return fail(
        'compose_failed',
        errorResponse('internal', 'Request failed', 500, req),
      )
    }

    let app
    try {
      app = await oauthApp(service, orgId)
    } catch {
      await report('oauth_app_unavailable')
      return fail(
        'oauth_app_unavailable',
        errorResponse('internal', 'Request failed', 500, req),
      )
    }
    if (!app) {
      return fail(
        'not_configured',
        errorResponse(
          'not_configured',
          'Google OAuth client is not set',
          503,
          req,
        ),
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
      // No request signal: a browser leaving mid-send must not cut Gmail short.
      gmail = new GmailClient({
        fetch: deps.fetch,
        origin: origins.api,
        accessToken: credentials.accessToken,
      })
    } catch (error) {
      if (error instanceof ReconnectNeeded) {
        return fail(
          'needs_reconnect',
          errorResponse('conflict', 'Mailbox needs reconnection', 409, req),
        )
      }
      await report('credentials_unavailable')
      return fail(
        'credentials_unavailable',
        errorResponse('provider_error', 'Google unavailable', 502, req),
      )
    }

    let sent: { id: string; threadId: string } | null = null
    if (send.verify_first) {
      // The last try had no answer: did it go? (Its Message-ID is this one.)
      const domain = send.from_address.split('@')[1]
      try {
        const found = await gmail.listMessages({
          q: `rfc822msgid:<${send.send_id}@${domain}>`,
          maxResults: 1,
        })
        const first = found.messages?.[0]
        if (first) {
          sent = {
            id: first.id,
            threadId: first.threadId ??
              (await gmail.getMessage(first.id, 'minimal')).threadId,
          }
        }
      } catch (error) {
        const code = error instanceof GmailError
          ? `gmail_${error.code}`
          : 'gmail_failed'
        await report(`verify_${code}`)
        return fail(code, providerResponse('unknown'), 'unknown')
      }
    }
    if (!sent) {
      try {
        sent = await gmail.sendMessage(raw, send.gmail_thread_id)
      } catch (error) {
        const refused = error instanceof GmailError &&
          REFUSED.includes(error.code)
        const code = error instanceof GmailError
          ? `gmail_${error.code}`
          : 'gmail_failed'
        await report(code)
        return refused
          ? fail(code, providerResponse('refused'))
          : fail(code, providerResponse('unknown'), 'unknown')
      }
    }
    ids.gmail_message_id = sent.id

    try {
      await mirrorMessage(
        service,
        gmail,
        orgId,
        input.connection_id,
        sent.id,
        deps.now(),
      )
    } catch {
      // Sent: the next sync brings it into the mirror.
      await report('mirror_failed')
    }
    const closed = await service.rpc('complete_mail_send', {
      p_org_id: orgId,
      p_send_id: send.send_id,
      p_status: 'sent',
      p_gmail_message_id: sent.id,
      p_gmail_thread_id: sent.threadId,
    })
    if (closed.error) await report('close_failed')
    return jsonResponse(
      {
        status: 'sent',
        thread_id: typeof closed.data === 'string' ? closed.data : null,
        gmail_message_id: sent.id,
      },
      200,
      req,
    )
  }
}
