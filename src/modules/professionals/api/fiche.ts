import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/**
 * The fiche PDF (Task 4c.5; 20261008191110_professionals_fiche.sql, 20261008191422_professionals_fiche_email.sql).
 * The PDF itself is made in the browser (`../pdf/`); the database keeps when it was last made, and
 * `professionals-fiche` emails an uploaded fiche.
 */

/** Stamps `professionals.fiche_generated_at` (professionals.view); throws the PostgREST error. */
export async function markFicheGenerated(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_professional_fiche_generated', { p_id: id })
  if (error) throw error
}

export interface FicheEmail {
  professionalId: string
  /** The `professional_fiche` upload (`uploadFile`): the very file the person made. */
  fileId: string
  to: string
  /** Empty: none. */
  message: string
}

const sentSchema = z.object({ email_log_id: z.string().min(1) })

/** Emails an uploaded fiche through `professionals-fiche`; throws its `FunctionCallError`. */
export async function sendFicheEmail({ professionalId, fileId, to, message }: FicheEmail): Promise<{ emailLogId: string }> {
  const data = sentSchema.parse(
    await invokeFunction('professionals-fiche', {
      action: 'email',
      professional_id: professionalId,
      file_id: fileId,
      to,
      ...(message ? { message } : {}),
    }),
  )
  return { emailLogId: data.email_log_id }
}
