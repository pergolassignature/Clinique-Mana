import { z } from 'zod'

/**
 * Zod parsers of the agenda's payloads, mapped to camelCase. Objects drop unknown keys, so a
 * column a later batch adds never breaks the page. A mismatch throws UNEXPECTED_SHAPE, never
 * Zod's issues (they could quote a client's name).
 */
export const UNEXPECTED_SHAPE = 'appointments: unexpected RPC shape'

export function parseRpc<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

export const APPOINTMENT_STATES = ['held', 'booked', 'confirmed', 'completed', 'cancelled'] as const
export type AppointmentState = (typeof APPOINTMENT_STATES)[number]
export const PRESENCES = ['expected', 'present', 'absent'] as const
export type Presence = (typeof PRESENCES)[number]
export const MODES = ['video', 'phone'] as const
export type AppointmentMode = (typeof MODES)[number]
export const EXCEPTION_KINDS = ['holiday', 'vacation', 'other'] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

const participantPayload = z
  .object({
    client_id: z.string(),
    name: z.string().nullable(),
    client_number: z.number().int().nullable(),
    role: z.enum(['client', 'second']),
    presence: z.enum(PRESENCES),
    confirmed_at: z.string().nullable(),
  })
  .transform((r) => ({ clientId: r.client_id, name: r.name ?? '', clientNumber: r.client_number, role: r.role, presence: r.presence, confirmedAt: r.confirmed_at }))
export type Participant = z.output<typeof participantPayload>

/** One row of `list_agenda`. */
export const agendaRowPayload = z
  .object({
    id: z.string(),
    professional_id: z.string(),
    service_id: z.string().nullable(),
    starts_at: z.string(),
    ends_at: z.string(),
    blocks_until: z.string(),
    mode: z.enum(MODES),
    state: z.enum(APPOINTMENT_STATES),
    is_personal: z.boolean(),
    personal_label: z.string().nullable(),
    kept_on_schedule: z.boolean(),
    cancel_late: z.boolean().nullable(),
    cancel_reason_id: z.string().nullable(),
    confirmed_at: z.string().nullable(),
    outside_availability: z.boolean(),
    balance_override: z.boolean(),
    video_url: z.string().nullable(),
    video_status: z.string().nullable(),
    participants: z.array(participantPayload),
    series_id: z.string().nullable().optional(),
  })
  .transform((r) => ({
    id: r.id,
    professionalId: r.professional_id,
    serviceId: r.service_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    blocksUntil: r.blocks_until,
    mode: r.mode,
    state: r.state,
    isPersonal: r.is_personal,
    personalLabel: r.personal_label,
    keptOnSchedule: r.kept_on_schedule,
    cancelLate: r.cancel_late,
    cancelReasonId: r.cancel_reason_id,
    confirmedAt: r.confirmed_at,
    outsideAvailability: r.outside_availability,
    balanceOverride: r.balance_override,
    videoUrl: r.video_url,
    videoStatus: r.video_status,
    participants: r.participants,
    seriesId: r.series_id ?? null,
  }))
export type AgendaAppointment = z.output<typeof agendaRowPayload>

export const SERIES_CONFLICTS = ['overlap', 'outside_availability'] as const
export type SeriesConflict = (typeof SERIES_CONFLICTS)[number]

/** One date of `preview_series`, with its conflict. */
export const seriesDatePayload = z
  .object({ occurrence: z.number().int(), starts_at: z.string(), ends_at: z.string(), conflict: z.enum(SERIES_CONFLICTS).nullable() })
  .transform((r) => ({ occurrence: r.occurrence, startsAt: r.starts_at, endsAt: r.ends_at, conflict: r.conflict }))
export type SeriesDate = z.output<typeof seriesDatePayload>

/** The editor's extra fields (the table, RLS): notes, message, cancellation, the override's reason. */
export const appointmentDetailPayload = z
  .object({
    id: z.string(),
    internal_note: z.string().nullable(),
    client_message: z.string().nullable(),
    cancel_details: z.string().nullable(),
    outside_availability_reason: z.string().nullable(),
    balance_override_reason: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    internalNote: r.internal_note,
    clientMessage: r.client_message,
    cancelDetails: r.cancel_details,
    outsideAvailabilityReason: r.outside_availability_reason,
    balanceOverrideReason: r.balance_override_reason,
  }))
export type AppointmentDetail = z.output<typeof appointmentDetailPayload>

export const rulePayload = z
  .object({
    id: z.string(),
    professional_id: z.string(),
    weekday: z.number().int().min(1).max(7),
    start_time: z.string(),
    end_time: z.string(),
    service_ids: z.array(z.string()),
    visible_to_clients: z.boolean(),
    overflow_allowed: z.boolean(),
    valid_from: z.string(),
    valid_until: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    professionalId: r.professional_id,
    weekday: r.weekday,
    startTime: r.start_time.slice(0, 5),
    endTime: r.end_time.slice(0, 5),
    serviceIds: r.service_ids,
    visibleToClients: r.visible_to_clients,
    overflowAllowed: r.overflow_allowed,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
  }))
export type AvailabilityRule = z.output<typeof rulePayload>

export const exceptionPayload = z
  .object({ id: z.string(), professional_id: z.string(), kind: z.enum(EXCEPTION_KINDS), starts_at: z.string(), ends_at: z.string(), label: z.string().nullable() })
  .transform((r) => ({ id: r.id, professionalId: r.professional_id, kind: r.kind, startsAt: r.starts_at, endsAt: r.ends_at, label: r.label }))
export type AvailabilityException = z.output<typeof exceptionPayload>

export const professionalOptionPayload = z
  .object({
    id: z.string(),
    display_name: z.string().nullable(),
    status: z.string(),
    professions: z.array(z.object({ title_id: z.string() }).passthrough()).nullable(),
  })
  .transform((r) => ({ id: r.id, name: r.display_name ?? '', active: r.status === 'active', titleIds: (r.professions ?? []).map((p) => p.title_id) }))
export type ProfessionalOption = z.output<typeof professionalOptionPayload>

export const serviceOptionPayload = z
  .object({
    id: z.string(),
    code: z.number().int(),
    name: z.string(),
    duration_minutes: z.number().int(),
    buffer_after_minutes: z.number().int(),
    for_two: z.boolean(),
    colour: z.string().nullable(),
    title_ids: z.array(z.string()),
  })
  .transform((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    durationMinutes: r.duration_minutes,
    bufferAfterMinutes: r.buffer_after_minutes,
    forTwo: r.for_two,
    colour: r.colour,
    titleIds: r.title_ids,
  }))
export type ServiceOption = z.output<typeof serviceOptionPayload>

export const reasonPayload = z.object({ id: z.string(), key: z.string(), name: z.string(), is_active: z.boolean() }).transform((r) => ({ id: r.id, key: r.key, name: r.name, active: r.is_active }))
export type CancellationReason = z.output<typeof reasonPayload>
