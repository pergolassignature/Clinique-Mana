/**
 * Email transports (design §2.1, P3-4, P3-23): Resend in production, Mailpit
 * locally, and a console transport for tests.
 *
 * - **Resend** (`POST https://api.resend.com/emails`, the request shape of PS
 *   Hub's `send-quote-signing-email`). Every attempt carries the same
 *   `Idempotency-Key` (the `email_log` id), so a retry, a double click or a
 *   timeout after acceptance never sends twice. A 429, a 5xx, a network error,
 *   a timeout, a 2xx without an id, or a 409 `concurrent_idempotent_requests`
 *   (an earlier attempt still in flight) is retried: 3 attempts, after 0.5 s
 *   then 2 s. Any other 4xx is final; a 422 validation error on `to` is
 *   `invalid_recipient`. Each attempt is cut after 10 s.
 * - **Mailpit** (`POST {MAILPIT_URL}/api/v1/send`): one attempt, local only.
 * - **Console**: logs the `email_log` id and the subject length, nothing else.
 *
 * A provider's answer is read for its id and error name only, and is never
 * logged or returned: it can quote the address. Nothing here logs a recipient,
 * a subject or a body. An aborted caller signal stops at once
 * (`provider_unavailable`).
 */

/** One message, ready to send. Built by `send.ts`; every field comes from code or the database. */
export interface OutgoingEmail {
  /** The display name (null: the address alone) and the sender address. */
  from: { name: string | null; email: string }
  /** One address, already validated. */
  to: string
  replyTo: string | null
  subject: string
  html: string
  text: string
  /** The `email_log` id. */
  idempotencyKey: string
  /** `[{ name: 'email_log_id', value: id }]`, so a webhook maps to its row. */
  tags: { name: string; value: string }[]
  attachments: {
    filename: string
    content: Uint8Array
    contentType: 'application/pdf'
  }[]
}

/** Accepted (with the provider's message id), or why not after `attempts` tries. */
export type TransportResult =
  | { ok: true; providerId: string; attempts: number }
  | {
    ok: false
    code:
      | 'provider_rejected'
      | 'provider_unavailable'
      | 'provider_rate_limited'
      | 'invalid_recipient'
    attempts: number
  }

/** Per-send options. */
export interface SendOptions {
  /** Aborting it stops the current attempt and any retry. */
  signal?: AbortSignal
}

/** Sends one email. Never throws. */
export interface EmailTransport {
  send(email: OutgoingEmail, options?: SendOptions): Promise<TransportResult>
}

/** Waits `ms`, returning early when `signal` aborts. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

/** Transport tuning; tests shorten the waits. */
export interface TransportOptions {
  sleep?: Sleep
  /** Per-attempt timeout (default 10 s). */
  timeoutMs?: number
}

/** The transports `EMAIL_TRANSPORT` can name. */
export type TransportKind = 'resend' | 'mailpit' | 'console'

const RESEND_URL = 'https://api.resend.com/emails'
const ATTEMPT_TIMEOUT_MS = 10_000
/** Waits before the 2nd and 3rd attempts (P3-4). */
const BACKOFF_MS = [500, 2_000] as const
/** A Resend validation message naming the `to` field (`Invalid \`to\` field…`). */
const TO_FIELD = /[`'"]to[`'"]/

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
  })

/** Standard base64, in chunks so a 10 MB attachment does not overflow the call stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * `"Name" <address>`. The name loses quotes, backslashes, angle brackets and
 * control or line-separator characters, so it can neither close its quotes
 * nor start a header; an empty name leaves the address alone.
 */
function formatFrom(from: OutgoingEmail['from']): string {
  const name = (from.name ?? '')
    .replace(/["\\<>\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name ? `"${name}" <${from.email}>` : from.email
}

/** The per-attempt signal: the timeout, plus the caller's signal when given. */
function attemptSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([timeout, signal]) : timeout
}

/** The JSON body, or null; the body is always consumed. */
async function readJson(
  res: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await res.json()
    return body !== null && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

type RetryableCode = 'provider_unavailable' | 'provider_rate_limited'
type Attempt =
  | { done: true; result: TransportResult }
  | { done: false; code: RetryableCode }

/** Classifies one Resend answer (see the module comment). */
async function resendAttempt(
  res: Response,
  attempts: number,
): Promise<Attempt> {
  const body = await readJson(res)
  if (res.ok) {
    return typeof body?.id === 'string' && body.id
      ? { done: true, result: { ok: true, providerId: body.id, attempts } }
      : { done: false, code: 'provider_unavailable' }
  }
  if (res.status === 429) return { done: false, code: 'provider_rate_limited' }
  if (res.status >= 500) return { done: false, code: 'provider_unavailable' }
  if (res.status === 409 && body?.name === 'concurrent_idempotent_requests') {
    return { done: false, code: 'provider_unavailable' }
  }
  const invalidTo = res.status === 422 && body?.name === 'validation_error' &&
    typeof body.message === 'string' && TO_FIELD.test(body.message)
  return {
    done: true,
    result: {
      ok: false,
      code: invalidTo ? 'invalid_recipient' : 'provider_rejected',
      attempts,
    },
  }
}

/**
 * The Resend transport. `apiKey` comes from the org's Vault secret
 * (`get_org_secret(org, 'resend_api_key')`), never from the environment.
 */
export function resendTransport(
  apiKey: string,
  fetchFn: typeof fetch,
  options: TransportOptions = {},
): EmailTransport {
  const sleep = options.sleep ?? defaultSleep
  const timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS
  return {
    async send(email, { signal } = {}) {
      const body = JSON.stringify({
        from: formatFrom(email.from),
        to: [email.to],
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: email.tags,
        ...(email.attachments.length > 0
          ? {
            attachments: email.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content),
            })),
          }
          : {}),
      })
      let attempts = 0
      let code: RetryableCode = 'provider_unavailable'
      while (attempts <= BACKOFF_MS.length && !signal?.aborted) {
        if (attempts > 0) {
          await sleep(BACKOFF_MS[attempts - 1], signal)
          if (signal?.aborted) break
        }
        attempts++
        try {
          const res = await fetchFn(RESEND_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': email.idempotencyKey,
            },
            body,
            signal: attemptSignal(timeoutMs, signal),
          })
          const outcome = await resendAttempt(res, attempts)
          if (outcome.done) return outcome.result
          code = outcome.code
        } catch {
          // A network error or a timeout: the request may have been accepted,
          // and the Idempotency-Key makes the retry safe.
          code = 'provider_unavailable'
        }
      }
      return { ok: false, code, attempts }
    },
  }
}

/**
 * The Mailpit transport (local, P3-23): one attempt to Mailpit's send API.
 * `baseUrl` is `MAILPIT_URL` (the CLI's Mailpit, reached from the functions
 * container).
 */
export function mailpitTransport(
  baseUrl: string,
  fetchFn: typeof fetch,
  options: Pick<TransportOptions, 'timeoutMs'> = {},
): EmailTransport {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/send`
  return {
    async send(email, { signal } = {}) {
      if (signal?.aborted) {
        return { ok: false, code: 'provider_unavailable', attempts: 0 }
      }
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: { Email: email.from.email, Name: email.from.name ?? '' },
            To: [{ Email: email.to }],
            ...(email.replyTo ? { ReplyTo: [{ Email: email.replyTo }] } : {}),
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
            Tags: email.tags.map((t) => `${t.name}:${t.value}`),
            Attachments: email.attachments.map((a) => ({
              Filename: a.filename,
              Content: toBase64(a.content),
              ContentType: a.contentType,
            })),
          }),
          signal: attemptSignal(
            options.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
            signal,
          ),
        })
        const body = await readJson(res)
        if (res.ok && typeof body?.ID === 'string' && body.ID) {
          return { ok: true, providerId: body.ID, attempts: 1 }
        }
        return {
          ok: false,
          code: res.status >= 400 && res.status < 500
            ? 'provider_rejected'
            : 'provider_unavailable',
          attempts: 1,
        }
      } catch {
        return { ok: false, code: 'provider_unavailable', attempts: 1 }
      }
    },
  }
}

/** The console transport (tests): one JSON line with the `email_log` id and the subject length. */
export function consoleTransport(): EmailTransport {
  return {
    send(email) {
      console.info(JSON.stringify({
        transport: 'console',
        email_log_id: email.idempotencyKey,
        subject_length: email.subject.length,
        attachment_count: email.attachments.length,
      }))
      return Promise.resolve({
        ok: true,
        providerId: `console:${email.idempotencyKey}`,
        attempts: 1,
      })
    },
  }
}

/** `EMAIL_TRANSPORT` (`resend` when unset), or null for an unknown value. */
export function transportKind(
  env: (key: string) => string | undefined,
): TransportKind | null {
  const value = env('EMAIL_TRANSPORT')?.trim() || 'resend'
  return value === 'resend' || value === 'mailpit' || value === 'console'
    ? value
    : null
}

/**
 * The transport named by `EMAIL_TRANSPORT`, or `not_configured` (fail
 * closed): an unknown value, Resend without an API key, or Mailpit without an
 * `http(s)` `MAILPIT_URL`. `apiKey` is the org's `resend_api_key` (null when
 * not set or not read).
 */
export function transportFromEnv(
  env: (key: string) => string | undefined,
  fetchFn: typeof fetch,
  apiKey: string | null,
  options: TransportOptions = {},
): EmailTransport | { error: 'not_configured' } {
  switch (transportKind(env)) {
    case 'resend':
      return apiKey
        ? resendTransport(apiKey, fetchFn, options)
        : { error: 'not_configured' }
    case 'mailpit': {
      const base = env('MAILPIT_URL')?.trim()
      return base && URL.canParse(base) &&
          ['http:', 'https:'].includes(new URL(base).protocol)
        ? mailpitTransport(base, fetchFn, options)
        : { error: 'not_configured' }
    }
    case 'console':
      return consoleTransport()
    default:
      return { error: 'not_configured' }
  }
}
