// src/availability/types.ts

export interface Professional {
  id: string
  displayName: string
  avatarUrl?: string
}

export interface Client {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
}

export interface Service {
  id: string
  nameFr: string
  durationMinutes: number
  colorHex: string
}

export type AppointmentStatus = 'scheduled' | 'cancelled'

export interface Appointment {
  id: string
  professionalId: string
  clientId: string
  serviceId: string
  /** ISO 8601 datetime string */
  startTime: string
  /** Duration in minutes (default from service, can be overridden) */
  durationMinutes: number
  status: AppointmentStatus
  notesInternal?: string
  createdAt: string
  updatedAt: string
}

// Form data for create/edit
export interface AppointmentFormData {
  professionalId: string
  clientId: string
  serviceId: string
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  durationMinutes: number
  notesInternal?: string
}

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
