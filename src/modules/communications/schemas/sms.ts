import { z } from 'zod'
import { t } from '@/i18n'
import type { SmsSettings } from '../api/sms-settings'
import { formatPhone, toE164 } from '../lib/phone'

/*
 * The forms of « Textos » and Paramètres → Textos (batch SM). Each mirrors a SQL rule
 * (`private.validate_sms_setting`, `set_sms_consent`, `private.send_sms`); the database checks it
 * again and answers a French P0001.
 */

const S = 'modules.communications.sms'

/** The longest text the PBX path takes (`sms_messages.body`). */
export const SMS_BODY_MAX = 1600
export const CONSENT_NOTE_MAX = 500

/** A typed number that must read as one (« 514 555-1234 »); the output is E.164. */
const phoneField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const e164 = toE164(value)
    if (e164 === null) {
      ctx.addIssue({ code: 'custom', message: t(`${S}.phone.invalid`) })
      return z.NEVER
    }
    return e164
  })

/** An optional text field: empty → null. */
const optional = (inner: z.ZodType<string, string>) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(inner.nullable())

// --- Paramètres → Textos ---------------------------------------------------------------------

export const pbxSchema = z.object({
  baseUrl: optional(
    z
      .string()
      .transform((value) => value.replace(/\/+$/, ''))
      .pipe(z.string().regex(/^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/i, t(`${S}.settings.pbx.baseUrlInvalid`))),
  ),
  clientId: optional(z.string().max(200, t(`${S}.settings.pbx.clientIdTooLong`))),
  did: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') return null
      const e164 = toE164(value)
      if (e164 === null) {
        ctx.addIssue({ code: 'custom', message: t(`${S}.phone.invalid`) })
        return z.NEVER
      }
      return e164
    }),
})
export type PbxValues = z.input<typeof pbxSchema>

export function toPbxValues(settings: SmsSettings): PbxValues {
  return { baseUrl: settings.baseUrl ?? '', clientId: settings.clientId ?? '', did: formatPhone(settings.did) }
}

/** « ARRÊT » in any case, with or without its accent, as a word (the SQL's `\marret\M` over unaccent). */
export function mentionsStop(text: string): boolean {
  return /(^|[^\p{L}\p{N}])arret($|[^\p{L}\p{N}])/u.test(text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())
}

const autoText = z.string().trim().min(20, t(`${S}.settings.texts.length`)).max(480, t(`${S}.settings.texts.length`))

export const textsSchema = z.object({
  consentText: autoText.refine(mentionsStop, t(`${S}.settings.texts.consentNeedsStop`)),
  optOutReply: autoText,
})
export type TextsValues = z.input<typeof textsSchema>

export function toTextsValues(settings: SmsSettings): TextsValues {
  return { consentText: settings.consentText, optOutReply: settings.optOutReply }
}

export const testSchema = z.object({ to: phoneField })
export type TestValues = z.input<typeof testSchema>

// --- « Textos » --------------------------------------------------------------------------------

export const consentSchema = z.object({
  phone: phoneField,
  note: z.string().trim().max(CONSENT_NOTE_MAX, t(`${S}.consent.noteTooLong`)),
})
export type ConsentValues = z.input<typeof consentSchema>

export const composerSchema = z.object({
  body: z.string().trim().min(1, t(`${S}.composer.required`)).max(SMS_BODY_MAX, t(`${S}.composer.tooLong`)),
})
export type ComposerValues = z.input<typeof composerSchema>
