import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * The matching panel (Demandes D4, D-27 … D-30): `match_professionals_for_demande(demande)`
 * (demandes.view and professionals.view) answers the request's criteria and every professional of
 * the clinic in the documented order — eligible ones first; within them the fit (motifs held, a ★
 * clientèle, the periods), then places left, then the name — each with why she is left out
 * (hard filters) or what to check (warnings, never filters: a refused motif, R-66; the insurance;
 * an age or a sex to ask; 0 place left). Parsed here.
 */

export const MATCH_REASONS = ['inactive', 'not_ready', 'not_accepting', 'title', 'clientele', 'min_age', 'women_only', 'language', 'gender'] as const
export type MatchReason = (typeof MATCH_REASONS)[number]
export const MATCH_WARNINGS = [
  'refused_motif',
  'insurance_expired',
  'insurance_expiring',
  'insurance_missing',
  'age_unknown',
  'sex_unknown',
  'no_places',
] as const
export type MatchWarning = (typeof MATCH_WARNINGS)[number]
export const PERIODS = ['am', 'pm', 'end_of_day', 'evening', 'weekend'] as const
export type Period = (typeof PERIODS)[number]

const named = z.object({ id: z.string(), name: z.string() })
/** A code the app does not know yet (a later migration's) is dropped, never a crash. */
const knownOf = <T extends string>(values: readonly T[]) =>
  z.array(z.string()).transform((list) => list.filter((v): v is T => (values as readonly string[]).includes(v)))

const professionalSchema = z.object({
  professional_id: z.string(),
  display_name: z.string(),
  title_label: z.string().nullable(),
  eligible: z.boolean(),
  reasons: knownOf(MATCH_REASONS),
  warnings: knownOf(MATCH_WARNINGS),
  motif_hits: z.array(named),
  refused_hits: z.array(named),
  specialized: z.boolean(),
  period_hits: knownOf(PERIODS),
  fit: z.number(),
  places_declared: z.number().nullable(),
  places_left: z.number().nullable(),
  insurance_status: z.string(),
  matching_note: z.string().nullable(),
  priority_reason: z.string().nullable(),
  availability_periods: knownOf(PERIODS),
  updated_at: z.string().nullable(),
  rank: z.number(),
})
export type MatchedProfessional = z.infer<typeof professionalSchema>

const criteriaSchema = z.object({
  demande_id: z.string(),
  client_id: z.string().nullable(),
  language: z.string(),
  beneficiary: z.string().nullable(),
  profession_title_id: z.string().nullable(),
  profession_title_name: z.string().nullable().optional(),
  clientele_id: z.string().nullable(),
  clientele_name: z.string().nullable().optional(),
  preferred_pro_gender: z.string(),
  availability_periods: knownOf(PERIODS),
  motifs: z.array(named),
  sex: z.string().nullable(),
  age: z.number().nullable(),
})
export type MatchCriteria = z.infer<typeof criteriaSchema>

const matchSchema = z.object({ criteria: criteriaSchema, professionals: z.array(professionalSchema) })
export type DemandeMatch = z.infer<typeof matchSchema>

export async function fetchDemandeMatch(demandeId: string): Promise<DemandeMatch> {
  const { data, error } = await supabase.rpc('match_professionals_for_demande', { p_demande_id: demandeId })
  if (error) throw error
  return matchSchema.parse(data)
}
