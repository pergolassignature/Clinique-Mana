import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * Video links (RZ): each professional's Zoom connection and fixed link (`get_my_video_setup`,
 * `list_professional_video_status`, `set_professional_video_link`), an appointment's effective
 * link (`get_appointment_video`, « Réessayer »), and the three calls to the functions: « Connecter
 * mon Zoom » (`zoom-connect` start → Zoom's consent URL), the return from Zoom (`zoom-callback`)
 * and « Déconnecter » (`zoom-connect` disconnect). Tokens never reach the browser: none of these
 * answers carries one.
 */

export const ZOOM_STATES = ['connected', 'needs_reconnect', 'disconnected'] as const
export type ZoomState = (typeof ZOOM_STATES)[number]

const setupSchema = z.object({
  professional_id: z.string(),
  zoom_state: z.enum(ZOOM_STATES).nullable(),
  zoom_email: z.string().nullable(),
  zoom_connected_at: z.string().nullable(),
  /** A code (`invalid_grant`, `unauthorized`, `deauthorized`), never a text. */
  zoom_reconnect_reason: z.string().nullable(),
  fixed_url: z.string().nullable(),
})
export type VideoSetup = z.infer<typeof setupSchema>

/** The caller's own setup, or null when she is not a professional of the clinic. */
export async function fetchMyVideoSetup(): Promise<VideoSetup | null> {
  const { data, error } = await supabase.rpc('get_my_video_setup')
  if (error) throw error
  return z.array(setupSchema).parse(data)[0] ?? null
}

/**
 * Every professional's setup the caller may see (staff: those with a connection or a fixed link;
 * a professional: hers). A professional with neither has no row.
 */
export async function listProfessionalVideoStatus(): Promise<VideoSetup[]> {
  const { data, error } = await supabase.rpc('list_professional_video_status')
  if (error) throw error
  return z.array(setupSchema).parse(data)
}

/** A professional's fixed link (`appointments.manage`, or her own); a blank one removes it. A refused address is a French P0001 whose HINT is `url`. */
export async function setProfessionalVideoLink(professionalId: string, url: string): Promise<void> {
  const { error } = await supabase.rpc('set_professional_video_link', { p_professional_id: professionalId, p_url: url })
  if (error) throw error
}

const directorySchema = z.object({ id: z.string(), display_name: z.string(), status: z.string() })
export type ProfessionalName = z.infer<typeof directorySchema>

/** The clinic's professionals by name (Professionnels' published `professionals_directory`; empty without `professionals.view`). */
export async function listProfessionalNames(): Promise<ProfessionalName[]> {
  const { data, error } = await supabase.from('professionals_directory').select('id, display_name, status').order('display_name').limit(500)
  if (error) throw error
  return z.array(directorySchema).parse(data)
}

const linkSchema = z.object({
  url: z.string().nullable(),
  source: z.enum(['zoom', 'fixed']).nullable(),
  status: z.enum(['ready', 'pending', 'failed', 'none']),
})
export type AppointmentVideo = z.infer<typeof linkSchema>

/** An appointment's effective link (its Zoom meeting, else the professional's fixed link); null when the caller cannot see it. */
export async function fetchAppointmentVideo(appointmentId: string): Promise<AppointmentVideo | null> {
  const { data, error } = await supabase.rpc('get_appointment_video', { p_appointment_id: appointmentId })
  if (error) throw error
  return z.array(linkSchema).parse(data)[0] ?? null
}

/** « Réessayer »: a failed meeting is tried again by the next run of the job (within 5 minutes). */
export async function retryAppointmentVideo(appointmentId: string): Promise<void> {
  const { error } = await supabase.rpc('retry_appointment_video', { p_appointment_id: appointmentId })
  if (error) throw error
}

const startSchema = z.object({ url: z.url({ protocol: /^https?$/ }) })

/** « Connecter mon Zoom »: Zoom's consent page for the clinic's Zoom app (signed state, 10 minutes). */
export async function startZoomConnect(): Promise<string> {
  return startSchema.parse(await invokeFunction('zoom-connect', { action: 'start' })).url
}

const callbackSchema = z.object({ email: z.string().nullable() })

/** The return from Zoom: stores the connection; answers the Zoom address. */
export async function finishZoomConnect(code: string, state: string): Promise<string | null> {
  return callbackSchema.parse(await invokeFunction('zoom-callback', { code, state })).email
}

const disconnectSchema = z.object({ ok: z.literal(true), revoked: z.boolean() })

/** « Déconnecter »: the grant revoked at Zoom (best effort), the connection ended. */
export async function disconnectZoom(): Promise<void> {
  disconnectSchema.parse(await invokeFunction('zoom-connect', { action: 'disconnect' }))
}
