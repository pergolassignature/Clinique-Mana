/**
 * `demandes-propose` (Demandes D3b, D-22): a counselor proposes a professional
 * and 1 to 3 of her free slots to the person. A user function (CLAUDE.md §7);
 * the actor model (ADR 0007): the link's token is made and hashed here and
 * travels only in the email, never to the caller.
 *
 * 1. CORS; `POST` only; body `{ demande_id, professional_id, service_id,
 *    starts_at: [1–3 ISO instants], mode: 'video' | 'phone' }` (Zod, 64 KB
 *    cap; never echoed).
 * 2. `verifyAuth` with the module `demandes` and `demandes.manage`.
 * 3. One hit on `LIMITS.propositionUser` (per caller).
 * 4. `create_proposition_for_service` (service role, `p_actor` = the verified
 *    caller, never the body): it re-checks her, refuses while Demandes is
 *    reserved for its testers (P3-40), needs Rendez-vous on, a client file
 *    and an address, holds each slot (Rendez-vous R1b, every booking rule) and
 *    issues the link (48 h). A refusal (P0001) is a 400 `refusal` with its
 *    French message; 42501 → 403.
 * 5. The email `demandes.proposition` (`_en` in English) with the slots in the
 *    clinic's time and the link `/proposition#t=…`.
 * 6. 200 `{ proposition_id, emailed, expires_at }`: a failed email leaves the
 *    proposal standing (the counselor calls, or withdraws it).
 *
 * Nothing logs or reports a name, an address or a token.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { sendTemplatedEmail } from '../_shared/email/send.ts'
import { isExpectedRpcError, rpcErrorResponse } from '../_shared/errors.ts'
import { formatEmailDateTime, isValidTimeZone } from '../_shared/format.ts'
import { readJson } from '../_shared/http.ts'
import { generateToken, hashToken, linkUrl } from '../_shared/links.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'

const FN = 'demandes-propose'

const bodySchema = z.strictObject({
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants.
  demande_id: z.guid(),
  professional_id: z.guid(),
  service_id: z.guid(),
  starts_at: z.array(z.iso.datetime({ offset: true })).min(1).max(3),
  mode: z.enum(['video', 'phone']),
})

const createdSchema = z.object({
  proposition_id: z.string(),
  demande_id: z.string(),
  email: z.string(),
  first_name: z.string(),
  language: z.enum(['fr', 'en']),
  clinic_name: z.string(),
  timezone: z.string(),
  professional_name: z.string().nullable(),
  service_name: z.string().nullable(),
  slots: z.array(z.object({ starts_at: z.string() })).min(1).max(3),
  expires_at: z.string(),
})

/** One instant in the clinic's time: « lundi 15 mars 2027 à 9 h », or « Monday, March 15 at 9:00 a.m. ». */
export function instantText(
  iso: string,
  timeZone: string,
  language: 'fr' | 'en',
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'America/Toronto'
  if (language === 'en') {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  }
  const weekday = new Intl.DateTimeFormat('fr-CA', {
    timeZone: zone,
    weekday: 'long',
  })
    .format(new Date(iso))
  return `${weekday} ${formatEmailDateTime(iso, zone)}`
}

/** The slots as lines of the email, in the clinic's time and the person's language. */
export function slotLines(
  starts: string[],
  timeZone: string,
  language: 'fr' | 'en',
): string {
  return [...starts].sort().map((s) =>
    `• ${instantText(s, timeZone, language)}`
  )
    .join('\n')
}

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
    const auth = await verifyAuth(
      req,
      { module: 'demandes', permission: 'demandes.manage' },
      deps.userClient,
    )
    if (auth instanceof Response) return auth
    const client = deps.serviceClient()
    if (client instanceof Response) return client
    const { org_id: orgId, user_id: actor } = auth.access
    const report = (code: string, ids: Record<string, string> = {}) =>
      reportError(
        {
          fn: FN,
          code,
          ids: { org_id: orgId, demande_id: input.demande_id, ...ids },
        },
        deps.fetch,
      )

    const limited = limitResponse(
      await consume(client, LIMITS.propositionUser, [orgId, actor]),
      req,
    )
    if (limited) return limited

    const token = generateToken()
    const { data, error } = await client.rpc('create_proposition_for_service', {
      p_actor: actor,
      p_demande_id: input.demande_id,
      p_professional_id: input.professional_id,
      p_service_id: input.service_id,
      p_starts_at: input.starts_at,
      p_mode: input.mode,
      p_token_hash: await hashToken(token),
    })
    if (error) {
      if (!isExpectedRpcError(error)) await report('create_failed')
      return rpcErrorResponse(error, req)
    }
    const created = createdSchema.safeParse(data)
    if (!created.success) {
      await report('create_invalid')
      return errorResponse('internal', 'Proposal failed', 500, req)
    }
    const c = created.data
    let emailed = false
    try {
      const result = await sendTemplatedEmail(
        { fn: FN, client, env: deps.env, fetch: deps.fetch },
        {
          orgId,
          templateKey: c.language === 'en'
            ? 'demandes.proposition_en'
            : 'demandes.proposition',
          to: { email: c.email, profileId: null },
          subject: { type: 'demande', id: c.demande_id },
          values: {
            person: { first_name: c.first_name },
            clinic: { name: c.clinic_name },
            professional: { name: c.professional_name ?? '' },
            proposal: {
              service: c.service_name ?? '',
              slots: slotLines(
                c.slots.map((s) => s.starts_at),
                c.timezone,
                c.language,
              ),
              // French: the template's datetime (« 16 octobre 2026 à 9 h »); English: written here.
              expires_at: c.language === 'en'
                ? instantText(c.expires_at, c.timezone, 'en')
                : c.expires_at,
            },
          },
          actionUrl: linkUrl(deps.env('APP_URL') ?? '', '/proposition', token),
          sentBy: actor,
        },
      )
      emailed = result.ok
    } catch {
      // sendTemplatedEmail (or linkUrl's configuration check) reported it; the proposal stands.
      await report('email_failed', { proposition_id: c.proposition_id })
    }
    return jsonResponse(
      { proposition_id: c.proposition_id, emailed, expires_at: c.expires_at },
      200,
      req,
    )
  }
}
