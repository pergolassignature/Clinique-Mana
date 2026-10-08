/**
 * `places` (P4-220): Google Places address suggestions and the chosen
 * place's address, for every address field of the app (`AddressAutocomplete`,
 * `src/core/address/`). The Google key stays here: the browser only ever sees
 * suggestions and an address.
 *
 * 1. CORS (`ALLOWED_ORIGINS`); `POST` only; `verifyAuth` (any active profile:
 *    staff, and providers for their own questionnaire). No module gate: the
 *    service is core's.
 * 2. Body (≤ 2 KB, strict), one of:
 *    - `{ action: 'autocomplete', input, session }`: `input` is the typed
 *      text, 3–200 characters once trimmed, no control characters;
 *    - `{ action: 'details', place_id, session }`: a place id from a
 *      suggestion (`PLACE_ID`).
 *    `session` is the client's session token (`SESSION_TOKEN`: a UUID v4
 *    from the browser), the same for a field's autocompletes and the one
 *    details call that ends them, so Google bills them as one session.
 * 3. `GOOGLE_PLACES_API_KEY` unset → 503 `not_configured`: the field then
 *    works as a plain input (reported `places_key_missing`, at most once per
 *    5 minutes per isolate like every code, except on a dev machine, where
 *    no key is the normal case).
 * 4. One hit on `LIMITS.placesUser` (600 an hour per caller), then one on
 *    `LIMITS.placesOrg` (3,000 an hour per org): either refused → 429; the
 *    limiter down → 503 (fails closed).
 * 5. The Google call (`google.ts`: 5 s timeout, the caller's disconnect
 *    stops it). Answers `{ suggestions: [{ place_id, main_text,
 *    secondary_text }] }` (at most 5) or `{ address: { line1, line2, city,
 *    province, postal_code, country } }` (`address.ts`).
 *
 * Privacy: nothing logs, reports or stores the typed text, a place id or an
 * address. Reports carry the org id and our failure code only, at most once
 * per code every 5 minutes per isolate (a failing key would otherwise report
 * every keystroke). Google's error bodies are never read.
 *
 * Locally, `GOOGLE_PLACES_BASE_URL` points the calls at the fake
 * (`npm run fake:places`); it is honoured only when `APP_URL` is a local
 * http URL, so a stray value on staging cannot send the key elsewhere.
 *
 * Status mapping: 200; 400 `invalid_request` (body); 401 / 403 / 503 from
 * `verifyAuth`; 404 `not_found` (Google does not know the place id); 405; 413;
 * 429 `rate_limited` with `Retry-After`; 502 `provider_error` (Google
 * unreachable, slow, over quota, refusing an argument, or answering nonsense;
 * reported); 503 `not_configured` (no key, Google refusing the key (reported),
 * or the limiter is down).
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  isLocalAppUrl,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  autocomplete,
  details,
  GOOGLE_PLACES_ORIGIN,
  PLACE_ID,
  PlacesError,
  SESSION_TOKEN,
} from './google.ts'

const FN = 'places'

/** A body is a few hundred bytes; anything bigger is not the app. */
const MAX_BODY_BYTES = 2_048

/** The same failure is reported at most once per this window, per isolate. */
export const REPORT_EVERY_MS = 5 * 60_000

// deno-lint-ignore no-control-regex -- refusing control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

const session = z.string().regex(SESSION_TOKEN)

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('autocomplete'),
    input: z.string().trim().min(3).max(200).refine((v) =>
      !CONTROL_CHARS.test(v)
    ),
    session,
  }),
  z.strictObject({
    action: z.literal('details'),
    place_id: z.string().regex(PLACE_ID),
    session,
  }),
])

const lastReported = new Map<string, number>()

/** Tests only: every code may be reported again. */
export function resetPlacesReportsForTests(): void {
  lastReported.clear()
}

/** Where the calls go: Google, or the local fake on a dev machine; `ignored` for a fake address elsewhere or a malformed one. */
function placesOrigin(deps: Deps): { origin: string } | { ignored: true } {
  const override = deps.env('GOOGLE_PLACES_BASE_URL')?.trim()
  if (!override) return { origin: GOOGLE_PLACES_ORIGIN }
  if (!isLocalAppUrl(deps.env('APP_URL'))) return { ignored: true }
  try {
    const url = new URL(override)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { origin: url.origin }
    }
  } catch {
    // falls through
  }
  return { ignored: true }
}

/** Test seams: a shorter Google timeout. */
export interface HandlerOptions {
  timeoutMs?: number
}

/** The places handler; see the module comment. */
export function createHandler(
  deps: Deps,
  handlerOptions: HandlerOptions = {},
): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {}, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema, MAX_BODY_BYTES)
    if (input instanceof Response) return input

    const orgId = auth.access.org_id
    /** Reports `code` unless it was reported in the last `REPORT_EVERY_MS`. */
    const report = async (code: string) => {
      const now = deps.now().getTime()
      const last = lastReported.get(code)
      if (last !== undefined && now - last < REPORT_EVERY_MS) return
      lastReported.set(code, now)
      await reportError({ fn: FN, code, ids: { org_id: orgId } }, deps.fetch)
    }
    const notConfigured = () =>
      errorResponse(
        'not_configured',
        'Address suggestions are not configured',
        503,
        req,
      )

    const key = deps.env('GOOGLE_PLACES_API_KEY')?.trim()
    if (!key) {
      if (!isLocalAppUrl(deps.env('APP_URL'))) {
        await report('places_key_missing')
      }
      return notConfigured()
    }
    const target = placesOrigin(deps)
    if ('ignored' in target) {
      // A fake's address outside a dev machine: never send the key there.
      await report('places_base_url_ignored')
      return notConfigured()
    }

    const service = deps.serviceClient()
    if (service instanceof Response) return service
    const limited = limitResponse(
      await consume(service, LIMITS.placesUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited
    // The clinic's ceiling, whoever types (after the caller's own limit).
    const orgLimited = limitResponse(
      await consume(service, LIMITS.placesOrg, [orgId]),
      req,
    )
    if (orgLimited) return orgLimited

    const options = {
      fetch: deps.fetch,
      key,
      origin: target.origin,
      signal: req.signal,
      timeoutMs: handlerOptions.timeoutMs,
    }
    try {
      if (input.action === 'autocomplete') {
        const suggestions = await autocomplete(
          input.input,
          input.session,
          options,
        )
        return jsonResponse({ suggestions }, 200, req)
      }
      const address = await details(input.place_id, input.session, options)
      return jsonResponse({ address }, 200, req)
    } catch (error) {
      const code = error instanceof PlacesError ? error.code : 'places_failed'
      if (code === 'places_not_found') {
        return errorResponse('not_found', 'Place not found', 404, req)
      }
      // The caller left (typing went on): nobody reads the answer, nothing to report.
      if (req.signal.aborted) {
        return errorResponse('provider_error', 'Request aborted', 502, req)
      }
      await report(code)
      if (code === 'places_key_rejected') return notConfigured()
      return errorResponse(
        'provider_error',
        'Address suggestions are unavailable',
        502,
        req,
      )
    }
  }
}
