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
export const isActive = (a: AgendaAppointment) => a.state === 'booked' || a.state === 'confirmed' || a.state === 'completed' || a.keptOnSchedule

/** The block's tone: confirmed, booked, cancelled (kept), personal. */
export function blockClasses(a: AgendaAppointment): string {
  if (a.isPersonal) return 'border-border bg-muted text-muted-foreground'
  if (a.state === 'cancelled') return 'border-dashed border-border bg-card text-muted-foreground line-through'
  if (a.state === 'confirmed' || a.state === 'completed') return 'border-primary/40 bg-primary/10 text-foreground'
  return 'border-primary/30 bg-card text-foreground'
}

/** The services a professional offers (her titles, or a clinic service). */
export function servicesFor(reference: AgendaReference, professionalId: string) {
  const titles = reference.professionals.find((p) => p.id === professionalId)?.titleIds ?? []
  return reference.services.filter((s) => s.titleIds.length === 0 || s.titleIds.some((id) => titles.includes(id)))
}
