// src/shared/lib/timezone.ts
// Centralized timezone handling for the clinic
// All dates in the database are stored as UTC (timestamptz)
// The clinic operates in a specific timezone (default: America/Toronto for EST/EDT)

import { parseISO, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz'

// America/Toronto handles both EST (winter) and EDT (summer) automatically
const DEFAULT_CLINIC_TIMEZONE = 'America/Toronto'

// Set at sign-in from organizations.timezone (see core/access/AccessProvider).
let clinicTimezone = DEFAULT_CLINIC_TIMEZONE
// Last value passed to setClinicTimezone (valid or not), so repeated calls are no-ops.
let lastRequestedTimezone: string | null = null

/** Placeholder shown for missing or invalid dates. */
const EMPTY_DATE = '—'

/**
 * Set the clinic timezone (IANA name, e.g. 'America/Vancouver').
 * An invalid value is ignored: the current timezone is kept and a warning logged.
 */
export function setClinicTimezone(timezone: string): void {
  // Called on every render by the access provider: a repeated value (even an invalid one) is a no-op.
  if (timezone === lastRequestedTimezone) return
  lastRequestedTimezone = timezone
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    console.warn(`Invalid clinic timezone "${timezone}", keeping "${clinicTimezone}".`)
    return
  }
  clinicTimezone = timezone
}

export function getClinicTimezone(): string {
  return clinicTimezone
}

/** Restore the default clinic timezone (e.g. on sign-out). */
export function resetClinicTimezone(): void {
  clinicTimezone = DEFAULT_CLINIC_TIMEZONE
  lastRequestedTimezone = null
}

type DateInput = Date | string | null | undefined

function toValidDate(date: DateInput): Date | null {
  if (date === null || date === undefined || date === '') return null
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return Number.isNaN(dateObj.getTime()) ? null : dateObj
}

/**
 * Format a UTC date/ISO string for display in clinic timezone
 * Use this for all user-facing date displays
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @param formatStr - date-fns format string
 * @returns Formatted string in clinic timezone, or '—' if missing/invalid
 */
export function formatInClinicTimezone(
  date: DateInput,
  formatStr: string
): string {
  const dateObj = toValidDate(date)
  if (!dateObj) return EMPTY_DATE
  return formatInTimeZone(dateObj, clinicTimezone, formatStr, { locale: fr })
}

/**
 * Convert a UTC date/ISO string to a Date object representing clinic local time
 * The returned Date's "local" values (getHours, etc.) will reflect clinic timezone
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Date object in clinic timezone
 */
export function toClinicTime(date: Date | string): Date {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return toZonedTime(dateObj, clinicTimezone)
}

/**
 * Current time as a Date whose local values reflect the clinic timezone.
 */
export function clinicNow(): Date {
  return toZonedTime(new Date(), clinicTimezone)
}

/**
 * Whether a UTC date/ISO string falls on today's date in the clinic timezone.
 * Missing or invalid dates are never "today".
 */
export function isClinicToday(date: DateInput): boolean {
  return getClinicDateString(date) === getClinicDateString(new Date())
}

/**
 * Convert clinic local time to UTC ISO string for storage
 * Use when constructing dates from form inputs (date picker + time picker)
 *
 * Independent of the browser's own timezone.
 *
 * @param dateStr - Date string in yyyy-MM-dd format
 * @param timeStr - Time string in HH:mm or HH:mm:ss format
 * @returns ISO string in UTC
 */
export function clinicTimeToUTC(dateStr: string, timeStr: string): string {
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr
  // Interpret the wall-clock string in the clinic timezone, then convert to UTC
  return fromZonedTime(`${dateStr}T${time}`, clinicTimezone).toISOString()
}

/**
 * Extract date string (yyyy-MM-dd) from UTC date in clinic timezone
 * Use for date input initial values
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Date string in yyyy-MM-dd format (in clinic timezone)
 */
export function getClinicDateString(date: DateInput): string {
  return formatInClinicTimezone(date, 'yyyy-MM-dd')
}

/**
 * Extract time string (HH:mm) from UTC date in clinic timezone
 * Use for time input initial values
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Time string in HH:mm format (in clinic timezone)
 */
export function getClinicTimeString(date: DateInput): string {
  return formatInClinicTimezone(date, 'HH:mm')
}

/**
 * Format a date for display with full day name
 * Example: "mercredi 21 janvier 2026"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted date string
 */
export function formatClinicDateFull(date: DateInput): string {
  return formatInClinicTimezone(date, 'EEEE d MMMM yyyy')
}

/**
 * Format a date for compact display
 * Example: "21 janv. 2026"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted date string
 */
export function formatClinicDateShort(date: DateInput): string {
  return formatInClinicTimezone(date, 'dd MMM yyyy')
}

/**
 * Format time for display
 * Example: "14:30"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted time string
 */
export function formatClinicTime(date: DateInput): string {
  return formatInClinicTimezone(date, 'HH:mm')
}

/**
 * Format date and time together
 * Example: "21 janv. 2026 à 14:30"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted datetime string
 */
export function formatClinicDateTime(date: DateInput): string {
  return formatInClinicTimezone(date, "dd MMM yyyy 'à' HH:mm")
}

// =============================================================================
// DATE-ONLY FORMATTING (for database `date` type fields, NOT timestamptz)
// =============================================================================
// IMPORTANT: Use these functions for date-only fields like birthdays, expiry
// dates, event dates, etc. These fields are stored as `date` type in the
// database (not `timestamptz`) and should NOT have timezone conversion applied.
//
// If you use formatInClinicTimezone() on a date-only field, it will shift the
// date by the timezone offset (e.g., 2020-01-01 becomes 2019-12-31 at 19:00 EST).
// =============================================================================

/**
 * Format a date-only field (database `date` type) for display.
 * DO NOT use for timestamptz fields - use formatInClinicTimezone instead.
 *
 * @param dateStr - Date string in yyyy-MM-dd or ISO format (e.g., "2020-01-01")
 * @param formatStr - date-fns format string (default: 'd MMMM yyyy')
 * @returns Formatted date string without timezone conversion
 *
 * @example
 * // For birthdays, expiry dates, event dates stored as `date` type:
 * formatDateOnly('2020-01-01') // "1 janvier 2020"
 * formatDateOnly('2020-01-01', 'dd/MM/yyyy') // "01/01/2020"
 */
export function formatDateOnly(
  dateStr: string | null | undefined,
  formatStr: string = 'd MMMM yyyy'
): string {
  // Extract just the calendar date (handles 'yyyy-MM-dd', ISO and
  // Postgres 'yyyy-MM-dd HH:mm:ss+00' forms)
  const datePart = dateStr?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!datePart) return EMPTY_DATE

  // Parse as local date (no timezone conversion)
  const date = parseISO(datePart)

  return format(date, formatStr, { locale: fr })
}

/**
 * Format a date-only field with full day name.
 * Example: "mercredi 1 janvier 2020"
 *
 * @param dateStr - Date string in yyyy-MM-dd format
 * @returns Formatted date string
 */
export function formatDateOnlyFull(dateStr: string | null | undefined): string {
  return formatDateOnly(dateStr, 'EEEE d MMMM yyyy')
}

/**
 * Format a date-only field in short format.
 * Example: "1 janv. 2020"
 *
 * @param dateStr - Date string in yyyy-MM-dd format
 * @returns Formatted date string
 */
export function formatDateOnlyShort(dateStr: string | null | undefined): string {
  return formatDateOnly(dateStr, 'd MMM yyyy')
}
