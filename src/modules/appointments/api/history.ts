import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { parseRpc } from './parse'

/** An appointment's « Historique » (AP-33): its audit rows, its participants' and its meeting's. */

const historyEntryPayload = z.object({
  id: z.number(),
  created_at: z.string(),
  table_name: z.string(),
  record_id: z.string(),
  action: z.string(),
  changed_fields: z.unknown().nullable(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_role: z.string().nullable(),
  source: z.string(),
})
export type AppointmentHistoryEntry = z.output<typeof historyEntryPayload>

/** Rows per page (the RPC clamps to 1–200). */
export const APPOINTMENT_HISTORY_PAGE_SIZE = 50

/** One page, newest first, before `beforeId` (the previous page's last id). */
export async function fetchAppointmentHistory(id: string, beforeId: number | null): Promise<AppointmentHistoryEntry[]> {
  const { data, error } = await supabase.rpc('list_appointment_history', {
    p_id: id,
    ...(beforeId !== null && { p_before_id: beforeId }),
    p_limit: APPOINTMENT_HISTORY_PAGE_SIZE,
  })
  if (error) throw error
  return parseRpc(z.array(historyEntryPayload), data)
}
