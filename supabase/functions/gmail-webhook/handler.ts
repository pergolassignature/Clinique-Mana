/**
 * `gmail-webhook` (plan §11, CM1): Google's Pub/Sub push for a mailbox's
 * changes → a sync of that mailbox. Not browser-facing: no CORS,
 * `webhookResponse` only.
 *
 * The push subscription's endpoint is `…/functions/v1/gmail-webhook?org=<org id>`
 * (« Courriels Gmail » shows it), **with authentication** (CM-4): Pub/Sub
 * signs each push with a Google ID token for the service account the clinic
 * set (`pubsub_service_account`) and the audience `pushAudience(org)`. No
 * secret travels in the address (PS Hub's token in the query string reached
 * the request logs). The payload is only a hint: the mailbox it names is
 * matched exactly among the clinic's connected mailboxes and its history id
 * is never trusted (the sync reads from its own stored id).
 *
 * 1. `POST` only (405); `?org=` a uuid (400); `Authorization: Bearer` present
 *    (401).
 * 2. One hit on `LIMITS.gmailWebhookIp` per IP (`clientIp`) before anything
 *    is read: anyone can post here. Refused → 429 (Pub/Sub retries); the
 *    limiter down → 503.
 * 3. The org's settings (`get_communications_settings_for_org`): no service
 *    account → 401 (fail closed; a console line with the org id, no report);
 *    a read error → 500. `verifyGoogleIdToken` (`_shared/google-oidc.ts`:
 *    Google's signature, issuer, audience, expiry, `email` = the service
 *    account) → 401 with the reason code in a console line; Google's keys
 *    unreachable → 503 (Pub/Sub retries). **Required** (PS Hub skipped its
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
 *    pass holds the lease, and may have read the history before this
 *    change) → `failEvent('lease_held')` and 503: Pub/Sub redelivers with
 *    backoff and the claim is taken again, so the change is read.
 * 9. `completeEvent`; a provider or database failure → `failEvent(code)` and
 *    500 (Pub/Sub retries with backoff); `needs_reconnect` is completed
 *    (retrying would not help; the settings page shows it).
 *
 * Status codes: 200 `{ outcome }` (`synced`, `needs_reconnect`, `ignored`,
 * `unknown_mailbox`, `duplicate`); 400; 401; 405; 409; 413; 429; 500; 503
 * (the limiter down, or the lease held). Reports carry the org, event and connection ids only.
 */
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { gmailOrigins, pushAudience } from '../_shared/gmail/env.ts'
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
import { verifyGoogleIdToken } from '../_shared/google-oidc.ts'
import {
  claimEvent,
  completeEvent,
  failEvent,
  webhookResponse,
} from '../_shared/webhooks.ts'

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

/** Options for tests. */
export interface WebhookOptions {
  syncBudgetMs?: number
}

const settingsSchema = z.looseObject({
  pubsub_service_account: z.string().nullable().optional(),
})

/** The webhook handler; see the module comment. */
export function createHandler(
  deps: Deps,
  options: WebhookOptions = {},
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return webhookResponse(405)
    const url = new URL(req.url)
    const orgId = url.searchParams.get('org') ?? ''
    if (!UUID.test(orgId)) return webhookResponse(400)
    const bearer = /^Bearer\s+(\S+)$/i.exec(
      req.headers.get('Authorization') ?? '',
    )?.[1]
    if (!bearer) return webhookResponse(401)
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
    const settings = await client.rpc('get_communications_settings_for_org', {
      p_org_id: orgId,
    })
    const parsedSettings = settingsSchema.safeParse(settings.data)
    if (settings.error || !parsedSettings.success) {
      await report('settings_unavailable')
      return webhookResponse(500)
    }
    const account = parsedSettings.data.pubsub_service_account
    if (!account) {
      console.warn(
        JSON.stringify({ fn: FN, code: 'pubsub_account_missing', ids }),
      )
      return webhookResponse(401)
    }
    const verified = await verifyGoogleIdToken(bearer, {
      audience: pushAudience(orgId),
      email: account,
    }, {
      fetch: deps.fetch,
      certsOrigin: gmailOrigins(deps.env).certs,
      now: deps.now,
    })
    if (!verified.ok) {
      console.warn(
        JSON.stringify({ fn: FN, code: `push_${verified.reason}`, ids }),
      )
      return webhookResponse(
        verified.reason === 'certs_unavailable' ? 503 : 401,
      )
    }

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
      if (outcome.status === 'skipped') {
        // Another pass holds the lease and may have read the history before this change: the
        // claim fails (re-claimable) and Pub/Sub redelivers with backoff, so the change is read.
        await failEvent(client, claim.id, claim.token, 'lease_held')
        return webhookResponse(503)
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
