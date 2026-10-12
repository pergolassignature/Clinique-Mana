/**
 * Phone numbers as the SMS code reads them. The database has the same rule
 * (`private.sms_normalize_e164`, the one that stores); this copy lets a
 * function refuse an unreadable number before any RPC. Dependency-free.
 *
 * Numbers are personal data: nothing here logs one.
 */

/** A number as E.164 (`+15145551234`), or null when it cannot be read. */
export function normalizeE164(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits === '') return null
  if (raw.startsWith('+')) {
    return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** The last `count` digits of a number (10 by default): how the PBX matches a DID to a channel. */
export function lastDigits(
  input: string | null | undefined,
  count = 10,
): string {
  return (input ?? '').replace(/[^0-9]/g, '').slice(-count)
}
