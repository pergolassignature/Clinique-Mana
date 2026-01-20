// src/availability/utils/validation.ts

import type { AvailabilityBlock, Appointment, BookableService } from '../types'

interface ValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Check if a time range is fully contained within an availability block
 */
export function isWithinAvailability(
  startTime: Date,
  endTime: Date,
  blocks: AvailabilityBlock[]
): ValidationResult {
  const availableBlocks = blocks.filter(b => b.type === 'available')

  for (const block of availableBlocks) {
    const blockStart = new Date(block.startTime)
    const blockEnd = new Date(block.endTime)

    if (startTime >= blockStart && endTime <= blockEnd) {
      return { valid: true }
    }
  }

  return { valid: false, reason: 'En dehors des disponibilités' }
}

/**
 * Check if a service is allowed in a specific availability block
 */
export function isServiceAllowed(
  service: BookableService,
  startTime: Date,
  blocks: AvailabilityBlock[]
): ValidationResult {
  const availableBlocks = blocks.filter(b => b.type === 'available')

  for (const block of availableBlocks) {
    const blockStart = new Date(block.startTime)
    const blockEnd = new Date(block.endTime)

    if (startTime >= blockStart && startTime < blockEnd) {
      // Found the containing block
      if (!block.allowedServiceIds) {
        return { valid: true } // All services allowed
      }
      if (block.allowedServiceIds.includes(service.id)) {
        return { valid: true }
      }
      return { valid: false, reason: 'Service non autorisé dans ce créneau' }
    }
  }

  return { valid: false, reason: 'En dehors des disponibilités' }
}

/**
 * Check if there's a conflict with existing appointments
 */
export function hasAppointmentConflict(
  startTime: Date,
  endTime: Date,
  appointments: Appointment[],
  excludeId?: string
): ValidationResult {
  const activeAppointments = appointments.filter(
    apt => apt.status !== 'cancelled' && apt.id !== excludeId
  )

  for (const apt of activeAppointments) {
    const aptStart = new Date(apt.startTime)
    const aptEnd = new Date(aptStart.getTime() + apt.durationMinutes * 60000)

    // Check for overlap
    if (startTime < aptEnd && endTime > aptStart) {
      return { valid: false, reason: 'Conflit avec un autre rendez-vous' }
    }
  }

  return { valid: true }
}

/**
 * Full validation for dropping a service on the calendar
 */
export function validateServiceDrop(
  service: BookableService,
  startTime: Date,
  availabilityBlocks: AvailabilityBlock[],
  appointments: Appointment[]
): ValidationResult {
  const endTime = new Date(startTime.getTime() + service.durationMinutes * 60000)

  // Check availability
  const availabilityCheck = isWithinAvailability(startTime, endTime, availabilityBlocks)
  if (!availabilityCheck.valid) return availabilityCheck

  // Check service allowed
  const serviceCheck = isServiceAllowed(service, startTime, availabilityBlocks)
  if (!serviceCheck.valid) return serviceCheck

  // Check conflicts
  const conflictCheck = hasAppointmentConflict(startTime, endTime, appointments)
  if (!conflictCheck.valid) return conflictCheck

  return { valid: true }
}

/**
 * Validate moving an appointment
 */
export function validateAppointmentMove(
  appointment: Appointment,
  newStartTime: Date,
  availabilityBlocks: AvailabilityBlock[],
  appointments: Appointment[]
): ValidationResult {
  const endTime = new Date(newStartTime.getTime() + appointment.durationMinutes * 60000)

  // Check availability
  const availabilityCheck = isWithinAvailability(newStartTime, endTime, availabilityBlocks)
  if (!availabilityCheck.valid) return availabilityCheck

  // Check conflicts (excluding self)
  const conflictCheck = hasAppointmentConflict(newStartTime, endTime, appointments, appointment.id)
  if (!conflictCheck.valid) return conflictCheck

  return { valid: true }
}
