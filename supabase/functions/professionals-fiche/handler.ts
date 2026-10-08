/**
 * `professionals-fiche` (Task 4c.5, P4-58): « Envoyer par courriel ». The
 * browser renders the fiche (react-pdf) and uploads that very file
 * (`storage-upload` / `storage-confirm`, purpose `professional_fiche`); this
 * function checks it may go out and sends it attached to
 * `professionals.fiche`. It renders nothing (no `_shared/pdf/`).
 *
 * 1. CORS; `POST` only; `verifyAuth` with module `professionals` and
 *    `professionals.view` (the conseillères send fiches after the discovery
 *    call).
 * 2. Body `{ action: 'email', professional_id, file_id, to, message? }`,
 *    strict: `to` trimmed (≤ 254, one mailbox: the send path's rule),
 *    `message` ≤ 1 000 characters, line breaks only among control
 *    characters.
 * 3. One hit on `LIMITS.ficheEmailUser` (30 an hour per caller), before any
 *    lookup: each call may download a file of up to 10 MB.
 * 4. `get_professional_fiche_upload` **with the caller's client**: the
 *    professional is of the caller's clinic and active, and the file is the
 *    caller's own ready upload of that purpose, for that professional, still
 *    staged. Its French refusals (P0001) are passed on (400, `refusal`).
 * 5. The object, read by the service role from the bucket and path the RPC
 *    returned (never from the body): at most 10 MB, sniffed as a PDF.
 * 6. `sendTemplatedEmail` (`professionals.fiche`, a free-recipient template
 *    with attachments, P3-18): the attachment is named by `ficheFileName`
 *    from the name in the database; the log row's subject is the
 *    professional. A deliberate send by a person: like « Renvoyer », it skips
 *    the one-per-minute limit per address (a client may receive two or three
 *    fiches in a row) and keeps the 5 s double-click guard (P4-209); the
 *    free-recipient limit (20 an hour per sender) applies.
 * 7. Sent: `mark_professional_fiche_generated` with the caller's client
 *    (P4-203; a failure is reported, the answer stays 200).
 *
 * Nothing logs the address, the message, the name or the path: reports carry
 * the org, the professional and the file ids.
 *
 * Status mapping: 200 `{ email_log_id }`; 400 `invalid_request` (body; a
 * refusal from the RPC with `refusal: true`; an invalid address with `field:
 * 'to'`); 400 `missing_variable` (a clinic's template names a value this
 * send lacks); 401 / 403 / 503 from `verifyAuth` (403 `module_disabled`
 * too from the send path); 403 `forbidden` (42501, or the catalogue no
 * longer allows a free recipient or an attachment: reported); 404
 * `not_found` (the object is gone: purged or never stored, reported); 405;
 * 413; 429 `rate_limited` with `Retry-After`; 502 `provider_error`; 503
 * `not_configured`; 500 `internal` (reported).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { type SendResult, sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError, rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { isMissingObject, sniff } from '../_shared/storage.ts'
import { ficheFileName } from './file-name.ts'

const FN = 'professionals-fiche'
const TEMPLATE = 'professionals.fiche'

/** The `professional_fiche` purpose's cap (10 MB), and the send path's. */
export const MAX_FICHE_BYTES = 10 * 1024 * 1024

/**
 * Control and formatting characters a message never carries: C0 but the
 * tab, the line break and the carriage return, DEL, C1, the line and
 * paragraph separators and the bidirectional controls.
 */
// deno-lint-ignore no-control-regex
const FORBIDDEN_IN_MESSAGE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/

const bodySchema = z.strictObject({
  action: z.literal('email'),
  professional_id: z.guid(),
  file_id: z.guid(),
  to: z.string().trim().min(1).max(254),
  message: z.string().max(1_000).refine((m) => !FORBIDDEN_IN_MESSAGE.test(m))
    .optional(),
})

/** `get_professional_fiche_upload`'s answer. */
const uploadSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  bucket: z.string().min(1),
  object_path: z.string().min(1),
  size_bytes: z.number().int().positive(),
})

/** The HTTP answer for a send outcome (see the module comment). */
async function outcomeResponse(
  result: Exclude<SendResult, { ok: true }>,
  req: Request,
  report: (code: string) => Promise<void>,
): Promise<Response> {
  switch (result.code) {
    case 'rate_limited': {
      const res = errorResponse('rate_limited', 'Too many emails', 429, req)
      res.headers.set('Retry-After', String(result.retryAfter))
      return res
    }
    case 'not_configured':
      return errorResponse(
        'not_configured',
        'Email is not configured',
        503,
        req,
      )
    case 'provider_error':
      return errorResponse('provider_error', 'Email provider failed', 502, req)
    case 'missing_variable':
      return jsonResponse(
        {
          error: {
            code: 'missing_variable',
            message: 'A template value is missing',
            variable: result.path.slice(0, 80),
          },
        },
        400,
        req,
      )
    case 'invalid_recipient':
      return jsonResponse(
        {
          error: {
            code: 'invalid_request',
            message: 'Invalid recipient',
            field: 'to',
          },
        },
        400,
        req,
      )
    case 'module_disabled':
      return errorResponse('module_disabled', 'Module disabled', 403, req)
    case 'recipient_not_allowed':
    case 'attachment_not_allowed':
      // The catalogue row no longer allows what this function relies on.
      await report(`fiche_${result.code}`)
      return errorResponse('forbidden', 'Not allowed', 403, req)
  }
}

/** The fiche-email handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'professionals', permission: 'professionals.view' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const { user_id: callerId, org_id: orgId } = auth.access
    const ids = {
      org_id: orgId,
      professional_id: input.professional_id,
      file_id: input.file_id,
    }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)
    const fail = async (code: string) => {
      await report(code)
      return errorResponse('internal', 'The fiche could not be sent', 500, req)
    }

    const limited = limitResponse(
      await consume(service, LIMITS.ficheEmailUser, [orgId, callerId]),
      req,
    )
    if (limited) return limited

    const checked = await auth.client.rpc('get_professional_fiche_upload', {
      p_id: input.professional_id,
      p_file_id: input.file_id,
    })
    if (checked.error) {
      if (checked.error.code === 'P0001' || checked.error.code === '42501') {
        return rpcErrorResponse(checked.error, req)
      }
      return await fail('fiche_upload_lookup_failed')
    }
    const upload = uploadSchema.safeParse(checked.data)
    if (!upload.success) return await fail('fiche_upload_unexpected')
    const file = upload.data
    if (file.size_bytes > MAX_FICHE_BYTES) {
      return await fail('fiche_too_large')
    }

    const downloaded = await service.storage.from(file.bucket).download(
      file.object_path,
    )
    if (downloaded.error || !downloaded.data) {
      if (downloaded.error && isMissingObject(downloaded.error)) {
        await report('fiche_object_missing')
        return errorResponse('not_found', 'File not found', 404, req)
      }
      return await fail('fiche_download_failed')
    }
    if (downloaded.data.size > MAX_FICHE_BYTES) {
      return await fail('fiche_too_large')
    }
    const content = new Uint8Array(await downloaded.data.arrayBuffer())
    if (sniff(content) !== 'pdf') return await fail('fiche_not_pdf')

    const person = { firstName: file.first_name, lastName: file.last_name }
    const message = input.message?.trim()
    let result: SendResult
    try {
      result = await sendTemplatedEmail(
        {
          fn: FN,
          client: service,
          env: deps.env,
          fetch: deps.fetch,
          signal: req.signal,
        },
        {
          orgId,
          templateKey: TEMPLATE,
          to: { email: input.to, profileId: null },
          subject: { type: 'professional', id: input.professional_id },
          values: {
            professional: { name: `${person.firstName} ${person.lastName}` },
            ...(message ? { message } : {}),
          },
          actionUrl: null,
          sentBy: callerId,
          freeRecipient: true,
          explicitResend: true,
          attachments: [{
            filename: ficheFileName(person),
            content,
            contentType: 'application/pdf',
          }],
        },
      )
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (error instanceof FunctionError) {
        return errorResponse(
          error.code,
          'The fiche could not be sent',
          500,
          req,
        )
      }
      return await fail('unexpected')
    }
    if (!result.ok) return await outcomeResponse(result, req, report)

    const stamped = await auth.client.rpc('mark_professional_fiche_generated', {
      p_id: input.professional_id,
    })
    if (stamped.error) await report('fiche_stamp_failed')
    return jsonResponse({ email_log_id: result.emailLogId }, 200, req)
  }
}
