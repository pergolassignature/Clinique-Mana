import { z } from 'zod'
import { t } from '@/i18n'
import { withoutControlChars } from '@/core/settings/organization/schemas'
import type { SigningSettings } from './api'

/**
 * The « Signature électronique » forms, checked in the browser with the database's own rules so a
 * save is refused here first; the database stays the authority (20261008073909_core_signing.sql:
 * `signing_settings` checks, `private.signing_base_url_valid` and `set_signing_settings`).
 */

/** Any scheme followed by `//` (to tell `sign.x.ca`, which gets https://, from `http://…`). */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** The scheme and authority, lowercased: SQL compares the host case-sensitively (`[a-z0-9.-]`). */
const ORIGIN = /^[^/]*\/\/[^/]*/
const HTTPS_OR_LOCAL_FAKE = /^(https:\/\/|http:\/\/host\.docker\.internal:)/
/*
 * `private.signing_base_url_valid` (P3-30, P3-34): `https://` to a public DNS name, or exactly the
 * local fake; a port of at most 5 digits; no whitespace, `?` or `#` in the path; 2 048 characters.
 */
const LOCAL_FAKE = /^http:\/\/host\.docker\.internal:[0-9]{1,5}(\/[^\s?#]*)?$/
const HTTPS = /^https:\/\/([a-z0-9.-]+)(:[0-9]{1,5})?(\/[^\s?#]*)?$/
/** At least two labels of 1–63 characters, no leading or trailing hyphen, no empty label. */
const DNS_NAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
/** Names that stay on the machine or the private network. */
const PRIVATE_NAME = /(^|\.)(localhost|internal|local)$/
/** A last label of digits or `0x…`: URL parsers read the host as an IPv4 literal (`127.1`, `0x7f.1`). */
const NUMERIC_TLD = /(^|\.)([0-9]+|0x[0-9a-f]*)$/
const BASE_URL_MAX = 2048

/** The host part of an https address as typed (up to the port or the path), or null. */
const typedHost = (url: string) => /^https:\/\/(\[[^\]]*\]|[^/:?#]*)/.exec(url)?.[1] ?? null

/**
 * True when the host names no public server: an IP literal (v4 in any form, or v6), a single
 * label, `localhost` or a name under `.localhost`, `.internal` or `.local`. The database refuses
 * those (P3-34); this tells them from a typo, which gets the generic message.
 */
function notPublicHost(url: string): boolean {
  const host = typedHost(url)
  if (host === null) return false
  return host.startsWith('[') || !host.includes('.') || PRIVATE_NAME.test(host) || NUMERIC_TLD.test(host)
}

/** As `signing_settings_base_url_check` decides it. */
function storableBaseUrl(url: string): boolean {
  if (url.length > BASE_URL_MAX) return false
  if (LOCAL_FAKE.test(url)) return true
  const host = HTTPS.exec(url)?.[1]
  return host !== undefined && host.length <= 253 && DNS_NAME.test(host) && !PRIVATE_NAME.test(host) && !NUMERIC_TLD.test(host)
}

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
      .refine((v) => v === '' || LOCAL_FAKE.test(v) || !notPublicHost(v), { error: t('settings.signing.connection.publicHost'), abort: true })
      .refine((v) => v === '' || storableBaseUrl(v), { error: t('settings.validation.url') })
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
