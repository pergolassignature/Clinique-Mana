// src/availability/hooks/use-availability-state.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import type { AvailabilityBlock, Appointment } from '../types'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const availabilityKeys = {
  all: ['availability'] as const,
  lists: () => [...availabilityKeys.all, 'list'] as const,
  list: (filters?: { professionalId?: string }) =>
    [...availabilityKeys.lists(), filters] as const,
}

export const appointmentStateKeys = {
  all: ['appointments-state'] as const,
  lists: () => [...appointmentStateKeys.all, 'list'] as const,
  list: (filters?: { professionalId?: string }) =>
    [...appointmentStateKeys.lists(), filters] as const,
}

export const calendarBusyBlocksKeys = {
  all: ['calendar-busy-blocks'] as const,
  lists: () => [...calendarBusyBlocksKeys.all, 'list'] as const,
  list: (filters?: { professionalId?: string }) =>
    [...calendarBusyBlocksKeys.lists(), filters] as const,
}

// =============================================================================
// HOOKS
// =============================================================================

export function useAvailabilityState(professionalId?: string | null) {
  const queryClient = useQueryClient()

  // Fetch availability blocks
  const { data: availabilityBlocks = [], isLoading: isLoadingBlocks } = useQuery({
    queryKey: availabilityKeys.list({ professionalId: professionalId || undefined }),
    queryFn: async (): Promise<AvailabilityBlock[]> => {
      let query = supabase
        .from('availability_blocks')
        .select('*')

      if (professionalId) {
        query = query.eq('professional_id', professionalId)
      }

      const { data, error } = await query.order('start_time', { ascending: true })

      if (error) throw error

      return (data || []).map((row): AvailabilityBlock => ({
        id: row.id,
        professionalId: row.professional_id,
        type: row.type,
        label: row.label,
        startTime: row.start_time,
        endTime: row.end_time,
        isRecurring: false, // Not stored in DB yet
        allowedServiceIds: row.allowed_service_ids,
        visibleToClients: row.visible_to_clients,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        source: 'manual',
      }))
    },
  })

  // Fetch imported calendar busy blocks (from external calendars)
  const { data: calendarBusyBlocks = [], isLoading: isLoadingCalendarBlocks } = useQuery({
    queryKey: calendarBusyBlocksKeys.list({ professionalId: professionalId || undefined }),
    queryFn: async (): Promise<AvailabilityBlock[]> => {
      let query = supabase
        .from('calendar_busy_blocks')
        .select('*')

      if (professionalId) {
        query = query.eq('professional_id', professionalId)
      }

      const { data, error } = await query.order('start_time', { ascending: true })

      if (error) {
        // Table might not exist yet - return empty array
        console.warn('calendar_busy_blocks query failed:', error)
        return []
      }

      return (data || []).map((row): AvailabilityBlock => ({
        id: row.id,
        professionalId: row.professional_id,
        type: 'imported',
        label: 'Occupé',
        startTime: row.start_time,
        endTime: row.end_time,
        isRecurring: false,
        visibleToClients: false,
        createdAt: row.synced_at,
        updatedAt: row.synced_at,
        source: row.source === 'google_calendar' ? 'google' : 'manual',
        externalEventId: row.external_event_id,
        isAllDay: row.is_all_day,
      }))
    },
  })

  // Fetch appointments
  const { data: appointments = [], isLoading: isLoadingAppointments } = useQuery({
    queryKey: appointmentStateKeys.list({ professionalId: professionalId || undefined }),
    queryFn: async (): Promise<Appointment[]> => {
      let query = supabase
        .from('appointments')
        .select(`
          *,
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

  // Availability mutations
  const createBlockMutation = useMutation({
    mutationFn: async (block: Omit<AvailabilityBlock, 'id' | 'createdAt' | 'updatedAt'>) => {
      const { data, error } = await supabase
        .from('availability_blocks')
        .insert({
          professional_id: block.professionalId,
          type: block.type,
          label: block.label,
          start_time: block.startTime,
          end_time: block.endTime,
          allowed_service_ids: block.allowedServiceIds,
          visible_to_clients: block.visibleToClients,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: availabilityKeys.lists() })
    },
  })

  const updateBlockMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AvailabilityBlock> }) => {
      const dbUpdates: Record<string, unknown> = {}
      if (updates.type) dbUpdates.type = updates.type
      if (updates.label !== undefined) dbUpdates.label = updates.label
      if (updates.startTime) dbUpdates.start_time = updates.startTime
      if (updates.endTime) dbUpdates.end_time = updates.endTime
      if (updates.allowedServiceIds !== undefined) dbUpdates.allowed_service_ids = updates.allowedServiceIds
      if (updates.visibleToClients !== undefined) dbUpdates.visible_to_clients = updates.visibleToClients

      const { error } = await supabase
        .from('availability_blocks')
        .update(dbUpdates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: availabilityKeys.lists() })
    },
  })

  const deleteBlockMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('availability_blocks')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: availabilityKeys.lists() })
    },
  })

  // Appointment mutations
  const createAppointmentMutation = useMutation({
    mutationFn: async (appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>) => {
      const { data, error } = await supabase
        .from('appointments')
        .insert({
          professional_id: appointment.professionalId,
          service_id: appointment.serviceId,
          start_time: appointment.startTime,
          duration_minutes: appointment.durationMinutes,
          status: appointment.status,
          mode: appointment.mode,
          notes_internal: appointment.notesInternal,
        })
        .select()
        .single()

      if (error) throw error

      // Add clients if any
      if (appointment.clientIds.length > 0) {
        const clientRecords = appointment.clientIds.map((clientId, index) => ({
          appointment_id: data.id,
          client_id: clientId,
          role: index === 0 ? 'primary' : 'other',
        }))

        await supabase.from('appointment_clients').insert(clientRecords)
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentStateKeys.lists() })
    },
  })

  const updateAppointmentMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Appointment> }) => {
      const dbUpdates: Record<string, unknown> = {}
      if (updates.professionalId) dbUpdates.professional_id = updates.professionalId
      if (updates.serviceId) dbUpdates.service_id = updates.serviceId
      if (updates.startTime) dbUpdates.start_time = updates.startTime
      if (updates.durationMinutes) dbUpdates.duration_minutes = updates.durationMinutes
      if (updates.status) dbUpdates.status = updates.status
      if (updates.mode !== undefined) dbUpdates.mode = updates.mode
      if (updates.notesInternal !== undefined) dbUpdates.notes_internal = updates.notesInternal
      // Cancellation fee fields
      if (updates.cancellationFeeApplied !== undefined) dbUpdates.cancellation_fee_applied = updates.cancellationFeeApplied
      if (updates.cancellationFeePercent !== undefined) dbUpdates.cancellation_fee_percent = updates.cancellationFeePercent

      const { error } = await supabase
        .from('appointments')
        .update(dbUpdates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentStateKeys.lists() })
    },
  })

  const cancelAppointmentMutation = useMutation({
    mutationFn: async ({ id, info }: { id: string; info?: { reason?: string; feeApplied?: boolean; feePercent?: number } }) => {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: info?.reason,
          cancellation_fee_applied: info?.feeApplied,
          cancellation_fee_percent: info?.feePercent,
        })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentStateKeys.lists() })
    },
  })

  const restoreAppointmentMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: appointmentStateKeys.lists() })
    },
  })

  // Merge manual availability blocks with imported calendar busy blocks
  const allAvailabilityBlocks = [...availabilityBlocks, ...calendarBusyBlocks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )

  return {
    availabilityBlocks: allAvailabilityBlocks,
    appointments,
    isLoading: isLoadingBlocks || isLoadingAppointments || isLoadingCalendarBlocks,
    createAvailabilityBlock: (block: Omit<AvailabilityBlock, 'id' | 'createdAt' | 'updatedAt'>) =>
      createBlockMutation.mutateAsync(block),
    updateAvailabilityBlock: (id: string, updates: Partial<AvailabilityBlock>) =>
      updateBlockMutation.mutate({ id, updates }),
    deleteAvailabilityBlock: deleteBlockMutation.mutate,
    createAppointment: (appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>) =>
      createAppointmentMutation.mutateAsync(appointment),
    updateAppointment: (id: string, updates: Partial<Appointment>) =>
      updateAppointmentMutation.mutate({ id, updates }),
    cancelAppointment: (id: string, info?: { reason?: string; feeApplied?: boolean; feePercent?: number }) =>
      cancelAppointmentMutation.mutate({ id, info }),
    restoreAppointment: restoreAppointmentMutation.mutate,
  }
}
