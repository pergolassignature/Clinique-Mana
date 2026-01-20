// src/availability/hooks/use-appointments.ts

import { useState, useCallback, useMemo } from 'react'
import type { Appointment, AppointmentFormData } from '../types'
import { MOCK_APPOINTMENTS, MOCK_SERVICES } from '../mock'

function generateId(): string {
  return `apt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>(MOCK_APPOINTMENTS)

  const createAppointment = useCallback((data: AppointmentFormData) => {
    const service = MOCK_SERVICES.find(s => s.id === data.serviceId)
    const startDateTime = new Date(`${data.startDate}T${data.startTime}:00`)

    const newAppointment: Appointment = {
      id: generateId(),
      professionalId: data.professionalId,
      clientIds: data.clientIds,
      serviceId: data.serviceId,
      startTime: startDateTime.toISOString(),
      durationMinutes: data.durationMinutes || service?.durationMinutes || 50,
      status: 'confirmed',
      notesInternal: data.notesInternal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setAppointments(prev => [...prev, newAppointment])
    return newAppointment
  }, [])

  const updateAppointment = useCallback((id: string, data: Partial<AppointmentFormData>) => {
    setAppointments(prev =>
      prev.map(apt => {
        if (apt.id !== id) return apt

        const updates: Partial<Appointment> = {
          updatedAt: new Date().toISOString(),
        }

        if (data.professionalId) updates.professionalId = data.professionalId
        if (data.clientIds) updates.clientIds = data.clientIds
        if (data.serviceId) updates.serviceId = data.serviceId
        if (data.durationMinutes) updates.durationMinutes = data.durationMinutes
        if (data.notesInternal !== undefined) updates.notesInternal = data.notesInternal

        if (data.startDate && data.startTime) {
          const startDateTime = new Date(`${data.startDate}T${data.startTime}:00`)
          updates.startTime = startDateTime.toISOString()
        }

        return { ...apt, ...updates }
      })
    )
  }, [])

  const cancelAppointment = useCallback((id: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? { ...apt, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
          : apt
      )
    )
  }, [])

  const restoreAppointment = useCallback((id: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? { ...apt, status: 'confirmed' as const, updatedAt: new Date().toISOString() }
          : apt
      )
    )
  }, [])

  return {
    appointments,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
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
