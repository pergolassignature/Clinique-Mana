/**
 * Error reports from edge functions (P3-29), ported from PS Hub
 * `_shared/sentry.ts`: a direct POST of a Sentry envelope, no SDK.
 *
 * A report carries only the function name, an error code and row ids: never an
 * address, a token, a message or a body. The keys `email`, `to`, `token` and
 * `password` are refused by the type; at runtime, any key with one of those
 * `_`-separated segments is dropped (`to_email`, `access_token`), except row
 * ids ending in `_id` (`email_log_id`), with a warning naming the key only.
 *
 * With `SENTRY_DSN` unset (local, tests), or when Sentry cannot be reached, the
 * report is one structured `console.error` line. Never throws.
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
const DSN_PATTERN = /^https:\/\/([^@/]+)@([^/]+)\/(.+)$/

/** The report with forbidden id keys removed (their names are warned). */
function sanitise(report: ErrorReport): ErrorReport {
  if (!report.ids) return { fn: report.fn, code: report.code }
  const ids: Record<string, string> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(report.ids)) {
    if (FORBIDDEN_SEGMENT.test(key) && !ROW_ID.test(key)) dropped.push(key)
    else ids[key] = value
  }
  if (dropped.length > 0) {
    console.warn(
      `[report] ${report.fn}: dropped forbidden id keys: ${dropped.join(', ')}`,
    )
  }
  return { fn: report.fn, code: report.code, ids }
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
    })
    await res.body?.cancel()
    if (res.ok) return true
    console.warn(`[report] Sentry ingest returned ${res.status}`)
  } catch (error) {
    console.warn('[report] Sentry unreachable', (error as Error)?.name)
  }
  return false
}

/**
 * Reports an error: to Sentry when `SENTRY_DSN` is set, otherwise (or when
 * Sentry fails) as one `console.error` JSON line `{ fn, code, ids }`.
 * Awaits the send, so the event leaves before the runtime stops. Never throws.
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
