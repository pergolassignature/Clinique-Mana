import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { PERIODS, type Period } from './matching'

/*
 * The availability board (Demandes D5, D-31): `list_professional_capacity()` (demandes.view and
 * professionals.view) — every active professional by name, with her places declared, taken and
 * left (D-30), whether she accepts new clients, her periods, languages and clientèles,
 * « À prioriser », « Bon à savoir », her matches of the last 30 days; the totals. The places are
 * Professionnels' to set: `set_professional_new_client_places` (professionals.matching), with
 * « Recommencer le décompte » (P4-553). Parsed here.
 */

const periods = z.array(z.string()).transform((list) => list.filter((p): p is Period => (PERIODS as readonly string[]).includes(p)))

const rowSchema = z.object({
  professional_id: z.string(),
  display_name: z.string(),
  primary_title_label: z.string().nullable(),
  accepting_new_clients: z.boolean(),
  availability_periods: periods,
  matching_note: z.string().nullable(),
  matching_priority_reason: z.string().nullable(),
  places_declared: z.number().nullable(),
  places_used: z.number().nullable(),
  places_left: z.number().nullable(),
  places_set_at: z.string().nullable(),
  languages: z.array(z.string()),
  clienteles: z.array(z.object({ name: z.string(), specialized: z.boolean() })),
  matched_30_days: z.number(),
})
export type CapacityRow = z.infer<typeof rowSchema>

const boardSchema = z.object({
  total_left: z.number(),
  tracked: z.number(),
  with_places: z.number(),
  last_snapshot_on: z.string().nullable(),
  professionals: z.array(rowSchema),
})
export type CapacityBoard = z.infer<typeof boardSchema>

export async function fetchCapacityBoard(): Promise<CapacityBoard> {
  const { data, error } = await supabase.rpc('list_professional_capacity')
  if (error) throw error
  return boardSchema.parse(data)
}

/** Her places offered (null: not tracked); `restart` starts the count again today with the same number. */
export async function setNewClientPlaces(professionalId: string, places: number | null, restart: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_professional_new_client_places', {
    p_id: professionalId,
    p_places: places as number,
    p_restart: restart,
  })
  if (error) throw error
}
