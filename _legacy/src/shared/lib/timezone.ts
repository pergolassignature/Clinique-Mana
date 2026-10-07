// src/shared/lib/timezone.ts
// Centralized timezone handling for the clinic
// All dates in the database are stored as UTC (timestamptz)
// The clinic operates in a specific timezone (default: America/Toronto for EST/EDT)

import { parse as dateFnsParse, parseISO, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz'

// Default clinic timezone - this should eventually come from clinic_settings
// America/Toronto handles both EST (winter) and EDT (summer) automatically
export const CLINIC_TIMEZONE = 'America/Toronto'

/**
 * Format a UTC date/ISO string for display in clinic timezone
 * Use this for all user-facing date displays
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @param formatStr - date-fns format string
 * @returns Formatted string in clinic timezone
 */
export function formatInClinicTimezone(
  date: Date | string,
  formatStr: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return formatInTimeZone(dateObj, CLINIC_TIMEZONE, formatStr, { locale: fr })
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
  return toZonedTime(dateObj, CLINIC_TIMEZONE)
}

/**
 * Convert clinic local time to UTC ISO string for storage
 * Use when constructing dates from form inputs (date picker + time picker)
 *
 * @param dateStr - Date string in yyyy-MM-dd format
 * @param timeStr - Time string in HH:mm format
 * @returns ISO string in UTC
 */
export function clinicTimeToUTC(dateStr: string, timeStr: string): string {
  // Parse the date and time as if they're in clinic timezone
  const localDateTime = dateFnsParse(
    `${dateStr} ${timeStr}`,
    'yyyy-MM-dd HH:mm',
    new Date()
  )
  // Convert from clinic timezone to UTC
  const utcDate = fromZonedTime(localDateTime, CLINIC_TIMEZONE)
  return utcDate.toISOString()
}

/**
 * Extract date string (yyyy-MM-dd) from UTC date in clinic timezone
 * Use for date input initial values
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Date string in yyyy-MM-dd format (in clinic timezone)
 */
export function getClinicDateString(date: Date | string): string {
  return formatInClinicTimezone(date, 'yyyy-MM-dd')
}

/**
 * Extract time string (HH:mm) from UTC date in clinic timezone
 * Use for time input initial values
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Time string in HH:mm format (in clinic timezone)
 */
export function getClinicTimeString(date: Date | string): string {
  return formatInClinicTimezone(date, 'HH:mm')
}

/**
 * Format a date for display with full day name
 * Example: "mercredi 21 janvier 2026"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted date string
 */
export function formatClinicDateFull(date: Date | string): string {
  return formatInClinicTimezone(date, 'EEEE d MMMM yyyy')
}

/**
 * Format a date for compact display
 * Example: "21 janv. 2026"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted date string
 */
export function formatClinicDateShort(date: Date | string): string {
  return formatInClinicTimezone(date, 'dd MMM yyyy')
}

/**
 * Format time for display
 * Example: "14:30"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted time string
 */
export function formatClinicTime(date: Date | string): string {
  return formatInClinicTimezone(date, 'HH:mm')
}

/**
 * Format date and time together
 * Example: "21 janv. 2026 à 14:30"
 *
 * @param date - Date object or ISO string (assumed UTC)
 * @returns Formatted datetime string
 */
export function formatClinicDateTime(date: Date | string): string {
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
  if (!dateStr) return '—'

  // Extract just the date part if it's a full ISO string
  const datePart = dateStr.includes('T') ? dateStr.split('T')[0]! : dateStr

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
