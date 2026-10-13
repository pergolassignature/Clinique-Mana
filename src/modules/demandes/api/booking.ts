import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'

/**
 * The discovery-call booking (Demandes D3c, R-74). The public page talks to `demandes-book-call`
 * (no session: the clinic comes from the page's address, the database checks it); the cancel page
 * also reads the call through `resolve-link`. The staff read and save the weekly rule through
 * `get_` / `set_demandes_booking_settings`. Every payload is parsed here.
 */

export const UNEXPECTED_SHAPE = 'demandes: unexpected booking shape'

// --- Public ---------------------------------------------------------------------------------------

const pageSchema = z.discriminatedUnion('open', [
  z.object({ open: z.literal(false) }),
  z.object({
    open: z.literal(true),
    clinic_name: z.string(),
    timezone: z.string(),
    slot_minutes: z.number().int(),
    slots: z.array(z.string()),
    referral_sources: z.array(z.object({ id: z.string(), name: z.string() })),
    check: z.object({ ticket: z.string(), bits: z.number().int().min(0).max(24) }),
  }),
])
export type BookingPage = z.infer<typeof pageSchema>

/** The page: closed, or the clinic, its free slots, its « Comment avez-vous entendu parler de MANA ? » list and a check to solve. */
export async function fetchBookingPage(org: string, signal?: AbortSignal): Promise<BookingPage> {
  const page = pageSchema.safeParse(await invokeFunction('demandes-book-call', { action: 'page', org }, { signal }))
  if (!page.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return page.data
}

export interface BookingSource {
  utm: Record<string, string>
  referrer: string | null
  landing: string | null
}

export interface BookingInput {
  org: string
  ticket: string
  nonce: string
  startsAt: string
  firstName: string
  lastName: string
  email: string
  phoneE164: string
  language: 'fr' | 'en'
  message: string | null
  referralSourceId: string | null
  source: BookingSource
}

const bookedSchema = z.object({ starts_at: z.string(), timezone: z.string(), emailed: z.boolean() })
export type Booked = z.infer<typeof bookedSchema>

/** Books the slot; throws a FunctionCallError (a French refusal, `rate_limited`, …). */
export async function bookCall(input: BookingInput): Promise<Booked> {
  const data = await invokeFunction('demandes-book-call', {
    action: 'book',
    org: input.org,
    ticket: input.ticket,
    nonce: input.nonce,
    starts_at: input.startsAt,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone_e164: input.phoneE164,
    language: input.language,
    ...(input.message && { message: input.message }),
    referral_source_id: input.referralSourceId,
    source: {
      utm: input.source.utm,
      ...(input.source.referrer && { referrer: input.source.referrer }),
      ...(input.source.landing && { landing: input.source.landing }),
    },
  })
  const booked = bookedSchema.safeParse(data)
  if (!booked.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return booked.data
}

const linkSchema = z.object({
  purpose: z.literal('discovery_call'),
  display: z.object({ clinic_name: z.string(), timezone: z.string(), starts_at: z.string(), language: z.enum(['fr', 'en']) }),
})
export type CancelLinkDisplay = z.infer<typeof linkSchema>['display']

/** What the cancel link opens (the clinic and the call); another purpose reads as `link_invalid`. */
export async function resolveCancelLink(token: string): Promise<CancelLinkDisplay> {
  const answer = linkSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a discovery call link')
  return answer.data.display
}

/** Cancels the call by its link (once). */
export async function cancelCall(token: string): Promise<void> {
  await invokeFunction('demandes-book-call', { action: 'cancel', token })
}

// --- Staff ----------------------------------------------------------------------------------------

const rangeSchema = z.object({ day: z.number().int().min(1).max(7), start: z.string(), end: z.string() })
export type WeeklyRange = z.infer<typeof rangeSchema>

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    slot_minutes: z.number().int(),
    notice_hours: z.number().int(),
    horizon_days: z.number().int(),
    capacity: z.number().int(),
    weekly: z.array(rangeSchema),
  })
  .transform((r) => ({
    enabled: r.enabled,
    slotMinutes: r.slot_minutes,
    noticeHours: r.notice_hours,
    horizonDays: r.horizon_days,
    capacity: r.capacity,
    weekly: r.weekly,
  }))
export type BookingSettings = z.output<typeof settingsSchema>

function parseSettings(data: unknown): BookingSettings {
  const result = settingsSchema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

export async function fetchBookingSettings(): Promise<BookingSettings> {
  const { data, error } = await supabase.rpc('get_demandes_booking_settings')
  if (error) throw error
  return parseSettings(data)
}

/** Saves the whole rule; a refusal is a French P0001 with its field as HINT. */
export async function saveBookingSettings(s: BookingSettings): Promise<BookingSettings> {
  const { data, error } = await supabase.rpc('set_demandes_booking_settings', {
    p_settings: {
      enabled: s.enabled,
      slot_minutes: s.slotMinutes,
      notice_hours: s.noticeHours,
      horizon_days: s.horizonDays,
      capacity: s.capacity,
      weekly: s.weekly,
    },
  })
  if (error) throw error
  return parseSettings(data)
}

/** The page's address for the website's button (the clinic's id names it). */
export const bookingPageUrl = (origin: string, orgId: string) => `${origin}/appel-decouverte?clinique=${orgId}`
