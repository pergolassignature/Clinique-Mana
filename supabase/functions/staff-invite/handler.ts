/**
 * `staff-invite` (Task 3.20, design §4, P3-7): « Inviter » and « Renvoyer »
 * in « Utilisateurs et accès ». The only caller of `create_staff_invitation`
 * and `renew_staff_invitation` (service role only, Task 3.18).
 *
 * The inviter never learns the token: the link proves that the invitee
 * controls the address only if nobody else knows it. The token is generated
 * and hashed here, in memory, travels only in the email, and is never
 * returned, logged, reported or stored (only its SHA-256 reaches the
 * database).
 *
 * 1. CORS; `POST` only; `verifyAuth` with `users.manage`.
 * 2. Body `{ email, display_name, role }` (invite) or `{ invitation_id }`
 *    (« Renvoyer »). The address is trimmed and lowercased, and must be one
 *    bare mailbox (the send path's rule), so an invitation is never created
 *    for an address the email cannot reach. Any other field (an actor, an
 *    org) is ignored.
 * 3. `invites.staff_user` (30 per hour per caller), on top of the email
 *    limits of the send path.
 * 4. `generateToken`, `hashToken` and the link URL (an unusable `APP_URL` →
 *    500 before anything is created).
 * 5. With the service client, `p_actor` = the caller `verifyAuth` verified,
 *    never a body value: `create_staff_invitation` then `peek_secure_link`
 *    for the link's expiry (create returns the id only), or
 *    `renew_staff_invitation` (which returns the address, name and expiry).
 *    The RPC re-checks `users.manage` and every guard as that actor, in her
 *    org. P0001 → 400 `invalid_request` with its French message; 42501 →
 *    403.
 * 6. `sendTemplatedEmail` (`core.staff_invite`, subject `staff_invitation` /
 *    id; « Renvoyer » is an `explicitResend`).
 * 7. 200 `{ invitation_id }`.
 *
 * Status mapping: 200; 400 `invalid_request` (body, P0001, 22023); 401 / 403
 * / 503 from `verifyAuth`; 403 `forbidden` (42501); 405; 413; 429
 * `rate_limited` with `Retry-After` (the caller's limit); 503
 * `not_configured` (limiter failed closed); 500 `internal` (another RPC
 * error, reported) or `server_misconfigured` (`APP_URL`). Once the invitation
 * exists, a failure answers with `invitation_id` next to the error, so the UI
 * shows « Invitation créée, mais le courriel n'a pas pu être envoyé.
 * Utilisez « Renvoyer ». »: 502 `provider_error`, 503 `not_configured`, 429
 * `rate_limited` (an email limit, with `Retry-After`), 400 `invalid_request`
 * (recipient refused), 403 `module_disabled`, 500 `internal` (anything else).
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
import { isMailbox, sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError, rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import {
  generateToken,
  hashToken,
  linkUrl,
  peekSecureLink,
} from '../_shared/links.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'staff-invite'

const resendSchema = z.object({ invitation_id: z.guid() })
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().refine(isMailbox),
  display_name: z.string().trim().min(1).max(80),
  role: z.string().min(1).max(64),
})
/** « Renvoyer » when `invitation_id` is valid, else an invitation. */
const bodySchema = z.union([resendSchema, inviteSchema])

/** `renew_staff_invitation`'s one row. */
const renewSchema = z.tuple([
  z.object({
    email: z.string(),
    display_name: z.string(),
    expires_at: z.string(),
  }),
])

/** An error answer that keeps the created invitation's id for « Renvoyer ». */
function invitationError(
  invitationId: string,
  code: ErrorCode,
  status: number,
  req: Request,
): Response {
  return jsonResponse(
    {
      error: { code, message: 'Invitation created, email not sent' },
      invitation_id: invitationId,
    },
    status,
    req,
  )
}

/** The invite / resend handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { permission: 'users.manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const { user_id: actor, org_id: orgId } = auth.access
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { org_id: orgId, ...ids } }, deps.fetch)

    const refused = limitResponse(
      await consume(client, LIMITS.staffInviteUser, [orgId, actor]),
      req,
    )
    if (refused) return refused

    // In memory only: the token goes into the email, its hash to the RPC.
    const token = generateToken()
    const tokenHash = await hashToken(token)
    let actionUrl: string
    try {
      actionUrl = linkUrl(
        deps.env('APP_URL')?.trim() ?? '',
        '/invitation',
        token,
      )
    } catch {
      await report('app_url_invalid')
      return errorResponse(
        'server_misconfigured',
        'Server misconfigured',
        500,
        req,
      )
    }

    const rpcFailed = async (error: { code?: string; message?: string }) => {
      if (!['P0001', '42501', '22023'].includes(error.code ?? '')) {
        await report('invite_failed')
      }
      return rpcErrorResponse(error, req)
    }

    let invitationId: string
    let invitee: { email: string; displayName: string; expiresAt: string }
    if ('invitation_id' in input) {
      const { data, error } = await client.rpc('renew_staff_invitation', {
        p_actor: actor,
        p_id: input.invitation_id,
        p_token_hash: tokenHash,
      })
      if (error) return rpcFailed(error)
      const row = renewSchema.safeParse(data)
      if (!row.success) {
        await report('renew_invalid', { invitation_id: input.invitation_id })
        return invitationError(input.invitation_id, 'internal', 500, req)
      }
      invitationId = input.invitation_id
      const [r] = row.data
      invitee = {
        email: r.email,
        displayName: r.display_name,
        expiresAt: r.expires_at,
      }
    } else {
      const { data, error } = await client.rpc('create_staff_invitation', {
        p_actor: actor,
        p_email: input.email,
        p_display_name: input.display_name,
        p_role: input.role,
        p_token_hash: tokenHash,
      })
      if (error) return rpcFailed(error)
      if (typeof data !== 'string') {
        await report('create_invalid')
        return errorResponse('internal', 'Invitation failed', 500, req)
      }
      invitationId = data
      // create returns the id only: the expiry is the new link's.
      const peek = await peekSecureLink(client, tokenHash, false)
      if (peek?.state !== 'valid') {
        await report('invite_peek_failed', { invitation_id: invitationId })
        return invitationError(invitationId, 'internal', 500, req)
      }
      invitee = {
        email: input.email,
        displayName: input.display_name,
        expiresAt: peek.expires_at,
      }
    }

    try {
      const result = await sendTemplatedEmail(
        {
          fn: FN,
          client,
          env: deps.env,
          fetch: deps.fetch,
          signal: req.signal,
        },
        {
          orgId,
          templateKey: 'core.staff_invite',
          to: { email: invitee.email, profileId: null },
          subject: { type: 'staff_invitation', id: invitationId },
          values: {
            invitee: { display_name: invitee.displayName },
            inviter: { display_name: auth.access.display_name },
            clinic: { name: auth.access.org_name },
            invitation: { expires_at: invitee.expiresAt },
          },
          actionUrl,
          sentBy: actor,
          explicitResend: 'invitation_id' in input,
        },
      )
      if (result.ok) {
        return jsonResponse({ invitation_id: invitationId }, 200, req)
      }
      switch (result.code) {
        case 'rate_limited': {
          const res = invitationError(invitationId, 'rate_limited', 429, req)
          res.headers.set('Retry-After', String(result.retryAfter))
          return res
        }
        case 'not_configured':
          return invitationError(invitationId, 'not_configured', 503, req)
        case 'provider_error':
          return invitationError(invitationId, 'provider_error', 502, req)
        case 'invalid_recipient':
          return invitationError(invitationId, 'invalid_request', 400, req)
        case 'module_disabled':
          return invitationError(invitationId, 'module_disabled', 403, req)
        default:
          await report(`email_${result.code}`, { invitation_id: invitationId })
          return invitationError(invitationId, 'internal', 500, req)
      }
    } catch (error) {
      // The send path reports its own failures before throwing them.
      if (!(error instanceof FunctionError)) {
        await report('unexpected', { invitation_id: invitationId })
      }
      return invitationError(invitationId, 'internal', 500, req)
    }
  }
}
