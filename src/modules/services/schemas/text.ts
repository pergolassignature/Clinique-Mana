import { z } from 'zod'
import { t } from '@/i18n'

/**
 * Text rules of `private.is_tidy_text` (20261008133511), which the module's names and
 * descriptions go through: Unicode White_Space stripped at both ends, inner runs folded to one
 * space, at most `max` characters (code points, as `char_length`), no control or invisible
 * character. The same rules as Professionnels' names (its `schemas/text.ts`).
 */
const SPACE_CLASS = '[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+'
const EDGE_SPACES = new RegExp(`^${SPACE_CLASS}|${SPACE_CLASS}$`, 'g')
const INNER_SPACES = new RegExp(SPACE_CLASS, 'g')
const INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class -- lone combining marks (U+034F, U+FE00–FE0F) are what is refused
  /[\p{Cc}\u0080-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202F\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/u

/** As the database stores it: stripped at the ends, inner spaces folded. */
export function tidy(value: string): string {
  return value.replace(EDGE_SPACES, '').replace(INNER_SPACES, ' ')
}

const length = (value: string) => [...value].length

interface TidyTextOptions {
  max: number
  /** Without it, empty is allowed and becomes null. */
  requiredMessage?: string
}

/** A tidy text field: string in, the stored string (or null when empty and optional) out. */
export function tidyText(options: TidyTextOptions & { requiredMessage: string }): z.ZodType<string, string>
export function tidyText(options: TidyTextOptions): z.ZodType<string | null, string>
export function tidyText({ max, requiredMessage }: TidyTextOptions): z.ZodType<string | null, string> {
  return z
    .string()
    .transform(tidy)
    .superRefine((v, ctx) => {
      if (v === '') {
        if (requiredMessage) ctx.addIssue({ code: 'custom', message: requiredMessage })
        return
      }
      if (length(v) > max) ctx.addIssue({ code: 'custom', message: t('modules.services.validation.maxChars', { max: String(max) }) })
      else if (INVISIBLE.test(v)) ctx.addIssue({ code: 'custom', message: t('modules.services.validation.invisibleChars') })
    })
    .transform((v) => (v === '' ? null : v))
}
