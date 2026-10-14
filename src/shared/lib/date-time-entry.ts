// What a person types in a TimeField or DateField, read into the values the native inputs gave:
// `HH:mm` for a time, `yyyy-MM-dd` for a calendar date. Pure, no timezone: a time of day and a
// calendar date are wall-clock values (CLAUDE.md §9; `clinicTimeToUTC` makes an instant of them).

import { isCalendarDate } from './timezone'

const pad = (n: number) => String(n).padStart(2, '0')

/** `HH:mm` from `HH:mm` or `HH:mm:ss` (what the database gives), else '' (empty or unreadable). */
export function normalizeTime(value: string | null | undefined): string {
  const match = value?.match(/^([01][0-9]|2[0-3]):([0-5][0-9])(:[0-5][0-9](\.[0-9]+)?)?$/)
  return match ? `${match[1]}:${match[2]}` : ''
}

/** Minutes since midnight of an `HH:mm` value. */
export function timeToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}

/** `HH:mm` of a number of minutes since midnight (0–1439). */
export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/**
 * A typed time, 24-hour, as `HH:mm`; null when it cannot be read. Accepts « 7 », « 17 », « 0700 »,
 * « 730 », « 7:00 », « 7h », « 7 h 30 », « 7.30 », « 07:00:00 ». Never AM/PM (the clinic is in
 * Québec, decision « il faut toujours être clair »).
 */
export function parseTimeText(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '')
  if (s === '') return null
  let hours: number
  let minutes: number
  let match: RegExpMatchArray | null
  if ((match = s.match(/^([0-9]{1,2})$/))) {
    hours = Number(match[1])
    minutes = 0
  } else if ((match = s.match(/^([0-9]{1,2})([0-9]{2})$/))) {
    hours = Number(match[1])
    minutes = Number(match[2])
  } else if ((match = s.match(/^([0-9]{1,2})[:h.,]([0-9]{2})?(?::[0-9]{2})?$/))) {
    hours = Number(match[1])
    minutes = match[2] === undefined ? 0 : Number(match[2])
  } else {
    return null
  }
  if (hours > 23 || minutes > 59) return null
  return `${pad(hours)}:${pad(minutes)}`
}

/**
 * Whether a typed time is finished, so the field may hand it over while the person types (as the
 * native input did): « 0730 », « 7:30 », « 7 h 30 ». « 7 » or « 17 » could still grow (« 17 » →
 * « 1730 »), so they wait for Entrée or for the field to be left.
 */
export function isCompleteTimeText(text: string): boolean {
  const s = text.trim().toLowerCase().replace(/\s+/g, '')
  return /^[0-9]{4}$/.test(s) || /^[0-9]{1,2}[:h.,][0-9]{2}$/.test(s)
}

/** French month names without accents, to read « 12 oct 2026 » or « 1er février 2026 ». */
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** The month (1–12) a word names, when it names exactly one: « oct », « févr. », « juil ». */
function monthOfWord(word: string): number | null {
  const w = stripAccents(word.toLowerCase()).replace(/\.$/, '')
  if (w.length < 3) return null
  const found = MONTHS.map((name, index) => (name.startsWith(w) ? index + 1 : 0)).filter(Boolean)
  return found.length === 1 ? found[0]! : null
}

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999) return null
  const value = `${year}-${pad(month)}-${pad(day)}`
  return isCalendarDate(value) ? value : null
}

/**
 * A typed date as `yyyy-MM-dd`; null when it cannot be read or names no real day. Québec order:
 * « 12/10/2026 », « 12-10-2026 », « 12.10.2026 », « 12102026 » are 12 October; also ISO
 * « 2026-10-12 » and words « 12 oct 2026 », « 1er février 2026 ». The year has four digits.
 */
export function parseDateText(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (s === '') return null
  let match: RegExpMatchArray | null
  if ((match = s.match(/^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})$/))) {
    return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  if ((match = s.match(/^([0-9]{1,2})[-/. ]([0-9]{1,2})[-/. ]([0-9]{4})$/))) {
    return calendarDate(Number(match[3]), Number(match[2]), Number(match[1]))
  }
  if ((match = s.match(/^([0-9]{2})([0-9]{2})([0-9]{4})$/))) {
    return calendarDate(Number(match[3]), Number(match[2]), Number(match[1]))
  }
  if ((match = s.match(/^([0-9]{1,2})(?:er)? ?([a-zà-ÿ]+\.?) ?([0-9]{4})$/))) {
    const month = monthOfWord(match[2]!)
    return month === null ? null : calendarDate(Number(match[3]), month, Number(match[1]))
  }
  return null
}

/** Whether `value` (`yyyy-MM-dd`) is inside the optional bounds (inclusive, same format). */
export function isDateInRange(value: string, min?: string | null, max?: string | null): boolean {
  return (!min || value >= min) && (!max || value <= max)
}
