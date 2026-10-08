import { t } from '@/i18n'
import { formatInClinicTimezone } from '@/shared/lib/timezone'

const NB = '\u00a0'
const INTEGER = /^\d{1,2}$/

/** « 4 h 30 », « 7 h » (non-breaking spaces). */
const hourText = (hour: number, minute = 0) => (minute === 0 ? `${hour}${NB}h` : `${hour}${NB}h${NB}${String(minute).padStart(2, '0')}`)

/**
 * The French schedule of a job. `localHour` (a clinic-local job, P3-22) wins over the cron entry,
 * which then only ticks hourly. Cron entries are in UTC: a daily time is converted to the clinic
 * timezone on today's date, so it follows daylight saving time. Handled: `M * * * *`,
 * `*\/N * * * *` and `M H * * *`; anything else is shown as written.
 */
export function scheduleLabel(cron: string | null, localHour: number | null): string {
  if (localHour !== null) return t('settings.jobs.schedule.localDaily', { time: hourText(localHour) })
  if (cron === null) return t('settings.jobs.schedule.none')
  const [minute = '', hour = '', ...rest] = cron.trim().split(/\s+/)
  const everyDay = rest.length === 3 && rest.every((field) => field === '*')
  const m = INTEGER.test(minute) ? Number(minute) : NaN
  const step = /^\*\/(\d{1,2})$/.exec(minute)?.[1]
  if (everyDay && hour === '*' && m < 60) return t('settings.jobs.schedule.hourly')
  if (everyDay && hour === '*' && step !== undefined) return t('settings.jobs.schedule.everyMinutes', { count: step })
  if (everyDay && INTEGER.test(hour) && Number(hour) < 24 && m < 60) {
    const now = new Date()
    const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hour), m))
    const [clinicHour = 0, clinicMinute = 0] = formatInClinicTimezone(utc, 'H:m').split(':').map(Number)
    return t('settings.jobs.schedule.daily', { time: hourText(clinicHour, clinicMinute) })
  }
  return t('settings.jobs.schedule.custom', { cron })
}
