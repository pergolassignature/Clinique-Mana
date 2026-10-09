/**
 * `signing-webhook` (design §6.3, Task 3.33): Documenso events → signature
 * requests. Not browser-facing: no CORS, `webhookResponse` only.
 *
 * 1. `POST` only (405); the org from `?org=` (a uuid, else 400): each
 *    clinic has its own Documenso instance and secret.
 * 2. `X-Documenso-Secret` present (else 401, before any read).
 * 2b. One hit on `LIMITS.documensoWebhookIp` for the caller's IP (`clientIp`), before
 *    the secret is read: anyone can post here, and each post would otherwise
 *    decrypt a Vault secret. Refused → 429 with `Retry-After` (Documenso
 *    retries); the limiter down → 503 (fail closed, reported by `consume`).
 * 3. `get_org_secret(org, 'documenso_webhook_secret')`: none → 401 (fail
 *    closed; a console line with the org id, no report: anyone can post
 *    here); a read error → 500.
 * 4. `timingSafeEqual(header, secret)` → 401 on mismatch (PS Hub compares
 *    with `!==`: fixed).
 * 5. The raw body at most 256 KB (413), UTF-8 JSON `{ event, createdAt?,
 *    payload: { envelopeId?, externalId?, status?, updatedAt?, completedAt?,
 *    recipients? } }` (else 400). Recipients are read for their id and
 *    statuses only: their addresses, names and tokens are never kept. The
 *    legacy numeric `payload.id` and `payload.Recipient` are ignored (E-4).
 * 6. The event name in Documenso's raw form (`document.completed`, PS Hub's
 *    form, becomes `DOCUMENT_COMPLETED`).
 * 6b. **No `externalId` that is a request id → 200 `{ outcome: 'ignored' }`,
 *    before the claim:** an envelope this app did not create (sent from
 *    Documenso's own screens), acked with no report and no row. Documenso
 *    ids are per instance, so a request is only ever found by its own id,
 *    never by envelope id alone (an org that changed instance could see
 *    another envelope under the same id).
 * 6c. Then `payload.envelopeId` is required and must be an envelope id
 *    (`isEnvelopeId`), else 400.
 * 7. `claimEvent('documenso', documensoEventId(org, event, envelope id,
 *    isoTime(createdAt) ?? isoTime(updatedAt)))` with `{ event, envelope_id,
 *    external_id }`: `duplicate` → 200, `in_progress` → 409, an RPC error →
 *    500. A terminal event has no version, so a replay is a duplicate
 *    whatever its time; the org is in the id, since two clinics' instances
 *    may give two envelopes one id. The version is ISO-normalised (24
 *    characters), which bounds the id at 200 (`documensoEventId`).
 * 8. `apply_signing_event` for what the event says (`webhookEvents`), the
 *    row found by `externalId` (our request id) in the hinted org only; a
 *    sent request whose recorded envelope is another one is `not_found`.
 *    The module gate is in the same RPC (`ignored` for a disabled module,
 *    like a terminal request).
 *    - `needs_download` → the signed PDF is stored (`storeSignedPdf`: the
 *      org's Documenso, the request's view permission) → 200 `signed`;
 *    - `retry` (a draft whose send is under way, or failed part way) →
 *      `failEvent('signing_retry')` and 409, so Documenso retries later;
 *    - `not_found` → 200, reported (a retry cannot find it either). A late
 *      event of an envelope a re-send superseded is `ignored`, not reported;
 *    - `DOCUMENT_COMPLETED` `ignored` for a request closed here (expired,
 *      cancelled, or an abandoned draft) → 200, reported
 *      `signing_completed_after_close` (ids only): the contract is signed at
 *      Documenso after the clinic closed it, which a person must look at;
 *    - `applied` / `ignored` → 200. An event the database does not track
 *      (`DOCUMENT_SENT`, `DOCUMENT_CREATED`) applies nothing: 200 `ignored`.
 * 9. `completeEvent`. A failure after the claim → `failEvent(code)` and 500
 *    (reported), so the next delivery retries the event.
 *
 * Status codes: 200 `{ outcome }` (`signed`, `applied`, `ignored`,
 * `not_found`, `duplicate`); 400 bad org or payload; 401 no header, no
 * secret, wrong secret; 405; 409 in progress or retry; 413; 429; 500; 503.
 * Reports carry the org, webhook-event, request and envelope ids only.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { documensoEventId, isEnvelopeId } from '../_shared/documenso.ts'
import { readCapped } from '../_shared/http.ts'
import { UUID } from '../_shared/patterns.ts'
import { clientIp, consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import {
  applyEvents,
  documensoReach,
  getSigningRequest,
  normaliseEventName,
  orgSigning,
  SigningFailure,
  storeSignedPdf,
  webhookEvents,
} from '../_shared/signing-events.ts'
import { timingSafeEqual } from '../_shared/timing-safe-equal.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'

const FN = 'signing-webhook'
/** Design §6.3. */
const MAX_BODY_BYTES = 256 * 1024
const SAFE_CODE = /^[a-z0-9_]{1,64}$/

const text = (max: number) => z.string().max(max).nullish()

/** The fields read from a webhook; everything else is ignored. */
const webhookSchema = z.object({
  event: z.string().min(1).max(100),
  createdAt: text(64),
  payload: z.object({
    // Any value: `isEnvelopeId` decides, after the `externalId` check (6c).
    envelopeId: z.unknown().optional(),
    externalId: text(200),
    status: z.string().max(32).optional(),
    updatedAt: text(64),
    completedAt: text(64),
    recipients: z.array(z.object({
      id: z.number().int().positive(),
      readStatus: z.string().max(32).optional(),
      signingStatus: z.string().max(32).optional(),
      signedAt: text(64),
      rejectionReason: text(2000),
    })).max(20).optional(),
  }),
})

/**
 * An ISO time of a four-digit year (24 characters), or null (the database
 * then uses now; a claim id then says `unversioned`).
 */
function isoTime(value: string | null | undefined): string | null {
  const at = value ? Date.parse(value) : NaN
  const iso = Number.isFinite(at) ? new Date(at).toISOString() : null
  return iso?.length === 24 ? iso : null
}

/** Options for tests: the comparison is observable. */
export interface WebhookOptions {
  timingSafeEqual?: (a: string, b: string) => boolean
}

/** The webhook handler; see the module comment. */
export function createHandler(
  deps: Deps,
  options: WebhookOptions = {},
): (req: Request) => Promise<Response> {
  const compare = options.timingSafeEqual ?? timingSafeEqual
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const orgId = new URL(req.url).searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const provided = req.headers.get('X-Documenso-Secret')
    if (!provided) return webhookResponse(401)

    const client = deps.serviceClient()
    if (client instanceof Response) return webhookResponse(500)
    const limit = await consume(client, LIMITS.documensoWebhookIp, [
      clientIp(req),
    ])
    if (!limit.allowed) {
      if (limit.reason === 'unavailable') return webhookResponse(503)
      const res = webhookResponse(429)
      res.headers.set('Retry-After', String(limit.retryAfter))
      return res
    }
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: 'documenso_webhook_secret',
    })
    if (secret.error) {
      await report('documenso_webhook_secret_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      console.warn(
        JSON.stringify({
          fn: FN,
          code: 'documenso_webhook_secret_missing',
          ids,
        }),
      )
      return webhookResponse(401)
    }
    if (!compare(provided, secret.data)) return webhookResponse(401)

    const bytes = await readCapped(req, MAX_BODY_BYTES)
    if (bytes === null) return webhookResponse(413)
    let parsed: z.infer<typeof webhookSchema>
    try {
      const result = webhookSchema.safeParse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      )
      if (!result.success) return webhookResponse(400)
      parsed = result.data
    } catch {
      return webhookResponse(400)
    }
    const event = normaliseEventName(parsed.event)
    if (!event) return webhookResponse(400)
    const externalId = parsed.payload.externalId ?? ''
    if (!UUID.test(externalId)) {
      return webhookResponse(200, { outcome: 'ignored' })
    }
    const envelopeId = parsed.payload.envelopeId
    if (!isEnvelopeId(envelopeId)) return webhookResponse(400)
    const requestId = externalId.toLowerCase()
    ids.envelope_id = envelopeId

    let claim
    try {
      claim = await claimEvent(client, {
        provider: 'documenso',
        eventId: documensoEventId(
          orgId.toLowerCase(),
          event,
          envelopeId,
          isoTime(parsed.createdAt) ?? isoTime(parsed.payload.updatedAt),
        ),
        orgId,
        eventType: event,
        payload: { event, envelope_id: envelopeId, external_id: requestId },
      })
    } catch {
      await report('webhook_claim_failed')
      return webhookResponse(500)
    }
    if (claim.status === 'duplicate') {
      return webhookResponse(200, { outcome: 'duplicate' })
    }
    if (claim.status === 'in_progress') return webhookResponse(409)
    ids.webhook_event_id = claim.id

    try {
      const snapshot = {
        status: parsed.payload.status,
        completedAt: isoTime(parsed.payload.completedAt),
        recipients: (parsed.payload.recipients ?? []).map((r) => ({
          ...r,
          id: String(r.id),
          signedAt: isoTime(r.signedAt),
        })),
      }
      const applied = await applyEvents(
        client,
        orgId,
        { requestId, envelopeId },
        webhookEvents(event, snapshot, isoTime(parsed.createdAt)),
      )
      if (applied.requestId) ids.signature_request_id = applied.requestId
      if (applied.outcome === 'retry') {
        await failEvent(client, claim.id, claim.token, 'signing_retry')
        return webhookResponse(409)
      }
      let outcome: string = applied.outcome
      if (applied.outcome === 'not_found') {
        await report('signing_event_not_found')
      } else if (
        event === 'DOCUMENT_COMPLETED' && applied.outcome === 'ignored' &&
        applied.requestId
      ) {
        const request = await getSigningRequest(
          client,
          orgId,
          applied.requestId,
        )
        if (
          request &&
          (['expired', 'cancelled'].includes(request.status) ||
            (request.status === 'draft' &&
              request.last_error === 'abandoned'))
        ) {
          await report('signing_completed_after_close')
        }
      } else if (applied.needsDownload) {
        const [signing, request] = await Promise.all([
          orgSigning(
            client,
            orgId,
            deps.fetch,
            documensoReach(deps),
            req.signal,
          ),
          getSigningRequest(client, orgId, applied.requestId!),
        ])
        if (!signing) throw new SigningFailure('not_configured')
        if (!request) throw new SigningFailure('request_not_found')
        await storeSignedPdf(client, signing.documenso, orgId, {
          id: request.id,
          envelopeId,
          viewPermission: request.view_permission,
          title: request.title,
        })
        outcome = 'signed'
      }
      await completeEvent(client, claim.id, claim.token)
      return webhookResponse(200, { outcome })
    } catch (error) {
      const raw = (error as { code?: unknown }).code
      const code = typeof raw === 'string' && SAFE_CODE.test(raw)
        ? raw
        : 'signing_webhook_failed'
      await report(code)
      await failEvent(client, claim.id, claim.token, code).catch(() => false)
      return webhookResponse(500)
    }
  }
}
