import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { useAccess } from '@/core/access/access-context'
import { supabase } from '@/core/supabase/client'

/**
 * Realtime between staff (roadmap §3.1; built with Demandes, D2): one private broadcast channel
 * per clinic and module, `org:<org id>:<module>`. The database announces **identifiers only**
 * (`*_core_realtime.sql`: `{ module, table, record_id, op }`, from triggers); the screen
 * invalidates its React Query keys and reads again through its RPCs, with its own rights.
 *
 * - Joining is authorized by the database (a member of the clinic holding a permission of the
 *   module); a refused join simply hears nothing: the screens still read on mount and focus.
 * - `onResync` runs when the channel comes back after a cut (a second `SUBSCRIBED`): changes may
 *   have been missed, so the screen reads everything again.
 * - Nothing polls (CLAUDE.md §8: only the bell's count does).
 */
export interface RealtimeChange {
  module: string
  table: string
  recordId: string
  op: 'insert' | 'update' | 'delete'
}

const payloadSchema = z.object({
  module: z.string(),
  table: z.string(),
  record_id: z.string(),
  op: z.enum(['insert', 'update', 'delete']),
})

/** The channel of a module for the signed-in person's clinic (none while access loads). */
export function realtimeTopic(orgId: string, module: string): string {
  return `org:${orgId}:${module}`
}

export function useOrgRealtime(
  module: string | null,
  handlers: { onChange: (change: RealtimeChange) => void; onResync: () => void },
): void {
  const { access } = useAccess()
  const orgId = access?.org_id ?? null
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!module || !orgId) return
    let cancelled = false
    let joined = false
    const channel = supabase.channel(realtimeTopic(orgId, module), { config: { private: true } })
    channel.on('broadcast', { event: 'change' }, (message: { payload?: unknown }) => {
      const parsed = payloadSchema.safeParse(message.payload)
      if (!parsed.success || parsed.data.module !== module) return
      latest.current.onChange({ module, table: parsed.data.table, recordId: parsed.data.record_id, op: parsed.data.op })
    })
    // A private channel joins with the person's token.
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return
        channel.subscribe((status) => {
          if (status !== 'SUBSCRIBED') return
          if (joined) latest.current.onResync()
          joined = true
        })
      })
    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [module, orgId])
}
