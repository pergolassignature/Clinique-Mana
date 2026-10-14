import { t } from '@/i18n'
import { formatClinicDateShort, formatClinicDateTime } from '@/shared/lib/timezone'
import type { CalendarSetup } from '../api/calendar'

const C = 'modules.appointments.calendar'

/** The app path Google sends the browser back to (`_shared/google-calendar/env.ts` RETURN_PATH). */
export const CALENDAR_RETURN_PATH = '/mon-agenda/agenda-google'

/** The line under a connected Google agenda: which account and since when. */
export function calendarAccountLine(setup: CalendarSetup): string | null {
  const since = setup.connected_at ? formatClinicDateShort(setup.connected_at) : null
  if (setup.account_email && since) return t(`${C}.connectedAs`, { email: setup.account_email, date: since })
  return since ? t(`${C}.connectedSince`, { date: since }) : null
}

/** Why it must be reconnected, in plain French (the reason is a code). */
export function calendarReconnectWhy(reason: string | null): string {
  return t(reason === 'scope_missing' ? `${C}.reconnectScope` : `${C}.reconnectWhy`)
}

/** The sync line: when the busy times were last read and how many are ahead, or why the last read failed. */
export function calendarSyncLine(setup: CalendarSetup): string {
  if (setup.last_sync_error) {
    return setup.last_synced_at
      ? t(`${C}.syncErrorSince`, { date: formatClinicDateTime(setup.last_synced_at) })
      : t(`${C}.syncErrorNever`)
  }
  if (!setup.last_synced_at) return t(`${C}.neverSynced`)
  const count = setup.busy_count ?? 0
  const key = count === 0 ? 'lastSyncedNone' : count === 1 ? 'lastSyncedOne' : 'lastSyncedOther'
  return t(`${C}.${key}`, { date: formatClinicDateTime(setup.last_synced_at), count: String(count) })
}
