// Value normalisers for the GOrendezvous import (plan §9, batch I1 prep). Pure functions, no I/O.
// Each returns the normalised value, or null when the cell is empty or cannot be read; the readers
// turn a null from a non-empty cell into a warning or a rejection reason. Nothing here logs a value.

/** Lower case, accents stripped, spaces collapsed: the comparison form of a name or a label. */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** A header's matching key: folded, then every non-alphanumeric character removed (« Cell Phone » = « cell_phone » = « CellPhone »). */
export const headerKey = (value) => foldText(value).replace(/[^a-z0-9]/g, '')

/**
 * A person's name as stored: trimmed, inner spaces collapsed. A name typed all in capitals or all in
 * lower case (« TREMBLAY », « marie-ève ») gets each word's first letter capitalised, hyphenated
 * and apostrophe parts too (« Marie-Ève », « D'Amours »); a mixed-case name is kept as typed
 * (« McDonald », « de la Fontaine »). Null when empty.
 */
export function normalizeName(value) {
  const text = String(value ?? '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return null
  const letters = text.replace(/[^\p{L}]/gu, '')
  const mixed = letters !== letters.toUpperCase() && letters !== letters.toLowerCase()
  if (mixed) return text
  return text.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** An email address, trimmed and lower-cased; null when empty or not an address. */
export function normalizeEmail(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '' || text.length > 254 || !EMAIL.test(text)) return null
  return text
}

/**
 * A phone as E.164 (`+15145551234`) from its number and the export's separate country code column
 * (« 1 », « +1 », empty). Without a country code, a 10-digit North American number (or 11 digits
 * starting with 1) is +1; another country's code needs 8 to 15 digits in all. Null otherwise. The
 * same rule as `private.sms_normalize_e164` and the app's `toE164`.
 */
export function toE164(number, countryCode = '') {
  const raw = String(number ?? '').trim()
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits === '') return null
  const code = String(countryCode ?? '').replace(/[^0-9]/g, '')
  if (raw.startsWith('+')) return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null
  if (code !== '' && code !== '1') {
    const full = digits.startsWith(code) && digits.length > 10 ? digits : code + digits.replace(/^0+/, '')
    return /^[1-9][0-9]{7,14}$/.test(full) ? `+${full}` : null
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits[1])) return `+${digits}`
  return null
}

/** The last 10 digits of an E.164 number (the duplicate rules' phone key), or null. */
export const phoneKey = (e164) => (e164 && e164.replace(/[^0-9]/g, '').length >= 10 ? e164.replace(/[^0-9]/g, '').slice(-10) : null)

const pad = (n) => String(n).padStart(2, '0')

/** True when y-m-d is a real calendar day. */
function isCalendarDay(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return d <= days[m - 1]
}

/**
 * A calendar date (« YYYY-MM-DD », never through a time zone: a birthday stays the day it was).
 * Reads `2021-03-04`, `2021/03/04`, `2021-03-04 00:00:00` or `…T…` (the date part only), and an
 * Excel serial day number (`44259`, what a date cell becomes in some CSV saves). A day-first or
 * month-first form (`04/03/2021`) is refused: it cannot be told apart. Null when empty or invalid,
 * or outside 1900–2100.
 */
export function parseDateOnly(value) {
  const text = String(value ?? '').trim()
  if (text === '') return null
  let match = /^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})(?:[ T].*)?$/.exec(text)
  if (match) {
    const [y, m, d] = match.slice(1).map(Number)
    if (y < 1900 || y > 2100 || !isCalendarDay(y, m, d)) return null
    return `${y}-${pad(m)}-${pad(d)}`
  }
  match = /^([0-9]{5})(?:[.,]0+)?$/.exec(text)
  if (match) {
    // Excel's day 1 is 1900-01-01 and it counts a 29 February 1900 that never was: day 60 and
    // after are one day early, hence the epoch 1899-12-30. UTC arithmetic: no zone involved.
    const date = new Date(Date.UTC(1899, 11, 30) + Number(match[1]) * 86_400_000)
    const y = date.getUTCFullYear()
    if (y < 1900 || y > 2100) return null
    return `${y}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }
  return null
}

/**
 * An amount in cents from a money cell as Excel writes it in French or English: « 1 234,56 $ »,
 * « 1234.56 », « -21,74 », « (21,74) » (negative), « $1,234.56 ». The decimal separator is the last
 * « , » or « . » followed by one or two digits; any other is a thousands separator. Null when empty
 * or not an amount. Integer arithmetic only (no float rounding).
 */
export function parseMoneyCents(value) {
  let text = String(value ?? '')
    .replace(/[\u00a0\u202f\s]/g, '')
    .replace(/\$|CAD/gi, '')
  if (text === '') return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  }
  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return null
  const decimal = /[.,]([0-9]{1,2})$/.exec(text)
  let units = text
  let fraction = '00'
  if (decimal) {
    units = text.slice(0, decimal.index)
    fraction = decimal[1].padEnd(2, '0')
  }
  // What is left before the decimals: digits with optional thousands separators, consistently grouped by three.
  if (units === '') units = '0'
  if (!/^[0-9]{1,3}([.,][0-9]{3})*$|^[0-9]+$/.test(units)) return null
  const cents = Number(units.replace(/[.,]/g, '')) * 100 + Number(fraction)
  if (!Number.isSafeInteger(cents)) return null
  return negative ? -cents : cents
}

/** « F », « Femme », « Female » → female; « M », « Homme », « Male » → male; « Autre », « Other », « X » → other; else null. */
export function normalizeSex(value) {
  const key = foldText(value)
  if (['f', 'femme', 'female', 'feminin'].includes(key)) return 'female'
  if (['m', 'h', 'homme', 'male', 'masculin'].includes(key)) return 'male'
  if (['autre', 'other', 'x', 'non binaire', 'non-binaire'].includes(key)) return 'other'
  return null
}

/** « fr », « Français », « French » → fr; « en », « Anglais », « English » → en; else null. */
export function normalizeLanguage(value) {
  const key = foldText(value)
  if (['fr', 'fr-ca', 'francais', 'french'].includes(key)) return 'fr'
  if (['en', 'en-ca', 'en-us', 'anglais', 'english'].includes(key)) return 'en'
  return null
}

/** « Oui », « Yes », « True », « 1 », « X » → true; « Non », « No », « False », « 0 », empty → false; else null. */
export function parseYesNo(value) {
  const key = foldText(value)
  if (['oui', 'yes', 'true', 'vrai', '1', 'x', 'o', 'y'].includes(key)) return true
  if (['', 'non', 'no', 'false', 'faux', '0', 'n'].includes(key)) return false
  return null
}

/** A Canadian postal code as « A1A 1A1 », else the trimmed text (another country's), null when empty. */
export function normalizePostalCode(value) {
  const text = String(value ?? '').trim().toUpperCase()
  if (text === '') return null
  const compact = text.replace(/\s+/g, '')
  return /^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : text
}

const PROVINCES = {
  qc: 'QC', quebec: 'QC', on: 'ON', ontario: 'ON', nb: 'NB', 'nouveau-brunswick': 'NB', 'new brunswick': 'NB', ns: 'NS',
  'nouvelle-ecosse': 'NS', 'nova scotia': 'NS', pe: 'PE', 'ile-du-prince-edouard': 'PE', 'prince edward island': 'PE',
  nl: 'NL', 'terre-neuve-et-labrador': 'NL', 'newfoundland and labrador': 'NL', mb: 'MB', manitoba: 'MB', sk: 'SK',
  saskatchewan: 'SK', ab: 'AB', alberta: 'AB', bc: 'BC', 'colombie-britannique': 'BC', 'british columbia': 'BC',
  yt: 'YT', yukon: 'YT', nt: 'NT', 'territoires du nord-ouest': 'NT', 'northwest territories': 'NT', nu: 'NU', nunavut: 'NU',
}

/** A province as one of the 13 codes (« Québec », « QC », « Quebec » → QC); null when empty or unknown. */
export function normalizeProvince(value) {
  return PROVINCES[foldText(value)] ?? null
}
