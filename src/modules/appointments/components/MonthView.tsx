import { useMemo } from 'react'
import { CalendarGridProvider, CalendarMonthGrid, type MonthDayRowProps } from '@pergolas-signature/calendar-ui'
import { Cake } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicTime, formatDateOnlyFull, getClinicDateString } from '@/shared/lib/timezone'
import { PHONE_QUERY, useMediaQuery } from '@/shared/lib/use-media-query'
import { useNow } from '@/shared/lib/use-now'
import type { AgendaAppointment } from '../api/parse'
import { gridDay, toGridItems, type AgendaGridItem } from '../lib/calendar-grid'
import { appointmentTitle, isBusyOnly } from '../lib/display'
import { lookOf, useAgendaGridPorts } from './agenda-grid-ports'

const A = 'modules.appointments.agenda'

/**
 * A row of the phone month's day list: the times, then the people (the grid's own row would write
 * the time twice, since MANA's short kind is the time). Named like the block: its marks and state.
 */
function MonthDayRow({ item, onSelect }: MonthDayRowProps<AgendaGridItem>) {
  const a = item.appointment
  return (
    <button
      type="button"
      data-testid="month-day-row"
      aria-label={lookOf(a, { professionalName: () => '', showProfessional: false }).label}
      onClick={() => onSelect(item)}
      className="flex min-h-11 w-full items-baseline gap-3 border-b border-border px-4 py-2 text-left text-sm hover:bg-muted/50"
    >
      <span className="tabular w-28 shrink-0 text-muted-foreground">
        {formatClinicTime(a.startsAt)} – {formatClinicTime(a.endsAt)}
      </span>
      <span className="truncate font-medium">{appointmentTitle(a)}</span>
    </button>
  )
}

/** The lines a day draws; the rest is « +n autres », a click on which opens the day. */
const MAX_LINES = 3

/**
 * « Mois » (plan R2) on PS Hub's `@pergolas-signature/calendar-ui` (stage 3b there): six weeks from
 * the Monday before the 1st, each day with its first three appointments (cancelled ones left out)
 * and « +n autres ». A day's number, its empty part and « +n autres » open it in « Jour »; an
 * appointment opens its own sheet, as in the other views, except another professional's personal one
 * (busy time, nothing to open: its day opens). Nothing is dragged from a month.
 */
export function MonthView({
  day,
  appointments,
  onDay,
  onOpen,
  professionalName,
  serviceColour,
  birthdays,
}: {
  day: string
  appointments: readonly AgendaAppointment[]
  onDay: (day: string) => void
  onOpen: (appointment: AgendaAppointment) => void
  professionalName: (id: string) => string
  serviceColour?: (serviceId: string | null) => string | null
  /** P4-564: the professionals whose birthday falls on a day, by `yyyy-MM-dd`. */
  birthdays?: ReadonlyMap<string, readonly string[]>
}) {
  const phone = useMediaQuery(PHONE_QUERY)
  const nowMs = useNow(60_000)
  const now = useMemo(() => new Date(nowMs), [nowMs])
  const items = useMemo(() => toGridItems(appointments.filter((a) => a.state !== 'cancelled')), [appointments])
  const dayNote = useMemo(
    () =>
      function BirthdayNote({ day: date }: { day: Date }) {
        const names = birthdays?.get(getClinicDateString(date)) ?? []
        if (names.length === 0) return null
        return (
          // On a phone the note opens the day's list, which has the list's gutter.
          <span className="flex items-center gap-1 text-xs text-primary max-sm:px-4 max-sm:pb-1 max-sm:pt-2">
            <Cake aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{names.join(', ')}</span>
          </span>
        )
      },
    [birthdays],
  )
  const ports = useAgendaGridPorts({ professionalName, showProfessional: false, serviceColour, dayNote, dayRow: MonthDayRow })
  // The day's number, for a screen reader: its date, its number of appointments, its birthdays.
  const dayLabel = (date: Date, count: number) => {
    const key = getClinicDateString(date)
    const label = t(`${A}.monthDay`, { day: formatDateOnlyFull(key), count: String(count) })
    const names = birthdays?.get(key) ?? []
    return names.length > 0 ? `${label} · ${t(`${A}.monthBirthday`, { names: names.join(', ') })}` : label
  }
  const openDay = (date: Date) => onDay(getClinicDateString(date))
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <CalendarGridProvider ports={ports}>
        <CalendarMonthGrid
          anchorDate={gridDay(day)}
          items={items}
          onSelectItem={(item) => (isBusyOnly(item.appointment) ? openDay(item.start) : onOpen(item.appointment))}
          isMobile={phone}
          now={now}
          isLoading={false}
          slotActivation="single"
          onSlotClick={openDay}
          onOpenDay={openDay}
          dayLabel={dayLabel}
          maxLines={MAX_LINES}
          canMoveItem={() => false}
          onMoveItem={() => undefined}
        />
      </CalendarGridProvider>
    </div>
  )
}
