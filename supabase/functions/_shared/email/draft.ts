/**
 * The request schema of an unsaved template (« Modèles » editor), shared by
 * `email-preview` and `email-test-send`. Rules as `save_email_template`
 * (Task 3.6): trimmed of spaces, tabs, CR and LF only (SQL
 * `btrim(…, E' \t\r\n')`, not JavaScript's wider `trim()`); subject 1–200
 * characters on one line, body 1–10 000, button label at most 60, an empty
 * one meaning « no button ». Lengths count characters (code points), as SQL
 * does.
 *
 * `draftBraceError` is SQL's « unclosed » check
 * (`private.email_placeholder_error`): any `{{` or `}}` left once the
 * placeholders are removed, over subject, body and button label joined by
 * line breaks. Unknown placeholders are found by the renderer. Both handlers
 * run it before rendering, so a draft with both faults is told about the
 * braces first (SQL names the unknown placeholder first); either way the
 * draft is refused, and preview and test send answer alike.
 */
import { z } from 'zod'
import { PLACEHOLDER_SOURCE } from '../format.ts'

/** `email_template_defaults.key`: `<module>.<name>`. */
export const templateKeySchema = z.string().max(100).regex(
  /^[a-z_]+\.[a-z0-9_]+$/,
)

/** SQL's trim set: space, tab, CR, LF. */
const TRIMMED = new Set([' ', '\t', '\r', '\n'])

/** `btrim(s, E' \t\r\n')`: index scans, no regex backtracking on long runs. */
export function btrim(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && TRIMMED.has(s[start])) start++
  while (end > start && TRIMMED.has(s[end - 1])) end--
  return s.slice(start, end)
}

/** Trimmed text of 1 to `max` characters (code points). */
const text = (max: number) =>
  z.string().transform(btrim).refine((s) =>
    s.length > 0 && [...s].length <= max
  )

/** The draft's subject. */
export const draftSubjectSchema = text(200).refine((s) => !/[\r\n]/.test(s))
/** The draft's body. */
export const draftBodySchema = text(10_000)
/** The draft's button label; empty or null → null. */
export const draftButtonSchema = z.string().transform(btrim)
  .refine((s) => [...s].length <= 60)
  .nullable()
  .transform((s) => s || null)

/** SQL's French message for an unclosed brace (shown as is by the editor). */
export const UNCLOSED_BRACES_MESSAGE = 'Accolades non fermées dans le texte.'

const PLACEHOLDER = new RegExp(PLACEHOLDER_SOURCE, 'g')

/**
 * `UNCLOSED_BRACES_MESSAGE` when a `{{` or `}}` is left once the placeholders
 * are removed from the draft's texts (joined by line breaks), else null.
 */
export function draftBraceError(
  ...texts: (string | null | undefined)[]
): string | null {
  const rest = texts.filter((t) => typeof t === 'string').join('\n')
    .replace(PLACEHOLDER, '')
  return rest.includes('{{') || rest.includes('}}')
    ? UNCLOSED_BRACES_MESSAGE
    : null
}
