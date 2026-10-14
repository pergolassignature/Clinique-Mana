import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'
import { parseRpc } from './parse'

/**
 * R4's reads and the public confirmation: « Clients sans rappel » (`list_appointments_without_reminder`),
 * and « Confirmer ma présence » (`resolve-link`, then `appointments-confirm`).
 */

const unreachablePayload = z
  .object({
    id: z.string(),
    professional_id: z.string(),
    starts_at: z.string(),
    participants: z.array(z.object({ client_id: z.string(), name: z.string().nullable(), client_number: z.number().int().nullable() })),
    state: z.enum(['booked', 'confirmed']),
  })
  .transform((r) => ({
    id: r.id,
    professionalId: r.professional_id,
    startsAt: r.starts_at,
    participants: r.participants.map((p) => ({ clientId: p.client_id, name: p.name ?? '', clientNumber: p.client_number })),
    /** « Marquer confirmé » once called (AP-30). */
    confirmed: r.state === 'confirmed',
  }))
export type UnreachableAppointment = z.output<typeof unreachablePayload>

/** The coming appointments no recipient of which can be reached (14 days at most). */
export async function fetchWithoutReminder(fromIso: string, toIso: string): Promise<UnreachableAppointment[]> {
  const { data, error } = await supabase.rpc('list_appointments_without_reminder', { p_from: fromIso, p_to: toIso })
  if (error) throw error
  return parseRpc(z.array(unreachablePayload), data)
}

// --- The sheet's « Messages » (AP-47) ----------------------------------------------------------

export const MESSAGE_KINDS = ['confirmation', 'reminder', 'changed', 'cancelled'] as const
export const MESSAGE_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const

const sheetMessagePayload = z
  .object({
    id: z.string(),
    kind: z.enum(MESSAGE_KINDS),
    channel: z.enum(['email', 'sms']),
    recipient_client_id: z.string(),
    recipient_name: z.string().nullable(),
    status: z.enum(MESSAGE_STATUSES),
    skip_reason: z.string().nullable(),
    attempts: z.number().int(),
    created_at: z.string(),
    sent_at: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    kind: r.kind,
    channel: r.channel,
    recipientName: r.recipient_name ?? '',
    status: r.status,
    skipReason: r.skip_reason,
    attempts: r.attempts,
    createdAt: r.created_at,
    sentAt: r.sent_at,
  }))
export type AppointmentMessage = z.output<typeof sheetMessagePayload>

/** The appointment's messages to its clients, newest first (never an address, a number or a text). */
export async function fetchAppointmentMessages(id: string): Promise<AppointmentMessage[]> {
  const { data, error } = await supabase.rpc('list_appointment_messages', { p_id: id })
  if (error) throw error
  return parseRpc(z.array(sheetMessagePayload), data)
}

/** « Renvoyer la notification » (appointments.manage): how many messages were queued (0: nobody reachable). */
export async function resendAppointmentNotification(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('resend_appointment_notification', { p_id: id })
  if (error) throw error
  return parseRpc(z.number().int(), data)
}

// --- Public: the confirmation link ----------------------------------------------------------------

const linkSchema = z.object({
  purpose: z.literal('appointment_confirm'),
  display: z.object({
    clinic_name: z.string(),
    language: z.enum(['fr', 'en']),
    when: z.string(),
    professional_name: z.string(),
    mode: z.enum(['video', 'phone']),
    confirmed: z.boolean(),
  }),
})
export type ConfirmLinkDisplay = z.infer<typeof linkSchema>['display']

/** What the link opens (the moment, the professional, the mode); another purpose reads as `link_invalid`. */
export async function resolveConfirmLink(token: string): Promise<ConfirmLinkDisplay> {
  const answer = linkSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not an appointment link')
  return answer.data.display
}

/** « Confirmer ma présence » (once). */
export async function confirmByLink(token: string): Promise<void> {
  await invokeFunction('appointments-confirm', { token })
}
