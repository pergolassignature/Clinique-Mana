/**
 * The templated send path (design §2.1, §2.6; P3-4, P3-5, P3-18): one call
 * resolves the template and sender, checks the gates and limits, composes,
 * logs, sends and records the outcome. Module functions, `send-email` and
 * `email-test-send` all send through `sendTemplatedEmail`.
 *
 * Order (plan Task 3.8):
 * 1. Configuration (`EMAIL_TRANSPORT`, `APP_URL`) and the recipient address,
 *    before any RPC.
 * 2. `get_email_context` ∥ `get_org_secret(org, 'resend_api_key')` (Resend only).
 * 3. Module gate, then the catalogue flags: a free recipient needs
 *    `recipient_mode = 'free'`; attachments need `allows_attachments` (at most
 *    3 complete PDFs, 10 MB in total, safe file names).
 * 4. Rate limits in parallel: org per day; same template and address (skipped
 *    for « Renvoyer » and test sends); test sends per caller, or free-recipient
 *    sends per sender. The 401st send of the day reports
 *    `email_daily_80_percent`.
 * 5. Compose (`compose.ts`); nothing is queued when it fails.
 * 6. `queue_email` → the `email_log` id, used as the idempotency key and tag.
 * 7. The transport (retries inside, P3-4), then `mark_email_sent` /
 *    `mark_email_failed`.
 *
 * Outcomes a caller presents are a `SendResult`. Failures that are not the
 * caller's to present (an RPC error, a malformed context, an invalid clinic
 * timezone) are reported here, then thrown as a `FunctionError` (`internal` /
 * `server_misconfigured`): the handler answers with its code and does not
 * report it again.
 *
 * Reports carry the calling function, a code and row ids (`org_id`,
 * `email_log_id`): never the address, the subject, the body or a value.
 *
 * Task 3.6 RPCs (DB lane), assumed until it merges; each call names its
 * assumed signature below. All are service-role only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../deps.ts'
import { FunctionError } from '../errors.ts'
import { consume, LIMITS, type RateLimit } from '../rate-limit.ts'
import { reportError } from '../report.ts'
import { sniff } from '../storage.ts'
import { composeEmail, type EmailContext } from './compose.ts'
import { safeUrl } from './render.ts'
import {
  type OutgoingEmail,
  type Sleep,
  transportFromEnv,
  transportKind,
} from './transport.ts'

/** What the send path needs: a service-role client, the environment and outbound HTTP. */
export interface EmailDeps extends Pick<Deps, 'env' | 'fetch'> {
  /** The calling function's name, for reports. */
  fn: string
  /** A service-role client (`deps.serviceClient()`, already checked). */
  client: SupabaseClient
  /** Aborts the provider call and its retries (e.g. the request's signal). */
  signal?: AbortSignal
  /** Tests only: replaces the retry back-off wait. */
  sleep?: Sleep
}

/** One templated email to send. */
export interface SendTemplatedEmailInput {
  /** From `auth.access.org_id` or the row acted on, never from the client. */
  orgId: string
  templateKey: string
  /** The recipient, resolved by the server (except free-recipient templates). */
  to: { email: string; profileId: string | null }
  /** The record the email is about (`staff_invitation` / id), for its timeline. */
  subject: { type: string; id: string }
  /** Nested values, read by the template's variable paths. */
  values: Record<string, unknown>
  /** The button URL, from code only. */
  actionUrl: string | null
  sentBy: string | null
  /** « Renvoyer »: skips the 60 s same-address limit. */
  explicitResend?: boolean
  /** A typed address: allowed only when `recipient_mode = 'free'`, with a sender. */
  freeRecipient?: boolean
  attachments?: OutgoingEmail['attachments']
  /**
   * « M'envoyer un test »: sample values for anything missing, a « [Test] »
   * subject, the test limit per caller. The caller passes its own address as
   * `to` (`auth.access.email`), never a body field. `draft` renders unsaved
   * text instead of the effective template.
   */
  test?: {
    callerId: string
    draft?: { subject: string; body: string; buttonLabel: string | null }
  }
}

/** Why a send did not happen (codes stay English, P3-28). */
export type SendFailureCode =
  | 'rate_limited'
  | 'not_configured'
  | 'module_disabled'
  | 'missing_variable'
  | 'recipient_not_allowed'
  | 'attachment_not_allowed'
  | 'provider_error'
  | 'invalid_recipient'

/**
 * The outcome. `emailLogId` is set once the row is queued (a provider failure
 * leaves a `failed` row for « Renvoyer »).
 */
export type SendResult =
  | { ok: true; emailLogId: string }
  | { ok: false; emailLogId: null; code: 'rate_limited'; retryAfter: number }
  | { ok: false; emailLogId: null; code: 'missing_variable'; path: string }
  | {
    ok: false
    emailLogId: string | null
    code: Exclude<SendFailureCode, 'rate_limited' | 'missing_variable'>
  }

const MAX_ATTACHMENTS = 3
/** 10 MB in total (P3-18), the `documents` bucket limit. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** The 80 % warning fires on exactly this hit, so once per window. */
const ORG_DAY_WARN_AT = Math.floor(LIMITS.emailOrgDay.max * 0.8) + 1

/** One part of an address: no space, control character, `@` or delimiter. */
const ATOM = String.raw`[^\s\p{Cc}@<>()[\]\\,;:"]`
/**
 * Exactly one bare mailbox (`local@domain.tld`), so a typed address can never
 * name a second recipient (`a@x.ca, b@y.ca`) or a display name.
 */
const MAILBOX = new RegExp(
  String.raw`^${ATOM}{1,64}@(?:(?:(?!\.)${ATOM})+\.)+(?:(?!\.)${ATOM}){2,}$`,
  'u',
)
const MAX_ADDRESS_LENGTH = 254
/** A plain file name ending in `.pdf`: letters, digits, spaces and `'’()._-`. */
const SAFE_FILENAME = /^[\p{L}\p{N}][\p{L}\p{N} '’()._-]{0,95}\.pdf$/iu

const variableSchema = z.object({
  path: z.string(),
  label: z.string(),
  sample: z.string(),
  required: z.boolean(),
  kind: z.enum(['text', 'date', 'datetime', 'url']),
})

/**
 * The assumed `get_email_context` result (Task 3.6, DB lane to confirm):
 *
 *   get_email_context(p_org_id uuid, p_template_key text) returns jsonb
 *   {
 *     module_key, module_enabled boolean, timezone,
 *     template: { key, version int, subject, body, button_label, why_line,
 *                 variables [{path,label,sample,required,kind}],
 *                 view_permission, recipient_mode 'subject'|'free',
 *                 allows_attachments boolean },
 *     sender: { from_name, from_address, reply_to },
 *     clinic: { name, address_line1, address_line2, city, province,
 *               postal_code, phone, website,
 *               privacy_officer_name, privacy_officer_email }
 *   }
 *   An unknown key raises 22023.
 *
 * `version` is the effective template's version, logged with the email.
 * Only the fields used here are read; others are ignored.
 */
const contextSchema = z.object({
  module_enabled: z.boolean(),
  timezone: z.string(),
  template: z.object({
    version: z.number().int().nonnegative(),
    subject: z.string(),
    body: z.string(),
    button_label: z.string().nullable(),
    why_line: z.string(),
    variables: z.array(variableSchema).max(40),
    view_permission: z.string().min(1),
    recipient_mode: z.enum(['subject', 'free']),
    allows_attachments: z.boolean(),
  }),
  sender: z.object({
    from_name: z.string(),
    from_address: z.string().min(3),
    reply_to: z.string().nullable(),
  }),
  clinic: z.object({
    name: z.string(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    city: z.string().nullable(),
    province: z.string().nullable(),
    postal_code: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    privacy_officer_name: z.string().nullable(),
    privacy_officer_email: z.string().nullable(),
  }),
})

type RawContext = z.infer<typeof contextSchema>

/** The compose input from the RPC's JSON. */
function emailContext(raw: RawContext): EmailContext {
  const { template: t, clinic: c } = raw
  return {
    template: {
      subject: t.subject,
      body: t.body,
      buttonLabel: t.button_label,
      whyLine: t.why_line,
      variables: t.variables,
    },
    clinic: {
      name: c.name,
      addressLine1: c.address_line1,
      addressLine2: c.address_line2,
      city: c.city,
      province: c.province,
      postalCode: c.postal_code,
      phone: c.phone,
      website: c.website,
      privacyOfficerName: c.privacy_officer_name,
      privacyOfficerEmail: c.privacy_officer_email,
    },
    timezone: raw.timezone,
  }
}

/** True when `email` is one bare mailbox of at most 254 characters. */
function isMailbox(email: string): boolean {
  return email.length <= MAX_ADDRESS_LENGTH && MAILBOX.test(email)
}

/** True when every attachment is allowed by P3-18 (PDF only, ≤ 3, ≤ 10 MB in total). */
function attachmentsAllowed(
  attachments: OutgoingEmail['attachments'],
  allowed: boolean,
): boolean {
  if (attachments.length === 0) return true
  if (!allowed || attachments.length > MAX_ATTACHMENTS) return false
  const total = attachments.reduce((sum, a) => sum + a.content.byteLength, 0)
  return total <= MAX_ATTACHMENT_BYTES &&
    attachments.every((a) =>
      a.contentType === 'application/pdf' && SAFE_FILENAME.test(a.filename) &&
      sniff(a.content) === 'pdf'
    )
}

/** Sends one templated email; see the module comment for the order and rules. */
export async function sendTemplatedEmail(
  deps: EmailDeps,
  input: SendTemplatedEmailInput,
): Promise<SendResult> {
  const { client, env } = deps
  const ids = { org_id: input.orgId }
  const report = (code: string, extra: Record<string, string> = {}) =>
    reportError({ fn: deps.fn, code, ids: { ...ids, ...extra } }, deps.fetch)
  const fail = async (
    code: string,
    as: 'internal' | 'server_misconfigured' = 'internal',
  ): Promise<never> => {
    await report(code)
    throw new FunctionError(as, `email send: ${code}`)
  }

  // 1. Configuration and the recipient, before any RPC.
  const kind = transportKind(env)
  const appUrl = env('APP_URL')?.trim() ?? ''
  if (!kind || !safeUrl(appUrl, true)) {
    await report(kind ? 'app_url_missing' : 'email_transport_unknown')
    return { ok: false, emailLogId: null, code: 'not_configured' }
  }
  const to = input.to.email.trim()
  if (!isMailbox(to)) {
    return { ok: false, emailLogId: null, code: 'invalid_recipient' }
  }

  // 2. Context ∥ API key.
  const [contextRes, secretRes] = await Promise.all([
    client.rpc('get_email_context', {
      p_org_id: input.orgId,
      p_template_key: input.templateKey,
    }),
    // get_org_secret(p_org_id uuid, p_key text) returns text (Phase 1; null when unset).
    kind === 'resend'
      ? client.rpc('get_org_secret', {
        p_org_id: input.orgId,
        p_key: 'resend_api_key',
      })
      : Promise.resolve({ data: null, error: null }),
  ])
  if (contextRes.error) return fail('email_context_failed')
  if (secretRes.error) return fail('email_secret_failed')
  const parsed = contextSchema.safeParse(contextRes.data)
  if (!parsed.success) return fail('email_context_invalid')
  const raw = parsed.data
  const apiKey = typeof secretRes.data === 'string' ? secretRes.data : null
  const transport = transportFromEnv(env, deps.fetch, apiKey, {
    sleep: deps.sleep,
  })
  if ('error' in transport) {
    await report(
      kind === 'resend' ? 'resend_api_key_missing' : 'mailpit_url_missing',
    )
    return { ok: false, emailLogId: null, code: 'not_configured' }
  }

  // 3. Module gate and catalogue flags.
  if (!raw.module_enabled) {
    return { ok: false, emailLogId: null, code: 'module_disabled' }
  }
  if (
    input.freeRecipient &&
    (raw.template.recipient_mode !== 'free' || !input.sentBy)
  ) {
    return { ok: false, emailLogId: null, code: 'recipient_not_allowed' }
  }
  const attachments = input.attachments ?? []
  if (!attachmentsAllowed(attachments, raw.template.allows_attachments)) {
    return { ok: false, emailLogId: null, code: 'attachment_not_allowed' }
  }

  // 4. Rate limits, in parallel; the org day limit comes first.
  const checks: [RateLimit, string[]][] = [[LIMITS.emailOrgDay, [input.orgId]]]
  if (!input.explicitResend && !input.test) {
    checks.push([
      LIMITS.emailSameAddress,
      [input.orgId, input.templateKey, to.toLowerCase()],
    ])
  }
  if (input.test) {
    checks.push([LIMITS.emailTest, [input.orgId, input.test.callerId]])
  } else if (input.freeRecipient && input.sentBy) {
    checks.push([LIMITS.emailFreeRecipient, [input.orgId, input.sentBy]])
  }
  const limits = await Promise.all(
    checks.map(([limit, key]) => consume(client, limit, key)),
  )
  if (limits[0].hits === ORG_DAY_WARN_AT) await report('email_daily_80_percent')
  if (limits.some((l) => l.reason === 'unavailable')) {
    return { ok: false, emailLogId: null, code: 'not_configured' }
  }
  const refused = limits.filter((l) => !l.allowed)
  if (refused.length > 0) {
    return {
      ok: false,
      emailLogId: null,
      code: 'rate_limited',
      retryAfter: Math.max(...refused.map((l) => l.retryAfter)),
    }
  }

  // 5. Compose.
  const context = emailContext(raw)
  const draft = input.test?.draft
  if (draft) {
    context.template = {
      ...context.template,
      subject: draft.subject,
      body: draft.body,
      buttonLabel: draft.buttonLabel,
    }
  }
  const composed = composeEmail(context, {
    values: input.values,
    actionUrl: input.actionUrl,
    appUrl,
    mode: input.test ? 'test' : 'send',
  })
  if (!composed.ok) {
    if (composed.code === 'invalid_timezone') {
      return fail('email_timezone_invalid', 'server_misconfigured')
    }
    // An unknown placeholder means the catalogue lacks the value: the same
    // outcome for the caller (compose.ts hand-off).
    return {
      ok: false,
      emailLogId: null,
      code: 'missing_variable',
      path: composed.path,
    }
  }

  // 6. Queue. Assumed (Task 3.6):
  // queue_email(p_org_id uuid, p_template_key text, p_template_version int,
  //   p_to_email text, p_to_profile_id uuid, p_subject_type text,
  //   p_subject_id uuid, p_view_permission text, p_sent_by uuid,
  //   p_attachment_count smallint) returns uuid   -- status 'queued'
  const queued = await client.rpc('queue_email', {
    p_org_id: input.orgId,
    p_template_key: input.templateKey,
    p_template_version: raw.template.version,
    p_to_email: to,
    p_to_profile_id: input.to.profileId,
    p_subject_type: input.subject.type,
    p_subject_id: input.subject.id,
    p_view_permission: raw.template.view_permission,
    p_sent_by: input.sentBy,
    p_attachment_count: attachments.length,
  })
  if (queued.error || typeof queued.data !== 'string') {
    return fail('email_queue_failed')
  }
  const emailLogId = queued.data
  const logIds = { email_log_id: emailLogId }

  // 7. Send, then record the outcome.
  const sent = await transport.send({
    from: { name: raw.sender.from_name, email: raw.sender.from_address },
    to,
    replyTo: raw.sender.reply_to,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    idempotencyKey: emailLogId,
    tags: [{ name: 'email_log_id', value: emailLogId }],
    attachments,
  }, { signal: deps.signal })

  if (sent.ok) {
    // Assumed: mark_email_sent(p_id uuid, p_resend_id text, p_attempts int) returns void.
    const marked = await client.rpc('mark_email_sent', {
      p_id: emailLogId,
      p_resend_id: sent.providerId,
      p_attempts: sent.attempts,
    })
    // The email has left: answer ok. The `email_log_id` tag lets the webhook
    // move the row on, and « Renvoyer » would send it twice.
    if (marked.error) await report('email_mark_failed', logIds)
    return { ok: true, emailLogId }
  }

  // Assumed: mark_email_failed(p_id uuid, p_error_code text, p_attempts int) returns void.
  const marked = await client.rpc('mark_email_failed', {
    p_id: emailLogId,
    p_error_code: sent.code,
    p_attempts: sent.attempts,
  })
  await report(sent.code, logIds)
  if (marked.error) await report('email_mark_failed', logIds)
  return {
    ok: false,
    emailLogId,
    code: sent.code === 'invalid_recipient'
      ? 'invalid_recipient'
      : 'provider_error',
  }
}
