import { t } from '@/i18n'
import type { AgendaReference } from '../api/agenda'
import type { AgendaAppointment, AppointmentMode, AppointmentState, ExceptionKind, Presence } from '../api/parse'

const V = 'modules.appointments.audit.values'

export const stateLabel = (state: AppointmentState): string => t(`${V}.appointments.state.${state}`)
export const modeLabel = (mode: AppointmentMode): string => t(`${V}.appointments.mode.${mode}`)
export const presenceLabel = (presence: Presence): string => t(`${V}.appointment_participants.presence.${presence}`)
export const exceptionKindLabel = (kind: ExceptionKind): string => t(`${V}.availability_exceptions.kind.${kind}`)

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
/** « lundi » for 1 … « dimanche » for 7. */
export const weekdayLabel = (weekday: number): string => WEEKDAYS[weekday - 1] ?? ''

/** What a block shows first: the clients' names, a personal appointment's label, or « Occupé ». */
export function appointmentTitle(a: AgendaAppointment): string {
  if (a.isPersonal) return a.personalLabel ?? t('modules.appointments.agenda.busy')
  return a.participants.map((p) => p.name).filter(Boolean).join(' et ') || t('modules.appointments.agenda.noClient')
}

/** Whether the appointment still holds its slot on the grid (a cancelled one kept on the schedule does). */
export const isActive = (a: AgendaAppointment) => a.state === 'held' || a.state === 'booked' || a.state === 'confirmed' || a.state === 'completed' || a.keptOnSchedule

/** The block's tone: confirmed, booked, held (hatched: proposed, not accepted yet), cancelled (kept), personal. */
export function blockClasses(a: AgendaAppointment): string {
  if (a.isPersonal) return 'border-border bg-muted text-muted-foreground'
  if (a.state === 'held')
    return 'border-dashed border-primary/50 bg-card text-foreground [background-image:repeating-linear-gradient(135deg,transparent_0_6px,var(--muted)_6px_10px)]'
  if (a.state === 'cancelled') return 'border-dashed border-border bg-card text-muted-foreground line-through'
  if (a.state === 'confirmed' || a.state === 'completed') return 'border-primary/40 bg-primary/10 text-foreground'
  return 'border-primary/30 bg-card text-foreground'
}

/** The state's badge: held and booked outlined, cancelled muted, confirmed and completed green. */
export function stateBadgeVariant(state: AppointmentState): 'outline' | 'secondary' | 'success' {
  if (state === 'cancelled') return 'secondary'
  if (state === 'held' || state === 'booked') return 'outline'
  return 'success'
}

/** The services a professional offers (her titles, or a clinic service). */
export function servicesFor(reference: AgendaReference, professionalId: string) {
  const titles = reference.professionals.find((p) => p.id === professionalId)?.titleIds ?? []
  return reference.services.filter((s) => s.titleIds.length === 0 || s.titleIds.some((id) => titles.includes(id)))
}

/** Another professional's personal appointment, as `list_agenda` gives it to the staff: busy time only. */
export const isBusyOnly = (a: AgendaAppointment) => a.isPersonal && a.serviceId === null && a.personalLabel === null && a.participants.length === 0
