/**
 * French typography for server-written text (emails and PDFs), the same rule
 * as the web app's `t()` (`src/i18n/index.ts` `frenchSpacing`; `french.test.ts`
 * repeats that file's cases: keep the two in step).
 *
 * Applied to **template text before its placeholders are filled**, never to
 * a value: an email address, a URL, a file name or a time inserted from a
 * value is never rewritten. Template text itself keeps its times and URLs:
 * only a plain space before the mark is replaced (« 14:30 », « https:// »
 * and « ?a=1 » have none). Placeholders (`{{ path }}`, Go's `{{ .Email }}`)
 * hold no such space either, so they pass through.
 */

/** U+202F, the narrow no-break space of French typography. */
export const NNBSP = '\u202F'

/**
 * A narrow no-break space (U+202F) before « ? ! ; : » and inside « », so the
 * mark never wraps onto a line of its own. Idempotent; a no-break space
 * (U+00A0) already before « ? ! ; : » is kept as written.
 */
export function frenchSpacing(text: string): string {
  return text
    .replace(/ ([?!;:])/g, `${NNBSP}$1`)
    .replace(/«[ \u00A0\u202F]?/g, `«${NNBSP}`)
    .replace(/[ \u00A0\u202F]?»/g, `${NNBSP}»`)
}
