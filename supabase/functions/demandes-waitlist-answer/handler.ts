/**
 * `demandes-waitlist-answer` (Demandes D3, D-17): the answer to the « still
 * waiting? » email, from `/liste-attente/reponse#t=…`. A public token
 * function (CLAUDE.md §7, `verify_jwt = false`): no user; the hashed,
 * single-use token is the credential, and the org and module come from the
 * link row (the database looks it up by its hash).
 *
 * 1. CORS; `POST` only; body `{ token, answer: 'stay' | 'leave' }` (Zod,
 *    64 KB cap; never echoed).
 * 2. One hit per IP first (`LIMITS.waitlistAnswerIp`), before any lookup.
 * 3. A malformed token → 410 `link_invalid`, like an unknown one.
 * 4. `answer_waitlist_followup_for_service` (one use): `stay` keeps the person
 *    on the list (no call needed), `leave` takes her off it and tells the
 *    counselors → 200 `{ state }`; an unknown, used, expired or revoked link,
 *    or a closed entry → 410 `link_invalid`.
 *
 * The page shows the clinic and the list first through `resolve-link`
 * (purpose `waitlist_followup`). Nothing logs or reports a token.
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

const FN = 'demandes-waitlist-answer'

const bodySchema = z.strictObject({
  token: z.unknown(),
  answer: z.enum(['stay', 'leave']),
})

const answeredSchema = z.object({
  state: z.enum(['stay', 'leave', 'invalid']),
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
      await consume(service, LIMITS.waitlistAnswerIp, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    if (!isWellFormedToken(input.token)) {
      return linkGoneResponse('link_invalid', req)
    }

    const { data, error } = await service.rpc(
      'answer_waitlist_followup_for_service',
      { p_token_hash: await hashToken(input.token), p_answer: input.answer },
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
    const res = jsonResponse({ state: answered.data.state }, 200, req)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
}
