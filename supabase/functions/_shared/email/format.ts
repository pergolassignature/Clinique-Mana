/**
 * FR-CA display formats for server-rendered text (emails, later PDFs),
 * mirroring the web app's `src/shared/lib/timezone.ts` and `format.ts`:
 *
 * - timestamps (`timestamptz`) are shown in the clinic timezone;
 * - date-only values (`date`) are calendar dates: never converted;
 * - dates read `d MMMM yyyy` with date-fns' French month names (« 1 janvier 2020 »);
 * - times use the Québec form « 14 h 30 », and « 9 h » on the hour (OQLF), the
 *   form the plan sets for emails, rather than the app's compact « 14:30 ».
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
 * A timestamp in the clinic timezone: « 15 octobre 2026 à 14 h 30 »
 * (the web app's `formatClinicDateTime`, in the plan's email form).
 * Accepts a Date, or a string with a time and an offset (ISO, JSON, or Postgres
 * text `2026-07-15 18:30:00+00`). Returns null for anything else, including a
 * bare date (read as UTC midnight it would shift a day, CLAUDE.md §9).
 * Throws RangeError for an unknown timezone.
 */
export function formatClinicDateTime(
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
