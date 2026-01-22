// src/availability/utils/audit-mappers.ts

import type {
  CalendarAuditAction,
  AppointmentAuditLog,
  HumanizedCalendarAuditEntry,
} from '../types'

// =============================================================================
// ACTION LABELS (FR-CA)
// =============================================================================

const ACTION_LABELS: Record<CalendarAuditAction, string> = {
  // Availability
  availability_created: 'Bloc de disponibilité créé',
  availability_updated: 'Bloc de disponibilité modifié',
  availability_deleted: 'Bloc de disponibilité supprimé',
  availability_type_changed: 'Type de bloc modifié',
  // Appointments
  appointment_created: 'Rendez-vous créé',
  appointment_confirmed: 'Rendez-vous confirmé',
  appointment_rescheduled: 'Rendez-vous reporté',
  appointment_cancelled: 'Rendez-vous annulé',
  appointment_completed: 'Rendez-vous complété',
  appointment_restored: 'Rendez-vous restauré',
  appointment_client_added: 'Client ajouté au rendez-vous',
  appointment_client_removed: 'Client retiré du rendez-vous',
  appointment_attendance_updated: 'Présence mise à jour',
  appointment_notes_updated: 'Notes internes modifiées',
  appointment_updated: 'Rendez-vous modifié',
}

// =============================================================================
// ICON TYPE MAPPING
// =============================================================================

function getIconType(action: CalendarAuditAction): HumanizedCalendarAuditEntry['iconType'] {
  // Errors (red)
  if (
    action === 'availability_deleted' ||
    action === 'appointment_cancelled' ||
    action === 'appointment_client_removed'
  ) {
    return 'error'
  }

  // Success (green)
  if (
    action === 'availability_created' ||
    action === 'appointment_created' ||
    action === 'appointment_confirmed' ||
    action === 'appointment_completed' ||
    action === 'appointment_restored' ||
    action === 'appointment_client_added'
  ) {
    return 'success'
  }

  // Warning (amber)
  if (
    action === 'appointment_rescheduled' ||
    action === 'availability_type_changed'
  ) {
    return 'warning'
  }

  // Info (neutral)
  return 'info'
}

// =============================================================================
// DESCRIPTION EXTRACTION
// =============================================================================

function getActionDescription(
  action: CalendarAuditAction,
  context: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): string | undefined {
  if (!context && !newValue) return undefined

  // Service name from context
  if (context?.service_name) {
    return context.service_name as string
  }

  // Availability type change
  if (action === 'availability_type_changed' && newValue?.type) {
    const typeLabels: Record<string, string> = {
      available: 'Disponible',
      blocked: 'Bloqué',
      vacation: 'Vacances',
      break: 'Pause',
    }
    return `→ ${typeLabels[newValue.type as string] || newValue.type}`
  }

  // Time slot from context
  if (context?.time_slot) {
    return context.time_slot as string
  }

  // Reschedule with old/new times
  if (action === 'appointment_rescheduled' && context?.old_time_slot && context?.new_time_slot) {
    return `${context.old_time_slot} → ${context.new_time_slot}`
  }

  // Cancellation reason
  if (action === 'appointment_cancelled' && context?.cancellation_reason) {
    return context.cancellation_reason as string
  }

  // Availability label
  if (newValue?.label) {
    return newValue.label as string
  }

  return undefined
}

// =============================================================================
// HUMANIZE AUDIT LOG
// =============================================================================

export function mapCalendarAuditLogToHumanized(
  entries: AppointmentAuditLog[]
): HumanizedCalendarAuditEntry[] {
  return entries.map(entry => ({
    id: entry.id,
    action: entry.action,
    labelFr: ACTION_LABELS[entry.action] || entry.action,
    descriptionFr: getActionDescription(entry.action, entry.context, entry.newValue),
    iconType: getIconType(entry.action),
    actorName: entry.actor?.displayName,
    isSystem: entry.actorId === null,
    createdAt: entry.createdAt,
    details: entry.newValue || entry.context || undefined,
    hasDetails:
      (entry.newValue !== null && Object.keys(entry.newValue).length > 0) ||
      (entry.context !== null && Object.keys(entry.context).length > 0),
  }))
}

// =============================================================================
// ENTITY ID FORMATTING
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function formatEntityId(id: string | null | undefined): string {
  if (!id) return '—'

  if (UUID_REGEX.test(id)) {
    return id.replace(/-/g, '').slice(0, 7).toLowerCase()
  }

  if (id.length > 12) {
    return id.slice(0, 7) + '…'
  }

  return id
}

export function isUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}
