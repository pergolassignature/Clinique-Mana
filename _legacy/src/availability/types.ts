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
  dateOfBirth?: string
  email?: string
  phone?: string
  primaryProfessionalId?: string
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
  /** Pricing model for billing calculation */
  pricingModel: 'fixed' | 'by_profession_category' | 'rule_cancellation_prorata' | 'by_profession_hourly_prorata'
}

// =============================================================================
// Availability Blocks
// =============================================================================

export type AvailabilityType = 'available' | 'blocked' | 'vacation' | 'break' | 'imported'

/** Source of availability block (manual = created in app, others = synced from external calendar) */
export type AvailabilitySource = 'manual' | 'google' | 'microsoft' | 'calendly'

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
  /** Source of this block (default: manual) */
  source?: AvailabilitySource
  /** External calendar event ID for synced blocks */
  externalEventId?: string
  /** Whether this is an all-day event (for imported blocks) */
  isAllDay?: boolean
}

// =============================================================================
// Appointments
// =============================================================================

export type AppointmentStatus = 'created' | 'confirmed' | 'completed' | 'cancelled'
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
  cancellationFeeApplied?: boolean
  cancellationFeePercent?: number
  /** Profession category used for this appointment (determines pricing) */
  professionCategoryKey?: string
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
  /** Profession category used for this appointment (determines pricing) */
  professionCategoryKey?: string
}

// =============================================================================
// Calendar View
// =============================================================================

export type CalendarMode = 'availability' | 'booking'

// View mode for the calendar
export type CalendarViewMode = 'day' | 'week' | 'list'

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

// =============================================================================
// Appointment Clients (Junction for multi-client support)
// =============================================================================

export type AppointmentClientRole = 'primary' | 'spouse' | 'partner' | 'child' | 'parent' | 'other'

export interface AppointmentClient {
  id: string
  appointmentId: string
  clientId: string
  role: AppointmentClientRole
  attended?: boolean | null
  createdAt: string
}

// =============================================================================
// Audit Tracking
// =============================================================================

export type AvailabilityAuditAction =
  | 'availability_created'
  | 'availability_updated'
  | 'availability_deleted'
  | 'availability_type_changed'

export type AppointmentAuditAction =
  | 'appointment_created'
  | 'appointment_confirmed'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'appointment_completed'
  | 'appointment_restored'
  | 'appointment_client_added'
  | 'appointment_client_removed'
  | 'appointment_attendance_updated'
  | 'appointment_notes_updated'
  | 'appointment_updated'

export type CalendarAuditAction = AvailabilityAuditAction | AppointmentAuditAction

export type CalendarAuditEntityType = 'appointment' | 'availability_block'

export interface AppointmentAuditLog {
  id: string
  entityType: CalendarAuditEntityType
  entityId: string
  professionalId: string
  actorId: string | null
  action: CalendarAuditAction
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  context: Record<string, unknown> | null
  createdAt: string
  // Joined data
  actor?: {
    displayName: string
  } | null
}

// Humanized audit entry for UI display
export interface HumanizedCalendarAuditEntry {
  id: string
  action: CalendarAuditAction
  labelFr: string
  descriptionFr?: string
  iconType: 'success' | 'warning' | 'error' | 'info'
  actorName?: string
  isSystem: boolean
  createdAt: string
  details?: Record<string, unknown>
  hasDetails: boolean
}
