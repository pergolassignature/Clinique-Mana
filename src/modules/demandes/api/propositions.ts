import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'

/*
 * The proposals (Demandes D3b, D-21 … D-23): a professional and 1 to 3 of her free slots held for
 * 48 h (Rendez-vous R1b), sent with a one-use link. The staff read a request's proposals
 * (`list_demande_propositions`), the services a professional may be booked for
 * (`proposition_services`) and her free slots (Rendez-vous' `get_open_slots`, appointments.view);
 * they propose through `demandes-propose` (the token made there) and withdraw
 * (`withdraw_proposition`). The person answers on `/proposition` (`resolve-link`,
 * `demandes-proposition-answer`). Every payload is parsed here.
 */

export const RESPONSES = ['pending', 'accepted', 'declined', 'no_answer', 'expired', 'withdrawn'] as const
export type PropositionResponse = (typeof RESPONSES)[number]
export const DECLINE_REASONS = ['schedule', 'fee', 'professional', 'changed_mind', 'other'] as const
export type DeclineReason = (typeof DECLINE_REASONS)[number]

const nullableString = z.string().nullable()
const slotSchema = z.object({ appointment_id: z.string(), starts_at: z.string(), ends_at: nullableString.optional() })

const propositionSchema = z.object({
  id: z.string(),
  professional_id: z.string(),
  professional_name: nullableString,
  service_name: nullableString,
  mode: nullableString,
  slots: z.array(slotSchema),
  proposed_at: z.string(),
  proposed_by_name: nullableString,
  expires_at: nullableString,
  response: z.enum(RESPONSES),
  responded_at: nullableString,
  decline_reason: z.enum(DECLINE_REASONS).nullable(),
  accepted_starts_at: nullableString,
})
export type Proposition = z.infer<typeof propositionSchema>

export async function listPropositions(demandeId: string): Promise<Proposition[]> {
  const { data, error } = await supabase.rpc('list_demande_propositions', { p_demande_id: demandeId })
  if (error) throw error
  return z.array(propositionSchema).parse(data)
}

const serviceSchema = z.object({ id: z.string(), code: z.number(), name: z.string(), duration_minutes: z.number(), for_two: z.boolean() })
export type PropositionService = z.infer<typeof serviceSchema>

/** The services the professional may be booked for (none when she is not active). */
export async function fetchPropositionServices(professionalId: string): Promise<PropositionService[]> {
  const { data, error } = await supabase.rpc('proposition_services', { p_professional_id: professionalId })
  if (error) throw error
  return z.array(serviceSchema).parse(data)
}

const openSlotSchema = z.object({ starts_at: z.string(), ends_at: z.string() })
export type OpenSlot = z.infer<typeof openSlotSchema>

/** Her free slots for the service between two clinic days (Rendez-vous, appointments.view). */
export async function fetchOpenSlots(professionalId: string, serviceId: string, from: string, to: string): Promise<OpenSlot[]> {
  const { data, error } = await supabase.rpc('get_open_slots', { p_professional_id: professionalId, p_service_id: serviceId, p_from: from, p_to: to })
  if (error) throw error
  return z.array(openSlotSchema).parse(data)
}

export interface ProposeInput {
  demandeId: string
  professionalId: string
  serviceId: string
  startsAt: string[]
  mode: 'video' | 'phone'
}

const proposedSchema = z.object({ proposition_id: z.string(), emailed: z.boolean(), expires_at: z.string() })
export type Proposed = z.infer<typeof proposedSchema>

/** Holds the slots and emails the link; throws a FunctionCallError (a French refusal, `rate_limited`…). */
export async function propose(input: ProposeInput): Promise<Proposed> {
  const data = await invokeFunction('demandes-propose', {
    demande_id: input.demandeId,
    professional_id: input.professionalId,
    service_id: input.serviceId,
    starts_at: input.startsAt,
    mode: input.mode,
  })
  const parsed = proposedSchema.safeParse(data)
  if (!parsed.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return parsed.data
}

export async function withdrawProposition(id: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_proposition', { p_id: id })
  if (error) throw error
}

// --- Public: the person's page ---------------------------------------------------------------------

const linkSchema = z.object({
  purpose: z.literal('proposition'),
  display: z.object({
    clinic_name: z.string(),
    timezone: z.string(),
    language: z.enum(['fr', 'en']),
    professional_name: nullableString,
    professional_title: nullableString,
    service_name: nullableString,
    mode: nullableString,
    expires_at: z.string(),
    slots: z.array(z.object({ id: z.string(), starts_at: z.string(), ends_at: nullableString })),
  }),
})
export type PropositionDisplay = z.infer<typeof linkSchema>['display']

/** What the link opens; another purpose reads as `link_invalid`. */
export async function resolvePropositionLink(token: string): Promise<PropositionDisplay> {
  const answer = linkSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a proposal link')
  return answer.data.display
}

const answeredSchema = z.object({
  state: z.enum(['accepted', 'declined', 'unavailable']),
  starts_at: z.string().optional(),
  reason: z.string().optional(),
})
export type PropositionAnswer = z.infer<typeof answeredSchema>

/** Accepts one slot, or declines (with an optional reason). */
export async function answerProposition(token: string, choice: { appointmentId: string } | { decline: DeclineReason | null }): Promise<PropositionAnswer> {
  const body =
    'appointmentId' in choice
      ? { token, appointment_id: choice.appointmentId }
      : { token, decline: true, ...(choice.decline && { reason: choice.decline }) }
  const parsed = answeredSchema.safeParse(await invokeFunction('demandes-proposition-answer', body))
  if (!parsed.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return parsed.data
}
