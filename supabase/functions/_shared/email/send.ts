/**
 * The templated send path (design §2.1, §2.6; P3-4, P3-5, P3-18): one call
 * resolves the template and sender, checks the gates and limits, composes,
 * logs, sends and records the outcome. Module and job functions and
 * `email-test-send` all send through `sendTemplatedEmail`, in process.
 *
 * Order (plan Task 3.8, with compose moved before the limits):
 * 1. Configuration (`EMAIL_TRANSPORT`, `APP_URL`; the console transport only
 *    with a local `APP_URL`) and the recipient address, before any RPC.
 * 2. `get_email_context` ∥ `get_org_secret(org, 'resend_api_key')` (Resend
 *    only); the sender `from_address` and `reply_to` must be single mailboxes
 *    (else `not_configured`, reported `sender_invalid`).
 * 3. Module gate, then the catalogue flags. The template's `recipient_mode`
 *    decides, not the caller: a `free` template always needs `sentBy` and
 *    consumes `emails.free_recipient`; `freeRecipient` on a `subject`
 *    template is `recipient_not_allowed`. Attachments need
 *    `allows_attachments` (at most 3 complete PDFs, 10 MB in total, safe
 *    file names).
 * 4. Compose (`compose.ts`), before any limit: a template error uses up no
 *    slot, and nothing is queued.
 * 5. Rate limits. A normal send consumes, in parallel: org per day
 *    (`emails.org_day`); same template and address (60 s,
 *    `emails.same_address`); free-recipient sends per sender. « Renvoyer »
 *    and test sends skip the same-address limit and consume the narrow
 *    buckets first, in parallel: a 5 s double-click guard per template,
 *    address and sender (`emails.repeat_guard`); test sends per caller
 *    (`emails.test`); free-recipient sends per sender. Only when those all
 *    pass is `emails.org_day` consumed, so refused clicks never use up the
 *    clinic's daily quota. The 401st send of the day reports
 *    `email_daily_80_percent`.
 * 6. An aborted caller signal stops here: nothing is queued or sent.
 * 7. `queue_email` → the `email_log` id, used as the idempotency key and tag.
 * 8. The transport (retries inside, P3-4), then `mark_email_sent` /
 *    `mark_email_failed`. The caller's signal never cuts an attempt in flight
 *    (`transport.ts`); `provider_unavailable` on the row means « outcome
 *    unknown » (a later webhook may still move it to `sent` / `delivered`).
 *
 * Outcomes a caller presents are a `SendResult`. Failures that are not the
 * caller's to present (an unknown template key, an RPC error, a malformed
 * context, an invalid clinic timezone) are reported here, then thrown as a
 * `FunctionError` (`not_found` for the unknown key, else `internal` /
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
import {
  consume,
  LIMITS,
  type RateLimit,
  type RateLimitResult,
} from '../rate-limit.ts'
import { reportError } from '../report.ts'
import { sniff } from '../storage.ts'
import { composeEmail, type EmailContext } from './compose.ts'
import { safeUrl } from './render.ts'
import {
  isLocalAppUrl,
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
  /**
   * The request's signal, say. Aborted before queueing: nothing is queued or
   * sent. Aborted later: it stops the back-off and any further attempt, but
   * never cuts an attempt in flight (bounded by its 10 s timeout), so an
   * email the provider accepted is still recorded as sent.
   */
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
  /**
   * « Renvoyer »: skips the 60 s same-address limit; a 5 s double-click guard
   * per template, address and sender applies instead.
   */
  explicitResend?: boolean
  /**
   * A typed address. Refused on a `subject` template. A `free` template is
   * treated as free whatever this says: it needs `sentBy` and uses the
   * free-recipient limit.
   */
  freeRecipient?: boolean
  attachments?: OutgoingEmail['attachments']
  /**
   * « M'envoyer un test »: sample values for anything missing, a « [Test] »
   * subject, the test limit per caller. The caller passes its own address as
   * `to` (`auth.access.email`), never a body field. `draft` renders unsaved
   * text instead of the effective template; `buttonLabel` null means « no
   * button », undefined keeps the effective template's label.
   */
  test?: {
    callerId: string
    draft?: { subject: string; body: string; buttonLabel?: string | null }
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
 * leaves a `failed` row for « Renvoyer »). `provider_error` with a null
 * `emailLogId` means the caller's signal aborted before queueing: nothing
 * was queued or sent.
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

/**
 * One character of a local part: no space, control or format character
 * (zero-width, bidi), `@` or delimiter.
 */
const LOCAL_CHAR = String.raw`[^\s\p{Cc}\p{Cf}@<>()[\]\\,;:"]`
/** One ASCII domain label: letters, digits and inner hyphens (`xn--` included). */
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
/** The top-level label: letters, or punycode (`xn--…`). */
const TLD = '(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})'
/**
 * Exactly one bare mailbox (`local@domain.tld`), so a typed address can never
 * name a second recipient (`a@x.ca, b@y.ca`) or a display name. The domain
 * is ASCII (an internationalised one arrives as punycode), so a homograph
 * (`exаmple.com` with a Cyrillic `а`) is refused rather than sent.
 */
const MAILBOX = new RegExp(
  String.raw`^${LOCAL_CHAR}{1,64}@(?:${LABEL}\.)+${TLD}$`,
  'u',
)
/** A uuid, as `queue_email` returns (also the `email_log_id` tag value). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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

/**
 * A `get_email_context` result as compose input, with its module gate, or
 * null when malformed. For callers that compose without sending (preview).
 */
export function parseEmailContext(
  data: unknown,
): { moduleEnabled: boolean; context: EmailContext } | null {
  const parsed = contextSchema.safeParse(data)
  return parsed.success
    ? {
      moduleEnabled: parsed.data.module_enabled,
      context: emailContext(parsed.data),
    }
    : null
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
    as: 'internal' | 'server_misconfigured' | 'not_found' = 'internal',
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
  // The console transport answers « sent » while nothing leaves: never
  // outside a local run.
  if (kind === 'console' && !isLocalAppUrl(appUrl)) {
    return fail('email_console_not_local', 'server_misconfigured')
  }
  const to = input.to.email.trim()
  if (!isMailbox(to)) {
    return { ok: false, emailLogId: null, code: 'invalid_recipient' }
  }

  // 2. Context ∥ API key, then the sender.
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
  // get_email_context raises 22023 for an unknown org or template key: the
  // caller answers 404 (still reported, a sender names a key in code).
  if (contextRes.error?.code === '22023') {
    return fail('email_template_unknown', 'not_found')
  }
  if (contextRes.error) return fail('email_context_failed')
  if (secretRes.error) return fail('email_secret_failed')
  const parsed = contextSchema.safeParse(contextRes.data)
  if (!parsed.success) return fail('email_context_invalid')
  const raw = parsed.data
  const { sender } = raw
  if (
    !isMailbox(sender.from_address) ||
    (sender.reply_to !== null && !isMailbox(sender.reply_to))
  ) {
    await report('sender_invalid')
    return { ok: false, emailLogId: null, code: 'not_configured' }
  }
  const apiKey = typeof secretRes.data === 'string' ? secretRes.data : null
  const transport = transportFromEnv(env, deps.fetch, apiKey, {
    sleep: deps.sleep,
  })
  if ('error' in transport) {
    if (transport.error === 'server_misconfigured') {
      return fail('email_console_not_local', 'server_misconfigured')
    }
    await report(
      kind === 'resend' ? 'resend_api_key_missing' : 'mailpit_url_missing',
    )
    return { ok: false, emailLogId: null, code: 'not_configured' }
  }

  // 3. Module gate and catalogue flags. The catalogue decides whether the
  // recipient is free, not the caller's flag.
  if (!raw.module_enabled) {
    return { ok: false, emailLogId: null, code: 'module_disabled' }
  }
  const free = raw.template.recipient_mode === 'free'
  if ((input.freeRecipient && !free) || (free && !input.sentBy)) {
    return { ok: false, emailLogId: null, code: 'recipient_not_allowed' }
  }
  const attachments = input.attachments ?? []
  if (!attachmentsAllowed(attachments, raw.template.allows_attachments)) {
    return { ok: false, emailLogId: null, code: 'attachment_not_allowed' }
  }

  // 4. Compose, before any limit: a template error uses up no slot.
  const context = emailContext(raw)
  const draft = input.test?.draft
  if (draft) {
    context.template = {
      ...context.template,
      subject: draft.subject,
      body: draft.body,
      buttonLabel: draft.buttonLabel === undefined
        ? context.template.buttonLabel
        : draft.buttonLabel,
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

  // 5. Rate limits. « Renvoyer » and test sends: the narrow buckets first,
  // then the org day only if they pass; a normal send: all in parallel.
  const address = to.toLowerCase()
  const orgDay: [RateLimit, string[]] = [LIMITS.emailOrgDay, [input.orgId]]
  const narrow: [RateLimit, string[]][] = []
  const guarded = Boolean(input.explicitResend || input.test)
  if (guarded) {
    // A double click on « Renvoyer » or « M'envoyer un test » sends once.
    narrow.push([LIMITS.emailRepeatGuard, [
      input.orgId,
      input.templateKey,
      address,
      input.sentBy ?? input.test?.callerId ?? '',
    ]])
  } else {
    narrow.push([
      LIMITS.emailSameAddress,
      [input.orgId, input.templateKey, address],
    ])
  }
  if (input.test) {
    narrow.push([LIMITS.emailTest, [input.orgId, input.test.callerId]])
  }
  if (free && input.sentBy) {
    narrow.push([LIMITS.emailFreeRecipient, [input.orgId, input.sentBy]])
  }
  const consumeAll = (checks: [RateLimit, string[]][]) =>
    Promise.all(checks.map(([limit, key]) => consume(client, limit, key)))
  const refusal = (limits: RateLimitResult[]): SendResult | null => {
    if (limits.some((l) => l.reason === 'unavailable')) {
      return { ok: false, emailLogId: null, code: 'not_configured' }
    }
    const refused = limits.filter((l) => !l.allowed)
    return refused.length > 0
      ? {
        ok: false,
        emailLogId: null,
        code: 'rate_limited',
        retryAfter: Math.max(...refused.map((l) => l.retryAfter)),
      }
      : null
  }
  let limits: RateLimitResult[]
  if (guarded) {
    const first = await consumeAll(narrow)
    const refusedFirst = refusal(first)
    if (refusedFirst) return refusedFirst
    limits = [...await consumeAll([orgDay]), ...first]
  } else {
    limits = await consumeAll([orgDay, ...narrow])
  }
  // limits[0] is the org day result in both orders.
  if (limits[0].hits === ORG_DAY_WARN_AT) await report('email_daily_80_percent')
  const refused = refusal(limits)
  if (refused) return refused

  // 6. The caller has gone: queue nothing, send nothing.
  if (deps.signal?.aborted) {
    return { ok: false, emailLogId: null, code: 'provider_error' }
  }

  // 7. Queue. Assumed (Task 3.6):
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
  if (
    queued.error || typeof queued.data !== 'string' || !UUID.test(queued.data)
  ) {
    return fail('email_queue_failed')
  }
  const emailLogId = queued.data
  const logIds = { email_log_id: emailLogId }

  // 8. Send, then record the outcome. The signal stops retries only.
  const sent = await transport.send({
    from: { name: sender.from_name, email: sender.from_address },
    to,
    replyTo: sender.reply_to,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    idempotencyKey: emailLogId,
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
  // `provider_unavailable` (attempts > 0) means « outcome unknown »: the
  // provider may have accepted it, and a later webhook can move the row to
  // `sent` / `delivered` (DB lane).
  const marked = await client.rpc('mark_email_failed', {
    p_id: emailLogId,
    p_error_code: sent.code,
    p_attempts: sent.attempts,
  })
  // The transport's detail (`resend_503`, `resend_timeout`): [a-z0-9_] only.
  await report(sent.detail, logIds)
  if (marked.error) await report('email_mark_failed', logIds)
  return {
    ok: false,
    emailLogId,
    code: sent.code === 'invalid_recipient'
      ? 'invalid_recipient'
      : 'provider_error',
  }
}
