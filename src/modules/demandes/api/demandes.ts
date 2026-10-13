import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { Json } from '@/core/supabase/database.types'

/*
 * Demandes (D2): the inbox (`list_demandes`, `demandes_counts`), the record's bundle
 * (`get_demande`), the reference lists (`get_demandes_reference`) and the D1 RPCs the screens
 * write through. Every call is checked by the database (demandes.view / .manage / .notes).
 */

export const STATES = ['new', 'evaluating', 'accepted', 'proposed', 'matched', 'waitlist', 'closed'] as const
export type DemandeState = (typeof STATES)[number]
export const CLOSED_REASONS = ['referred_out', 'not_relevant', 'no_answer', 'withdrew', 'duplicate', 'other'] as const
export type ClosedReason = (typeof CLOSED_REASONS)[number]
export const CHANNELS = ['phone', 'email', 'web_form', 'booking_page', 'sms', 'referral', 'walk_in', 'other'] as const
export const CONTACT_CHANNELS = ['phone', 'email', 'sms', 'other'] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]
export const CONTACT_OUTCOMES = ['reached', 'voicemail', 'no_answer', 'message_sent', 'wrong_number'] as const
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number]
export const TASK_KINDS = ['discovery_call', 'callback', 'follow_up', 'other'] as const
export type TaskKind = (typeof TASK_KINDS)[number]
export const TASK_OUTCOMES = [...CONTACT_OUTCOMES, 'not_needed'] as const
export type TaskOutcome = (typeof TASK_OUTCOMES)[number]
export const BENEFICIARIES = ['self', 'child', 'teen', 'couple', 'family', 'other'] as const
export const MODALITIES = ['video', 'phone', 'any'] as const
export const GENDERS = ['female', 'male', 'any'] as const
export const PAYER_KINDS = ['self', 'insurance', 'eap', 'ivac', 'other', 'unknown'] as const
export const PERIODS = ['am', 'pm', 'end_of_day', 'evening', 'weekend'] as const
export const RELATIONSHIPS = ['self', 'child', 'partner', 'parent', 'sibling', 'other'] as const
export const PROMISES = ['ok', 'soon', 'late', 'met', 'met_late', 'none'] as const
export type Promise_ = (typeof PROMISES)[number]

/** The inbox's views and filters. */
export const VIEWS = ['open', 'matched', 'waitlist', 'closed', 'all'] as const
export type InboxView = (typeof VIEWS)[number]
export const ASSIGNED = ['any', 'me', 'none'] as const
export type AssignedFilter = (typeof ASSIGNED)[number]
export const FLAGS = ['late', 'no_answer', 'urgent', 'due'] as const
export type InboxFlag = (typeof FLAGS)[number]

export interface InboxQuery {
  view: InboxView
  assigned: AssignedFilter
  flags: InboxFlag[]
  search: string
}

/** Rows per page (the RPC caps at 100). */
export const PAGE_SIZE = 50

const rowSchema = z.object({
  id: z.string(),
  reference: z.string(),
  received_at: z.string(),
  channel: z.string(),
  state: z.enum(STATES),
  is_urgent: z.boolean(),
  client_id: z.string().nullable(),
  client_number: z.number().nullable(),
  person_name: z.string().nullable(),
  beneficiary: z.string().nullable(),
  assigned_to: z.string().nullable(),
  assigned_name: z.string().nullable(),
  contact_attempts: z.number(),
  last_contact_at: z.string().nullable(),
  last_outcome: z.string().nullable(),
  next_contact_at: z.string().nullable(),
  first_contact_at: z.string().nullable(),
  waiting_hours: z.number(),
  promise: z.enum(PROMISES),
  no_answer: z.boolean(),
  handled_by: z.string().nullable(),
  handled_by_name: z.string().nullable(),
  handled_at: z.string().nullable(),
  open_tasks: z.number(),
  next_task_due: z.string().nullable(),
  motif_count: z.number(),
})
export type InboxRow = z.infer<typeof rowSchema>

/** One page of the inbox. */
export async function listDemandes(query: InboxQuery, page: number): Promise<InboxRow[]> {
  const { data, error } = await supabase.rpc('list_demandes', {
    p_view: query.view,
    p_assigned: query.assigned,
    p_flags: query.flags,
    ...(query.search.trim() && { p_search: query.search.trim() }),
    p_offset: page * PAGE_SIZE,
    p_limit: PAGE_SIZE,
  })
  if (error) throw error
  return z.array(rowSchema).parse(data)
}

const countsSchema = z.array(
  z.object({ open: z.number(), late: z.number(), no_answer: z.number(), due: z.number(), mine: z.number(), unassigned: z.number(), waitlist: z.number() }),
)
export type InboxCounts = z.infer<typeof countsSchema>[number]

export async function fetchCounts(): Promise<InboxCounts> {
  const { data, error } = await supabase.rpc('demandes_counts')
  if (error) throw error
  const rows = countsSchema.parse(data)
  return rows[0] ?? { open: 0, late: 0, no_answer: 0, due: 0, mine: 0, unassigned: 0, waitlist: 0 }
}

const nullableString = z.string().nullable()

const demandeSchema = z.looseObject({
  id: z.string(),
  reference: z.string(),
  received_at: z.string(),
  received_by_name: nullableString,
  channel: z.string(),
  referral_source_id: nullableString,
  source_campaign: nullableString,
  source_referrer: nullableString,
  source_utm: z.record(z.string(), z.string()).nullable().catch(null),
  source_landing_page: nullableString,
  client_id: nullableString,
  contact_name: nullableString,
  contact_email: nullableString,
  contact_phone_e164: nullableString,
  beneficiary: nullableString,
  previous_therapy: z.boolean().nullable(),
  language: z.string(),
  modality: z.string(),
  availability_periods: z.array(z.string()),
  availability_days: z.array(z.number()),
  preferred_pro_gender: z.string(),
  profession_title_id: nullableString,
  clientele_id: nullableString,
  concerns: nullableString,
  payer_kind: z.string(),
  insurer: nullableString,
  state: z.enum(STATES),
  closed_reason: nullableString,
  closed_at: nullableString,
  is_urgent: z.boolean(),
  assigned_to: nullableString,
  assigned_name: nullableString,
  matched_professional_id: nullableString,
  contact_attempts: z.number(),
  last_contact_at: nullableString,
  next_contact_at: nullableString,
  handled_by: nullableString,
  handled_by_name: nullableString,
  handled_at: nullableString,
  waiting_hours: z.number(),
  promise: z.enum(PROMISES),
  no_answer: z.boolean(),
  first_contact_at: nullableString,
  last_outcome: nullableString,
  person_name: nullableString,
})

const fileSchema = z.object({ client_number: z.number(), display_name: z.string() })

const bundleSchema = z.object({
  demande: demandeSchema,
  client: z
    .object({
      id: z.string(),
      client_number: z.number(),
      display_name: z.string(),
      email: nullableString,
      mobile_e164: nullableString,
      birthday: nullableString,
      is_archived: z.boolean(),
    })
    .nullable(),
  matched_professional: z.object({ id: z.string(), display_name: z.string() }).nullable(),
  motif_ids: z.array(z.string()),
  participants: z.array(
    z.object({
      id: z.string(),
      client_id: nullableString,
      display_name: nullableString,
      relationship: z.string(),
      birthday: nullableString,
      is_primary: z.boolean(),
      client: fileSchema.nullable(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(TASK_KINDS),
      due_at: z.string(),
      state: z.enum(['open', 'done', 'cancelled']),
      outcome: nullableString,
      assigned_to: nullableString,
      assigned_name: nullableString,
      done_at: nullableString,
      done_by_name: nullableString,
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      from_state: nullableString,
      to_state: nullableString,
      closed_reason: nullableString,
      contact_channel: nullableString,
      contact_outcome: nullableString,
      professional_name: nullableString,
      assignee_name: nullableString,
      at: z.string(),
      by_name: nullableString,
    }),
  ),
  note: z.object({ internal_note: z.string(), updated_at: z.string(), updated_by_name: nullableString }).nullable(),
  can: z.object({ manage: z.boolean(), notes: z.boolean() }),
})
export type DemandeBundle = z.infer<typeof bundleSchema>
export type DemandeTask = DemandeBundle['tasks'][number]
export type DemandeEvent = DemandeBundle['events'][number]
export type DemandeParticipant = DemandeBundle['participants'][number]

/** The record's bundle; null when it is not the caller's clinic's. */
export async function getDemande(id: string): Promise<DemandeBundle | null> {
  const { data, error } = await supabase.rpc('get_demande', { p_id: id })
  if (error) throw error
  return data === null ? null : bundleSchema.parse(data)
}

const optionSchema = z.object({ id: z.string(), name: z.string() })
const referenceSchema = z.object({
  workers: z.array(z.object({ user_id: z.string(), display_name: z.string() })),
  referral_sources: z.array(optionSchema),
  motifs: z.array(optionSchema.extend({ category_id: nullableString, category_name: nullableString })),
  profession_titles: z.array(optionSchema),
  clienteles: z.array(optionSchema),
})
export type DemandesReference = z.infer<typeof referenceSchema>

export async function fetchReference(): Promise<DemandesReference> {
  const { data, error } = await supabase.rpc('get_demandes_reference')
  if (error) throw error
  return referenceSchema.parse(data)
}

// ---------------------------------------------------------------------------------------------
// Writes (D1's RPCs)
// ---------------------------------------------------------------------------------------------

/** A new request: « saisie rapide » (a name and a phone) or more. Returns its id. */
export async function createDemande(data: Record<string, unknown>): Promise<string> {
  const { data: id, error } = await supabase.rpc('create_demande', { p_data: data as Json })
  if (error) throw error
  return z.string().parse(id)
}

/** The intake keys given only. */
export async function updateDemande(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('update_demande', { p_id: id, p_patch: patch as Json })
  if (error) throw error
}

export async function setDemandeState(id: string, state: DemandeState, closedReason: ClosedReason | null): Promise<void> {
  const { error } = await supabase.rpc('set_demande_state', {
    p_id: id,
    p_state: state,
    ...(closedReason && { p_closed_reason: closedReason }),
  })
  if (error) throw error
}

export async function assignDemande(id: string, assignee: string | null): Promise<void> {
  // The generated types want a uuid; null leaves the request in the shared inbox.
  const { error } = await supabase.rpc('assign_demande', { p_id: id, p_assignee: assignee as string })
  if (error) throw error
}

export async function logContact(id: string, channel: ContactChannel, outcome: ContactOutcome, nextContactAt: string | null): Promise<void> {
  const { error } = await supabase.rpc('log_demande_contact', {
    p_id: id,
    p_channel: channel,
    p_outcome: outcome,
    ...(nextContactAt && { p_next_contact_at: nextContactAt }),
  })
  if (error) throw error
}

export async function addTask(id: string, kind: TaskKind, dueAt: string, assignee: string | null): Promise<void> {
  const { error } = await supabase.rpc('add_demande_task', { p_demande_id: id, p_kind: kind, p_due_at: dueAt, ...(assignee && { p_assigned_to: assignee }) })
  if (error) throw error
}

export async function completeTask(id: string, taskId: string, outcome: TaskOutcome): Promise<void> {
  const { error } = await supabase.rpc('complete_demande_task', { p_demande_id: id, p_task_id: taskId, p_outcome: outcome })
  if (error) throw error
}

export async function cancelTask(id: string, taskId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_demande_task', { p_demande_id: id, p_task_id: taskId })
  if (error) throw error
}

export async function saveNote(id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('set_demande_note', { p_id: id, p_note: note })
  if (error) throw error
}

export interface ParticipantInput {
  id?: string
  client_id?: string | null
  display_name?: string | null
  relationship: string
  birthday?: string | null
  is_primary: boolean
}

export async function saveParticipants(id: string, participants: ParticipantInput[]): Promise<void> {
  const { error } = await supabase.rpc('set_demande_participants', { p_id: id, p_participants: participants as unknown as Json })
  if (error) throw error
}

/** « Je m'en occupe » (take; `expected`: the handler the person saw, for a take-over) or « Je laisse ». */
export async function setHandler(id: string, take: boolean, expected: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('set_demande_handler', { p_id: id, p_take: take, ...(expected && { p_expected: expected }) })
  if (error) throw error
}
