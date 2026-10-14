import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * Google busy times (R6, AP-40 … AP-45): a professional's own Google connection
 * (`get_my_calendar_setup`), the agenda's « Occupé » times (`list_external_busy`: times only, never
 * a title), and the three calls to the functions: « Connecter mon agenda Google »
 * (`google-calendar-connect` start → Google's consent URL), the return from Google
 * (`google-calendar-callback`), « Synchroniser » (`google-calendar-sync`) and « Déconnecter »
 * (`google-calendar-connect` disconnect). Tokens never reach the browser: no answer carries one.
 */

export const CALENDAR_STATES = ['connected', 'needs_reconnect'] as const
export type CalendarState = (typeof CALENDAR_STATES)[number]

const setupSchema = z.object({
  professional_id: z.string(),
  state: z.enum(CALENDAR_STATES).nullable(),
  account_email: z.string().nullable(),
  connected_at: z.string().nullable(),
  /** A code (`invalid_grant`, `unauthorized`, `scope_missing`), never a text. */
  reconnect_reason: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  /** A code (`provider_error`, `timeout`…), never a text. */
  last_sync_error: z.string().nullable(),
  /** The busy times still ahead. */
  busy_count: z.number().int().nullable(),
})
export type CalendarSetup = z.infer<typeof setupSchema>

/** The caller's own Google connection, or null when she is not a professional of the clinic. */
export async function fetchMyCalendarSetup(): Promise<CalendarSetup | null> {
  const { data, error } = await supabase.rpc('get_my_calendar_setup')
  if (error) throw error
  return z.array(setupSchema).parse(data)[0] ?? null
}

const busySchema = z.object({ professional_id: z.string(), starts_at: z.string(), ends_at: z.string() })

export interface ExternalBusy {
  professionalId: string
  startsAt: string
  endsAt: string
}

/** The busy times between two instants (62 days at most) of the professionals asked (null: all the caller may see). */
export async function listExternalBusy(fromIso: string, toIso: string, professionalIds: readonly string[] | null): Promise<ExternalBusy[]> {
  const { data, error } = await supabase.rpc('list_external_busy', {
    p_from: fromIso,
    p_to: toIso,
    ...(professionalIds ? { p_professional_ids: [...professionalIds] } : {}),
  })
  if (error) throw error
  return z
    .array(busySchema)
    .parse(data)
    .map((b) => ({ professionalId: b.professional_id, startsAt: b.starts_at, endsAt: b.ends_at }))
}

const startSchema = z.object({ url: z.url({ protocol: /^https?$/ }) })

/** « Connecter mon agenda Google »: Google's consent page for the clinic's Google application (signed state, 10 minutes). */
export async function startGoogleCalendarConnect(): Promise<string> {
  return startSchema.parse(await invokeFunction('google-calendar-connect', { action: 'start' })).url
}

const callbackSchema = z.object({ email: z.string().nullable(), busy: z.number().int().nullable() })
export type CalendarConnected = z.infer<typeof callbackSchema>

/** The return from Google: stores the connection and reads the busy times once; answers the address and their count. */
export async function finishGoogleCalendarConnect(code: string, state: string): Promise<CalendarConnected> {
  return callbackSchema.parse(await invokeFunction('google-calendar-callback', { code, state }))
}

const syncSchema = z.object({ outcome: z.enum(['synced', 'reconnect', 'error']) })
export type CalendarSyncOutcome = z.infer<typeof syncSchema>['outcome']

/** « Synchroniser »: her busy times read again at once. */
export async function syncGoogleCalendar(): Promise<CalendarSyncOutcome> {
  return syncSchema.parse(await invokeFunction('google-calendar-sync', { action: 'sync' })).outcome
}

const disconnectSchema = z.object({ ok: z.literal(true), revoked: z.boolean() })

/** « Déconnecter »: the grant revoked at Google (best effort), the connection and its busy times deleted. */
export async function disconnectGoogleCalendar(): Promise<void> {
  disconnectSchema.parse(await invokeFunction('google-calendar-connect', { action: 'disconnect' }))
}
