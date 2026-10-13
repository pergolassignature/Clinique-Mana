import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { Database } from '@/core/supabase/database.types'
import {
  agendaRowPayload,
  appointmentDetailPayload,
  exceptionPayload,
  parseRpc,
  professionalOptionPayload,
  reasonPayload,
  rulePayload,
  serviceOptionPayload,
  type AgendaAppointment,
  type AppointmentDetail,
  type AppointmentMode,
  type AvailabilityException,
  type AvailabilityRule,
  type CancellationReason,
  type ExceptionKind,
  type Presence,
  type ProfessionalOption,
  type SeriesDate,
  type ServiceOption,
  seriesDatePayload,
} from './parse'

/**
 * The agenda's reads and writes. Every write is an RPC (the database holds the booking rules,
 * R1); reads are `list_agenda` (with the clients' names), the module's own tables (RLS) and the
 * other modules' published views (`professionals_directory`, `services_catalog`).
 */

type Functions = Database['public']['Functions']
type RpcArgs<F extends keyof Functions> = Functions[F]['Args']
/** The generator types optional parameters as non-null; the RPCs take null where SQL allows it. */
function sqlArgs<F extends keyof Functions>(args: { [K in keyof RpcArgs<F>]-?: RpcArgs<F>[K] | null }): RpcArgs<F> {
  return args as RpcArgs<F>
}

const LIST_MAX = 1000

// --- Reads ---------------------------------------------------------------------------------------

export async function fetchAgenda(fromIso: string, toIso: string, professionalIds: readonly string[] | null): Promise<AgendaAppointment[]> {
  const { data, error } = await supabase.rpc(
    'list_agenda',
    sqlArgs<'list_agenda'>({ p_from: fromIso, p_to: toIso, p_professional_ids: professionalIds ? [...professionalIds] : null }),
  )
  if (error) throw error
  return parseRpc(z.array(agendaRowPayload), data)
}

export async function fetchAppointmentDetail(id: string): Promise<AppointmentDetail | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, internal_note, client_message, cancel_details, outside_availability_reason, balance_override_reason')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? parseRpc(appointmentDetailPayload, data) : null
}

export interface AgendaReference {
  professionals: ProfessionalOption[]
  services: ServiceOption[]
  reasons: CancellationReason[]
}

/** The active professionals, the bookable services and the cancellation reasons. */
export async function fetchAgendaReference(): Promise<AgendaReference> {
  const [pros, services, reasons] = await Promise.all([
    supabase.from('professionals_directory').select('id, display_name, status, professions').eq('status', 'active').order('display_name').limit(LIST_MAX),
    supabase
      .from('services_catalog')
      .select('id, code, name, duration_minutes, buffer_after_minutes, for_two, colour, title_ids')
      .gt('duration_minutes', 0)
      .order('code')
      .limit(LIST_MAX),
    supabase.from('cancellation_reasons').select('id, key, name, is_active').order('sort_order').limit(LIST_MAX),
  ])
  for (const result of [pros, services, reasons]) if (result.error) throw result.error
  return {
    professionals: parseRpc(z.array(professionalOptionPayload), pros.data),
    services: parseRpc(z.array(serviceOptionPayload), services.data),
    reasons: parseRpc(z.array(reasonPayload), reasons.data),
  }
}

/**
 * « Mon agenda »'s reference (R5): the professional herself, the services she offers
 * (`get_my_agenda_reference`: she cannot read the staff's views) and the cancellation reasons.
 */
export async function fetchMyAgendaReference(): Promise<AgendaReference> {
  const [mine, reasons] = await Promise.all([
    supabase.rpc('get_my_agenda_reference'),
    supabase.from('cancellation_reasons').select('id, key, name, is_active').order('sort_order').limit(LIST_MAX),
  ])
  if (mine.error) throw mine.error
  if (reasons.error) throw reasons.error
  const parsed = parseRpc(
    z.object({ professional: professionalOptionPayload, services: z.array(serviceOptionPayload) }),
    mine.data,
  )
  return { professionals: [parsed.professional], services: parsed.services, reasons: parseRpc(z.array(reasonPayload), reasons.data) }
}

/** The windows of these professionals, and their exceptions ending after `sinceIso` (the shown range's start). */
export async function fetchAvailability(professionalIds: readonly string[], sinceIso: string): Promise<{ rules: AvailabilityRule[]; exceptions: AvailabilityException[] }> {
  const [rules, exceptions] = await Promise.all([
    supabase
      .from('availability_rules')
      .select('id, professional_id, weekday, start_time, end_time, service_ids, visible_to_clients, overflow_allowed, valid_from, valid_until')
      .in('professional_id', [...professionalIds])
      .order('weekday')
      .order('start_time')
      .limit(LIST_MAX),
    supabase
      .from('availability_exceptions')
      .select('id, professional_id, kind, starts_at, ends_at, label')
      .in('professional_id', [...professionalIds])
      .gt('ends_at', sinceIso)
      .order('starts_at')
      .limit(LIST_MAX),
  ])
  if (rules.error) throw rules.error
  if (exceptions.error) throw exceptions.error
  return { rules: parseRpc(z.array(rulePayload), rules.data), exceptions: parseRpc(z.array(exceptionPayload), exceptions.data) }
}

// --- Writes --------------------------------------------------------------------------------------

export interface BookInput {
  professionalId: string
  serviceId: string
  startsAt: string
  clientIds: string[]
  mode: AppointmentMode
  internalNote: string | null
  clientMessage: string | null
  balanceOverrideReason: string | null
  outsideAvailabilityReason: string | null
}

export async function bookAppointment(input: BookInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'book_appointment',
    sqlArgs<'book_appointment'>({
      p_professional_id: input.professionalId,
      p_service_id: input.serviceId,
      p_starts_at: input.startsAt,
      p_client_ids: input.clientIds,
      p_mode: input.mode,
      p_internal_note: input.internalNote,
      p_client_message: input.clientMessage,
      p_balance_override_reason: input.balanceOverrideReason,
      p_outside_availability_reason: input.outsideAvailabilityReason,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

/** A series' rule (AP-16): every 1–12 weeks on these ISO weekdays, N appointments or until a date. */
export interface SeriesRule {
  professionalId: string
  serviceId: string
  firstStartsAt: string
  intervalWeeks: number
  weekdays: number[]
  count: number | null
  until: string | null
}

export async function previewSeries(rule: SeriesRule): Promise<SeriesDate[]> {
  const { data, error } = await supabase.rpc(
    'preview_series',
    sqlArgs<'preview_series'>({
      p_professional_id: rule.professionalId,
      p_service_id: rule.serviceId,
      p_first_starts_at: rule.firstStartsAt,
      p_interval_weeks: rule.intervalWeeks,
      p_weekdays: rule.weekdays,
      p_count: rule.count,
      p_until: rule.until,
    }),
  )
  if (error) throw error
  return parseRpc(z.array(seriesDatePayload), data)
}

export interface SeriesInput extends SeriesRule {
  clientIds: string[]
  mode: AppointmentMode
  internalNote: string | null
  clientMessage: string | null
  skipConflicts: boolean
  balanceOverrideReason: string | null
  outsideAvailabilityReason: string | null
}

export async function createSeries(input: SeriesInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'create_series',
    sqlArgs<'create_series'>({
      p_professional_id: input.professionalId,
      p_service_id: input.serviceId,
      p_first_starts_at: input.firstStartsAt,
      p_interval_weeks: input.intervalWeeks,
      p_weekdays: input.weekdays,
      p_count: input.count,
      p_until: input.until,
      p_client_ids: input.clientIds,
      p_mode: input.mode,
      p_internal_note: input.internalNote,
      p_client_message: input.clientMessage,
      p_skip_conflicts: input.skipConflicts,
      p_balance_override_reason: input.balanceOverrideReason,
      p_outside_availability_reason: input.outsideAvailabilityReason,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

/** Cancels this appointment and the series' later active ones; returns how many. */
export async function cancelSeriesFrom(id: string, reasonKey: string, details: string | null, keptOnSchedule: boolean): Promise<number> {
  const { data, error } = await supabase.rpc(
    'cancel_series_from',
    sqlArgs<'cancel_series_from'>({ p_id: id, p_reason_key: reasonKey, p_details: details, p_kept_on_schedule: keptOnSchedule }),
  )
  if (error) throw error
  return parseRpc(z.number().int(), data)
}

export interface PersonalInput {
  startsAt: string
  endsAt: string
  label: string | null
  isWork: boolean
}

/** A personal appointment on one's own agenda (AP-17). */
export async function bookPersonalAppointment(input: PersonalInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'book_personal_appointment',
    sqlArgs<'book_personal_appointment'>({ p_starts_at: input.startsAt, p_ends_at: input.endsAt, p_label: input.label, p_is_work: input.isWork }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

export interface MoveInput {
  id: string
  startsAt: string
  professionalId: string | null
  outsideAvailabilityReason: string | null
}

export async function moveAppointment(input: MoveInput): Promise<void> {
  const { error } = await supabase.rpc(
    'move_appointment',
    sqlArgs<'move_appointment'>({
      p_id: input.id,
      p_starts_at: input.startsAt,
      p_professional_id: input.professionalId,
      p_outside_availability_reason: input.outsideAvailabilityReason,
    }),
  )
  if (error) throw error
}

export async function setAppointmentDetails(id: string, mode: AppointmentMode, internalNote: string | null, clientMessage: string | null): Promise<void> {
  const { error } = await supabase.rpc(
    'set_appointment_details',
    sqlArgs<'set_appointment_details'>({ p_id: id, p_mode: mode, p_internal_note: internalNote, p_client_message: clientMessage }),
  )
  if (error) throw error
}

export async function setPresence(appointmentId: string, clientId: string, presence: Presence): Promise<void> {
  const { error } = await supabase.rpc('set_appointment_presence', { p_appointment_id: appointmentId, p_client_id: clientId, p_presence: presence })
  if (error) throw error
}

export async function cancelAppointment(id: string, reasonKey: string, details: string | null, keptOnSchedule: boolean): Promise<void> {
  const { error } = await supabase.rpc(
    'cancel_appointment',
    sqlArgs<'cancel_appointment'>({ p_id: id, p_reason_key: reasonKey, p_details: details, p_kept_on_schedule: keptOnSchedule }),
  )
  if (error) throw error
}

export interface RuleInput {
  id: string | null
  professionalId: string
  weekday: number
  startTime: string
  endTime: string
  serviceIds: string[]
  visibleToClients: boolean
  overflowAllowed: boolean
  validFrom: string | null
  validUntil: string | null
}

export async function saveAvailabilityRule(input: RuleInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'set_availability_rule',
    sqlArgs<'set_availability_rule'>({
      p_id: input.id,
      p_professional_id: input.professionalId,
      p_weekday: input.weekday,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_service_ids: input.serviceIds,
      p_visible_to_clients: input.visibleToClients,
      p_overflow_allowed: input.overflowAllowed,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

export async function deleteAvailabilityRule(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_availability_rule', { p_id: id })
  if (error) throw error
}

export interface ExceptionInput {
  professionalId: string
  kind: ExceptionKind
  startsAt: string
  endsAt: string
  label: string | null
}

export async function addAvailabilityException(input: ExceptionInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'add_availability_exception',
    sqlArgs<'add_availability_exception'>({
      p_professional_id: input.professionalId,
      p_kind: input.kind,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_label: input.label,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

export async function removeAvailabilityException(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_availability_exception', { p_id: id })
  if (error) throw error
}
