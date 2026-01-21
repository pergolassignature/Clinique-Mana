// src/availability/hooks/use-appointments.ts

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import type { Appointment, AppointmentFormData } from '../types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const appointmentKeys = {
  all: ['appointments'] as const,
  lists: () => [...appointmentKeys.all, 'list'] as const,
  list: (filters?: { professionalId?: string; weekStart?: string }) =>
    [...appointmentKeys.lists(), filters] as const,
  details: () => [...appointmentKeys.all, 'detail'] as const,
  detail: (id: string) => [...appointmentKeys.details(), id] as const,
}

// =============================================================================
// HOOKS
// =============================================================================

export function useAppointments(professionalId?: string | null) {
  const queryClient = useQueryClient()

  const { data: appointments = [], isLoading, error } = useQuery({
    queryKey: appointmentKeys.list({ professionalId: professionalId || undefined }),
    queryFn: async (): Promise<Appointment[]> => {
      let query = supabase
        .from('appointments')
        .select(`
          id,
          professional_id,
          service_id,
          start_time,
          duration_minutes,
          status,
          mode,
          notes_internal,
          cancelled_at,
          cancellation_reason,
          cancellation_fee_applied,
          cancellation_fee_percent,
          created_at,
          updated_at,
          appointment_clients (
            client_id
          )
        `)

      if (professionalId) {
        query = query.eq('professional_id', professionalId)
      }

      const { data, error } = await query.order('start_time', { ascending: true })

      if (error) throw error

      return (data || []).map((row): Appointment => {
        const clients = row.appointment_clients as unknown as Array<{ client_id: string }> || []
        return {
          id: row.id,
          professionalId: row.professional_id,
          clientIds: clients.map(c => c.client_id),
          serviceId: row.service_id,
          startTime: row.start_time,
          durationMinutes: row.duration_minutes,
          status: row.status,
          mode: row.mode,
          notesInternal: row.notes_internal,
          cancelledAt: row.cancelled_at,
          cancellationReason: row.cancellation_reason,
          cancellationFeeApplied: row.cancellation_fee_applied,
          cancellationFeePercent: row.cancellation_fee_percent,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: AppointmentFormData): Promise<Appointment> => {
      const startDateTime = new Date(`${data.startDate}T${data.startTime}:00`)

      // Create appointment
      const { data: appointment, error: aptError } = await supabase
        .from('appointments')
        .insert({
          professional_id: data.professionalId,
          service_id: data.serviceId,
          start_time: startDateTime.toISOString(),
          duration_minutes: data.durationMinutes,
          status: 'confirmed',
          mode: data.mode,
          notes_internal: data.notesInternal,
        })
        .select()
        .single()

      if (aptError) throw aptError

      // Add clients
      if (data.clientIds.length > 0) {
        const clientRecords = data.clientIds.map((clientId, index) => ({
          appointment_id: appointment.id,
          client_id: clientId,
          role: index === 0 ? 'primary' : 'other',
        }))

        const { error: clientsError } = await supabase
          .from('appointment_clients')
          .insert(clientRecords)

        if (clientsError) throw clientsError
      }

      return {
        id: appointment.id,
        professionalId: appointment.professional_id,
        clientIds: data.clientIds,
        serviceId: appointment.service_id,
        startTime: appointment.start_time,
        durationMinutes: appointment.duration_minutes,
        status: appointment.status,
        mode: appointment.mode,
        notesInternal: appointment.notes_internal,
        createdAt: appointment.created_at,
        updatedAt: appointment.updated_at,
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AppointmentFormData> }) => {
      const updates: Record<string, unknown> = {}

      if (data.professionalId) updates.professional_id = data.professionalId
      if (data.serviceId) updates.service_id = data.serviceId
      if (data.durationMinutes) updates.duration_minutes = data.durationMinutes
      if (data.notesInternal !== undefined) updates.notes_internal = data.notesInternal
      if (data.mode) updates.mode = data.mode

      if (data.startDate && data.startTime) {
        const startDateTime = new Date(`${data.startDate}T${data.startTime}:00`)
        updates.start_time = startDateTime.toISOString()
      }

      const { error } = await supabase
        .from('appointments')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'confirmed',
          cancelled_at: null,
          cancellation_reason: null,
        })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() })
    },
  })

  return {
    appointments,
    isLoading,
    error,
    createAppointment: createMutation.mutate,
    updateAppointment: (id: string, data: Partial<AppointmentFormData>) =>
      updateMutation.mutate({ id, data }),
    cancelAppointment: cancelMutation.mutate,
    restoreAppointment: restoreMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isCancelling: cancelMutation.isPending,
  }
}

export function useAppointmentsByProfessional(
  appointments: Appointment[],
  professionalId: string | null
) {
  return useMemo(() => {
    if (!professionalId) return []
    return appointments.filter(apt => apt.professionalId === professionalId)
  }, [appointments, professionalId])
}

export function useAppointmentsForWeek(
  appointments: Appointment[],
  weekStartDate: Date
) {
  return useMemo(() => {
    const weekStart = new Date(weekStartDate)
    weekStart.setHours(0, 0, 0, 0)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    return appointments.filter(apt => {
      const aptDate = new Date(apt.startTime)
      return aptDate >= weekStart && aptDate < weekEnd
    })
  }, [appointments, weekStartDate])
}
