import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { formatClinicDateFull, formatClinicTime, getClinicDateString } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import type { AgendaAppointment, ServiceOption } from '../api/parse'
import { appointmentTitle, isBusyOnly, stateLabel } from '../lib/display'

const A = 'modules.appointments.agenda'

/**
 * « Prochains jours » (plan R2): the appointments of the next days as a list by clinic day, each
 * a button that opens the editor; cancelled ones shown struck through.
 */
export function UpcomingList({
  appointments,
  services,
  professionalName,
  onOpen,
}: {
  appointments: readonly AgendaAppointment[]
  services: readonly ServiceOption[]
  professionalName: (id: string) => string
  onOpen: (a: AgendaAppointment) => void
}) {
  const visible = appointments.filter((a) => !isBusyOnly(a))
  if (visible.length === 0) return <EmptyState title={t(`${A}.upcomingEmpty`)} />
  const serviceName = (id: string | null) => services.find((s) => s.id === id)?.name ?? ''
  const days: { day: string; items: AgendaAppointment[] }[] = []
  for (const a of visible) {
    const day = getClinicDateString(a.startsAt)
    const last = days.at(-1)
    if (last?.day === day) last.items.push(a)
    else days.push({ day, items: [a] })
  }
  return (
    <div className="space-y-4">
      {days.map(({ day, items }) => (
        <section key={day} aria-label={formatClinicDateFull(items[0]!.startsAt)} className="space-y-1.5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatClinicDateFull(items[0]!.startsAt)}</h2>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpen(a)} className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-muted/50">
                  <span className="tabular w-24 text-muted-foreground">
                    {formatClinicTime(a.startsAt)} – {formatClinicTime(a.endsAt)}
                  </span>
                  <span className={a.state === 'cancelled' ? 'line-through' : 'font-medium'}>{appointmentTitle(a)}</span>
                  <span className="text-muted-foreground">{serviceName(a.serviceId)}</span>
                  <span className="text-muted-foreground">{professionalName(a.professionalId)}</span>
                  {a.state !== 'booked' && <Badge variant={a.state === 'cancelled' ? 'secondary' : 'success'}>{stateLabel(a.state)}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
