import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/**
 * The GOrendezvous imports switch as `get_imports_status` returns it (`modules.manage`, else
 * `42501`). `imports_closed_at` is the last close (kept after a reopen); `changed_at` and
 * `changed_by_name` are the switch's last change from the audit log, null when it never changed
 * (or the author's profile is gone). The generator types every column as non-null.
 */
const importsStatusRowSchema = z.object({
  imports_open: z.boolean(),
  imports_closed_at: z.string().nullable(),
  changed_at: z.string().nullable(),
  changed_by_name: z.string().nullable(),
})

export interface ImportsStatus {
  open: boolean
  closedAt: string | null
  changedAt: string | null
  changedByName: string | null
}

export async function fetchImportsStatus(): Promise<ImportsStatus> {
  const { data, error } = await supabase.rpc('get_imports_status')
  if (error) throw error
  const row = importsStatusRowSchema.parse(data?.[0])
  return { open: row.imports_open, closedAt: row.imports_closed_at, changedAt: row.changed_at, changedByName: row.changed_by_name }
}

/** Opens (true) or closes (false) every GOrendezvous import RPC of the clinic (`modules.manage`, audited). */
export async function setImportsOpen(open: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_imports_open', { p_open: open })
  if (error) throw error
}
