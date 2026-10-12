/**
 * `gmail-webhook` (plan §11, CM1): Google's Pub/Sub push for a mailbox's
 * changes → a sync of that mailbox. Not browser-facing: no CORS,
 * `webhookResponse` only.
 *
 * The push subscription's endpoint is
 * `…/functions/v1/gmail-webhook?org=<org id>&token=<gmail_pubsub_token>`
 * (« Courriels Gmail » shows it): the org names whose secret verifies the
 * call, the token is that secret (Google's documented way to authenticate a
 * push without OIDC). The payload is only a hint: the mailbox it names is
 * matched exactly among the clinic's connected mailboxes and its history id
 * is never trusted (the sync reads from its own stored id), so a leaked
 * token can at most trigger syncs of known mailboxes, under the limit.
 *
 * 1. `POST` only (405); `?org=` a uuid (400); `?token=` present (401).
 * 2. One hit on `LIMITS.gmailWebhookIp` per IP (`clientIp`) before the
 *    secret is read: anyone can post here. Refused → 429 (Pub/Sub retries);
 *    the limiter down → 503.
 * 3. `get_org_secret(org, 'gmail_pubsub_token')`: none → 401 (fail closed;
 *    a console line with the org id, no report); a read error → 500;
 *    `timingSafeEqual` → 401 on mismatch. **Required** (PS Hub skipped the
 *    check when its secret was unset, roadmap §2.4 bis).
 * 4. The body (≤ 64 KB): `{ message: { data, messageId }, subscription? }`,
 *    `data` base64 JSON `{ emailAddress, historyId }` (else 400).
 * 5. The module gate (`requireModuleForOrg`): disabled → 200 `ignored` (an
 *    ack: Google would otherwise retry forever).
 * 6. `claimEvent('gmail', '<org>:<messageId>')`: `duplicate` → 200,
 *    `in_progress` → 409.
 * 7. `request_mail_sync(org, emailAddress)`: no connected mailbox of that
 *    address → 200 `unknown_mailbox` (acked, not reported: a push of a
 *    mailbox disconnected meanwhile).
 * 8. The sync of that mailbox, inline, within 25 s (`syncMailbox`: the
 *    lease, the history, the attachments, the watch); `skipped` (another
 *    sync holds the lease) is fine: `sync_requested_at` is newer than
 *    `last_sync_at`, the holder or the 15-minute job runs again.
 * 9. `completeEvent`; a provider or database failure → `failEvent(code)` and
 *    500 (Pub/Sub retries with backoff); `needs_reconnect` is completed
 *    (retrying would not help; the settings page shows it).
 *
 * Status codes: 200 `{ outcome }` (`synced`, `skipped`, `needs_reconnect`,
 * `ignored`, `unknown_mailbox`, `duplicate`); 400; 401; 405; 409; 413;
 * 429; 500; 503. Reports carry the org, event and connection ids only.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { gmailOrigins } from '../_shared/gmail/env.ts'
import {
  listMailboxes,
  pubsubTopic,
  syncMailbox,
} from '../_shared/gmail/sync.ts'
import { readCapped } from '../_shared/http.ts'
import { requireModuleForOrg } from '../_shared/modules.ts'
import { UUID } from '../_shared/patterns.ts'
import { clientIp, consume, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { timingSafeEqual } from '../_shared/timing-safe-equal.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'
import { SECRET_PUBSUB_TOKEN } from '../_shared/gmail/env.ts'

const FN = 'gmail-webhook'
const MAX_BODY_BYTES = 64 * 1024
/** The inline sync's budget: Pub/Sub's ack deadline is 10 s by default and set to 60 s (status doc). */
export const WEBHOOK_SYNC_BUDGET_MS = 25_000
const SAFE_CODE = /^[a-z0-9_]{1,64}$/

const pushSchema = z.looseObject({
  message: z.looseObject({
    data: z.string().min(1).max(8_192),
    messageId: z.string().min(1).max(200).optional(),
    message_id: z.string().min(1).max(200).optional(),
  }),
  subscription: z.string().max(512).optional(),
})
const dataSchema = z.looseObject({
  emailAddress: z.string().min(3).max(254),
  historyId: z.union([z.string(), z.number()]).optional(),
})

function decodeData(data: string): unknown {
  const base64 = data.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
  ))
}

/** Options for tests: the comparison is observable. */
export interface WebhookOptions {
  timingSafeEqual?: (a: string, b: string) => boolean
  syncBudgetMs?: number
}

/** The webhook handler; see the module comment. */
export function createHandler(
  deps: Deps,
  options: WebhookOptions = {},
): (req: Request) => Promise<Response> {
  const compare = options.timingSafeEqual ?? timingSafeEqual
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const url = new URL(req.url)
    const orgId = url.searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const provided = url.searchParams.get('token')
    if (!provided) return webhookResponse(401)
    const ids: Record<string, string> = { org_id: orgId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)

    const client = deps.serviceClient()
    if (client instanceof Response) return webhookResponse(500)
    const limit = await consume(client, LIMITS.gmailWebhookIp, [clientIp(req)])
    if (!limit.allowed) {
      if (limit.reason === 'unavailable') return webhookResponse(503)
      const res = webhookResponse(429)
      res.headers.set('Retry-After', String(limit.retryAfter))
      return res
    }
    const secret = await client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: SECRET_PUBSUB_TOKEN,
    })
    if (secret.error) {
      await report('pubsub_token_unavailable')
      return webhookResponse(500)
    }
    if (typeof secret.data !== 'string' || !secret.data) {
      console.warn(
        JSON.stringify({ fn: FN, code: 'pubsub_token_missing', ids }),
      )
      return webhookResponse(401)
    }
    if (!compare(provided, secret.data)) return webhookResponse(401)

    const bytes = await readCapped(req, MAX_BODY_BYTES)
    if (bytes === null) return webhookResponse(413)
    let push: z.infer<typeof pushSchema>
    let hint: z.infer<typeof dataSchema>
    try {
      const parsed = pushSchema.safeParse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      )
      if (!parsed.success) return webhookResponse(400)
      push = parsed.data
      const data = dataSchema.safeParse(decodeData(push.message.data))
      if (!data.success) return webhookResponse(400)
      hint = data.data
    } catch {
      return webhookResponse(400)
    }
    const messageId = push.message.messageId ?? push.message.message_id
    if (!messageId) return webhookResponse(400)

    const gate = await requireModuleForOrg(client, orgId, 'communications')
    if (gate) {
      return gate.status === 403
        ? webhookResponse(200, { outcome: 'ignored' })
        : webhookResponse(500)
    }

    let claim
    try {
      claim = await claimEvent(client, {
        provider: 'gmail',
        eventId: `${orgId.toLowerCase()}:${messageId}`.slice(0, 200),
        orgId,
        eventType: 'pubsub.push',
        payload: { message_id: messageId },
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
      const requested = await client.rpc('request_mail_sync', {
        p_org_id: orgId,
        p_email_address: hint.emailAddress,
      })
      if (requested.error) {
        throw Object.assign(new Error('request_failed'), {
          code: 'request_failed',
        })
      }
      if (typeof requested.data !== 'string') {
        await completeEvent(client, claim.id, claim.token)
        return webhookResponse(200, { outcome: 'unknown_mailbox' })
      }
      ids.connection_id = requested.data
      const [mailboxes, topic] = await Promise.all([
        listMailboxes(client, orgId),
        pubsubTopic(client, orgId),
      ])
      const mailbox = mailboxes.find((m) => m.connection_id === requested.data)
      if (!mailbox) {
        await completeEvent(client, claim.id, claim.token)
        return webhookResponse(200, { outcome: 'unknown_mailbox' })
      }
      const outcome = await syncMailbox({
        client,
        fetch: deps.fetch,
        origins: gmailOrigins(deps.env),
        now: deps.now,
        orgId,
        signal: req.signal,
        softDeadline: Date.now() +
          (options.syncBudgetMs ?? WEBHOOK_SYNC_BUDGET_MS),
        pubsubTopic: topic,
      }, mailbox)
      if (outcome.status === 'error') {
        const code = outcome.code ?? 'sync_failed'
        await report(code)
        await failEvent(
          client,
          claim.id,
          claim.token,
          SAFE_CODE.test(code) ? code : 'sync_failed',
        )
        return webhookResponse(500)
      }
      await completeEvent(client, claim.id, claim.token)
      return webhookResponse(200, {
        outcome: outcome.status === 'ok' ? 'synced' : outcome.status,
      })
    } catch (error) {
      const raw = (error as { code?: unknown }).code
      const code = typeof raw === 'string' && SAFE_CODE.test(raw)
        ? raw
        : 'gmail_webhook_failed'
      await report(code)
      await failEvent(client, claim.id, claim.token, code).catch(() => false)
      return webhookResponse(500)
    }
  }
}
