/**
 * `resend-webhook` (Task 3.10): Resend delivery events → `email_log` status.
 * Not browser-facing: no CORS, `webhookResponse` only.
 *
 * 1. `POST` only (405); the org from `?org=` (a uuid, else 400). The URL is
 *    per clinic because each clinic has its own Resend account and secret.
 * 2. The three Svix headers must be present (else 401, before any read), and
 *    the raw body at most 64 KB (413) and UTF-8 (400).
 * 3. `get_org_secret(org, 'resend_webhook_secret')`: none → 401 (fail
 *    closed, reported `resend_webhook_secret_missing`); a read error → 500.
 * 4. `verifySvix` over the raw body, before parsing: false → 401, and no
 *    other RPC runs.
 * 5. Parse `{ type, created_at, data: { email_id, tags } }` (else 400). The
 *    `email_log_id` tag is read in Resend's object or array form; a value
 *    that is not a uuid is dropped (the row is then found by `email_id`).
 * 6. `claimEvent('resend', svix-id, …)` with ids only (`type`, `email_id`,
 *    `email_log_id`), never `data.to` or the subject: `duplicate` → 200,
 *    `in_progress` → 409 (Resend retries later), an RPC error → 500.
 * 7. `email.sent` / `delivered` / `delivery_delayed` / `bounced` /
 *    `complained` → `apply_email_event`; any other type is acked (200) and
 *    completed, so Resend does not retry it.
 * 8. **Module gate in the same RPC:** `apply_email_event` reads the row's
 *    `module_key` and checks `module_enabled_for_org` itself, answering
 *    `ignored` for a disabled module (the design's `requireModuleForOrg` from
 *    the row, without an extra round trip). `applied` and `ignored` → 200;
 *    `not_found` (no row, or another org's) → 200 too, reported: a retry
 *    cannot find it either.
 * 9. Then `completeEvent`. A failure after the claim → `failEvent(code)` and
 *    500, so the next delivery retries the event.
 *
 * Answers carry `{ outcome }` at most. Reports and logs carry the org,
 * webhook-event and email-log ids only: never an address or a payload.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { readCapped } from '../_shared/http.ts'
import { reportError } from '../_shared/report.ts'
import { verifySvix } from '../_shared/svix.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'

const FN = 'resend-webhook'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A Resend email id (a uuid today); anything else is not looked up. */
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,100}$/
/** `claim_webhook_event` accepts event ids of 1 to 200 characters. */
const MAX_EVENT_ID = 200

/** Resend event types that move an `email_log` row, and the status they set. */
const STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
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

/** The webhook handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
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
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: 'resend_webhook_secret',
    })
    if (secret.error) {
      await report('resend_webhook_secret_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      await report('resend_webhook_secret_missing')
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
    const providerId = parsed.data?.email_id ?? ''
    const resendId = PROVIDER_ID.test(providerId) ? providerId : null
    if (logId) ids.email_log_id = logId

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
