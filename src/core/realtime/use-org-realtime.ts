import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { z } from 'zod'
import { useAccess } from '@/core/access/access-context'
import { supabase } from '@/core/supabase/client'

/**
 * Realtime between staff (roadmap §3.1; built with Demandes, D2): one private broadcast channel
 * per clinic and module, `org:<org id>:<module>`. The database announces **identifiers only**
 * (`*_core_realtime.sql`: `{ module, table, record_id, op }`, from triggers); the screen
 * invalidates its React Query keys and reads again through its RPCs, with its own rights.
 *
 * - Joining is authorized by the database (a member of the clinic holding `<module>.view`); a
 *   refused join simply hears nothing: the screens still read on mount and focus.
 * - **One channel per topic for the whole app**, shared by every screen listening to it and kept
 *   a few seconds after the last one leaves: realtime-js hands back a channel of the same topic
 *   until the server confirms a leave, so a page change (inbox → record) must reuse it, never
 *   remove it and join again.
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

interface Handlers {
  onChange: (change: RealtimeChange) => void
  onResync: () => void
}

const payloadSchema = z.object({
  module: z.string(),
  table: z.string(),
  record_id: z.string(),
  op: z.enum(['insert', 'update', 'delete']),
})

/** How long a channel nobody listens to stays joined (a page change reuses it). */
export const CHANNEL_GRACE_MS = 10_000

interface SharedChannel {
  channel: RealtimeChannel
  listeners: Set<{ current: Handlers }>
  joined: boolean
  removal: ReturnType<typeof setTimeout> | null
}

const channels = new Map<string, SharedChannel>()

/** The channel of a module for the signed-in person's clinic. */
export function realtimeTopic(orgId: string, module: string): string {
  return `org:${orgId}:${module}`
}

function join(topic: string, module: string): SharedChannel {
  const existing = channels.get(topic)
  if (existing) {
    if (existing.removal) clearTimeout(existing.removal)
    existing.removal = null
    return existing
  }
  const channel = supabase.channel(topic, { config: { private: true } })
  const shared: SharedChannel = { channel, listeners: new Set(), joined: false, removal: null }
  channel.on('broadcast', { event: 'change' }, (message: { payload?: unknown }) => {
    const parsed = payloadSchema.safeParse(message.payload)
    if (!parsed.success || parsed.data.module !== module) return
    const change: RealtimeChange = { module, table: parsed.data.table, recordId: parsed.data.record_id, op: parsed.data.op }
    for (const listener of shared.listeners) listener.current.onChange(change)
  })
  // A private channel joins with the person's token.
  void supabase.realtime
    .setAuth()
    .catch(() => undefined)
    .then(() => {
      if (channels.get(topic) !== shared) return
      channel.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return
        if (shared.joined) for (const listener of shared.listeners) listener.current.onResync()
        shared.joined = true
      })
    })
  channels.set(topic, shared)
  return shared
}

function leave(topic: string, listener: { current: Handlers }): void {
  const shared = channels.get(topic)
  if (!shared) return
  shared.listeners.delete(listener)
  if (shared.listeners.size > 0 || shared.removal) return
  shared.removal = setTimeout(() => {
    if (shared.listeners.size > 0) return
    channels.delete(topic)
    void supabase.removeChannel(shared.channel)
  }, CHANNEL_GRACE_MS)
}

export function useOrgRealtime(module: string | null, handlers: Handlers): void {
  const { access } = useAccess()
  const orgId = access?.org_id ?? null
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!module || !orgId) return
    const topic = realtimeTopic(orgId, module)
    const listener = latest
    join(topic, module).listeners.add(listener)
    return () => leave(topic, listener)
  }, [module, orgId])
}

/** Test-only: forget every channel (no removal sent). */
export function resetRealtimeChannelsForTests(): void {
  for (const shared of channels.values()) if (shared.removal) clearTimeout(shared.removal)
  channels.clear()
}
