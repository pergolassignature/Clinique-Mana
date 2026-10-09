/**
 * `resend-webhook` (Task 3.10): Resend delivery events → `email_log` status.
 * Not browser-facing: no CORS, `webhookResponse` only.
 *
 * 1. `POST` only (405); the org from `?org=` (a uuid, else 400). The URL is
 *    per clinic because each clinic has its own Resend account and secret.
 * 2. The three Svix headers must be present (else 401, before any read), and
 *    the raw body at most 64 KB (413) and UTF-8 (400).
 * 2b. One hit on `LIMITS.resendWebhookIp` for the caller's IP (`clientIp`),
 *    before the secret is read: anyone can post here, and each post would
 *    otherwise decrypt a Vault secret. Refused → 429 with `Retry-After`
 *    (Resend retries); the limiter down → 503 (fail closed, reported by
 *    `consume`).
 * 3. `get_org_secret(org, 'resend_webhook_secret')`: none → 401 (fail
 *    closed); a read error → 500. An unknown or unconfigured org would
 *    otherwise report on every delivery (Resend retries, anyone can post),
 *    so `resend_webhook_secret_missing` is reported at most once per org per
 *    hour per isolate (a map capped at 256 orgs, the oldest evicted); the
 *    other hits are a console line with the org id only.
 * 4. `verifySvix` over the raw body, before parsing: false → 401, and no
 *    other RPC runs.
 * 5. Parse `{ type, created_at, data: { email_id, tags } }` (else 400). The
 *    `email_log_id` tag is read in Resend's object or array form; a value
 *    that is not a uuid is dropped.
 * 6. **No tag → 200 `{ outcome: 'skipped' }`, before the claim:** an email
 *    this app did not send (another tool on the clinic's Resend account),
 *    acked so Resend stops, with no report and no row in `webhook_events`.
 *    Only signed events get here (step 4 comes first).
 * 7. `claimEvent('resend', svix-id, …)` with ids only (`type`, `email_id`,
 *    `email_log_id`), never `data.to` or the subject: `duplicate` → 200,
 *    `in_progress` → 409 (Resend retries later), an RPC error → 500.
 * 8. `email.sent` / `delivered` / `delivery_delayed` / `bounced` /
 *    `complained` → `apply_email_event` with that status; `email.suppressed`
 *    (Resend did not send to a suppressed address) → `bounced`;
 *    `email.failed` → `failed` (the RPC sets `provider_failed`). Any other
 *    type is acked (200 `skipped`) and completed, so Resend does not retry
 *    it. The RPC gets the tag's id and `email_id` (`p_resend_id`, recorded on
 *    a row whose `mark_email_sent` failed).
 * 9. **Module gate in the same RPC:** `apply_email_event` reads the row's
 *    `module_key` and checks `module_enabled_for_org` itself, answering
 *    `ignored` for a disabled module (the design's `requireModuleForOrg` from
 *    the row, without an extra round trip). `applied` and `ignored` → 200;
 *    `not_found` (a tagged id with no row, or another org's) → 200 too,
 *    reported: a retry cannot find it either.
 * 10. Then `completeEvent`. A failure after the claim → `failEvent(code)` and
 *     500, so the next delivery retries the event.
 *
 * Answers carry `{ outcome }` at most. Reports and logs carry the org,
 * webhook-event and email-log ids only: never an address or a payload.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { readCapped } from '../_shared/http.ts'
import { UUID } from '../_shared/patterns.ts'
import { clientIp, consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { verifySvix } from '../_shared/svix.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'

const FN = 'resend-webhook'
/** A Resend email id (a uuid today); anything else is passed as null. */
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,100}$/
/** `claim_webhook_event` accepts event ids of 1 to 200 characters. */
const MAX_EVENT_ID = 200
/** `resend_webhook_secret_missing` is reported once per org per this window. */
const MISSING_SECRET_WINDOW_MS = 60 * 60 * 1000
/** Orgs remembered for that throttle (per isolate); the oldest is evicted. */
const MISSING_SECRET_MAX_ORGS = 256

/** Resend event types that move an `email_log` row, and the status they set. */
const STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  // Resend refused to send to an address on its suppression list.
  'email.suppressed': 'bounced',
  // Resend could not send it (`apply_email_event` sets `provider_failed`).
  'email.failed': 'failed',
}

/** The fields read from an event; everything else (`to`, `subject`) is ignored. */
const eventSchema = z.object({
  type: z.string().min(1).max(100),
  created_at: z.string().max(64).optional(),
  data: z.object({
    email_id: z.string().optional(),
    tags: z.unknown().optional(),
  }).optional(),
})

/** The `email_log_id` tag, from `{ email_log_id: v }` or `[{ name, value }]`. */
function emailLogId(tags: unknown): string | null {
  let value: unknown = null
  if (Array.isArray(tags)) {
    value = tags.find((t) => t?.name === 'email_log_id')?.value
  } else if (tags !== null && typeof tags === 'object') {
    value = (tags as Record<string, unknown>).email_log_id
  }
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : null
}

/** An ISO timestamp, or null (the RPC then uses now). */
function eventTime(value: string | undefined): string | null {
  const at = value ? Date.parse(value) : NaN
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

/**
 * True when `key` was not reported within the window: records it now. A Map
 * keeps insertion order, and a report re-inserts its key, so the first key is
 * the one reported longest ago (evicted past `max`).
 */
export function createReportThrottle(
  windowMs = MISSING_SECRET_WINDOW_MS,
  max = MISSING_SECRET_MAX_ORGS,
): (key: string, nowMs: number) => boolean {
  const last = new Map<string, number>()
  return (key, nowMs) => {
    const at = last.get(key)
    if (at !== undefined && nowMs - at < windowMs) return false
    last.delete(key)
    last.set(key, nowMs)
    if (last.size > max) last.delete(last.keys().next().value!)
    return true
  }
}

/** The webhook handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  // One handler per isolate (`index.ts`), so this throttle is per isolate.
  const reportMissingSecret = createReportThrottle()
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const orgId = new URL(req.url).searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const svixId = req.headers.get('svix-id')
    const timestamp = req.headers.get('svix-timestamp')
    const signature = req.headers.get('svix-signature')
    if (
      !svixId || svixId.length > MAX_EVENT_ID || !timestamp || !signature
    ) return webhookResponse(401)

    const bytes = await readCapped(req)
    if (bytes === null) return webhookResponse(413)
    let rawBody: string
    try {
      rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return webhookResponse(400)
    }

    const client = deps.serviceClient()
    if (client instanceof Response) return webhookResponse(500)
    const limit = await consume(client, LIMITS.resendWebhookIp, [clientIp(req)])
    if (!limit.allowed) {
      if (limit.reason === 'unavailable') return webhookResponse(503)
      const res = webhookResponse(429)
      res.headers.set('Retry-After', String(limit.retryAfter))
      return res
    }
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: 'resend_webhook_secret',
    })
    if (secret.error) {
      await report('resend_webhook_secret_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      if (reportMissingSecret(orgId.toLowerCase(), deps.now().getTime())) {
        await report('resend_webhook_secret_missing')
      } else {
        console.warn(
          JSON.stringify({
            fn: FN,
            code: 'resend_webhook_secret_missing',
            ids,
          }),
        )
      }
      return webhookResponse(401)
    }
    const valid = await verifySvix({
      rawBody,
      id: svixId,
      timestamp,
      signature,
      secret: secret.data,
      nowSeconds: Math.floor(deps.now().getTime() / 1000),
    })
    if (!valid) return webhookResponse(401)

    let parsed: z.infer<typeof eventSchema>
    try {
      const result = eventSchema.safeParse(JSON.parse(rawBody))
      if (!result.success) return webhookResponse(400)
      parsed = result.data
    } catch {
      return webhookResponse(400)
    }
    const { type } = parsed
    const logId = emailLogId(parsed.data?.tags)
    // Not an email this app sent: ack it, claim nothing, report nothing.
    if (!logId) return webhookResponse(200, { outcome: 'skipped' })
    const providerId = parsed.data?.email_id ?? ''
    const resendId = PROVIDER_ID.test(providerId) ? providerId : null
    ids.email_log_id = logId

    let claim
    try {
      claim = await claimEvent(client, {
        provider: 'resend',
        eventId: svixId,
        orgId,
        eventType: type,
        payload: { type, email_id: resendId, email_log_id: logId },
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

    let step = 'apply_email_event_failed'
    try {
      let outcome = 'skipped'
      const status = STATUS[type]
      if (status) {
        const { data, error } = await client.rpc('apply_email_event', {
          p_org_id: orgId,
          p_email_log_id: logId,
          p_resend_id: resendId,
          p_status: status,
          p_at: eventTime(parsed.created_at),
        })
        if (error || !['applied', 'ignored', 'not_found'].includes(data)) {
          throw new Error('apply_email_event failed')
        }
        outcome = data
        if (outcome === 'not_found') await report('email_event_not_found')
      }
      step = 'complete_webhook_event_failed'
      await completeEvent(client, claim.id, claim.token)
      return webhookResponse(200, { outcome })
    } catch {
      await report(step)
      await failEvent(client, claim.id, claim.token, step).catch(() => false)
      return webhookResponse(500)
    }
  }
}
