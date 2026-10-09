import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { DISPLAY_STATUSES, type DisplayStatus } from '../lib/constants'
import { parseRpc } from './parse'

/** The most results the global search (⌘K) shows for professionals. */
export const PROFESSIONALS_SEARCH_LIMIT = 8

/** One row of `search_professionals`: the name, the displayed status and the primary profession. */
export interface ProfessionalSearchRow {
  id: string
  firstName: string
  lastName: string
  displayStatus: DisplayStatus
  /** The gendered label of the primary title (« Psychologue »), null without a profession. */
  titleLabel: string | null
  orderAcronym: string | null
  licenceNumber: string | null
}

const searchRows = z.array(
  z
    .object({
      id: z.string(),
      first_name: z.string(),
      last_name: z.string(),
      display_status: z.enum(DISPLAY_STATUSES),
      title_label: z.string().nullable(),
      order_acronym: z.string().nullable(),
      licence_number: z.string().nullable(),
    })
    .transform(
      (r): ProfessionalSearchRow => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        displayStatus: r.display_status,
        titleLabel: r.title_label,
        orderAcronym: r.order_acronym,
        licenceNumber: r.licence_number,
      }),
    ),
)

/**
 * The clinic's professionals matching every word of `query` (name, email, any licence, IVAC
 * number; accents and case ignored), at most PROFESSIONALS_SEARCH_LIMIT. `signal` cancels the
 * request when the query changes. Never the email nor any private value: the RPC returns none.
 */
export async function searchProfessionalsRows(query: string, signal: AbortSignal): Promise<ProfessionalSearchRow[]> {
  const { data, error } = await supabase
    .rpc('search_professionals', { p_query: query, p_limit: PROFESSIONALS_SEARCH_LIMIT })
    .abortSignal(signal)
  if (error) throw error
  return parseRpc(searchRows, data)
}
