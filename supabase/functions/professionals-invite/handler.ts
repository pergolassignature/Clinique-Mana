/**
 * `professionals-invite` (Task 4b.2, design §3.7): « Inviter », « Renvoyer
 * l'invitation », « Nouveau lien », « Révoquer l'invitation » and « Demander
 * une mise à jour » on a professional's file.
 *
 * The inviter never learns the token (Task 3.18's actor model, P4-260): the
 * link proves that the invitee controls the file's address only if nobody
 * else knows it, and an inviter holding it could create the account herself.
 * The token is generated and hashed here, in memory, travels only in the
 * email, and is never returned, logged, reported or stored (only its SHA-256
 * reaches the database). There is therefore no « Copier le lien ».
 *
 * 1. CORS; `POST` only; `verifyAuth` with the module `professionals` and
 *    `professionals.invite`.
 * 2. Body `{ action, professional_id, sections? }`: `sections` (section keys)
 *    with `request_update` only. Any other field (an actor, an org, an
 *    address) is ignored: the recipient is the file's address, from the RPC.
 * 3. `revoke`: `revoke_professional_invitation` as the caller → 200
 *    `{ ok: true }`. Nothing else below applies.
 * 4. `professionals.invite_user` (30 per hour per caller), on top of the
 *    email limits.
 * 5. The email's URL before anything is created (an unusable `APP_URL` →
 *    500): `send`, `resend`, `new_link` → `generateToken`, `hashToken`,
 *    `linkUrl(APP_URL, '/invitation', token)`; `request_update` →
 *    `APP_URL/mon-profil/questionnaire` (no token, P4-44).
 * 6. `send`, `resend`, `new_link`: `create_professional_invitation` with the
 *    **service** client, `p_actor` = the caller `verifyAuth` verified (never
 *    a body value); it re-checks her (active, `professionals.invite`, the
 *    module) in her clinic, issues the link (revoking the previous one) and
 *    answers `{ link_id, submission_id, email, first_name, expires_at }`.
 *    `request_update`: `request_professional_update` as the caller →
 *    `{ submission_id, email, first_name }`. P0001 → 400 with its French
 *    message, its HINT as `field`; 42501 → 403; 22023 → 400; another shape →
 *    500, reported.
 * 7. `sendTemplatedEmail`: `professionals.invite` or
 *    `professionals.profile_update`, subject `professional` / id, to the
 *    address the RPC returned; `resend` and `new_link` are explicit re-sends
 *    (the 5 s double-click guard instead of the 60 s same-address limit).
 * 8. 200 `{ ok: true, expires_at }` (an invitation) or `{ ok: true,
 *    submission_id }` (an update request).
 *
 * Once the link or the submission exists, an email failure answers with
 * `professional_id` (and `submission_id` for an update request) next to the
 * error, so the UI says « Invitation créée, mais le courriel n'a pas pu être
 * envoyé. Utilisez « Renvoyer ». »: 502 `provider_error`, 503
 * `not_configured`, 429 `rate_limited` (an email limit, with `Retry-After`),
 * 400 `invalid_request` with `field: 'email'` (the file's address is
 * refused), 403 `module_disabled`, 500 `internal` (anything else, reported).
 *
 * Status mapping: 200; 400 `invalid_request` (body, P0001, 22023); 401 / 403
 * / 503 from `verifyAuth`; 403 `forbidden` (42501); 405; 413; 429
 * `rate_limited` with `Retry-After` (the caller's limit); 503
 * `not_configured` (the limiter failed closed); 500 `internal` (another RPC
 * error, reported) or `server_misconfigured` (`APP_URL`). Reports carry the
 * org, professional and submission ids only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  type ErrorCode,
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { type SendResult, sendTemplatedEmail } from '../_shared/email/send.ts'
import { FunctionError } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { generateToken, hashToken, linkUrl } from '../_shared/links.ts'
import {
  appPageUrl,
  invitationValues,
  isExpectedRpcError,
  professionalsRpcError,
  profileUpdateValues,
  QUESTIONNAIRE_PATH,
  type RpcError,
} from '../_shared/professionals.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'professionals-invite'

const INVITE_ACTIONS = ['send', 'resend', 'new_link'] as const

const bodySchema = z.object({
  action: z.enum([...INVITE_ACTIONS, 'revoke', 'request_update']),
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
  professional_id: z.guid(),
  sections: z.array(z.string().regex(/^[a-z_]{1,32}$/)).min(1).max(11)
    .optional(),
}).refine((b) => (b.action === 'request_update') === (b.sections !== undefined))

/** `create_professional_invitation`'s answer (4b.1); other fields are ignored. */
const invitationSchema = z.object({
  email: z.string(),
  first_name: z.string(),
  expires_at: z.string(),
})

/** `request_professional_update`'s answer (4b.1). */
const updateSchema = z.object({
  submission_id: z.guid(),
  email: z.string(),
  first_name: z.string(),
})

/** The invite / update handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(
      req,
      { module: 'professionals', permission: 'professionals.invite' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input

    const { user_id: actor, org_id: orgId } = auth.access
    const professionalId = input.professional_id
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError(
        {
          fn: FN,
          code,
          ids: { org_id: orgId, professional_id: professionalId, ...ids },
        },
        deps.fetch,
      )
    const rpcFailed = async (error: RpcError, code: string) => {
      if (!isExpectedRpcError(error)) await report(code)
      return professionalsRpcError(error, req)
    }

    if (input.action === 'revoke') {
      const { error } = await auth.client.rpc(
        'revoke_professional_invitation',
        { p_id: professionalId },
      )
      if (error) return rpcFailed(error, 'revoke_failed')
      return jsonResponse({ ok: true }, 200, req)
    }

    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const client: SupabaseClient = service
    const refused = limitResponse(
      await consume(client, LIMITS.professionalInviteUser, [orgId, actor]),
      req,
    )
    if (refused) return refused

    const misconfigured = async () => {
      await report('app_url_invalid')
      return errorResponse(
        'server_misconfigured',
        'Server misconfigured',
        500,
        req,
      )
    }
    const appUrl = deps.env('APP_URL')?.trim() ?? ''

    if (input.action === 'request_update') {
      const actionUrl = appPageUrl(appUrl, QUESTIONNAIRE_PATH)
      if (!actionUrl) return misconfigured()
      const { data, error } = await auth.client.rpc(
        'request_professional_update',
        { p_id: professionalId, p_sections: input.sections },
      )
      if (error) return rpcFailed(error, 'update_request_failed')
      const row = updateSchema.safeParse(data)
      if (!row.success) {
        await report('update_request_invalid')
        return errorResponse('internal', 'Update request failed', 500, req)
      }
      const { submission_id: submissionId } = row.data
      const sent = await send(
        {
          templateKey: 'professionals.profile_update',
          email: row.data.email,
          values: profileUpdateValues({
            firstName: row.data.first_name,
            clinicName: auth.access.org_name,
          }),
          actionUrl,
          explicitResend: false,
        },
        { submission_id: submissionId },
      )
      return sent ?? jsonResponse(
        { ok: true, submission_id: submissionId },
        200,
        req,
      )
    }

    // In memory only: the token goes into the email, its hash to the RPC.
    const token = generateToken()
    const tokenHash = await hashToken(token)
    let actionUrl: string
    try {
      actionUrl = linkUrl(appUrl, '/invitation', token)
    } catch {
      return misconfigured()
    }
    const { data, error } = await client.rpc('create_professional_invitation', {
      p_actor: actor,
      p_id: professionalId,
      p_token_hash: tokenHash,
    })
    if (error) return rpcFailed(error, 'invite_failed')
    const row = invitationSchema.safeParse(data)
    if (!row.success) {
      await report('invite_invalid')
      return errorResponse('internal', 'Invitation failed', 500, req)
    }
    const sent = await send({
      templateKey: 'professionals.invite',
      email: row.data.email,
      values: invitationValues({
        firstName: row.data.first_name,
        clinicName: auth.access.org_name,
        expiresAt: row.data.expires_at,
      }),
      actionUrl,
      explicitResend: input.action !== 'send',
    })
    return sent ??
      jsonResponse({ ok: true, expires_at: row.data.expires_at }, 200, req)

    /**
     * Sends one email about the file; null when sent, else the error answer
     * (with the ids of what was created, for « Renvoyer »).
     */
    async function send(
      email: {
        templateKey: string
        email: string
        values: Record<string, unknown>
        actionUrl: string
        explicitResend: boolean
      },
      created: Record<string, string> = {},
    ): Promise<Response | null> {
      const ids = { professional_id: professionalId, ...created }
      let result: SendResult
      try {
        result = await sendTemplatedEmail(
          {
            fn: FN,
            client,
            env: deps.env,
            fetch: deps.fetch,
            signal: req.signal,
          },
          {
            orgId,
            templateKey: email.templateKey,
            to: { email: email.email, profileId: null },
            subject: { type: 'professional', id: professionalId },
            values: email.values,
            actionUrl: email.actionUrl,
            sentBy: actor,
            explicitResend: email.explicitResend,
          },
        )
      } catch (error) {
        // The send path reports its own failures before throwing them.
        if (!(error instanceof FunctionError)) {
          await report('unexpected', created)
        }
        return createdError('internal', 500, ids)
      }
      if (result.ok) return null
      switch (result.code) {
        case 'rate_limited': {
          const res = createdError('rate_limited', 429, ids)
          res.headers.set('Retry-After', String(result.retryAfter))
          return res
        }
        case 'not_configured':
          return createdError('not_configured', 503, ids)
        case 'provider_error':
          return createdError('provider_error', 502, ids)
        case 'invalid_recipient':
          return createdError('invalid_request', 400, ids, 'email')
        case 'module_disabled':
          return createdError('module_disabled', 403, ids)
        default:
          await report(`email_${result.code}`, created)
          return createdError('internal', 500, ids)
      }
    }

    /** An error answer that keeps what was created, for « Renvoyer ». */
    function createdError(
      code: ErrorCode,
      status: number,
      ids: Record<string, string>,
      field?: 'email',
    ): Response {
      return jsonResponse(
        {
          error: {
            code,
            message: 'Created, email not sent',
            ...(field && { field }),
          },
          ...ids,
        },
        status,
        req,
      )
    }
  }
}
