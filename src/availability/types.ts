// src/availability/types.ts

// =============================================================================
// Professionals
// =============================================================================

export interface Professional {
  id: string
  displayName: string
  avatarUrl?: string
  professionKeys: string[]
}

// =============================================================================
// Clients
// =============================================================================

export interface Client {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
}

// =============================================================================
// Services
// =============================================================================

/** @deprecated Use BookableService for v3 */
export interface Service {
  id: string
  nameFr: string
  durationMinutes: number
  colorHex: string
}

export type ServiceClientType = 'individual' | 'couple' | 'family'

export interface BookableService {
  id: string
  nameFr: string
  durationMinutes: number
  colorHex: string
  clientType: ServiceClientType
  minClients: number
  maxClients: number
  compatibleProfessionKeys: string[]
}

// =============================================================================
// Availability Blocks
// =============================================================================

export type AvailabilityType = 'available' | 'blocked' | 'vacation' | 'break'

export interface AvailabilityBlock {
  id: string
  professionalId: string
  type: AvailabilityType
  label?: string
  startTime: string
  endTime: string
  isRecurring: boolean
  allowedServiceIds?: string[]
  visibleToClients: boolean
  createdAt: string
  updatedAt: string
}

// =============================================================================
// Appointments
// =============================================================================

export type AppointmentStatus = 'draft' | 'confirmed' | 'cancelled'
export type AppointmentMode = 'in_person' | 'video' | 'phone'

export interface Appointment {
  id: string
  professionalId: string
  clientIds: string[]
  serviceId: string
  /** ISO 8601 datetime string */
  startTime: string
  /** Duration in minutes (default from service, can be overridden) */
  durationMinutes: number
  status: AppointmentStatus
  mode?: AppointmentMode
  notesInternal?: string
  cancelledAt?: string
  cancellationReason?: string
  createdAt: string
  updatedAt: string
}

// Form data for create/edit
export interface AppointmentFormData {
  professionalId: string
  clientIds: string[]
  serviceId: string
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  durationMinutes: number
  mode?: AppointmentMode
  notesInternal?: string
}

// =============================================================================
// Calendar View
// =============================================================================

export type CalendarMode = 'availability' | 'booking'

// View mode for the calendar
export type CalendarViewMode = 'day' | 'week' | 'list'

// Drag state for create/move/resize interactions
export interface DragState {
  type: 'create' | 'move' | 'resize'
  startY: number
  currentY: number
  dayIndex: number
  appointmentId?: string
  resizeEdge?: 'top' | 'bottom'
}

// Time range in minutes from midnight
export interface TimeRange {
  startMinutes: number // minutes from midnight
  endMinutes: number
}

// Calendar view state
export interface CalendarViewState {
  selectedProfessionalId: string | null
  viewDate: Date // anchor date for current view
  viewMode: CalendarViewMode
}
