/**
 * `appointments-confirm` (Rendez-vous R4, R-39): « Confirmer ma présence »,
 * from `/rendez-vous/confirmer#t=…` (the link of a confirmation, reminder or
 * change email). A public token function (CLAUDE.md §7, `verify_jwt = false`):
 * no user; the hashed, single-use token is the credential, and the org and
 * module come from the link row (the database looks it up by its hash).
 *
 * 1. CORS; `POST` only; body `{ token }` (Zod, 64 KB cap; never echoed).
 * 2. One hit per IP first (`LIMITS.appointmentConfirmIp`), before any lookup.
 * 3. A malformed token → 410 `link_invalid`, like an unknown one.
 * 4. `confirm_appointment_by_link_for_service` (one use): the appointment
 *    `confirmed` and the client's row → 200 `{ state: 'confirmed' }`; an
 *    unknown, used, expired or revoked link, a module turned off, or an
 *    appointment cancelled or past → 410 `link_invalid`.
 *
 * The page shows the appointment first through `resolve-link` (purpose
 * `appointment_confirm`). Nothing logs or reports a token.
 */
import { z } from 'zod'
import { errorResponse, handleCors, jsonResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import {
  hashToken,
  isWellFormedToken,
  linkGoneResponse,
} from '../_shared/links.ts'
import {
  clientIp,
  consume,
  limitResponse,
  LIMITS,
} from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'appointments-confirm'

const bodySchema = z.strictObject({ token: z.unknown() })

const confirmedSchema = z.object({
  state: z.enum(['confirmed', 'invalid']),
})

/** The handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const byIp = limitResponse(
      await consume(service, LIMITS.appointmentConfirmIp, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const { data, error } = await service.rpc(
      'confirm_appointment_by_link_for_service',
      { p_token_hash: await hashToken(input.token) },
    )
    if (error) {
      await reportError({ fn: FN, code: 'confirm_failed', ids: {} }, deps.fetch)
      return rpcErrorResponse(error, req)
    }
    const confirmed = confirmedSchema.safeParse(data)
    if (!confirmed.success) {
      await reportError(
        { fn: FN, code: 'confirm_invalid', ids: {} },
        deps.fetch,
      )
      return errorResponse('internal', 'Confirmation failed', 500, req)
    }
    if (confirmed.data.state === 'invalid') {
      return linkGoneResponse('link_invalid', req)
    }
    const res = jsonResponse({ state: 'confirmed' }, 200, req)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
}
