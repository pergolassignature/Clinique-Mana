/**
 * `sms-webhook` (batch SM): the PBX's message events → `sms_messages`,
 * `sms_consents` (« ARRÊT ») and the staff's notices. A webhook function
 * (CLAUDE.md §7): not browser-facing, no CORS, `webhookResponse` only.
 *
 * 1. `POST` only (405); the org from `?org=` (a uuid, else 400): the
 *    address pasted in the PBX's Integrations → API is per clinic.
 * 2. `X-Signature` present (else 401, before any read); the raw body at most
 *    64 KB (413) and UTF-8 (400).
 * 3. One hit on `LIMITS.yeastarWebhookIp` per IP before the secret is read:
 *    anyone can post here. Refused → 429 with `Retry-After`; the limiter
 *    down → 503.
 * 4. `get_org_secret(org, 'yeastar_webhook_secret')`: none → 401 (fail
 *    closed; reported once per org per hour per isolate), a read error → 500.
 * 5. `verifyYeastarSignature` over the raw body → 401 on mismatch, and no
 *    other RPC runs.
 * 6. The envelope (else 400). `event: test` (the PBX's « Test » button) and
 *    any type that is not a message event (the PBX's call events) → 200
 *    `{ outcome: 'skipped' }`, nothing claimed. A message event with no
 *    `msg_id` → 200 `skipped` too.
 * 7. `claimEvent('yeastar', <org>:<type>:<msg_id>[:<delivery_status>], …)`
 *    with ids only (never the number or the body): `duplicate` → 200,
 *    `in_progress` → 409 (the PBX retries), an RPC error → 500.
 * 8. 30031 from an external number → `record_inbound_sms` (the module gate,
 *    the keyword, the notice are the RPC's): `recorded`, `duplicate`,
 *    `ignored` (module off), `unreadable_number` → 200 with that outcome;
 *    after a « stop » the RPC hands back the acknowledgement it claimed, sent
 *    at once through the transport (`sendClaimedText`: a failure shows in
 *    the thread, the withdrawal stands). 30031 that is our own echo (sender
 *    type 1 or 9) → 200 `echo`, nothing stored (the send path recorded the
 *    text). 30032 → `apply_sms_delivery_event` (`sent` for status 1,
 *    `failed` with the PBX's code for 2; other statuses are acked `skipped`).
 *    30030 (a bulk send failed) → 200 `skipped`.
 * 9. Then `completeEvent`; a failure after the claim → `failEvent(code)`
 *    and 500, so the PBX's retry runs it again (every RPC is idempotent).
 *
 * Answers carry `{ outcome }` at most. Reports and logs carry the org, the
 * webhook-event and message ids only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { readCapped } from '../_shared/http.ts'
import { UUID } from '../_shared/patterns.ts'
import { clientIp, consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { sendClaimedText } from '../_shared/sms/send.ts'
import {
  createYeastarTransport,
  type SmsTransport,
} from '../_shared/sms/transport.ts'
import {
  type MessageEvent,
  normalizeMessageEvent,
  parseYeastarEnvelope,
  verifyYeastarSignature,
} from '../_shared/sms/webhook.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'
import { createReportThrottle } from '../_shared/report-throttle.ts'

const FN = 'sms-webhook'

const recordedSchema = z.object({
  outcome: z.string(),
  message_id: z.guid().optional(),
  keyword: z.string().nullable().optional(),
  ack: z.object({
    id: z.guid(),
    to_e164: z.string(),
    body: z.string(),
    request_id: z.string(),
  }).nullable().optional(),
})

export interface HandlerOptions {
  /** Injected by the tests; the Yeastar transport by default. */
  transport?: (client: SupabaseClient) => SmsTransport
}

/** The claim id of an event: the org, the type and the PBX's message id (and the delivery outcome for a report). */
export function yeastarEventId(orgId: string, event: MessageEvent): string {
  const base = `${orgId.toLowerCase()}:${event.type}:${event.msgId}`
  return event.type === 30032 ? `${base}:${event.deliveryStatus ?? 'none'}` : base
}

/** The webhook handler; see the module comment. */
export function createHandler(
  deps: Deps,
  options: HandlerOptions = {},
): (req: Request) => Promise<Response> {
  const reportMissingSecret = createReportThrottle()
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const orgId = new URL(req.url).searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const signature = req.headers.get('x-signature')
    if (!signature) return webhookResponse(401)
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
    const limit = await consume(client, LIMITS.yeastarWebhookIp, [clientIp(req)])
    if (!limit.allowed) {
      if (limit.reason === 'unavailable') return webhookResponse(503)
      const res = webhookResponse(429)
      res.headers.set('Retry-After', String(limit.retryAfter))
      return res
    }
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: 'yeastar_webhook_secret',
    })
    if (secret.error) {
      await report('yeastar_webhook_secret_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      if (reportMissingSecret(orgId.toLowerCase(), deps.now().getTime())) {
        await report('yeastar_webhook_secret_missing')
      } else {
        console.warn(
          JSON.stringify({ fn: FN, code: 'yeastar_webhook_secret_missing', ids }),
        )
      }
      return webhookResponse(401)
    }
    if (!(await verifyYeastarSignature(rawBody, signature, secret.data))) {
      return webhookResponse(401)
    }

    const envelope = parseYeastarEnvelope(rawBody)
    if (!envelope) return webhookResponse(400)
    const event = normalizeMessageEvent(envelope)
    if (!event || event.msgId === null) {
      return webhookResponse(200, { outcome: 'skipped' })
    }
    // Our own send, echoed by the PBX: the send path recorded it.
    if (event.type === 30031 && event.direction === 'out') {
      return webhookResponse(200, { outcome: 'echo' })
    }
    if (event.type === 30030) {
      return webhookResponse(200, { outcome: 'skipped' })
    }
    if (
      event.type === 30032 && event.deliveryStatus !== 1 &&
      event.deliveryStatus !== 2
    ) {
      return webhookResponse(200, { outcome: 'skipped' })
    }

    let claim
    try {
      claim = await claimEvent(client, {
        provider: 'yeastar',
        eventId: yeastarEventId(orgId, event),
        orgId,
        eventType: String(event.type),
        payload: {
          type: event.type,
          msg_id: event.msgId,
          session_id: event.sessionId,
          delivery_status: event.deliveryStatus,
        },
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

    let step = event.type === 30032
      ? 'apply_sms_delivery_event_failed'
      : 'record_inbound_sms_failed'
    try {
      let outcome: string
      if (event.type === 30032) {
        const { data, error } = await client.rpc('apply_sms_delivery_event', {
          p_org_id: orgId,
          p_provider_msg_id: event.msgId,
          p_status: event.deliveryStatus === 1 ? 'sent' : 'failed',
          p_error_code: event.deliveryStatus === 2
            ? (event.sendError ?? 'provider_failed')
            : null,
        })
        if (error || !['applied', 'ignored', 'not_found'].includes(data)) {
          throw new Error('apply_sms_delivery_event failed')
        }
        outcome = data
      } else {
        const { data, error } = await client.rpc('record_inbound_sms', {
          p_org_id: orgId,
          p_from: event.from,
          p_did: null,
          p_body: event.body,
          p_media: event.media,
          p_provider_msg_id: event.msgId,
          p_provider_session_id: event.sessionId,
          p_received_at: event.at?.toISOString() ?? null,
        })
        const recorded = recordedSchema.safeParse(data)
        if (error || !recorded.success) {
          throw new Error('record_inbound_sms failed')
        }
        outcome = recorded.data.outcome
        if (recorded.data.message_id) ids.sms_message_id = recorded.data.message_id
        if (recorded.data.ack) {
          // The withdrawal is recorded; its acknowledgement is best effort.
          const transport = options.transport
            ? options.transport(client)
            : createYeastarTransport({
              client,
              fetch: deps.fetch,
              now: deps.now,
              env: deps.env,
            })
          await sendClaimedText(
            { fn: FN, client, transport, fetch: deps.fetch },
            orgId,
            recorded.data.ack,
          )
        }
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
