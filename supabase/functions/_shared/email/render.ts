/**
 * Renders a template (subject, body, button label) with its variables.
 *
 * - Every `{{ path }}` must be a catalogue variable: an unknown one fails
 *   (`unknown_variable`), a defence behind `save_email_template`'s check.
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
 * - The subject is plain text on one line (line breaks become spaces).
 */
import { formatClinicDateTime, formatDateOnly } from './format.ts'
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

const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g
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
 * An `https:` URL (or local `http:` when allowed), normalised by the URL parser
 * (which also drops tabs and line breaks); null for anything else.
 */
export function safeUrl(value: string, allowLocalHttp = false): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
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
      ? formatClinicDateTime(value, input.timezone)
      : null
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  switch (variable.kind) {
    case 'text':
      return value
    case 'datetime':
      return formatClinicDateTime(value, input.timezone)
    case 'date':
      return formatDateOnly(value)
    case 'url':
      return safeUrl(value, input.allowLocalHttp)
  }
}

/** Renders the template; see the module comment for the rules. */
export function renderTemplate(input: RenderInput): RenderResult {
  const byPath = new Map(input.variables.map((v) => [v.path, v]))
  const texts = [input.subject, input.body, input.buttonLabel ?? '']
  for (const text of texts) {
    for (const [, path] of text.matchAll(PLACEHOLDER)) {
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

  const fill = (text: string, escape: (s: string) => string = (s) => s) =>
    text.replace(
      PLACEHOLDER,
      (_, path: string) => escape(resolved.get(path) ?? ''),
    )

  return {
    ok: true,
    subject: fill(input.subject).replace(/\s*[\r\n]+\s*/g, ' ').trim(),
    html: fill(toHtml(input.body), escapeHtml),
    text: fill(toText(input.body)),
    buttonLabel: input.buttonLabel === null ? null : fill(input.buttonLabel),
  }
}
