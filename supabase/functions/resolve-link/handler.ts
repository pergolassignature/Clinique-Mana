/**
 * `resolve-link` (Task 3.20, design §3.2): what a secure link opens, for the
 * page that reads `#t=` (`/invitation`). A public token function (CLAUDE.md
 * §7): `verify_jwt = false`, no user; the token authorizes. Nothing here
 * reads `Authorization` or `apikey`: the gateway checks nothing either.
 *
 * 1. CORS (`ALLOWED_ORIGINS`); `POST` only.
 * 2. `links.resolve_ip` (30 per 10 min) on `clientIp`, before the body is
 *    read or anything is looked up.
 * 3. Body `{ token }` (1 KB at most): a token that is not well formed answers
 *    exactly like an unknown one, and is never hashed.
 * 4. `peek_secure_link(hash, p_mark_opened: false)`: nothing is written yet.
 * 5. `invalid` → 410 `link_invalid`; `expired` → 410 `link_expired`; `used` →
 *    410 `link_used`.
 * 6. Module gate on the link's org and the purpose's module: disabled →
 *    `link_invalid`, indistinguishable on purpose, and the link is **not**
 *    marked opened (a disabled module opens nothing).
 * 7. `peek_secure_link(hash, p_mark_opened: true)` (« opened », at most once
 *    an hour): a second peek, only past the gate. A state that changed in
 *    between (revoked, used, expired) answers as in step 5.
 * 8. The purpose's `resolve_rpc(p_link_id)`. Null (revoked or renewed since
 *    the peek) → `link_invalid`.
 * 9. 200 `{ purpose, display }`: `display` as the purpose RPC returns it (it
 *    owns its minimisation).
 *
 * Status mapping: 200; 400 / 413 `invalid_request` (not JSON, over 1 KB);
 * 405; 410 `link_invalid` / `link_expired` / `link_used` (every cause of one
 * code byte-identical); 429 `rate_limited` with `Retry-After`; 503
 * `not_configured` (the limiter failed closed); 500 `internal` (an RPC
 * failure or a purpose without `resolve_rpc`, reported with the link id at
 * most) or `server_misconfigured`. The token is never echoed, logged or
 * reported.
 */
import { z } from 'zod'
import { errorResponse, handleCors, jsonResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import {
  hashToken,
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

const FN = 'resolve-link'

/** A token is 43 characters: 1 KB is ample. */
const MAX_BODY_BYTES = 1_024

/** Any JSON object; the token itself is checked by `isWellFormedToken`. */
const bodySchema = z.object({ token: z.unknown() })

/** The resolve handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const client = deps.serviceClient()
    if (client instanceof Response) return client

    const refused = limitResponse(
      await consume(client, LIMITS.linkResolveIp, [clientIp(req)]),
      req,
    )
    if (refused) return refused

    const input = await readJson(req, bodySchema, MAX_BODY_BYTES)
    if (input instanceof Response) return input
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const failed = async (code: string, ids: Record<string, string> = {}) => {
      await reportError({ fn: FN, code, ids }, deps.fetch)
      return errorResponse('internal', 'Link lookup failed', 500, req)
    }

    const tokenHash = await hashToken(input.token)
    const peek = await peekSecureLink(client, tokenHash, false)
    if (!peek) return failed('peek_failed')
    if (peek.state !== 'valid') {
      return linkGoneResponse(LINK_STATE_CODE[peek.state], req)
    }
    const ids = { link_id: peek.link_id }
    if (!peek.resolve_rpc) return failed('purpose_without_resolve', ids)

    const gate = await requireModuleForOrg(client, peek.org_id, peek.module_key)
    if (gate) {
      return gate.status === 403
        ? linkGoneResponse('link_invalid', req)
        : failed('module_check_failed', ids)
    }

    // Past the gate only: the link is marked opened.
    const opened = await peekSecureLink(client, tokenHash, true)
    if (!opened) return failed('peek_failed', ids)
    if (opened.state !== 'valid') {
      return linkGoneResponse(LINK_STATE_CODE[opened.state], req)
    }

    const { data, error } = await client.rpc(peek.resolve_rpc, {
      p_link_id: peek.link_id,
    })
    if (error) return failed('resolve_failed', ids)
    if (data === null) return linkGoneResponse('link_invalid', req)
    if (typeof data !== 'object' || Array.isArray(data)) {
      return failed('resolve_invalid', ids)
    }
    return jsonResponse({ purpose: peek.purpose, display: data }, 200, req)
  }
}
