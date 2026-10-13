import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { STATES } from './demandes'

/*
 * The discovery calls (Demandes D3b, D-20): a counselor's day of calls instead of the shared
 * « conseillère » agenda (`list_discovery_calls`, demandes.view), and an open task moved or given
 * to someone (`reschedule_demande_task`, `assign_demande_task`, demandes.manage). Done and cancel
 * are D1's `complete_demande_task` / `cancel_demande_task` (api/demandes).
 */

const nullableString = z.string().nullable()

const callSchema = z.object({
  task_id: z.string(),
  demande_id: z.string(),
  reference: z.string(),
  person_name: nullableString,
  phone_e164: nullableString,
  language: nullableString,
  booked_online: z.boolean(),
  is_urgent: z.boolean(),
  demande_state: z.enum(STATES),
  due_at: z.string(),
  state: z.enum(['open', 'done', 'cancelled']),
  outcome: nullableString,
  assigned_to: nullableString,
  assigned_name: nullableString,
  done_at: nullableString,
  done_by_name: nullableString,
})
export type DiscoveryCall = z.infer<typeof callSchema>

export interface CallsPeriod {
  from: string
  to: string
  /** The open calls already due before `from` too. */
  overdue: boolean
}

/** The calls of a period (32 days at most), in time order. */
export async function listDiscoveryCalls(period: CallsPeriod): Promise<DiscoveryCall[]> {
  const { data, error } = await supabase.rpc('list_discovery_calls', { p_from: period.from, p_to: period.to, p_overdue: period.overdue })
  if (error) throw error
  return z.array(callSchema).parse(data)
}

export async function rescheduleTask(demandeId: string, taskId: string, dueAt: string): Promise<void> {
  const { error } = await supabase.rpc('reschedule_demande_task', { p_demande_id: demandeId, p_task_id: taskId, p_due_at: dueAt })
  if (error) throw error
}

/** `assignee` null: nobody in particular (whoever is free). */
export async function assignTask(demandeId: string, taskId: string, assignee: string | null): Promise<void> {
  // The generated types want a uuid; null gives the call to whoever is free.
  const { error } = await supabase.rpc('assign_demande_task', { p_demande_id: demandeId, p_task_id: taskId, p_assigned_to: assignee as string })
  if (error) throw error
}
