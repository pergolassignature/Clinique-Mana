import { i18nAuditLabels } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * appointments (and their Zoom meetings, RZ), then the availability, then the clinic's lists and
 * settings, then the professionals' video setup (RZ) and Google agendas (R6).
 * `src/app/audit-labels.test.ts` checks it against the migrations' audit triggers.
 */
export const APPOINTMENTS_AUDITED_TABLES = [
  'appointments',
  'appointment_participants',
  'appointment_video_meetings',
  'video_tasks',
  'appointment_series',
  'availability_rules',
  'availability_exceptions',
  'cancellation_reasons',
  'appointment_settings',
  'professional_video_links',
  'video_connections',
  'video_connection_tokens',
  'calendar_connections',
  'calendar_connection_tokens',
] as const

/** The audit source of the per-clinic seed (`private.seed_appointments_reference`). */
export const APPOINTMENTS_SEED_SOURCE = 'seed:appointments_reference'

const WEEKDAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

/** Weekdays and the business days in the module's words; stored codes are in the i18n `values`. */
function appointmentsValue(_table: string, column: string, value: unknown): string | undefined {
  if (column === 'weekday' && typeof value === 'number') return WEEKDAYS[value]
  if (column === 'weekdays' && Array.isArray(value)) return value.map((d) => WEEKDAYS[Number(d)] ?? String(d)).join(', ')
  if (column === 'business_days' && Array.isArray(value)) return value.map((d) => WEEKDAYS[Number(d)] ?? String(d)).join(', ')
  return undefined
}

/**
 * What the module tells the Journal d'audit (`appointmentsManifest.audit`, loaded with the
 * journal): its tables' and columns' French names (`modules.appointments.audit`), its values,
 * and its seed's source. Notes, messages and details arrive redacted.
 */
export const appointmentsAuditLabels = i18nAuditLabels({
  prefix: 'modules.appointments.audit',
  tables: APPOINTMENTS_AUDITED_TABLES,
  value: appointmentsValue,
  sources: [APPOINTMENTS_SEED_SOURCE, 'job:appointments.video_sync', 'webhook:zoom', 'job:appointments.google_busy_sync'],
})
