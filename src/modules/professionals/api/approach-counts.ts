import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { parseRpc } from './parse'

const countRow = z
  .object({ id: z.string(), key: z.string(), name: z.string(), is_active: z.boolean(), professionals: z.number().int() })
  .transform((r) => ({ id: r.id, key: r.key, name: r.name, isActive: r.is_active, professionals: r.professionals }))
/** One approach and how many active professionals hold it (P4-561). */
export type ApproachCount = z.output<typeof countRow>

/** Every approach of the clinic with its count of active professionals (`professionals.view`). */
export async function fetchApproachCounts(): Promise<ApproachCount[]> {
  const { data, error } = await supabase.rpc('count_professional_approaches')
  if (error) throw error
  return parseRpc(z.array(countRow), data)
}
