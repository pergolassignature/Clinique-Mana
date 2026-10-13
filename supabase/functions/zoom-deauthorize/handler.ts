/**
 * `zoom-deauthorize` (RZ): Zoom's event notifications for the clinic's Zoom
 * app, of which one matters: `app_deauthorized` (a professional removed the
 * app from her Zoom account). A webhook function (CLAUDE.md §7): not
 * browser-facing, no CORS, `webhookResponse` only.
 *
 * 1. `POST` only (405); the org from `?org=` (a uuid, else 400): the address
 *    saved in the clinic's Zoom app is per clinic.
 * 2. `x-zm-signature` and `x-zm-request-timestamp` present (else 401, before
 *    any read); the raw body at most 16 KB (413) and UTF-8 (400).
 * 3. One hit on `LIMITS.zoomWebhookIp` per IP before the secret is read:
 *    anyone can post here. Refused → 429 with `Retry-After`; the limiter
 *    down → 503.
 * 4. `get_org_secret(org, 'zoom_webhook_secret')`: none → 401 (fail closed;
 *    reported once per org per hour per isolate), a read error → 500.
 * 5. `verifyZoomSignature` (HMAC over `v0:<timestamp>:<body>`, constant
 *    time, 5 minutes) → 401 on mismatch, and no other RPC runs.
 * 6. `endpoint.url_validation` → 200 `{ plainToken, encryptedToken }` (Zoom
 *    checks the endpoint when it is saved).
 * 7. `app_deauthorized` with a `user_id` → `zoom_deauthorized_for_service`
 *    (idempotent: a connection already ended counts 0) → 200
 *    `{ outcome: 'ended', count }`. Any other event → 200 `skipped`.
 *
 * No module gate (the one exception to CLAUDE.md §7's rule, on purpose): a
 * deauthorization only deletes the clinic's copy of the tokens and ends the
 * connection, which must happen even while Rendez-vous is disabled.
 *
 * Nothing is claimed in `webhook_events`: the only write is idempotent.
 * Answers carry the outcome at most; reports carry the org id only.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { readCapped } from '../_shared/http.ts'
import { UUID } from '../_shared/patterns.ts'
import { clientIp, consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { createReportThrottle } from '../_shared/report-throttle.ts'
import { webhookResponse } from '../_shared/webhooks.ts'
import { SECRET_WEBHOOK } from '../_shared/zoom/env.ts'
import {
  urlValidationAnswer,
  verifyZoomSignature,
} from '../_shared/zoom/webhook.ts'

const FN = 'zoom-deauthorize'
const MAX_BODY = 16 * 1024

const eventSchema = z.looseObject({
  event: z.string().max(100),
  payload: z.looseObject({
    plainToken: z.string().min(1).max(256).optional(),
    user_id: z.string().min(1).max(64).optional(),
  }).optional(),
})

/** The webhook handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const reportMissingSecret = createReportThrottle()
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const orgId = new URL(req.url).searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const ids = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const signature = req.headers.get('x-zm-signature')
    const timestamp = req.headers.get('x-zm-request-timestamp')
    if (!signature || !timestamp) return webhookResponse(401)
    const bytes = await readCapped(req, MAX_BODY)
    if (bytes === null) return webhookResponse(413)
    let rawBody: string
    try {
      rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return webhookResponse(400)
    }

    const client = deps.serviceClient()
    if (client instanceof Response) return webhookResponse(500)
    const limit = await consume(client, LIMITS.zoomWebhookIp, [clientIp(req)])
    if (!limit.allowed) {
      if (limit.reason === 'unavailable') return webhookResponse(503)
      const res = webhookResponse(429)
      res.headers.set('Retry-After', String(limit.retryAfter))
      return res
    }
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: SECRET_WEBHOOK,
    })
    if (secret.error) {
      await report('zoom_webhook_secret_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      if (reportMissingSecret(orgId.toLowerCase(), deps.now().getTime())) {
        await report('zoom_webhook_secret_missing')
      }
      return webhookResponse(401)
    }
    if (
      !(await verifyZoomSignature(
        secret.data,
        signature,
        timestamp,
        rawBody,
        deps.now(),
      ))
    ) {
      return webhookResponse(401)
    }

    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      return webhookResponse(400)
    }
    const parsed = eventSchema.safeParse(json)
    if (!parsed.success) return webhookResponse(400)
    const { event, payload } = parsed.data

    if (event === 'endpoint.url_validation') {
      if (!payload?.plainToken) return webhookResponse(400)
      return webhookResponse(
        200,
        await urlValidationAnswer(secret.data, payload.plainToken),
      )
    }
    if (event !== 'app_deauthorized' || !payload?.user_id) {
      return webhookResponse(200, { outcome: 'skipped' })
    }
    const ended = await client.rpc('zoom_deauthorized_for_service', {
      p_org_id: orgId,
      p_external_user_id: payload.user_id,
    })
    if (ended.error || typeof ended.data !== 'number') {
      await report('zoom_deauthorize_failed')
      return webhookResponse(500)
    }
    return webhookResponse(200, { outcome: 'ended', count: ended.data })
  }
}
