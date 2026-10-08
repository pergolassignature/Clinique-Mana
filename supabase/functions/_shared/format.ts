/**
 * FR-CA display formats for server-rendered text (emails and PDFs), mirroring
 * the web app's `src/shared/lib/timezone.ts` and `format.ts`, and the one
 * template value formatter both renderers use (`formatValue`):
 *
 * - timestamps (`timestamptz`) are shown in the clinic timezone;
 * - date-only values (`date`) are calendar dates: never converted;
 * - dates read `d MMMM yyyy` with date-fns' French month names (« 1 janvier 2020 »);
 * - times use the Québec prose form « 14 h 30 », and « 9 h » on the hour
 *   (OQLF), the form the plan sets for emails, rather than the app's compact
 *   « 14:30 ». The datetime helper is therefore named `formatEmailDateTime`,
 *   not after the app's `formatClinicDateTime`, whose output differs.
 *
 * Month names are a fixed table and the time is assembled from numeric parts,
 * so the output does not depend on the runtime's ICU locale data.
 */

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** `yyyy-MM-dd` at the start of a date-only, ISO or Postgres text value. */
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/
/**
 * An instant: date, time (`T` or a space) and an explicit offset (`Z`, `+00`,
 * `-04:00`). Without an offset the runtime's own timezone would be assumed.
 */
const INSTANT =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/

/** An `INSTANT` string as a Date (offset normalised to `±HH:mm`), else null. */
function parseInstant(value: string): Date | null {
  const match = INSTANT.exec(value)
  if (!match) return null
  const [, date, time, offset] = match
  const zone = offset === 'Z'
    ? 'Z'
    : `${offset.slice(0, 3)}:${offset.length > 3 ? offset.slice(-2) : '00'}`
  return new Date(`${date}T${time}${zone}`)
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** One cached formatter per timezone (constructing one is the costly part). */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('fr-CA', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * True when `timeZone` is an IANA name the runtime knows (`America/Toronto`).
 * Lets callers turn a misconfigured clinic timezone into a result code
 * instead of the RangeError `formatEmailDateTime` would throw.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

/**
 * A timestamp in the clinic timezone, in email prose style:
 * « 15 octobre 2026 à 14 h 30 », « 15 octobre 2026 à 9 h ». The web app's
 * `formatClinicDateTime` shows the same instant as « 15 oct. 2026 à 14:30 »;
 * emails are read as sentences, so they spell the month and use « h ».
 * Accepts a Date, or a string with a time and an offset (ISO, JSON, or Postgres
 * text `2026-07-15 18:30:00+00`). Returns null for anything else, including a
 * bare date (read as UTC midnight it would shift a day, CLAUDE.md §9).
 * Throws RangeError for an unknown timezone (check with `isValidTimeZone`).
 */
export function formatEmailDateTime(
  value: Date | string,
  timeZone: string,
): string | null {
  const date = typeof value === 'string' ? parseInstant(value) : value
  if (!date || Number.isNaN(date.getTime())) return null
  const part: Record<string, number> = {}
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') part[p.type] = Number(p.value)
  }
  const minutes = part.minute === 0
    ? ''
    : ` ${String(part.minute).padStart(2, '0')}`
  return `${part.day} ${
    MONTHS[part.month - 1]
  } ${part.year} à ${part.hour} h${minutes}`
}

/**
 * A date-only value as written, with no timezone conversion: « 1 janvier 2020 »
 * (the web app's `formatDateOnly`). Reads the leading `yyyy-MM-dd` of a date,
 * ISO or Postgres string. Returns null when it is not a real calendar date.
 */
export function formatDateOnly(value: string): string | null {
  const match = DATE_PREFIX.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  // Date.UTC normalises overflow (2026-02-30 → 2 March): a real date round-trips.
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null
  }
  return `${day} ${MONTHS[month - 1]} ${year}`
}

const PHONE_E164 = /^\+1(\d{3})(\d{3})(\d{4})$/

/** `+15145551234` → `514 555-1234` (the web app's `formatPhone`); anything else as is. */
export function formatPhone(value: string): string {
  const match = PHONE_E164.exec(value)
  return match ? `${match[1]} ${match[2]}-${match[3]}` : value
}

/**
 * The placeholder rule, as a regex source: `{{`, then any characters except
 * `{`, `}` and line breaks (CR, LF), then `}}`. The variable path is the
 * captured text with surrounding whitespace removed (`{{ clinic.name }}` is
 * `clinic.name`). The one repeated class stops at the next brace, so each
 * attempt scans its own stretch of text once and matching is linear.
 *
 * Email and PDF templates share it. The SQL checks (`save_email_template`,
 * Task 3.6; `update_template_version`, Task 3.31) must use the same rule:
 * `regexp_matches(text, '\{\{([^{}\r\n]*)\}\}', 'g')`, then `btrim` the capture.
 * (`btrim` removes spaces only, so SQL can only be stricter than `trim()`.)
 * Any `{{` or `}}` left after removing the matches is unclosed.
 */
export const PLACEHOLDER_SOURCE = String.raw`\{\{([^{}\r\n]*)\}\}`

/** One template variable (`email_template_defaults.variables`, `document_template_versions.variables`). */
export interface TemplateVariable {
  path: string
  label: string
  sample: string
  required: boolean
  kind: 'text' | 'date' | 'datetime' | 'url'
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The value at a dot path, through own properties only (never `constructor`, `__proto__`). */
export function valueAt(
  values: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = values
  for (const key of path.split('.')) {
    if (
      typeof current !== 'object' || current === null ||
      !Object.hasOwn(current, key)
    ) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * An `https:` URL (or local `http:` when allowed) without credentials,
 * normalised by the URL parser (which also drops tabs and line breaks); null
 * for anything else.
 */
export function safeUrl(value: string, allowLocalHttp = false): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  // `https://user:pass@host` hides the real host from a quick reading.
  if (url.username || url.password) return null
  if (url.protocol === 'https:') return url.href
  if (
    url.protocol === 'http:' && allowLocalHttp && LOCAL_HOSTS.has(url.hostname)
  ) return url.href
  return null
}

/**
 * A provided template value formatted for its variable's `kind`: `text` as
 * is (a finite number as its digits), `datetime` in the clinic timezone,
 * `date` with no conversion, `url` through `safeUrl`. Null when the value is
 * absent, blank or unusable for the kind; the caller decides whether that is
 * a missing value. Throws RangeError for an unknown timezone (check first
 * with `isValidTimeZone`).
 */
export function formatValue(
  variable: TemplateVariable,
  value: unknown,
  options: { timezone: string; allowLocalHttp?: boolean },
): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && variable.kind === 'text'
      ? String(value)
      : null
  }
  if (value instanceof Date) {
    return variable.kind === 'datetime'
      ? formatEmailDateTime(value, options.timezone)
      : null
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  switch (variable.kind) {
    case 'text':
      return value
    case 'datetime':
      return formatEmailDateTime(value, options.timezone)
    case 'date':
      return formatDateOnly(value)
    case 'url':
      return safeUrl(value, options.allowLocalHttp)
  }
}
