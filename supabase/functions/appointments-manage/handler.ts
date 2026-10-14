/**
 * `appointments-manage` (Rendez-vous L16, AP-50): « Annuler » and « Demander
 * un changement », from `/rendez-vous/gerer#t=…` (the link of a confirmation,
 * reminder or change email while Paramètres → Agenda turns the links on). A
 * public token function (CLAUDE.md §7, `verify_jwt = false`): no user; the
 * hashed, single-use token is the credential, and the org and module come
 * from the link row (the database looks it up by its hash).
 *
 * 1. CORS; `POST` only; body `{ token, action }` (`cancel` or
 *    `change_request`; Zod, 64 KB cap; never echoed).
 * 2. One hit per IP first (`LIMITS.appointmentManageIp`), before any lookup.
 * 3. A malformed token → 410 `link_invalid`, like an unknown one.
 * 4. `manage_appointment_by_link_for_service` (one use; the module enabled and
 *    open to all, P3-40; the switch still on; the appointment still to come at
 *    the start its email announced): `cancel` → 200
 *    `{ state: 'cancelled', late }` (late: the clinic's notice was not given,
 *    a fee may follow); `change_request` → 200 `{ state: 'requested' }` (the
 *    staff call the client back); anything else → 410 `link_invalid`.
 *
 * The page shows the appointment first through `resolve-link` (purpose
 * `appointment_manage`). Nothing logs or reports a token.
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

const FN = 'appointments-manage'

const bodySchema = z.strictObject({
  token: z.unknown(),
  action: z.enum(['cancel', 'change_request']),
})

const resultSchema = z.object({
  state: z.enum(['cancelled', 'requested', 'invalid']),
  late: z.boolean().optional(),
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
      await consume(service, LIMITS.appointmentManageIp, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const { data, error } = await service.rpc(
      'manage_appointment_by_link_for_service',
      { p_token_hash: await hashToken(input.token), p_action: input.action },
    )
    if (error) {
      await reportError({ fn: FN, code: 'manage_failed', ids: {} }, deps.fetch)
      return rpcErrorResponse(error, req)
    }
    const result = resultSchema.safeParse(data)
    if (!result.success) {
      await reportError({ fn: FN, code: 'manage_invalid', ids: {} }, deps.fetch)
      return errorResponse('internal', 'Request failed', 500, req)
    }
    if (result.data.state === 'invalid') {
      return linkGoneResponse('link_invalid', req)
    }
    const res = jsonResponse(
      result.data.state === 'cancelled'
        ? { state: 'cancelled', late: result.data.late ?? false }
        : { state: 'requested' },
      200,
      req,
    )
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
}
