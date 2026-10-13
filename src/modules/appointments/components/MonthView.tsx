import { t } from '@/i18n'
import { formatClinicTime, formatDateOnlyFull, getClinicDateString } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import type { AgendaAppointment } from '../api/parse'
import { appointmentTitle } from '../lib/display'
import { monthGrid, sameMonth } from '../lib/time'

const A = 'modules.appointments.agenda'
const WEEKDAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

/**
 * « Mois » (plan R2): six weeks from the Monday before the 1st, each day with its number of
 * appointments (cancelled ones not counted) and the first three; a day opens in « Jour ».
 */
export function MonthView({ day, today, appointments, onDay }: { day: string; today: string; appointments: readonly AgendaAppointment[]; onDay: (day: string) => void }) {
  const days = monthGrid(day)
  const byDay = new Map<string, AgendaAppointment[]>()
  for (const a of appointments) {
    if (a.state === 'cancelled') continue
    const key = getClinicDateString(a.startsAt)
    byDay.set(key, [...(byDay.get(key) ?? []), a])
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div className="grid min-w-[44rem] grid-cols-7">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="border-b border-border px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const items = byDay.get(d) ?? []
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDay(d)}
              className={cn(
                'min-h-24 border-b border-r border-border p-1.5 text-left align-top last:border-r-0 hover:bg-muted/50',
                !sameMonth(d, day) && 'bg-muted/30 text-muted-foreground',
              )}
              aria-label={t(`${A}.monthDay`, { day: formatDateOnlyFull(d), count: String(items.length) })}
            >
              <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs tabular', d === today && 'bg-primary text-primary-foreground')}>
                {Number(d.slice(8))}
              </span>
              <span className="mt-1 block space-y-0.5">
                {items.slice(0, 3).map((a) => (
                  <span key={a.id} className="block truncate text-xs">
                    <span className="tabular text-muted-foreground">{formatClinicTime(a.startsAt)}</span> {appointmentTitle(a)}
                  </span>
                ))}
                {items.length > 3 && <span className="block text-xs text-muted-foreground">{t(`${A}.more`, { count: String(items.length - 3) })}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
