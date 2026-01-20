// src/availability/hooks/index.ts

export {
  useAppointments,
  useAppointmentsByProfessional,
  useAppointmentsForWeek,
} from './use-appointments'

export { useCalendarDnd, type DragContext, type DragPreview, type DragState, type CalendarDndCallbacks } from './use-calendar-dnd'

export { useAvailabilityState } from './use-availability-state'

export {
  calendarAuditKeys,
  useCalendarAuditLog,
  useAppointmentAuditLog,
  useProfessionalCalendarAuditLog,
} from './use-calendar-audit'
