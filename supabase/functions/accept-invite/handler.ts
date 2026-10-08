/**
 * `accept-invite` (Task 3.20, design §3.2 and §4, P3-8, P3-16): creates the
 * invitee's account from a secure link and the password she chose. A public
 * token function (CLAUDE.md §7): `verify_jwt = true` (the anon key), no user;
 * the token authorizes.
 *
 * 1. CORS (`ALLOWED_ORIGINS`); `POST` only.
 * 2. `links.accept_ip` (10 per hour) on `clientIp`, before the body is read.
 * 3. Body `{ token, password, payload? }` (8 KB at most): the password as
 *    GoTrue takes it (10 characters to 72 bytes, `password-schema.ts`), the
 *    payload an object of at most 4 KB. A token that is not well formed
 *    answers like an unknown one (410 `link_invalid`), never hashed.
 * 4. `peek_secure_link(hash, false)`: not valid → 410 with its code.
 * 5. `links.accept_link` (5 per hour) on the link id.
 * 6. Module gate on the link's org and module: disabled → `link_invalid`.
 * 7. A purpose that creates no account → 400 `invalid_request` (session-only
 *    purposes have their own module functions).
 * 8. `display = resolve_rpc(p_link_id)`; null (revoked or renewed since the
 *    peek) → `link_invalid`; `display.email` is required.
 * 9. `auth.admin.createUser({ email, password, email_confirm: true,
 *    app_metadata: { invite_link_id } })`: the link proves the address. An
 *    address that already has an account → 409 `conflict` with the neutral
 *    « Ce lien ne peut plus être utilisé… », reported `invite_email_exists`
 *    with the link id only (P3-8: never reveal that an account exists);
 *    `weak_password` → 400. Any other error: the link is peeked again, and
 *    if it is now `used` (a concurrent accept won; Auth may answer the
 *    losing insert with a database error rather than `email_exists`) → 410
 *    `link_used`, not reported; otherwise 500, nothing consumed.
 *    Orphan marker: `app_metadata.invite_link_id` marks an account created
 *    here. A maintenance job (DB lane) deletes auth users that carry it,
 *    have no profile and are older than 1 hour, so an account left behind by
 *    a failed compensation (step 11) cannot block the invitation for good:
 *    once it is gone, the invitee can accept again.
 * 10. `accept_rpc(p_token_hash, p_user_id, p_payload)`: it consumes the link
 *    and does the purpose's work in one transaction.
 * 11. Compensation: any status but `accepted` deletes the user just created;
 *    a link state (`link_used` / `link_expired` / `link_invalid`) answers 410
 *    with it, an unknown answer 500. An RPC (transport) error is ambiguous:
 *    the transaction may have committed and only the reply been lost. The
 *    link is peeked first: deleted only when the peek shows it still not
 *    used (`accept_failed`, 500); when it is `used`, or the peek fails, the
 *    account may be real and is kept (`accept_outcome_unknown`, reported
 *    with the link and user ids, 500; the orphan job removes it if no
 *    profile was made). A failed delete is reported with the user id;
 *    nothing is retried.
 * 12. 200 `{ status: 'accepted', email }`: the token holder already knows
 *    the address, and the page signs in with it.
 *
 * Status mapping: 200; 400 `invalid_request` (body, password refused by Auth,
 * a purpose without accounts); 405; 409 `conflict`; 410 `link_invalid` /
 * `link_expired` / `link_used`; 413; 429 `rate_limited` with `Retry-After`;
 * 503 `not_configured` (limiter failed closed); 500 `internal` (reported) or
 * `server_misconfigured`. Reports carry the link and user ids only: never the
 * token, the password or the address.
 *
 * Deviation from PS Hub (`admin-create-user`): Auth's error message is never
 * returned or logged (it may name the address); errors map to codes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { errorResponse, handleCors, jsonResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import {
  hashToken,
  isLinkGoneCode,
  isWellFormedToken,
  LINK_STATE_CODE,
  linkGoneResponse,
  peekSecureLink,
} from '../_shared/links.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import {
  clientIp,
  consume,
  limitResponse,
  LIMITS,
} from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'accept-invite'

/** Token, password and a 4 KB payload. */
const MAX_BODY_BYTES = 8_192
const MAX_PAYLOAD_BYTES = 4_096
/** bcrypt uses the first 72 bytes only (`password-schema.ts`). */
const MAX_PASSWORD_BYTES = 72

const utf8Length = (value: string) => new TextEncoder().encode(value).length

const bodySchema = z.object({
  token: z.unknown(),
  password: z.string().min(10).refine((v) =>
    utf8Length(v) <= MAX_PASSWORD_BYTES
  ),
  payload: z.record(z.string(), z.unknown())
    .refine((v) => utf8Length(JSON.stringify(v)) <= MAX_PAYLOAD_BYTES)
    .optional(),
})

/** P3-8: the same answer whether or not the address has an account elsewhere. */
const NO_LONGER_USABLE =
  'Ce lien ne peut plus être utilisé. Communiquez avec la clinique.'

/** An Auth error meaning the address already has an account. */
function emailExists(
  error: { code?: string; status?: number; message?: string },
) {
  return error.code === 'email_exists' ||
    (error.status === 422 &&
      /already (been )?registered/i.test(error.message ?? ''))
}

/** The accept handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const ipRefused = limitResponse(
      await consume(client, LIMITS.inviteAcceptIp, [clientIp(req)]),
      req,
    )
    if (ipRefused) return ipRefused

    const input = await readJson(req, bodySchema, MAX_BODY_BYTES)
    if (input instanceof Response) return input
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids }, deps.fetch)
    const failed = async (code: string, ids: Record<string, string> = {}) => {
      await report(code, ids)
      return errorResponse(
        'internal',
        'Invitation could not be accepted',
        500,
        req,
      )
    }

    const tokenHash = await hashToken(input.token)
    const peek = await peekSecureLink(client, tokenHash, false)
    if (!peek) return failed('peek_failed')
    if (peek.state !== 'valid') {
      return linkGoneResponse(LINK_STATE_CODE[peek.state], req)
    }
    const ids = { link_id: peek.link_id }

    const linkRefused = limitResponse(
      await consume(client, LIMITS.inviteAcceptLink, [peek.link_id]),
      req,
    )
    if (linkRefused) return linkRefused

    const gate = await requireModuleForOrg(client, peek.org_id, peek.module_key)
    if (gate) {
      return gate.status === 403
        ? linkGoneResponse('link_invalid', req)
        : failed('module_check_failed', ids)
    }
    if (!peek.creates_account) {
      return errorResponse(
        'invalid_request',
        'This link does not create an account',
        400,
        req,
      )
    }
    const { resolve_rpc: resolveRpc, accept_rpc: acceptRpc } = peek
    if (!resolveRpc || !acceptRpc) return failed('purpose_without_rpc', ids)

    const resolved = await client.rpc(resolveRpc, { p_link_id: peek.link_id })
    if (resolved.error) return failed('resolve_failed', ids)
    if (resolved.data === null) return linkGoneResponse('link_invalid', req)
    const email = (resolved.data as { email?: unknown }).email
    if (typeof email !== 'string' || email === '') {
      return failed('resolve_invalid', ids)
    }

    const created = await client.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      // The orphan marker (step 9): see the module comment.
      app_metadata: { invite_link_id: peek.link_id },
    })
    if (created.error) {
      if (emailExists(created.error)) {
        await report('invite_email_exists', ids)
        return errorResponse('conflict', NO_LONGER_USABLE, 409, req)
      }
      if (created.error.code === 'weak_password') {
        return errorResponse('invalid_request', 'Password refused', 400, req)
      }
      // A concurrent accept may have won: not an error worth a report.
      const again = await peekSecureLink(client, tokenHash, false)
      if (again?.state === 'used') return linkGoneResponse('link_used', req)
      return failed('create_user_failed', ids)
    }
    const userId = created.data.user?.id
    if (!userId) return failed('create_user_invalid', ids)

    const accepted = await client.rpc(acceptRpc, {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_payload: input.payload ?? {},
    })
    const status = (accepted.data as { status?: unknown } | null)?.status
    if (!accepted.error && status === 'accepted') {
      return jsonResponse({ status: 'accepted', email }, 200, req)
    }

    // Compensation: the account exists only with an accepted link.
    const userIds = { ...ids, user_id: userId }
    if (accepted.error) {
      // The reply may be lost after a commit: never delete a real account.
      const peeked = await peekSecureLink(client, tokenHash, false)
      if (!peeked || peeked.state === 'used') {
        return failed('accept_outcome_unknown', userIds)
      }
      const answer = await failed('accept_failed', userIds)
      await deleteCreatedUser(client, userIds, report)
      return answer
    }
    const answer = isLinkGoneCode(status)
      ? linkGoneResponse(status, req)
      : await failed('accept_invalid', userIds)
    await deleteCreatedUser(client, userIds, report)
    return answer
  }
}

/** Deletes the account created for a link that was not accepted; reports a failure. */
async function deleteCreatedUser(
  client: SupabaseClient,
  ids: { link_id: string; user_id: string },
  report: (code: string, ids: Record<string, string>) => Promise<void>,
): Promise<void> {
  const { error } = await client.auth.admin.deleteUser(ids.user_id)
  if (error) await report('invite_user_cleanup_failed', ids)
}
