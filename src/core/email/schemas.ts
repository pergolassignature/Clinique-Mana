import { z } from 'zod'
import { t } from '@/i18n'
import type { EmailSender } from './api'

/**
 * The « Courriels » forms, checked in the browser with the database's own rules so a save is
 * refused here first; the database stays the authority (20261008050047_core_email.sql):
 * - templates: `save_email_template` (trim, lengths, `private.email_placeholder_error`);
 * - sender: `set_email_sender` and `private.is_mailbox` (one bare mailbox);
 * - sending domain: `set_email_sending_domain`.
 * Lengths count characters (code points), as SQL does.
 */

/** The placeholder rule shared with the renderer (`_shared/format.ts`) and the SQL check. */
export const PLACEHOLDER_SOURCE = String.raw`\{\{([^{}\r\n]*)\}\}`

/** SQL's message for a lone `{{` or `}}` (`_shared/email/draft.ts` answers the same). */
export const UNCLOSED_BRACES_MESSAGE = t('settings.email.validation.unclosedBraces')

/** Index scans: no regex backtracking on a long run of spaces. */
function trimSet(s: string, set: ReadonlySet<string>): string {
  let start = 0
  let end = s.length
  while (start < end && set.has(s[start]!)) start++
  while (end > start && set.has(s[end - 1]!)) end--
  return s.slice(start, end)
}

const TRIMMED = new Set([' ', '\t', '\r', '\n'])
const SPACE = new Set([' '])

/** SQL `btrim(s, E' \t\r\n')`: spaces, tabs, CR and LF only (JavaScript's trim() removes more). */
export function btrim(s: string): string {
  return trimSet(s, TRIMMED)
}

/** Length in characters (code points), like SQL `length`. */
const length = (s: string) => [...s].length

/**
 * `private.email_placeholder_error`: the first placeholder whose path (spaces trimmed) is not
 * declared, else any `{{` / `}}` left once the placeholders are removed; null when the text is
 * sound. The SQL messages, word for word.
 */
export function placeholderError(text: string, paths: readonly string[]): string | null {
  for (const match of text.matchAll(new RegExp(PLACEHOLDER_SOURCE, 'g'))) {
    // SQL btrim without a set removes spaces only.
    const path = trimSet(match[1]!, SPACE)
    if (!paths.includes(path)) {
      return t('settings.email.validation.unknownVariable', { variable: `{{${[...path].slice(0, 80).join('')}}}` })
    }
  }
  const rest = text.replace(new RegExp(PLACEHOLDER_SOURCE, 'g'), '')
  return rest.includes('{{') || rest.includes('}}') ? UNCLOSED_BRACES_MESSAGE : null
}

/** One template field: trimmed, then each rule in the SQL order with its message. */
const templateField = (rules: ((s: string) => string | null)[]) =>
  z
    .string()
    .transform(btrim)
    .superRefine((value, ctx) => {
      for (const rule of rules) {
        const message = rule(value)
        if (message) {
          ctx.addIssue({ code: 'custom', message })
          return
        }
      }
    })

/**
 * The editor's draft of a template whose catalogue declares `paths`: subject (1–200, one line),
 * text (1–10 000) and button label (at most 60; empty means no button, sent as null).
 */
export function templateDraftSchema(paths: readonly string[]) {
  const placeholders = (s: string) => placeholderError(s, paths)
  return z.object({
    subject: templateField([
      (s) => (s === '' ? t('settings.email.validation.subjectRequired') : null),
      (s) => (length(s) > 200 ? t('settings.email.validation.subjectTooLong') : null),
      (s) => (/[\r\n]/.test(s) ? t('settings.email.validation.subjectOneLine') : null),
      placeholders,
    ]),
    body: templateField([
      (s) => (s === '' ? t('settings.email.validation.bodyRequired') : null),
      (s) => (length(s) > 10_000 ? t('settings.email.validation.bodyTooLong') : null),
      placeholders,
    ]),
    button_label: templateField([(s) => (length(s) > 60 ? t('settings.email.validation.buttonTooLong') : null), placeholders]).transform(
      (s) => s || null,
    ),
  })
}

/** The editor's form values (the button label empty for no button). */
export type TemplateDraftValues = { subject: string; body: string; button_label: string }

/** `private.is_mailbox`: one bare address (no display name, no second address), at most 254 characters. */
const MAILBOX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/

/** Whether `address` is one bare mailbox, as `private.is_mailbox` decides. */
export function isMailbox(address: string): boolean {
  return length(address) <= 254 && MAILBOX.test(address)
}

/** The local part the « Adresse d'envoi » field accepts (lowercased first, as `set_email_sender` stores it). */
const FROM_LOCAL = /^[a-z0-9._-]+$/
/** The From header refuses control characters, `<`, `>` and `"` (`email_settings.from_name` check). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const FROM_NAME_REFUSED = /[\u0000-\u001f\u007f-\u009f<>"]/

/** The sender card's form values: the address is typed without its domain. */
type SenderFormValues = { from_name: string; from_local: string; reply_to: string }

/** The sender card's schema for the clinic's current sending `domain`: the arguments of `set_email_sender`. */
export function senderSchema(domain: string) {
  return z
    .object({
      from_name: z
        .string()
        .transform(btrim)
        .superRefine((value, ctx) => {
          const message =
            value === ''
              ? t('settings.validation.nameRequired')
              : length(value) > 80
                ? t('settings.validation.maxLength', { max: '80' })
                : FROM_NAME_REFUSED.test(value)
                  ? t('settings.email.validation.fromNameChars')
                  : null
          if (message) ctx.addIssue({ code: 'custom', message })
        }),
      from_local: z
        .string()
        .transform((v) => btrim(v).toLowerCase())
        .superRefine((value, ctx) => {
          const message =
            value === ''
              ? t('settings.email.validation.fromLocalRequired')
              : length(value) > 64
                ? t('settings.validation.maxLength', { max: '64' })
                : !FROM_LOCAL.test(value)
                  ? t('settings.email.validation.fromLocalChars')
                  : !isMailbox(`${value}@${domain}`)
                    ? t('settings.email.validation.fromAddressTooLong')
                    : null
          if (message) ctx.addIssue({ code: 'custom', message })
        }),
      reply_to: z
        .string()
        .transform(btrim)
        .refine((v) => v === '' || isMailbox(v), { error: t('settings.email.validation.mailbox') })
        .transform((v) => v || null),
    })
    .transform(({ from_name, from_local, reply_to }) => ({ from_name, from_address: `${from_local}@${domain}`, reply_to }))
}

/** A stored sender as the card's form values. */
export function toSenderFormValues(sender: EmailSender): SenderFormValues {
  return { from_name: sender.from_name, from_local: sender.from_address.split('@')[0] ?? '', reply_to: sender.reply_to ?? '' }
}

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/** « Domaine d'envoi »: trimmed and lowercased, then `set_email_sending_domain`'s rule. */
export const sendingDomainSchema = z
  .string()
  .transform((v) => btrim(v).toLowerCase())
  .refine((v) => v.length <= 253 && DOMAIN.test(v), { error: t('settings.email.validation.domain') })
