import { supabase } from '@/core/supabase/client'

/**
 * The fiche PDF (Task 4c.5; 20261008191110_professionals_fiche.sql). The PDF itself is made in
 * the browser (`../pdf/`); the database only keeps when it was last made.
 */

/** Stamps `professionals.fiche_generated_at` (professionals.view); throws the PostgREST error. */
export async function markFicheGenerated(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_professional_fiche_generated', { p_id: id })
  if (error) throw error
}
