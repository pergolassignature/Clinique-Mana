// src/availability/hooks/use-availability-state.ts

import { useState, useCallback } from 'react'
import type { AvailabilityBlock, Appointment } from '../types'
import { MOCK_AVAILABILITY_BLOCKS, MOCK_APPOINTMENTS } from '../mock'

export function useAvailabilityState() {
  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>(MOCK_AVAILABILITY_BLOCKS)
  const [appointments, setAppointments] = useState<Appointment[]>(MOCK_APPOINTMENTS)

  // Availability CRUD
  const createAvailabilityBlock = useCallback((block: Omit<AvailabilityBlock, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newBlock: AvailabilityBlock = {
      ...block,
      id: `avail-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setAvailabilityBlocks(prev => [...prev, newBlock])
    return newBlock
  }, [])

  const updateAvailabilityBlock = useCallback((id: string, updates: Partial<AvailabilityBlock>) => {
    setAvailabilityBlocks(prev =>
      prev.map(block =>
        block.id === id
          ? { ...block, ...updates, updatedAt: new Date().toISOString() }
          : block
      )
    )
  }, [])

  const deleteAvailabilityBlock = useCallback((id: string) => {
    setAvailabilityBlocks(prev => prev.filter(block => block.id !== id))
  }, [])

  // Appointment CRUD
  const createAppointment = useCallback((appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAppointment: Appointment = {
      ...appointment,
      id: `apt-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setAppointments(prev => [...prev, newAppointment])
    return newAppointment
  }, [])

  const updateAppointment = useCallback((id: string, updates: Partial<Appointment>) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? { ...apt, ...updates, updatedAt: new Date().toISOString() }
          : apt
      )
    )
  }, [])

  const cancelAppointment = useCallback((id: string, info?: { reason?: string; feeApplied?: boolean; feePercent?: number }) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? {
              ...apt,
              status: 'cancelled' as const,
              cancelledAt: new Date().toISOString(),
              cancellationReason: info?.reason,
              cancellationFeeApplied: info?.feeApplied,
              cancellationFeePercent: info?.feePercent,
              updatedAt: new Date().toISOString(),
            }
          : apt
      )
    )
  }, [])

  const restoreAppointment = useCallback((id: string) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === id
          ? {
              ...apt,
              status: 'confirmed' as const,
              cancelledAt: undefined,
              cancellationReason: undefined,
              updatedAt: new Date().toISOString(),
            }
          : apt
      )
    )
  }, [])

  return {
    availabilityBlocks,
    appointments,
    createAvailabilityBlock,
    updateAvailabilityBlock,
    deleteAvailabilityBlock,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  }
}
