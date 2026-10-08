import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { TablesUpdate } from '@/core/supabase/database.types'
import type { PayerType } from '../lib/constants'
import {
  parseRpc,
  professionRowPayload,
  recordPayload,
  statusChangePayload,
  type MatchingProfile,
  type Professional,
  type ProfessionalRecord,
  type ProfessionRow,
  type PublicProfile,
  type SpecializedRef,
  type StatusChange,
} from './parse'
import { sqlArgs } from './sql-args'

/**
 * One professional: the record bundle, its plain fields (column grants + RLS), its sets and its
 * status (RPCs; 20261008092451_professionals_core.sql, 20261008100634_professionals_lifecycle.sql).
 * Every function throws the PostgREST error unchanged; the hooks map it for users.
 */

// --- Reads ---------------------------------------------------------------------------------------

/** The record page in one payload; null when the caller cannot read it (or it does not exist). */
export async function fetchProfessionalRecord(id: string): Promise<ProfessionalRecord | null> {
  const { data, error } = await supabase.rpc('get_professional_record', { p_id: id })
  if (error) throw error
  return parseRpc(recordPayload, data)
}

// --- Creation ------------------------------------------------------------------------------------

/** A new professional (« Ajouter »), normalised by `createProfessionalSchema`. */
export interface NewProfessional {
  firstName: string
  lastName: string
  email: string
  titleId: string | null
  /** Required when the title belongs to an order (P4-35); only with a title. */
  licenceNumber: string | null
}

/**
 * Creates the record (`draft`) with both profiles, French and the primary title; resolves with
 * its id. Duplicate email in the clinic (« Ce courriel est déjà utilisé. ») and a missing licence
 * are French `P0001`.
 */
export async function createProfessional(input: NewProfessional): Promise<string> {
  const { data, error } = await supabase.rpc(
    'create_professional',
    sqlArgs<'create_professional'>({
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_email: input.email,
      p_profession_title_id: input.titleId,
      p_licence_number: input.licenceNumber,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

// --- Plain fields (column grants) ----------------------------------------------------------------

/** camelCase field → column, for the columns `authenticated` may update (4a.3 grants). */
const PROFESSIONAL_COLUMNS = {
  firstName: 'first_name',
  lastName: 'last_name',
  personalPhone: 'personal_phone',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  province: 'province',
  postalCode: 'postal_code',
  yearsExperience: 'years_experience',
  gender: 'gender',
} as const satisfies Partial<Record<keyof Professional, keyof TablesUpdate<'professionals'>>>

const PUBLIC_PROFILE_COLUMNS = {
  bio: 'bio',
  approach: 'approach',
  publicEmail: 'public_email',
  publicPhone: 'public_phone',
} as const satisfies Partial<Record<keyof PublicProfile, keyof TablesUpdate<'professional_public_profiles'>>>

const MATCHING_PROFILE_COLUMNS = {
  acceptingNewClients: 'accepting_new_clients',
  availabilityPeriods: 'availability_periods',
  availabilityNote: 'availability_note',
} as const satisfies Partial<Record<keyof MatchingProfile, keyof TablesUpdate<'professional_matching_profiles'>>>

/** Identity, contact and experience (`professionals.manage`). Any other column is a compile error. */
export type ProfessionalPatch = Partial<Pick<Professional, keyof typeof PROFESSIONAL_COLUMNS>>
/** Portrait and public contact (`professionals.manage`). */
export type PublicProfilePatch = Partial<Pick<PublicProfile, keyof typeof PUBLIC_PROFILE_COLUMNS>>
/** General availability and new clients (`professionals.matching`). */
export type MatchingProfilePatch = Partial<Pick<MatchingProfile, keyof typeof MATCHING_PROFILE_COLUMNS>>

type PatchTable = 'professionals' | 'professional_public_profiles' | 'professional_matching_profiles'

/**
 * Writes the patch's columns on one row. RLS hides a row the caller may not update (another
 * clinic's, or no permission) and PostgREST then updates nothing without an error: no row back is
 * reported as the refusal it is (`42501`).
 */
async function updateRow(table: PatchTable, idColumn: 'id' | 'professional_id', id: string, patch: object, columns: Record<string, string>): Promise<void> {
  const row = Object.fromEntries(Object.entries(patch).map(([field, value]) => [columns[field] ?? field, value]))
  if (Object.keys(row).length === 0) return
  const { data, error } = await supabase.from(table).update(row).eq(idColumn, id).select(idColumn)
  if (error) throw error
  if (!data || data.length === 0) throw Object.assign(new Error(`professionals: no ${table} row updated`), { code: '42501' })
}

export function updateProfessional(id: string, patch: ProfessionalPatch): Promise<void> {
  return updateRow('professionals', 'id', id, patch, PROFESSIONAL_COLUMNS)
}

export function updatePublicProfile(id: string, patch: PublicProfilePatch): Promise<void> {
  return updateRow('professional_public_profiles', 'professional_id', id, patch, PUBLIC_PROFILE_COLUMNS)
}

export function updateMatchingProfile(id: string, patch: MatchingProfilePatch): Promise<void> {
  return updateRow('professional_matching_profiles', 'professional_id', id, patch, MATCHING_PROFILE_COLUMNS)
}

// --- Sets (RPCs: one transaction, one audit set, the new set back) -------------------------------

/** A title to hold; without a flagged primary, the first item becomes primary. */
export interface ProfessionInput {
  titleId: string
  licenceNumber: string | null
  isPrimary: boolean
}

/**
 * Replaces the titles (0–2, one primary). Row ids survive for kept titles (Services et tarifs
 * points at them). Licence rules, archived titles and restricted motifs are French `P0001`.
 */
export async function setProfessions(id: string, items: ProfessionInput[]): Promise<ProfessionRow[]> {
  const { data, error } = await supabase.rpc('set_professional_professions', {
    p_id: id,
    p_items: items.map((i) => ({ title_id: i.titleId, licence_number: i.licenceNumber, is_primary: i.isPrimary })),
  })
  if (error) throw error
  return parseRpc(z.array(professionRowPayload), data)
}

const clienteleRows = z.array(z.object({ clientele_id: z.string(), is_specialized: z.boolean() }))
const specialtyRows = z.array(z.object({ specialty_id: z.string(), is_specialized: z.boolean() }))
const idRows = z.array(z.string())

/** Replaces the clientèles (`[]` clears them). */
export async function setClienteles(id: string, items: SpecializedRef[]): Promise<SpecializedRef[]> {
  const { data, error } = await supabase.rpc('set_professional_clienteles', { p_id: id, p_items: items.map((i) => ({ id: i.id, specialized: i.specialized })) })
  if (error) throw error
  return parseRpc(clienteleRows, data).map((r) => ({ id: r.clientele_id, specialized: r.is_specialized }))
}

/** Replaces the approaches (`[]` clears them). */
export async function setSpecialties(id: string, items: SpecializedRef[]): Promise<SpecializedRef[]> {
  const { data, error } = await supabase.rpc('set_professional_specialties', { p_id: id, p_items: items.map((i) => ({ id: i.id, specialized: i.specialized })) })
  if (error) throw error
  return parseRpc(specialtyRows, data).map((r) => ({ id: r.specialty_id, specialized: r.is_specialized }))
}

/** Replaces the motifs. A newly added archived motif, or a restricted one without a regulated title, is a French `P0001`. */
export async function setMotifs(id: string, motifIds: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_professional_motifs', { p_id: id, p_motif_ids: motifIds })
  if (error) throw error
  return parseRpc(idRows, data)
}

/** Replaces the languages (at least one: « Au moins une langue est requise. »). */
export async function setLanguages(id: string, languageIds: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_professional_languages', { p_id: id, p_language_ids: languageIds })
  if (error) throw error
  return parseRpc(idRows, data)
}

/** Sets a payer number (unique in the clinic); null or blank deletes it. */
export async function setPayerNumber(id: string, type: PayerType, value: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_professional_payer_number', sqlArgs<'set_professional_payer_number'>({ p_id: id, p_payer_type: type, p_number: value }))
  if (error) throw error
}

/** Changes the login email while no account exists (then « Mon compte » owns it). */
export async function setProfessionalEmail(id: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('set_professional_email', { p_id: id, p_email: email })
  if (error) throw error
}

// --- Status --------------------------------------------------------------------------------------

/**
 * Activates (or reactivates) the professional. A complete file needs no reason; an incomplete one
 * needs `professionals.activate_override` and a reason of at least 5 characters. Re-enables the
 * account this module disabled (`accountChange: 'enabled'`).
 */
export async function activateProfessional(id: string, overrideReason?: string): Promise<StatusChange> {
  const { data, error } = await supabase.rpc('activate_professional', { p_id: id, ...(overrideReason !== undefined && { p_override_reason: overrideReason }) })
  if (error) throw error
  return parseRpc(statusChangePayload, data)
}

/**
 * Deactivates with an active reason of the clinic; the note is required when the reason says so.
 * A reason that disables the account disables the provider's profile (`accountChange: 'disabled'`).
 */
export async function deactivateProfessional(id: string, reasonId: string, note?: string | null): Promise<StatusChange> {
  const { data, error } = await supabase.rpc('deactivate_professional', { p_id: id, p_reason_id: reasonId, ...(note != null && { p_note: note }) })
  if (error) throw error
  return parseRpc(statusChangePayload, data)
}
