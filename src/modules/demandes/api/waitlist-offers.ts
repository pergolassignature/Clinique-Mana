import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { MATCH_WARNINGS, type MatchWarning } from './matching'

/*
 * The waiting list meets the matching (Demandes D4 part 2, D-34 … D-36):
 * `list_waitlist_compatible(professional)` (demandes.view and professionals.view) — the open
 * entries she could be offered (« Active » or « À rappeler », no proposal pending), of her own
 * list and her professions', whose criteria she meets, in list order (« Prioritaire » first, then
 * the oldest), with the warnings of the match. « Offrir la plage » is D3b's proposal, from the
 * request's « Jumelage » tab with her preset (`?proposer=`). Parsed here.
 */

const rowSchema = z.object({
  entry_id: z.string(),
  demande_id: z.string(),
  reference: z.string(),
  person_name: z.string().nullable(),
  client_number: z.number().nullable(),
  target_kind: z.enum(['title', 'professional']),
  target_name: z.string().nullable(),
  priority: z.enum(['normal', 'priority']),
  priority_reason: z.string().nullable(),
  registered_at: z.string(),
  waited_days: z.number().nullable(),
  state: z.string(),
  rank: z.number().nullable(),
  list_size: z.number().nullable(),
  warnings: z.array(z.string()).transform((list) => list.filter((w): w is MatchWarning => (MATCH_WARNINGS as readonly string[]).includes(w))),
  order: z.number(),
})
export type CompatibleEntry = z.infer<typeof rowSchema>

export async function fetchWaitlistCompatible(professionalId: string): Promise<CompatibleEntry[]> {
  const { data, error } = await supabase.rpc('list_waitlist_compatible', { p_professional_id: professionalId })
  if (error) throw error
  return z.array(rowSchema).parse(data)
}

/** The request's « Jumelage » tab with the proposal to her opened (« Offrir la plage »). */
export const offerPath = (demandeId: string, professionalId: string) => `/demandes/${demandeId}/jumelage?proposer=${professionalId}`
