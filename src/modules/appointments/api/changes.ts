import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { parseRpc } from './parse'

/**
 * The parity audit's gaps (AP-28 … AP-32): « Changer le service », « Rétablir », « Marquer
 * confirmé », the consents an appointment or a booking needs, and Paramètres → Agenda. Every write
 * is an RPC; a refusal is a French P0001 with its HINT.
 */

/** « Changer le service »: the same moment, the new service's duration; every booking rule again (AP-28). */
export async function changeAppointmentService(id: string, serviceId: string, outsideAvailabilityReason: string | null): Promise<void> {
  const args: { p_id: string; p_service_id: string; p_outside_availability_reason?: string } = { p_id: id, p_service_id: serviceId }
  if (outsideAvailabilityReason !== null) args.p_outside_availability_reason = outsideAvailabilityReason
  const { error } = await supabase.rpc('change_appointment_service', args)
  if (error) throw error
}

/** « Rétablir »: a cancelled appointment still to come, booked again if its slot is free (AP-29). */
export async function restoreAppointment(id: string): Promise<void> {
  const { error } = await supabase.rpc('restore_appointment', { p_id: id })
  if (error) throw error
}

/** « Marquer confirmé » (appointments.manage), after a call (AP-30). */
export async function confirmAppointment(id: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_appointment', { p_id: id })
  if (error) throw error
}

export const REQUIRED_CONSENT_STATES = ['signed', 'resign', 'pending', 'missing'] as const
export type RequiredConsentState = (typeof REQUIRED_CONSENT_STATES)[number]

const requiredConsentPayload = z
  .object({
    client_id: z.string(),
    consent_key: z.string(),
    consent_name: z.string(),
    frequency: z.enum(['once', 'each_time']),
    state: z.enum(REQUIRED_CONSENT_STATES),
  })
  .transform((r) => ({ clientId: r.client_id, consentKey: r.consent_key, consentName: r.consent_name, state: r.state }))
export type RequiredConsent = z.output<typeof requiredConsentPayload>

/** The consents an appointment requires, per client, with their state (Clients' rules; never blocks, R-47). */
export async function fetchAppointmentConsents(appointmentId: string): Promise<RequiredConsent[]> {
  const { data, error } = await supabase.rpc('get_appointment_consents', { p_appointment_id: appointmentId })
  if (error) throw error
  return parseRpc(z.array(requiredConsentPayload), data)
}

/** The same for a booking not made yet: the service and the clients chosen (AP-32). */
export async function fetchBookingConsents(serviceId: string, clientIds: readonly string[]): Promise<RequiredConsent[]> {
  const { data, error } = await supabase.rpc('get_booking_consents', { p_service_id: serviceId, p_client_ids: [...clientIds] })
  if (error) throw error
  return parseRpc(z.array(requiredConsentPayload), data)
}

const settingsPayload = z
  .object({
    business_days: z.array(z.number().int()),
    business_start: z.string(),
    business_end: z.string(),
    reminder_business_days: z.number().int(),
    reminder_local_hour: z.number().int(),
    late_notice_business_hours: z.boolean(),
  })
  .transform((r) => ({
    businessDays: r.business_days,
    businessStart: r.business_start.slice(0, 5),
    businessEnd: r.business_end.slice(0, 5),
    reminderBusinessDays: r.reminder_business_days,
    reminderLocalHour: r.reminder_local_hour,
    lateNoticeBusinessHours: r.late_notice_business_hours,
  }))
export type AgendaSettings = z.output<typeof settingsPayload>

export const DEFAULT_AGENDA_SETTINGS: AgendaSettings = {
  businessDays: [1, 2, 3, 4, 5],
  businessStart: '08:00',
  businessEnd: '17:00',
  reminderBusinessDays: 1,
  reminderLocalHour: 8,
  lateNoticeBusinessHours: true,
}

/** Paramètres → Agenda: the clinic's row (RLS: appointments.view), or the defaults before it exists. */
export async function fetchAgendaSettings(): Promise<AgendaSettings> {
  const { data, error } = await supabase
    .from('appointment_settings')
    .select('business_days, business_start, business_end, reminder_business_days, reminder_local_hour, late_notice_business_hours')
    .maybeSingle()
  if (error) throw error
  return data ? parseRpc(settingsPayload, data) : DEFAULT_AGENDA_SETTINGS
}

/** `set_appointment_settings` (appointments.settings). */
export async function saveAgendaSettings(s: AgendaSettings): Promise<void> {
  const { error } = await supabase.rpc('set_appointment_settings', {
    p_business_days: s.businessDays,
    p_business_start: s.businessStart,
    p_business_end: s.businessEnd,
    p_reminder_business_days: s.reminderBusinessDays,
    p_reminder_local_hour: s.reminderLocalHour,
    p_late_notice_business_hours: s.lateNoticeBusinessHours,
  })
  if (error) throw error
}
