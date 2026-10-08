/**
 * Renders a template (subject, body, button label) with its variables.
 *
 * - A placeholder follows `PLACEHOLDER_SOURCE`. Every one must be a catalogue
 *   variable: an unknown one fails (`unknown_variable`), a defence behind
 *   `save_email_template`'s check. Text that does not follow the rule (a
 *   `{{` with a line break before its `}}`) is literal text, escaped and
 *   visible, in every part.
 * - An invalid clinic timezone fails (`invalid_timezone`) instead of throwing.
 * - A required value that is missing fails closed (`missing_variable`), so an
 *   email is never sent with a hole in it. In `sample` mode (preview, test send)
 *   a missing value uses the catalogue's `sample`, inserted as written: samples
 *   are display text (« 15 octobre 2026 à 14 h 30 »), not raw values.
 * - Values are formatted by `kind` (`format.ts`): `datetime` in the clinic
 *   timezone, `date` with no conversion, `url` only `https:` (or local
 *   `http:` when the app itself is local). A value that cannot be formatted
 *   counts as missing.
 * - The body goes through `markup.ts` first and the values are inserted
 *   afterwards, HTML-escaped in the HTML part and plain in the text part, in a
 *   single pass: a value is never read as markup or as a placeholder.
 * - The subject is plain text on one line: control characters (line breaks
 *   included) and U+2028/U+2029 become spaces, and runs of spaces collapse.
 */
import {
  formatDateOnly,
  formatEmailDateTime,
  isValidTimeZone,
} from './format.ts'
import { escapeHtml, toHtml, toText } from './markup.ts'

/** One entry of `email_template_defaults.variables`. */
export interface TemplateVariable {
  path: string
  label: string
  sample: string
  required: boolean
  kind: 'text' | 'date' | 'datetime' | 'url'
}

/** A template and the values to fill it with. */
export interface RenderInput {
  subject: string
  body: string
  buttonLabel: string | null
  variables: TemplateVariable[]
  /** Nested object, read by dot path (`invitee.display_name`). */
  values: Record<string, unknown>
  /** Clinic timezone (`organizations.timezone`). */
  timezone: string
  /** Preview and test sends: missing values use the variable's `sample`. */
  sample?: boolean
  /** Accept `http://localhost` / `127.0.0.1` URLs (only when `APP_URL` is local). */
  allowLocalHttp?: boolean
}

/** The rendered parts, or the first variable that prevented rendering. */
export type RenderResult =
  | {
    ok: true
    subject: string
    html: string
    text: string
    buttonLabel: string | null
  }
  | { ok: false; code: 'missing_variable' | 'unknown_variable'; path: string }
  | { ok: false; code: 'invalid_timezone' }

/**
 * The placeholder rule, as a regex source: `{{`, then any characters except
 * `{`, `}` and line breaks (CR, LF), then `}}`. The variable path is the
 * captured text with surrounding whitespace removed (`{{ clinic.name }}` is
 * `clinic.name`). The one repeated class stops at the next brace, so each
 * attempt scans its own stretch of text once and matching is linear.
 *
 * The SQL `save_email_template` check (Task 3.6) must use the same rule:
 * `regexp_matches(text, '\{\{([^{}\r\n]*)\}\}', 'g')`, then `btrim` the capture.
 * (`btrim` removes spaces only, so SQL can only be stricter than `trim()`.)
 * Any `{{` or `}}` left after removing the matches is unclosed.
 */
export const PLACEHOLDER_SOURCE = String.raw`\{\{([^{}\r\n]*)\}\}`
const PLACEHOLDER = new RegExp(PLACEHOLDER_SOURCE, 'g')
/**
 * The same rule applied to the HTML of the body. Markup has turned each line
 * break into a tag (`<br>`, `</p><p …>`), so it also stops at `<`: escaped
 * text never contains one, and `{{<br>x}}` stays literal as `{{\nx}}` does.
 */
const HTML_PLACEHOLDER = /\{\{([^{}\r\n<]*)\}\}/g
/** Control characters (C0, DEL, C1) and the Unicode line/paragraph separators. */
const SUBJECT_BREAKS = /[\p{Cc}\u2028\u2029]/gu
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The value at a dot path, through own properties only (never `constructor`, `__proto__`). */
function valueAt(values: Record<string, unknown>, path: string): unknown {
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

/** A provided value formatted for its kind; null when it is absent or unusable. */
function format(
  variable: TemplateVariable,
  value: unknown,
  input: RenderInput,
): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && variable.kind === 'text'
      ? String(value)
      : null
  }
  if (value instanceof Date) {
    return variable.kind === 'datetime'
      ? formatEmailDateTime(value, input.timezone)
      : null
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  switch (variable.kind) {
    case 'text':
      return value
    case 'datetime':
      return formatEmailDateTime(value, input.timezone)
    case 'date':
      return formatDateOnly(value)
    case 'url':
      return safeUrl(value, input.allowLocalHttp)
  }
}

/** The subject on one line: breaks and control characters → spaces, runs collapsed. */
function oneLine(text: string): string {
  return text.replace(SUBJECT_BREAKS, ' ').replace(/ {2,}/g, ' ').trim()
}

/** Renders the template; see the module comment for the rules. */
export function renderTemplate(input: RenderInput): RenderResult {
  if (!isValidTimeZone(input.timezone)) {
    return { ok: false, code: 'invalid_timezone' }
  }

  const byPath = new Map(input.variables.map((v) => [v.path, v]))
  const htmlBody = toHtml(input.body)
  const textBody = toText(input.body)
  // The texts as written, then the parts actually filled (the text part drops
  // bold markers): whatever is filled has been checked.
  const texts: [string, RegExp][] = [
    [input.subject, PLACEHOLDER],
    [input.body, PLACEHOLDER],
    [input.buttonLabel ?? '', PLACEHOLDER],
    [htmlBody, HTML_PLACEHOLDER],
    [textBody, PLACEHOLDER],
  ]
  for (const [text, pattern] of texts) {
    for (const [, raw] of text.matchAll(pattern)) {
      const path = raw.trim()
      if (!byPath.has(path)) {
        return { ok: false, code: 'unknown_variable', path }
      }
    }
  }

  const resolved = new Map<string, string>()
  for (const variable of input.variables) {
    const formatted = format(
      variable,
      valueAt(input.values, variable.path),
      input,
    )
    if (formatted !== null) resolved.set(variable.path, formatted)
    else if (input.sample) resolved.set(variable.path, variable.sample)
    else if (variable.required) {
      return { ok: false, code: 'missing_variable', path: variable.path }
    } else resolved.set(variable.path, '')
  }

  const fill = (
    text: string,
    pattern = PLACEHOLDER,
    escape: (s: string) => string = (s) => s,
  ) =>
    text.replace(
      pattern,
      (_, raw: string) => escape(resolved.get(raw.trim()) ?? ''),
    )

  return {
    ok: true,
    subject: oneLine(fill(input.subject)),
    html: fill(htmlBody, HTML_PLACEHOLDER, escapeHtml),
    text: fill(textBody),
    buttonLabel: input.buttonLabel === null ? null : fill(input.buttonLabel),
  }
}
