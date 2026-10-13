import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { APPOINTMENT_STATES, MODES, PRESENCES, parseRpc } from './parse'

/** R5: a client's appointments (`list_client_visits`), for Clients' « Visites et paiements ». */

const visitPayload = z
  .object({
    id: z.string(),
    starts_at: z.string(),
    ends_at: z.string(),
    state: z.enum(APPOINTMENT_STATES),
    mode: z.enum(MODES),
    professional_id: z.string(),
    professional_name: z.string().nullable(),
    service_id: z.string().nullable(),
    service_code: z.number().int().nullable(),
    service_name: z.string().nullable(),
    presence: z.enum(PRESENCES),
    role: z.enum(['client', 'second']),
    cancel_reason: z.string().nullable(),
    cancel_late: z.boolean().nullable(),
    kept_on_schedule: z.boolean(),
    confirmed_at: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    state: r.state,
    mode: r.mode,
    professionalId: r.professional_id,
    professionalName: r.professional_name ?? '',
    serviceName: r.service_name,
    serviceCode: r.service_code,
    presence: r.presence,
    role: r.role,
    cancelReason: r.cancel_reason,
    cancelLate: r.cancel_late,
    keptOnSchedule: r.kept_on_schedule,
    confirmedAt: r.confirmed_at,
  }))
export type ClientVisit = z.output<typeof visitPayload>

export const VISITS_PAGE = 50

/** A page of the client's appointments, newest first, before `beforeIso` (the last one shown). */
export async function fetchClientVisits(clientId: string, beforeIso: string | null): Promise<ClientVisit[]> {
  const { data, error } = await supabase.rpc('list_client_visits', { p_client_id: clientId, p_before: beforeIso ?? undefined, p_limit: VISITS_PAGE })
  if (error) throw error
  return parseRpc(z.array(visitPayload), data)
}
