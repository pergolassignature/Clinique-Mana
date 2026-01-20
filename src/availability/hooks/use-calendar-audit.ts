// src/availability/hooks/use-calendar-audit.ts

import { useQuery } from '@tanstack/react-query'
import { fetchAppointmentAuditLog, type FetchAuditLogParams } from '../api'

export const calendarAuditKeys = {
  all: ['calendar-audit'] as const,
  professional: (professionalId: string) =>
    [...calendarAuditKeys.all, 'professional', professionalId] as const,
  entity: (entityType: 'appointment' | 'availability_block', entityId: string) =>
    [...calendarAuditKeys.all, 'entity', entityType, entityId] as const,
}

export function useCalendarAuditLog(params: FetchAuditLogParams) {
  return useQuery({
    queryKey: params.entityId
      ? calendarAuditKeys.entity(params.entityType!, params.entityId)
      : params.professionalId
        ? calendarAuditKeys.professional(params.professionalId)
        : calendarAuditKeys.all,
    queryFn: () => fetchAppointmentAuditLog(params),
    enabled: !!(params.professionalId || params.entityId),
  })
}

export function useAppointmentAuditLog(appointmentId: string) {
  return useQuery({
    queryKey: calendarAuditKeys.entity('appointment', appointmentId),
    queryFn: () =>
      fetchAppointmentAuditLog({
        entityType: 'appointment',
        entityId: appointmentId,
      }),
    enabled: !!appointmentId,
  })
}

export function useProfessionalCalendarAuditLog(professionalId: string, limit?: number) {
  return useQuery({
    queryKey: calendarAuditKeys.professional(professionalId),
    queryFn: () =>
      fetchAppointmentAuditLog({
        professionalId,
        limit,
      }),
    enabled: !!professionalId,
  })
}
