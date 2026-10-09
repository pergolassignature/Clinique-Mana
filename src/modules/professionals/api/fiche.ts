import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'
import type { Duration } from './compensation'
import { parseRpc } from './parse'
import { sqlArgs } from './sql-args'

/**
 * The fiche PDF (Task 4c.5; 20261008211740_professionals_fiche.sql, 20261008211742_professionals_fiche_email.sql,
 * 20261008212331_professionals_public_fees.sql). The PDF itself is made in the browser (`../pdf/`); the database
 * gives the public fees, keeps when it was last made, and `professionals-fiche` emails an uploaded fiche.
 */

/** A client price of the retention grid in force today (P4-218): what the client pays, never what the professional receives. */
export interface PublicFee {
  duration: Duration
  clientPriceCents: number
}

const feesSchema = z.array(
  z
    .object({
      duration: z.union([z.literal(60), z.literal(50), z.literal(30)]),
      client_price_cents: z.number().int().positive(),
    })
    .transform((r): PublicFee => ({ duration: r.duration, clientPriceCents: r.client_price_cents })),
)

/**
 * The public fees of a professional for one of their titles (null → the primary one), from the
 * grid in force today (`get_professional_public_fees`, professionals.view: the conseillères send
 * fiches). Empty without a grid. Throws the PostgREST error.
 */
export async function fetchPublicFees(professionalId: string, titleId: string | null): Promise<PublicFee[]> {
  const { data, error } = await supabase.rpc(
    'get_professional_public_fees',
    sqlArgs<'get_professional_public_fees'>({ p_id: professionalId, p_title_id: titleId }),
  )
  if (error) throw error
  return parseRpc(feesSchema, data)
}

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
