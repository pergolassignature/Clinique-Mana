import { formatDateOnly } from '@/shared/lib/timezone'

/**
 * A professional's birthday (P4-564): a day of the year, « MM-DD », never a year — the clinic
 * marks the day and has no use for an age. Mirrors `professionals_birthday_check`.
 */
const BIRTHDAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
/** Days that exist in no year (29 February exists, in a leap year). */
const IMPOSSIBLE = /^(02-3[01]|(04|06|09|11)-31)$/

export const isBirthday = (value: string): boolean => BIRTHDAY.test(value) && !IMPOSSIBLE.test(value)

/**
 * « 14 mars ». Formatted as a date-only value of a leap year, so every day — 29 February
 * included — has a name and no timezone ever moves it (CLAUDE.md §9).
 */
export function birthdayLabel(value: string | null | undefined): string {
  return value && isBirthday(value) ? formatDateOnly(`2000-${value}`, 'd MMMM') : ''
}

/** « 01 » … « 31 ». */
export const BIRTHDAY_DAYS: readonly string[] = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))

/** The months, « 01 » … « 12 », with their French names. */
export const BIRTHDAY_MONTHS: readonly { value: string; label: string }[] = Array.from({ length: 12 }, (_, i) => {
  const value = String(i + 1).padStart(2, '0')
  return { value, label: formatDateOnly(`2000-${value}-01`, 'MMMM') }
})

/** The picker's two halves from a stored « MM-DD » (or the partial « MM- » / « -DD » it builds). */
export function splitBirthday(value: string): { month: string; day: string } {
  const [month = '', day = ''] = value.split('-')
  return { month, day }
}

/** « MM-DD » from the two halves; '' when neither is chosen, a partial value while one is missing. */
export const joinBirthday = (month: string, day: string): string => (month === '' && day === '' ? '' : `${month}-${day}`)
