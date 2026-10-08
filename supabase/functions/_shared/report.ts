/**
 * Error reports from edge functions (P3-29), ported from PS Hub
 * `_shared/sentry.ts`: a direct POST of a Sentry envelope, no SDK.
 *
 * A report carries only the function name, an error code and row ids: never an
 * address, a token, a message or a body. The keys `email`, `to`, `token` and
 * `password` are refused by the type; at runtime, any key with one of those
 * `_`-separated segments is dropped (`to_email`, `access_token`), except row
 * ids ending in `_id` (`email_log_id`), with a warning naming the key only.
 * Values are checked too: `fn` and `code` must be short identifiers (else
 * `invalid_fn` / `invalid_code`), and an id value holding `@` or whitespace, or
 * longer than 100 characters, is dropped (it is not a row id).
 *
 * With `SENTRY_DSN` unset (local, tests), or when Sentry cannot be reached, the
 * report is one structured `console.error` line (Sentry gets 3 s, then the
 * line is written instead). Never throws.
 *
 * Optional secrets: `SENTRY_DSN` (`https://<key>@<host>/<projectId>`) and
 * `SENTRY_ENVIRONMENT` (Sentry's default `production` when unset).
 */

type ForbiddenKey = 'email' | 'to' | 'token' | 'password'

/** Row ids to attach to a report. */
export type ReportIds =
  & Record<string, string>
  & { [K in ForbiddenKey]?: never }

/** One report: which function, which error code, which rows. */
export interface ErrorReport {
  fn: string
  code: string
  ids?: ReportIds
}

const FORBIDDEN_SEGMENT = /(?:^|_)(?:email|to|token|password)(?:_|$)/i
const ROW_ID = /_id$/
/**
 * A function name or error code. Upper case is allowed on purpose: codes can be
 * a SQLSTATE (`42P01`) or a PostgREST code (`PGRST202`).
 */
const SAFE_CODE = /^[a-zA-Z0-9_.-]{1,64}$/
/** Longest id value kept: uuids, bucket names, short keys. */
const MAX_ID_LENGTH = 100
/** How long Sentry gets before the console line is written instead. */
const SENTRY_TIMEOUT_MS = 3_000
const DSN_PATTERN = /^https:\/\/([^@/]+)@([^/]+)\/(.+)$/

/** True when an id value looks like a row id, not an address or free text. */
function safeIdValue(value: unknown): boolean {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH &&
    !value.includes('@') && !/\s/.test(value)
}

/**
 * The report with unsafe values replaced or removed: `fn` / `code` that are not
 * identifiers become `invalid_fn` / `invalid_code`; forbidden id keys and unsafe
 * id values are dropped (their key names are warned, never their values).
 */
function sanitise(report: ErrorReport): ErrorReport {
  const fn = typeof report.fn === 'string' && SAFE_CODE.test(report.fn)
    ? report.fn
    : 'invalid_fn'
  const code = typeof report.code === 'string' && SAFE_CODE.test(report.code)
    ? report.code
    : 'invalid_code'
  if (!report.ids) return { fn, code }
  const ids: Record<string, string> = {}
  const forbidden: string[] = []
  const unsafe: string[] = []
  for (const [key, value] of Object.entries(report.ids)) {
    if (FORBIDDEN_SEGMENT.test(key) && !ROW_ID.test(key)) forbidden.push(key)
    else if (!safeIdValue(value)) unsafe.push(key)
    else ids[key] = value
  }
  if (forbidden.length > 0) {
    console.warn(
      `[report] ${fn}: dropped forbidden id keys: ${forbidden.join(', ')}`,
    )
  }
  if (unsafe.length > 0) {
    console.warn(
      `[report] ${fn}: dropped id values that are not row ids: ${
        unsafe.join(', ')
      }`,
    )
  }
  return { fn, code, ids }
}

/** The envelope body for one event (https://develop.sentry.dev/sdk/envelopes/). */
function envelope(report: ErrorReport): string {
  const eventId = crypto.randomUUID().replaceAll('-', '')
  const environment = Deno.env.get('SENTRY_ENVIRONMENT')
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'edge-function',
    ...(environment ? { environment } : {}),
    server_name: report.fn,
    message: { formatted: `${report.fn}: ${report.code}` },
    tags: { function: report.fn, code: report.code },
    extra: report.ids ?? {},
  }
  const header = { event_id: eventId, sent_at: new Date().toISOString() }
  // One JSON document per line, trailing newline required.
  return [header, { type: 'event' }, event]
    .map((part) => `${JSON.stringify(part)}\n`).join('')
}

/** True when Sentry accepted the event; failures are warned, never thrown. */
async function sendToSentry(
  report: ErrorReport,
  dsn: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  const match = DSN_PATTERN.exec(dsn)
  if (!match) {
    console.warn('[report] SENTRY_DSN is malformed')
    return false
  }
  const [, key, host, projectId] = match
  try {
    const res = await fetchFn(`https://${host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth':
          `Sentry sentry_version=7, sentry_key=${key}, sentry_client=clinique-mana-edge/1.0`,
      },
      body: envelope(report),
      signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
    })
    await res.body?.cancel()
    if (res.ok) return true
    console.warn(`[report] Sentry ingest returned ${res.status}`)
  } catch (error) {
    // A timeout rejects with a DOMException named TimeoutError.
    console.warn('[report] Sentry unreachable', (error as Error)?.name)
  }
  return false
}

/**
 * Reports an error: to Sentry when `SENTRY_DSN` is set, otherwise (or when
 * Sentry fails) as one `console.error` JSON line `{ fn, code, ids }`.
 * Awaits the send (3 s at most), so the event leaves before the runtime stops.
 * Never throws.
 */
export async function reportError(
  report: ErrorReport,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const safe = sanitise(report)
  const dsn = Deno.env.get('SENTRY_DSN')
  if (dsn && await sendToSentry(safe, dsn, fetchFn)) return
  console.error(JSON.stringify(safe))
}
