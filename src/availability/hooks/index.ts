// src/availability/hooks/index.ts

export {
  useAppointments,
  useAppointmentsByProfessional,
  useAppointmentsForWeek,
  useClientAppointments,
  clientAppointmentKeys,
  type ClientAppointmentInfo,
} from './use-appointments'

export { useCalendarDnd, type DragContext, type DragPreview, type DragState, type CalendarDndCallbacks } from './use-calendar-dnd'

export { useAvailabilityState } from './use-availability-state'

export { useAvailabilityData, type AvailabilityData } from './use-availability-data'

export {
  calendarAuditKeys,
  useCalendarAuditLog,
  useAppointmentAuditLog,
  useProfessionalCalendarAuditLog,
} from './use-calendar-audit'
