/**
 * Email transports (design §2.1, P3-4, P3-23): Resend in production, Mailpit
 * locally, and a console transport for local runs and tests.
 *
 * - **Resend** (`POST https://api.resend.com/emails`, the request shape of PS
 *   Hub's `send-quote-signing-email`). Every attempt carries the same
 *   `Idempotency-Key` (the `email_log` id), so a retry, a double click or a
 *   timeout after acceptance never sends twice. A 429, a 5xx, a network error,
 *   a timeout, a 2xx without an id, or a 409 `concurrent_idempotent_requests`
 *   (an earlier attempt still in flight) is retried: 3 attempts, after 0.5 s
 *   then 2 s, or after the 429's `Retry-After` when longer. A 429
 *   `daily_quota_exceeded` / `monthly_quota_exceeded` is final: retrying
 *   cannot succeed before the quota resets. Any other 4xx is final; a 400 or
 *   422 `validation_error` on `to` is `invalid_recipient`. Each attempt is cut
 *   after 10 s, and the whole send (attempts and waits) stays within 30 s: a
 *   wait that would leave no room for the next attempt ends the retries.
 * - **Mailpit** (`POST {MAILPIT_URL}/api/v1/send`): one attempt, local only.
 * - **Console**: logs the `email_log` id and the subject length, nothing else.
 *   Only with a local `APP_URL` (`transportFromEnv`).
 *
 * **The caller's signal never cuts an attempt in flight.** It stops the
 * back-off and any further attempt; the attempt already sent finishes,
 * bounded by its own timeout. Cutting it would turn an email the provider
 * accepted into a « failed » row, and « Renvoyer » would send it again.
 *
 * **`provider_unavailable` means « outcome unknown »** when `attempts > 0`:
 * the last attempt timed out, lost its connection, or got a 5xx, a 2xx
 * without an id or a 409 `concurrent_idempotent_requests`, and the provider
 * may still have accepted the email. A later webhook can move a
 * `failed(provider_unavailable)` row on to `sent` / `delivered` (DB lane).
 * With `attempts = 0` (the caller's signal aborted first) nothing was sent.
 *
 * A provider's answer is read for its id, its error name and `Retry-After`
 * only, and is never logged or returned: it can quote the address. A failure
 * carries a `detail` code safe to report (`resend_503`,
 * `resend_validation_error`, `resend_timeout`): `[a-z0-9_]` only, built from
 * the status or a snake_case error name, never from a message. Nothing here
 * logs a recipient, a subject or a body.
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
  /**
   * The `email_log` id (a uuid): the idempotency key, and the `email_log_id`
   * tag (`emailLogTag`) so a webhook maps to its row.
   */
  idempotencyKey: string
  attachments: {
    filename: string
    content: Uint8Array
    contentType: 'application/pdf'
  }[]
}

/** Why a transport did not deliver (see the module comment for `provider_unavailable`). */
export type TransportFailureCode =
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'invalid_recipient'

/**
 * Accepted (with the provider's message id), or why not after `attempts`
 * tries. `detail` is a report code (`[a-z0-9_]`, no personal data).
 */
export type TransportResult =
  | { ok: true; providerId: string; attempts: number }
  | {
    ok: false
    code: TransportFailureCode
    detail: string
    attempts: number
  }

/** Per-send options. */
export interface SendOptions {
  /**
   * Stops the back-off and any further attempt. An attempt in flight is
   * never cut by it (only by its own timeout), so an accepted email is not
   * recorded as failed.
   */
  signal?: AbortSignal
}

/** Sends one email. Never throws. */
export interface EmailTransport {
  send(email: OutgoingEmail, options?: SendOptions): Promise<TransportResult>
}

/** Waits `ms`, returning early when `signal` aborts. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

/** Transport tuning; tests shorten the waits and drive the clock. */
export interface TransportOptions {
  sleep?: Sleep
  /** Per-attempt timeout (default 10 s). */
  timeoutMs?: number
  /** The whole Resend send, attempts and waits (default 30 s). */
  budgetMs?: number
  /** Milliseconds since the epoch (default `Date.now`). */
  now?: () => number
}

/** The transports `EMAIL_TRANSPORT` can name. */
export type TransportKind = 'resend' | 'mailpit' | 'console'

const RESEND_URL = 'https://api.resend.com/emails'
const MAX_ATTEMPTS = 3
const ATTEMPT_TIMEOUT_MS = 10_000
const SEND_BUDGET_MS = 30_000
/** The least time worth giving an attempt; less ends the retries instead. */
const MIN_ATTEMPT_MS = 1_000
/** Waits before the 2nd and 3rd attempts (P3-4). */
const BACKOFF_MS = [500, 2_000] as const
/** A Resend validation message naming the `to` field (`Invalid \`to\` field…`). */
const TO_FIELD = /[`'"]to[`'"]/
/** 429 names that no retry within this send can clear. */
const QUOTA_ERRORS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded'])
/** A provider error name usable in a report code (Resend's are snake_case). */
const ERROR_NAME = /^[a-z][a-z0-9_]{0,47}$/
/** Hosts a console-transport `APP_URL` may name. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The tag name a webhook reads to find its `email_log` row. */
export const EMAIL_LOG_TAG = 'email_log_id'

/**
 * The `email_log_id` tag in each provider's form, from one place. Resend tags
 * allow `[A-Za-z0-9_-]` in names and values; Mailpit tags are one string
 * matching `^[a-zA-Z0-9\-\ \_\.@]{1,100}$` (no `:`). A uuid fits both:
 * Resend `{ name: 'email_log_id', value: '<uuid>' }`, Mailpit
 * `email_log_id-<uuid>`.
 */
export function emailLogTag(emailLogId: string): {
  resend: { name: string; value: string }
  mailpit: string
} {
  return {
    resend: { name: EMAIL_LOG_TAG, value: emailLogId },
    mailpit: `${EMAIL_LOG_TAG}-${emailLogId}`,
  }
}

/** True when `appUrl` is a local `http` URL (`http://localhost:5173`). */
export function isLocalAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl || !URL.canParse(appUrl.trim())) return false
  const url = new URL(appUrl.trim())
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}

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
 * A display name that can neither close its quotes nor start a header, nor
 * hide or reorder text: quotes, backslashes, angle brackets, control and
 * format characters (zero-width, bidi) and line separators become spaces.
 */
function displayName(name: string | null): string {
  return (name ?? '')
    .replace(/["\\<>\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `"Name" <address>`; an empty name leaves the address alone. */
function formatFrom(from: OutgoingEmail['from']): string {
  const name = displayName(from.name)
  return name ? `"${name}" <${from.email}>` : from.email
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

/** `<provider>_<error name>` when the name is snake_case, else `<provider>_<status>`. */
function detailOf(provider: string, status: number, name: unknown): string {
  const n = typeof name === 'string' ? name.toLowerCase() : ''
  return ERROR_NAME.test(n) ? `${provider}_${n}` : `${provider}_${status}`
}

/** `timeout` or `network_error`, from a rejected fetch. */
function thrownDetail(provider: string, error: unknown): string {
  return error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? `${provider}_timeout`
    : `${provider}_network_error`
}

/** `Retry-After` (seconds or an HTTP date) in ms, or 0 when absent or unreadable. */
function retryAfterMs(res: Response, now: number): number {
  const value = res.headers.get('retry-after')?.trim()
  if (!value) return 0
  if (/^\d{1,6}$/.test(value)) return Number(value) * 1_000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : 0
}

type Failure = { code: TransportFailureCode; detail: string }
type Attempt =
  | { done: true; result: TransportResult }
  | { done: false; failure: Failure; retryAfterMs: number }

/** Classifies one Resend answer (see the module comment). */
async function resendAttempt(
  res: Response,
  attempts: number,
  now: number,
): Promise<Attempt> {
  const body = await readJson(res)
  const name = body?.name
  const detail = detailOf('resend', res.status, name)
  const retry = (code: TransportFailureCode, wait = 0): Attempt => ({
    done: false,
    failure: { code, detail },
    retryAfterMs: wait,
  })
  const final = (code: TransportFailureCode): Attempt => ({
    done: true,
    result: { ok: false, code, detail, attempts },
  })
  if (res.ok) {
    return typeof body?.id === 'string' && body.id
      ? { done: true, result: { ok: true, providerId: body.id, attempts } }
      : {
        done: false,
        failure: { code: 'provider_unavailable', detail: 'resend_no_id' },
        retryAfterMs: 0,
      }
  }
  if (res.status === 429) {
    return typeof name === 'string' && QUOTA_ERRORS.has(name)
      ? final('provider_rate_limited')
      : retry('provider_rate_limited', retryAfterMs(res, now))
  }
  if (res.status >= 500) return retry('provider_unavailable')
  if (res.status === 409 && name === 'concurrent_idempotent_requests') {
    return retry('provider_unavailable')
  }
  const invalidTo = (res.status === 400 || res.status === 422) &&
    name === 'validation_error' &&
    typeof body?.message === 'string' && TO_FIELD.test(body.message)
  return final(invalidTo ? 'invalid_recipient' : 'provider_rejected')
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
  const budgetMs = options.budgetMs ?? SEND_BUDGET_MS
  const now = options.now ?? Date.now
  const minAttemptMs = Math.min(MIN_ATTEMPT_MS, timeoutMs)
  return {
    async send(email, { signal } = {}) {
      const body = JSON.stringify({
        from: formatFrom(email.from),
        to: [email.to],
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [emailLogTag(email.idempotencyKey).resend],
        ...(email.attachments.length > 0
          ? {
            attachments: email.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content),
            })),
          }
          : {}),
      })
      const start = now()
      const remaining = () => budgetMs - (now() - start)
      let attempts = 0
      let last: Failure = {
        code: 'provider_unavailable',
        detail: 'resend_aborted',
      }
      let wait = 0
      while (attempts < MAX_ATTEMPTS && !signal?.aborted) {
        if (attempts > 0) {
          // No room for the wait and a useful attempt: stop rather than
          // retry before the provider allows it, or with a hopeless timeout.
          if (wait + minAttemptMs > remaining()) break
          await sleep(wait, signal)
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
            // The timeout only: the caller's signal never cuts an attempt.
            signal: AbortSignal.timeout(
              Math.max(minAttemptMs, Math.min(timeoutMs, remaining())),
            ),
          })
          const outcome = await resendAttempt(res, attempts, now())
          if (outcome.done) return outcome.result
          last = outcome.failure
          wait = Math.max(BACKOFF_MS[attempts - 1] ?? 0, outcome.retryAfterMs)
        } catch (error) {
          // A network error or a timeout: the request may have been accepted
          // (outcome unknown), and the Idempotency-Key makes the retry safe.
          last = {
            code: 'provider_unavailable',
            detail: thrownDetail('resend', error),
          }
          wait = BACKOFF_MS[attempts - 1] ?? 0
        }
      }
      return { ok: false, ...last, attempts }
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
        return {
          ok: false,
          code: 'provider_unavailable',
          detail: 'mailpit_aborted',
          attempts: 0,
        }
      }
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: {
              Email: email.from.email,
              Name: displayName(email.from.name),
            },
            To: [{ Email: email.to }],
            ...(email.replyTo ? { ReplyTo: [{ Email: email.replyTo }] } : {}),
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
            Tags: [emailLogTag(email.idempotencyKey).mailpit],
            Attachments: email.attachments.map((a) => ({
              Filename: a.filename,
              Content: toBase64(a.content),
              ContentType: a.contentType,
            })),
          }),
          // The timeout only, as for Resend.
          signal: AbortSignal.timeout(options.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
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
          detail: res.ok ? 'mailpit_no_id' : `mailpit_${res.status}`,
          attempts: 1,
        }
      } catch (error) {
        return {
          ok: false,
          code: 'provider_unavailable',
          detail: thrownDetail('mailpit', error),
          attempts: 1,
        }
      }
    },
  }
}

/** The console transport (local, tests): one JSON line with the `email_log` id and the subject length. */
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
 * The transport named by `EMAIL_TRANSPORT`, or why not (fail closed):
 * `not_configured` for an unknown value, Resend without an API key, or
 * Mailpit without an `http(s)` `MAILPIT_URL`; `server_misconfigured` for the
 * console transport with a non-local `APP_URL` (it would answer « sent »
 * while nothing leaves). `apiKey` is the org's `resend_api_key` (null when
 * not set or not read).
 */
export function transportFromEnv(
  env: (key: string) => string | undefined,
  fetchFn: typeof fetch,
  apiKey: string | null,
  options: TransportOptions = {},
): EmailTransport | { error: 'not_configured' | 'server_misconfigured' } {
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
      return isLocalAppUrl(env('APP_URL'))
        ? consoleTransport()
        : { error: 'server_misconfigured' }
    default:
      return { error: 'not_configured' }
  }
}
