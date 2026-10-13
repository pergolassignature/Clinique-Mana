import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'

/*
 * The waiting list (Demandes D3, roadmap §2.3 bis): the lists and their entries (`waitlist_lists`,
 * `list_waitlist`, `get_waitlist_entry`, demandes.view), the work on an entry (`register_waitlist`,
 * `update_waitlist_entry`, `set_waitlist_fee`, `log_waitlist_contact`, `add_waitlist_offer`,
 * `answer_waitlist_offer`, `exit_waitlist`, demandes.waitlist), the follow-up settings, and the
 * public answer to the « still waiting? » email (`resolve-link`, `demandes-waitlist-answer`).
 * Every call is checked by the database; every payload is parsed here.
 */

export const ENTRY_STATES = ['incomplete', 'active', 'to_call', 'offered', 'closed'] as const
export type EntryState = (typeof ENTRY_STATES)[number]
export const FEE_STATUSES = ['to_invoice', 'invoiced', 'paid', 'waived'] as const
export type FeeStatus = (typeof FEE_STATUSES)[number]
export const CONSENT_STATES = ['signed', 'resign', 'pending', 'missing', 'not_required'] as const
export type ConsentState = (typeof CONSENT_STATES)[number]
export const EXIT_REASONS = ['placed', 'referred_elsewhere', 'withdrew', 'no_answer', 'other'] as const
export type ExitReason = (typeof EXIT_REASONS)[number]
export const WAITLIST_CONTACT_KINDS = ['call', 'email', 'sms'] as const
export type WaitlistContactKind = (typeof WAITLIST_CONTACT_KINDS)[number]
export const WAITLIST_OUTCOMES = ['reached', 'voicemail', 'no_answer', 'message_sent'] as const
export type WaitlistOutcome = (typeof WAITLIST_OUTCOMES)[number]
export const OFFER_RESPONSES = ['accepted', 'declined', 'withdrawn'] as const
export type OfferResponse = (typeof OFFER_RESPONSES)[number]

export type TargetKind = 'title' | 'professional'

const nullableString = z.string().nullable()

const listSchema = z.object({
  target_kind: z.enum(['title', 'professional']),
  target_id: z.string(),
  name: z.string(),
  open_count: z.number(),
  incomplete_count: z.number(),
  to_call_count: z.number(),
  offered_count: z.number(),
  average_wait_days: z.number().nullable(),
})
export type WaitlistList = z.infer<typeof listSchema>

/** Every active profession and professional with its counts and average wait (D-19). */
export async function fetchWaitlistLists(): Promise<WaitlistList[]> {
  const { data, error } = await supabase.rpc('waitlist_lists')
  if (error) throw error
  return z.array(listSchema).parse(data)
}

const entrySchema = z.object({
  id: z.string(),
  demande_id: z.string(),
  reference: z.string(),
  client_id: nullableString,
  client_number: z.number().nullable(),
  person_name: nullableString,
  target_kind: z.enum(['title', 'professional']),
  target_id: z.string(),
  target_name: nullableString,
  priority: z.enum(['normal', 'priority']),
  priority_reason: nullableString,
  registered_at: z.string(),
  waited_days: z.number(),
  state: z.enum(ENTRY_STATES),
  fee_status: z.enum(FEE_STATUSES),
  fee_waived_reason: nullableString,
  consent_state: z.enum(CONSENT_STATES).nullable(),
  last_contact_at: nullableString,
  next_contact_at: nullableString,
  bridge_professional_id: nullableString,
  bridge_name: nullableString,
  exit_reason: z.enum(EXIT_REASONS).nullable(),
  exited_at: nullableString,
  rank: z.number().nullable(),
  list_size: z.number().nullable(),
  pending_offer: z.boolean(),
  followup_unanswered: z.boolean(),
})
export type WaitlistEntry = z.infer<typeof entrySchema>

export interface WaitlistQuery {
  /** One list (a profession or a professional), or every open entry. */
  target: { kind: TargetKind; id: string } | null
  /** Narrow by state; null: the open ones. */
  states: EntryState[] | null
}

/** One list in its order (open entries), or a request's entries (`demandeId`). */
export async function listWaitlist(query: WaitlistQuery | { demandeId: string }): Promise<WaitlistEntry[]> {
  const args =
    'demandeId' in query
      ? { p_demande_id: query.demandeId }
      : {
          ...(query.target?.kind === 'title' && { p_title_id: query.target.id }),
          ...(query.target?.kind === 'professional' && { p_professional_id: query.target.id }),
          ...(query.states && { p_states: query.states }),
        }
  const { data, error } = await supabase.rpc('list_waitlist', args)
  if (error) throw error
  return z.array(entrySchema).parse(data)
}

const contactSchema = z.object({ id: z.string(), kind: z.string(), outcome: z.string(), at: z.string(), by_name: nullableString })
const slotSchema = z.object({ starts_at: z.string(), ends_at: z.string() })
const offerSchema = z.object({
  id: z.string(),
  professional_id: z.string(),
  professional_name: nullableString,
  slots: z.array(slotSchema),
  channel: z.string(),
  offered_at: z.string(),
  response: z.enum(['pending', 'accepted', 'declined', 'expired', 'withdrawn']),
  responded_at: nullableString,
  by_name: nullableString,
})
export type WaitlistOffer = z.infer<typeof offerSchema>
export type WaitlistContact = z.infer<typeof contactSchema>

const detailSchema = z.object({
  entry: entrySchema.extend({
    availability_periods: z.array(z.string()),
    availability_days: z.array(z.number()),
    modality: z.string(),
    language: z.string(),
    preferred_pro_gender: z.string(),
    clientele_id: nullableString,
    payer_kind: z.string(),
    motif_ids: z.array(z.string()),
    consent_signed_at: nullableString,
  }),
  contacts: z.array(contactSchema),
  offers: z.array(offerSchema),
  fee: z.object({ code: z.number(), name: z.string(), price_cents: z.number().nullable(), tax_rule: z.string() }).nullable(),
  can: z.object({ manage: z.boolean() }),
})
export type WaitlistEntryDetail = z.infer<typeof detailSchema>

/** One entry with its follow-ups, offers and the fee's price; null when it is not the clinic's. */
export async function getWaitlistEntry(id: string): Promise<WaitlistEntryDetail | null> {
  const { data, error } = await supabase.rpc('get_waitlist_entry', { p_id: id })
  if (error) throw error
  return data === null ? null : detailSchema.parse(data)
}

export interface RegisterInput {
  titleId: string | null
  professionalId: string | null
  priority: 'normal' | 'priority'
  priorityReason: string
}

/** Puts the request on one or two lists (D-15); returns the entries' ids. */
export async function registerWaitlist(demandeId: string, input: RegisterInput): Promise<string[]> {
  const targets = [
    ...(input.titleId ? [{ title_id: input.titleId }] : []),
    ...(input.professionalId ? [{ professional_id: input.professionalId }] : []),
  ]
  const { data, error } = await supabase.rpc('register_waitlist', {
    p_demande_id: demandeId,
    p_targets: targets,
    p_priority: input.priority,
    ...(input.priority === 'priority' && { p_priority_reason: input.priorityReason.trim() }),
  })
  if (error) throw error
  return z.array(z.string()).parse(data)
}

/** Only the keys given change (priority and its reason, a bridge professional, the next call…). */
export async function updateWaitlistEntry(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('update_waitlist_entry', { p_id: id, p_patch: patch as never })
  if (error) throw error
}

/** « Facturer l'inscription »: Facturation invoices the fee and sends it to the dossier's payer. Returns the invoice's number. */
export async function invoiceWaitlistFee(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('invoice_waitlist_fee', { p_entry_id: id })
  if (error) throw error
  const parsed = z.string().safeParse(data)
  if (!parsed.success) throw new Error('demandes: unexpected RPC shape')
  return parsed.data
}

export async function setWaitlistFee(id: string, status: 'to_invoice' | 'paid' | 'waived', reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_waitlist_fee', { p_id: id, p_status: status, ...(reason && { p_reason: reason }) })
  if (error) throw error
}

export async function logWaitlistContact(id: string, kind: WaitlistContactKind, outcome: WaitlistOutcome, nextContactAt: string | null): Promise<void> {
  const { error } = await supabase.rpc('log_waitlist_contact', {
    p_id: id,
    p_kind: kind,
    p_outcome: outcome,
    ...(nextContactAt && { p_next_contact_at: nextContactAt }),
  })
  if (error) throw error
}

export async function addWaitlistOffer(id: string, professionalId: string, slots: { starts_at: string; ends_at: string }[]): Promise<string> {
  const { data, error } = await supabase.rpc('add_waitlist_offer', { p_id: id, p_professional_id: professionalId, p_slots: slots })
  if (error) throw error
  return z.string().parse(data)
}

export async function answerWaitlistOffer(id: string, offerId: string, response: OfferResponse): Promise<void> {
  const { error } = await supabase.rpc('answer_waitlist_offer', { p_id: id, p_offer_id: offerId, p_response: response })
  if (error) throw error
}

export async function exitWaitlist(id: string, reason: ExitReason, professionalId: string | null): Promise<void> {
  const { error } = await supabase.rpc('exit_waitlist', { p_id: id, p_reason: reason, ...(professionalId && { p_professional_id: professionalId }) })
  if (error) throw error
}

// --- Settings (D-17) ------------------------------------------------------------------------------

const settingsSchema = z
  .object({ followup_weeks: z.number().int(), followup_email: z.boolean(), answer_days: z.number().int() })
  .transform((s) => ({ followupWeeks: s.followup_weeks, followupEmail: s.followup_email, answerDays: s.answer_days }))
export type WaitlistSettings = z.output<typeof settingsSchema>

export async function fetchWaitlistSettings(): Promise<WaitlistSettings> {
  const { data, error } = await supabase.rpc('get_demandes_waitlist_settings')
  if (error) throw error
  return settingsSchema.parse(data)
}

/** Saves the follow-up; a refusal is a French P0001 with its field as HINT. */
export async function saveWaitlistSettings(s: WaitlistSettings): Promise<WaitlistSettings> {
  const { data, error } = await supabase.rpc('set_demandes_waitlist_settings', {
    p_settings: { followup_weeks: s.followupWeeks, followup_email: s.followupEmail, answer_days: s.answerDays },
  })
  if (error) throw error
  return settingsSchema.parse(data)
}

// --- Public: the « still waiting? » link ----------------------------------------------------------

const linkSchema = z.object({
  purpose: z.literal('waitlist_followup'),
  // `language`: the demande's (the page speaks it); French when absent.
  display: z.object({ clinic_name: z.string(), list_name: nullableString, language: z.enum(['fr', 'en']).default('fr') }),
})
export type FollowupLinkDisplay = z.infer<typeof linkSchema>['display']

/** What the link opens (the clinic and the list); another purpose reads as `link_invalid`. */
export async function resolveFollowupLink(token: string): Promise<FollowupLinkDisplay> {
  const answer = linkSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a waiting-list link')
  return answer.data.display
}

/** « Oui, je reste » or « Non, retirez-moi » (once). */
export async function answerFollowup(token: string, answer: 'stay' | 'leave'): Promise<void> {
  await invokeFunction('demandes-waitlist-answer', { token, answer })
}
