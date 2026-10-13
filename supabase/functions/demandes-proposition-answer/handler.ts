/**
 * `demandes-proposition-answer` (Demandes D3b, D-22): the person's answer to a
 * proposal, from `/proposition#t=…`. A public token function (CLAUDE.md §7,
 * `verify_jwt = false`): no user; the hashed, single-use token is the
 * credential, and the org and modules come from the link row.
 *
 * 1. CORS; `POST` only; body `{ token, appointment_id }` (accept that slot) or
 *    `{ token, decline: true, reason? }` (Zod, 64 KB cap; never echoed).
 * 2. One hit per IP first (`LIMITS.propositionAnswerIp`), before any lookup.
 * 3. A malformed token → 410 `link_invalid`, like an unknown one.
 * 4. `answer_proposition_for_service`: `accepted` (the slot booked by
 *    Rendez-vous, the others freed, the request matched) → 200 `{ state,
 *    starts_at }`; `declined` → 200 `{ state }`; `unavailable` (the slot no
 *    longer possible: R1b's HINT `hold_gone`, `hold_expired`, `overlap`,
 *    `outside_availability`, `balance_due`, …) → 200 `{ state, reason }`, the
 *    link still usable for another slot; `invalid` → 410 `link_invalid`.
 *
 * The page shows the proposal first through `resolve-link` (purpose
 * `proposition`). Nothing logs or reports a token.
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

const FN = 'demandes-proposition-answer'

const bodySchema = z.union([
  z.strictObject({ token: z.unknown(), appointment_id: z.guid() }),
  z.strictObject({
    token: z.unknown(),
    decline: z.literal(true),
    reason: z.enum(['schedule', 'fee', 'professional', 'changed_mind', 'other'])
      .optional(),
  }),
])

const answeredSchema = z.object({
  state: z.enum(['accepted', 'declined', 'unavailable', 'invalid']),
  starts_at: z.string().optional(),
  reason: z.string().max(64).optional(),
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
      await consume(service, LIMITS.propositionAnswerIp, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const { data, error } = await service.rpc(
      'answer_proposition_for_service',
      {
        p_token_hash: await hashToken(input.token),
        p_appointment_id: 'appointment_id' in input
          ? input.appointment_id
          : null,
        p_decline_reason: 'decline' in input ? input.reason ?? null : null,
      },
    )
    if (error) {
      await reportError({ fn: FN, code: 'answer_failed', ids: {} }, deps.fetch)
      return rpcErrorResponse(error, req)
    }
    const answered = answeredSchema.safeParse(data)
    if (!answered.success) {
      await reportError({ fn: FN, code: 'answer_invalid', ids: {} }, deps.fetch)
      return errorResponse('internal', 'Answer failed', 500, req)
    }
    if (answered.data.state === 'invalid') {
      return linkGoneResponse('link_invalid', req)
    }
    const res = jsonResponse(answered.data, 200, req)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
}
