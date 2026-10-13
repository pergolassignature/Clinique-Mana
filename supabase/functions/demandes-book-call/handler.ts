/**
 * `demandes-book-call` (Demandes D3c, R-74): the public discovery-call booking
 * page (`/appel-decouverte?clinique=<org>`) that replaces Calendly. A public
 * function (CLAUDE.md §7, `verify_jwt = false`): no user. The clinic comes
 * from the page's address, as a webhook's `?org=` names it; the database
 * checks it exists and is open, and an unknown or closed clinic reads the same
 * (`open: false`).
 *
 * 1. CORS; `POST` only; body by `action` (Zod, 64 KB cap; never echoed).
 * 2. One hit per IP first, on the action's bucket (`LIMITS.bookingPageIp`,
 *    `bookingIp`, `bookingCancelIp`), before any read or write.
 * 3. `page` {org}: `demandes_booking_page_for_service` → the clinic, the
 *    free slots, the « Comment avez-vous entendu parler de MANA ? » list, and
 *    a **proof-of-work check** (D-7): a signed, 10-minute ticket
 *    (`_shared/oauth-state.ts`, purpose `booking_pow`) the page solves by
 *    finding `n` such that SHA-256(`<ticket>:<n>`) starts with `POW_BITS`
 *    zero bits (well under a second in a browser; nothing for Jonathan to
 *    create, no third-party script). Closed → `{ open: false }`.
 * 4. `book` {org, ticket, nonce, the person, the slot, the source}: the
 *    ticket's signature, expiry, clinic and work, then its single use
 *    (`LIMITS.bookingChallenge` on its nonce), then
 *    `book_discovery_call_for_service` with the hash of a fresh cancel-link
 *    token (the actor model: the token exists only here and in the email).
 *    The confirmation (`demandes.discovery_call_booked` / `_en`) carries the
 *    cancel link `/appel-decouverte/annuler#t=…`. 200 `{ starts_at,
 *    timezone, emailed }`. A refusal (slot taken, already booked, a field,
 *    closed: P3-40) is the database's French sentence, 400 `refusal: true`.
 * 5. `cancel` {token}: a malformed token → 410 `link_invalid` before any
 *    read; `cancel_discovery_call_for_service` (one use) → 200
 *    `{ state: 'cancelled' }` or 410 `link_invalid`. The page shows the call
 *    first through `resolve-link` (purpose `discovery_call`).
 *
 * Nothing logs or reports a name, an address, a phone, a source or a token:
 * reports carry the org and the request ids.
 */
import { z } from 'zod'
import { errorResponse, handleCors, jsonResponse } from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { isExpectedRpcError, rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import {
  generateToken,
  hashToken,
  isWellFormedToken,
  linkGoneResponse,
  linkUrl,
} from '../_shared/links.ts'
import { signState, verifyState } from '../_shared/oauth-state.ts'
import { UUID } from '../_shared/patterns.ts'
import {
  clientIp,
  consume,
  limitResponse,
  LIMITS,
} from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'demandes-book-call'
export const POW_PURPOSE = 'booking_pow'
/** The work asked of the page: 16 leading zero bits (about 65 000 hashes on average). */
export const POW_BITS = 16

const text = (max: number) => z.string().max(max)
const sourceSchema = z.object({
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
  referrer: text(500).optional(),
  landing: text(500).optional(),
}).optional()

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('page'), org: z.string().regex(UUID) }),
  z.strictObject({
    action: z.literal('book'),
    org: z.string().regex(UUID),
    ticket: text(2_048),
    nonce: z.string().regex(/^[0-9]{1,12}$/),
    starts_at: text(40),
    first_name: text(100),
    last_name: text(100),
    email: text(254),
    phone_e164: text(20),
    language: z.enum(['fr', 'en']),
    message: text(1_000).optional(),
    referral_source_id: z.string().regex(UUID).nullable().optional(),
    source: sourceSchema,
  }),
  z.strictObject({ action: z.literal('cancel'), token: z.unknown() }),
])

const pageSchema = z.object({
  open: z.boolean(),
  clinic_name: z.string().optional(),
  timezone: z.string().optional(),
  slot_minutes: z.number().optional(),
  slots: z.array(z.string()).optional(),
  referral_sources: z.array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
})

const bookedSchema = z.object({
  demande_id: z.string(),
  task_id: z.string(),
  starts_at: z.string(),
  timezone: z.string(),
  clinic_name: z.string(),
  language: z.enum(['fr', 'en']),
  first_name: z.string(),
  email: z.string(),
})

const encoder = new TextEncoder()

/** The number of leading zero bits of SHA-256(`<ticket>:<nonce>`). */
export async function leadingZeroBits(
  ticket: string,
  nonce: string,
): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(`${ticket}:${nonce}`)),
  )
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

const noStore = (body: unknown, req: Request): Response => {
  const res = jsonResponse(body, 200, req)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** The handler; see the module comment. `powBits` lowers the work in tests only. */
export function createHandler(
  deps: Deps,
  { powBits = POW_BITS }: { powBits?: number } = {},
): (req: Request) => Promise<Response> {
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

    const bucket = input.action === 'page'
      ? LIMITS.bookingPageIp
      : input.action === 'book'
      ? LIMITS.bookingIp
      : LIMITS.bookingCancelIp
    const byIp = limitResponse(
      await consume(service, bucket, [clientIp(req)]),
      req,
    )
    if (byIp) return byIp
    const secret = deps.env('INTERNAL_FUNCTION_SECRET')
    if (!secret) {
      await reportError({ fn: FN, code: 'secret_missing', ids: {} }, deps.fetch)
      return errorResponse('not_configured', 'Not configured', 503, req)
    }

    if (input.action === 'cancel') {
      if (!isWellFormedToken(input.token)) {
        return linkGoneResponse('link_invalid', req)
      }
      const { data, error } = await service.rpc(
        'cancel_discovery_call_for_service',
        { p_token_hash: await hashToken(input.token) },
      )
      if (error) {
        await reportError(
          { fn: FN, code: 'cancel_failed', ids: {} },
          deps.fetch,
        )
        return rpcErrorResponse(error, req)
      }
      if ((data as { state?: string } | null)?.state !== 'cancelled') {
        return linkGoneResponse('link_invalid', req)
      }
      return noStore({ state: 'cancelled' }, req)
    }

    const orgId = input.org
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError({ fn: FN, code, ids: { org_id: orgId, ...ids } }, deps.fetch)

    if (input.action === 'page') {
      const { data, error } = await service.rpc(
        'demandes_booking_page_for_service',
        { p_org_id: orgId },
      )
      if (error) {
        await report('page_failed')
        return rpcErrorResponse(error, req)
      }
      const page = pageSchema.safeParse(data)
      if (!page.success) {
        await report('page_invalid')
        return errorResponse('internal', 'Booking page failed', 500, req)
      }
      if (!page.data.open) return noStore({ open: false }, req)
      const { state } = await signState(secret, {
        purpose: POW_PURPOSE,
        orgId,
        userId: orgId,
        data: { bits: String(powBits) },
      }, deps.now())
      return noStore(
        { ...page.data, check: { ticket: state, bits: powBits } },
        req,
      )
    }

    // book: the check first (signature, expiry, clinic, work), then its single use.
    const verified = await verifyState(
      secret,
      input.ticket,
      POW_PURPOSE,
      deps.now(),
    )
    const bits = verified.ok ? Number(verified.state.data?.bits ?? POW_BITS) : 0
    if (
      !verified.ok || verified.state.orgId !== orgId || !(bits >= powBits) ||
      (await leadingZeroBits(input.ticket, input.nonce)) < bits
    ) {
      return errorResponse('invalid_request', 'Check failed', 400, req)
    }
    const spent = await consume(service, LIMITS.bookingChallenge, [
      verified.state.nonce,
    ])
    if (!spent.allowed) {
      return spent.reason === 'unavailable'
        ? (limitResponse(spent, req) as Response)
        : errorResponse('invalid_request', 'Check already used', 400, req)
    }

    const token = generateToken()
    const { data, error } = await service.rpc(
      'book_discovery_call_for_service',
      {
        p_org_id: orgId,
        p_payload: {
          starts_at: input.starts_at,
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email,
          phone_e164: input.phone_e164,
          language: input.language,
          message: input.message ?? null,
          referral_source_id: input.referral_source_id ?? null,
          source_utm: input.source?.utm ?? {},
          source_referrer: input.source?.referrer ?? null,
          source_landing_page: input.source?.landing ?? null,
        },
        p_token_hash: await hashToken(token),
      },
    )
    if (error) {
      if (!isExpectedRpcError(error)) await report('book_failed')
      return rpcErrorResponse(error, req)
    }
    const booked = bookedSchema.safeParse(data)
    if (!booked.success) {
      await report('book_invalid')
      return errorResponse('internal', 'Booking failed', 500, req)
    }
    const b = booked.data
    let emailed = false
    try {
      const result = await sendTemplatedEmail(
        { fn: FN, client: service, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: b.language === 'en'
            ? 'demandes.discovery_call_booked_en'
            : 'demandes.discovery_call_booked',
          to: { email: b.email, profileId: null },
          subject: { type: 'demande', id: b.demande_id },
          values: {
            person: { first_name: b.first_name },
            clinic: { name: b.clinic_name },
            call: { starts_at: b.starts_at },
          },
          actionUrl: linkUrl(
            deps.env('APP_URL') ?? '',
            '/appel-decouverte/annuler',
            token,
          ),
          sentBy: null,
        },
      )
      emailed = result.ok
    } catch {
      // sendTemplatedEmail (or linkUrl's configuration check) reported it; the booking stands.
      await report('confirmation_failed', { demande_id: b.demande_id })
    }
    return noStore(
      { starts_at: b.starts_at, timezone: b.timezone, emailed },
      req,
    )
  }
}
