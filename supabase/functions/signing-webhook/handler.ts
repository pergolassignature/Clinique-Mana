/**
 * `signing-webhook` (design §6.3, Task 3.33): Documenso events → signature
 * requests. Not browser-facing: no CORS, `webhookResponse` only.
 *
 * 1. `POST` only (405); the org from `?org=` (a uuid, else 400): each
 *    clinic has its own Documenso instance and secret.
 * 2. `X-Documenso-Secret` present (else 401, before any read).
 * 3. `get_org_secret(org, 'documenso_webhook_secret')`: none → 401 (fail
 *    closed; a console line with the org id, no report: anyone can post
 *    here); a read error → 500.
 * 4. `timingSafeEqual(header, secret)` → 401 on mismatch (PS Hub compares
 *    with `!==`: fixed).
 * 5. The raw body at most 256 KB (413), UTF-8 JSON `{ event, createdAt?,
 *    payload: { id, externalId?, status?, updatedAt?, completedAt?,
 *    recipients? } }` (else 400). Recipients are read for their id and
 *    statuses only: their addresses, names and tokens are never kept.
 * 6. The event name in Documenso's raw form (`document.completed`, PS Hub's
 *    form, becomes `DOCUMENT_COMPLETED`).
 * 7. `claimEvent('documenso', documensoEventId(event, document id,
 *    createdAt ?? updatedAt))` with `{ event, document_id, external_id }`:
 *    `duplicate` → 200, `in_progress` → 409, an RPC error → 500. A terminal
 *    event has no version, so a replay is a duplicate whatever its time.
 * 8. `apply_signing_event` for what the event says (`webhookEvents`), the
 *    row found by `externalId` (our request id), else by document id, in
 *    the hinted org only. The module gate is in the same RPC (`ignored` for
 *    a disabled module, like a terminal request).
 *    - `needs_download` → the signed PDF is stored (`storeSignedPdf`: the
 *      org's Documenso, the request's view permission) → 200 `signed`;
 *    - `retry` (a draft whose send is under way, or failed part way) →
 *      `failEvent('signing_retry')` and 409, so Documenso retries later;
 *    - `not_found` → 200, reported (a retry cannot find it either). A late
 *      event of a document a re-send superseded is `ignored`, not reported;
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
 * secret, wrong secret; 405; 409 in progress or retry; 413; 500.
 * Reports carry the org, webhook-event, request and document ids only.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { documensoEventId } from '../_shared/documenso.ts'
import { readCapped } from '../_shared/http.ts'
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Documenso document ids (`documenso.ts`). */
const DOCUMENT_ID = /^[1-9][0-9]{0,14}$/
/** Design §6.3. */
const MAX_BODY_BYTES = 256 * 1024
const SAFE_CODE = /^[a-z0-9_]{1,64}$/

const text = (max: number) => z.string().max(max).nullish()

/** The fields read from a webhook; everything else is ignored. */
const webhookSchema = z.object({
  event: z.string().min(1).max(100),
  createdAt: text(64),
  payload: z.object({
    id: z.number().int().positive(),
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

/** An ISO time, or null (the database then uses now). */
function isoTime(value: string | null | undefined): string | null {
  const at = value ? Date.parse(value) : NaN
  return Number.isFinite(at) ? new Date(at).toISOString() : null
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
    const documentId = String(parsed.payload.id)
    if (!event || !DOCUMENT_ID.test(documentId)) return webhookResponse(400)
    const externalId = parsed.payload.externalId ?? ''
    const requestId = UUID.test(externalId) ? externalId.toLowerCase() : null
    ids.document_id = documentId

    let claim
    try {
      claim = await claimEvent(client, {
        provider: 'documenso',
        eventId: documensoEventId(
          event,
          documentId,
          parsed.createdAt ?? parsed.payload.updatedAt ?? null,
        ),
        orgId,
        eventType: event,
        payload: { event, document_id: documentId, external_id: requestId },
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
        { requestId, documentId },
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
          documentId,
          viewPermission: request.view_permission,
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
