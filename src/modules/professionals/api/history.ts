import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { historyEntryPayload, parseRpc, type HistoryEntry } from './parse'

/** Rows per history page (the RPC's default; it clamps to 1–200). */
export const PROFESSIONAL_HISTORY_PAGE_SIZE = 50

const historyRows = z.array(historyEntryPayload)

/**
 * One page of the professional's history (record, 1:1 rows, child rows, deleted ones included),
 * newest first, keyset-paged on the audit id: pass the previous page's last id. A full page means
 * there may be more. Needs `professionals.view`.
 */
export async function fetchProfessionalHistory(id: string, beforeId?: number): Promise<HistoryEntry[]> {
  const { data, error } = await supabase.rpc('list_professional_history', {
    p_id: id,
    ...(beforeId !== undefined && { p_before_id: beforeId }),
    p_limit: PROFESSIONAL_HISTORY_PAGE_SIZE,
  })
  if (error) throw error
  return parseRpc(historyRows, data)
}
