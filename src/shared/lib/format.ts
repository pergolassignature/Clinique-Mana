/**
 * Display and input helpers for the values the clinic types in French (fr-CA).
 *
 * Storage formats (matching the database checks):
 * - phone: E.164, North American numbers only (`+15145551234`);
 * - postal code: `H2X 1Y4`;
 * - rate: a fraction with up to 6 decimals (`0.09975` for 9,975 %).
 */

const PHONE_E164 = /^\+1(\d{3})(\d{3})(\d{4})$/
/**
 * Digits plus the separators people type or paste in a phone number (spaces, brackets, dots,
 * hyphens, en and em dashes); anything else (letters, « poste ») is refused.
 */
const PHONE_INPUT = /^\+?[\d\s().\-\u2013\u2014]+$/

/** `+15145551234` → `514 555-1234`; a missing number shows as `''`, an unrecognised one as is. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ''
  const match = PHONE_E164.exec(value)
  return match ? `${match[1]} ${match[2]}-${match[3]}` : value
}

/**
 * A typed North American number (10 digits, optionally led by 1) → E.164, or `null` when invalid.
 * With a leading `+` the country code is explicit, so it must be `+1` and 11 digits (`+65 6123 4567` is refused).
 */
export function parsePhone(input: string): string | null {
  const trimmed = input.trim()
  if (!PHONE_INPUT.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return digits.length === 11 && digits.startsWith('1') ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** `h2x1y4` → `H2X 1Y4`. A value that is not 6 characters is only uppercased (validation is the schema's job). */
export function formatPostalCode(value: string | null | undefined): string {
  if (!value) return ''
  const compact = value.replace(/\s/g, '').toUpperCase()
  return compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : compact
}

// 4 decimals in percent = the 6 a stored rate can have (numeric(7, 6)), so every stored rate round-trips.
const percentNumber = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 4 })

/**
 * `0.09975` → `9,975 %`: French decimal comma, no trailing zeros.
 *
 * The number comes from Intl; the « % » is appended after a no-break space (U+00A0) rather than
 * using Intl's `style: 'percent'`, whose space (U+00A0 or U+202F) differs between engines. The
 * output is the same everywhere and « % » never wraps onto its own line.
 */
export function formatRate(rate: number): string {
  return `${percentNumber.format(rate * 100)}\u00A0%`
}

const RATE_INPUT = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/

/**
 * A percentage typed by the user (`9,975`, `9.975`, `9,975 %`) → the stored fraction (`0.09975`),
 * rounded to 6 decimals like `numeric(7, 6)`. `null` when it is not a non-negative number; the
 * allowed range is the schema's job.
 */
export function parseRate(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/%$/, '')
  if (!RATE_INPUT.test(compact)) return null
  const percent = Number(compact.replace(',', '.'))
  // Round in percent units (6 decimals of the fraction = 4 of the percent), then divide an integer
  // by a power of ten so the result is the closest double to the decimal value (0.09975, not 0.09975000000000001).
  return Math.round(percent * 1e4) / 1e6
}

/**
 * Avatar initials: the first letter of the first two words, upper-cased (`Marie-Ève Tremblay` → `MT`).
 * Letters outside the BMP count as one; an empty name shows `?`.
 */
export function initialsOf(name: string | null | undefined): string {
  const letters = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
  return letters.length > 0 ? letters.join('').toLocaleUpperCase('fr-CA') : '?'
}
