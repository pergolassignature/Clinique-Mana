/**
 * Phone numbers in « Textos » (batch SM). The database stores E.164 (`+15145551234`,
 * `private.sms_normalize_e164`); the page reads and writes the clinic's usual form
 * (« 514 555-1234 »). The same rule as the database and `_shared/sms/phone.ts`, so a form refuses
 * an unreadable number before any call; the database checks it again.
 *
 * Numbers are personal data: never in a URL, a log or a report.
 */

/** A typed number as E.164, or null when it cannot be read (10 digits, or 11 starting with 1, or `+` and 8 to 15 digits). */
export function toE164(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits === '') return null
  if (raw.startsWith('+')) return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** A stored number as read here: « 514 555-1234 » for a North American number, else E.164 as is. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const match = /^\+1([2-9][0-9]{2})([0-9]{3})([0-9]{4})$/.exec(e164)
  return match ? `${match[1]} ${match[2]}-${match[3]}` : e164
}
