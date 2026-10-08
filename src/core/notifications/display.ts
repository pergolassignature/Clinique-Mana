import { differenceInCalendarDays } from 'date-fns'
import { t } from '@/i18n'
import { safeRedirect } from '@/core/auth/redirect'
import { formatClinicDateShort, toClinicTime } from '@/shared/lib/timezone'

/**
 * The notice's link if it is an app path (`/…`, same origin), else null. The database already
 * refuses anything else (`notifications.link_path` check); this keeps the UI from ever navigating
 * off the app should a bad row get through.
 */
export function noticeLinkPath(path: string | null): string | null {
  return path && safeRedirect(path) === path ? path : null
}

/**
 * How long ago a notice came, in a few words, each capitalised (it stands alone under the
 * title): « À l'instant », « Il y a 5 min », « Il y a 2 h » (same day), « Hier », « Il y a 3 j »,
 * then the date. Minutes and hours are elapsed time (a DST night is 23 or 25 hours long); days
 * are calendar days in the clinic timezone (toClinicTime), not the browser's.
 */
export function noticeAge(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000)
  if (minutes < 1) return t('notifications.age.now')
  if (minutes < 60) return t('notifications.age.minutes', { count: String(minutes) })
  const days = differenceInCalendarDays(toClinicTime(new Date(now)), toClinicTime(createdAt))
  if (days === 0) return t('notifications.age.hours', { count: String(Math.floor(minutes / 60)) })
  if (days === 1) return t('notifications.age.yesterday')
  if (days < 7) return t('notifications.age.days', { count: String(days) })
  return formatClinicDateShort(createdAt)
}
