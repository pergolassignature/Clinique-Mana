import { z } from 'zod'
import { t } from '@/i18n'
import { withoutControlChars } from '@/core/settings/organization/schemas'
import type { SigningSettings } from './api'

/**
 * The « Signature électronique » forms, checked in the browser with the database's own rules so a
 * save is refused here first; the database stays the authority (20261008073909_core_signing.sql:
 * `signing_settings` checks and `set_signing_settings`).
 */

/** Any scheme followed by `//` (to tell `sign.x.ca`, which gets https://, from `http://…`). */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** The scheme and authority, lowercased: SQL compares the host case-sensitively (`[a-z0-9.-]`). */
const ORIGIN = /^[^/]*\/\/[^/]*/
const HTTPS_OR_LOCAL_FAKE = /^(https:\/\/|http:\/\/host\.docker\.internal:)/
/** `signing_settings_base_url_check`: https, or the local fake (P3-30); no whitespace, `?` or `#` in the path. */
const BASE_URL = /^(https:\/\/[a-z0-9.-]+(:[0-9]+)?|http:\/\/host\.docker\.internal:[0-9]+)(\/[^\s?#]*)?$/
const BASE_URL_MAX = 2048

/**
 * As `set_signing_settings` stores it (trimmed, without trailing slashes), with the scheme and host
 * lowercased, and `https://` added when typed without a scheme. Empty stays empty (it clears).
 */
function normalizeBaseUrl(value: string): string {
  const url = value.replace(/\/+$/, '')
  if (url === '') return ''
  return (URL_SCHEME.test(url) ? url : `https://${url}`).replace(ORIGIN, (origin) => origin.toLowerCase())
}

/** « Adresse de l'instance »: optional (empty clears it, and nothing can be sent). */
export const baseUrlSchema = z.object({
  base_url: withoutControlChars(
    z
      .string()
      .transform(normalizeBaseUrl)
      .refine((v) => v === '' || HTTPS_OR_LOCAL_FAKE.test(v), { error: t('settings.validation.https'), abort: true })
      .refine((v) => v === '' || (v.length <= BASE_URL_MAX && BASE_URL.test(v)), { error: t('settings.validation.url') })
      .transform((v) => (v === '' ? null : v)),
  ),
})

/** « Délai d'expiration (jours) »: a whole number of days, 1 to 60 (`signing_settings` check). */
export const expirySchema = z.object({
  expiry_days: z
    .string()
    .trim()
    .refine((v) => /^[0-9]{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 60, { error: t('settings.signing.send.expiryRange') })
    .transform(Number),
})

export const toBaseUrlFormValues = (settings: SigningSettings): z.input<typeof baseUrlSchema> => ({ base_url: settings.base_url ?? '' })
export const toExpiryFormValues = (settings: SigningSettings): z.input<typeof expirySchema> => ({ expiry_days: String(settings.expiry_days) })
