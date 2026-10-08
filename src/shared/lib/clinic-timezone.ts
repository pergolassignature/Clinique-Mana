// The clinic timezone setting, without date-fns: AccessProvider (on the login page's critical
// path) sets it, while the formatting helpers that need date-fns live in ./timezone, which
// re-exports these. Import from '@/shared/lib/timezone' everywhere else.

// America/Toronto handles both EST (winter) and EDT (summer) automatically
const DEFAULT_CLINIC_TIMEZONE = 'America/Toronto'

// Set at sign-in from organizations.timezone (see core/access/AccessProvider).
let clinicTimezone = DEFAULT_CLINIC_TIMEZONE
// Last value passed to setClinicTimezone (valid or not), so repeated calls are no-ops.
let lastRequestedTimezone: string | null = null

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
