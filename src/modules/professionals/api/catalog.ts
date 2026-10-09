import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { REFERENCE_KINDS, type DocumentExpiryRule, type DocumentMimeType, type MotifCategoryIcon, type ReferenceKind } from '../lib/constants'
import {
  catalogPayload,
  parseRpc,
  type Clientele,
  type DeactivationReason,
  type DocumentType,
  type Language,
  type Motif,
  type MotifCategory,
  type ProfessionalOrder,
  type ProfessionalsCatalog,
  type ProfessionCategory,
  type ProfessionTitle,
} from './parse'
import { sqlArgs } from './sql-args'

export type { ReferenceKind } from '../lib/constants'

/**
 * The nine per-clinic lists (« Paramètres → Professionnels ») and their settings RPCs
 * (20261008133523_professionals_reference_settings.sql). Every function throws the PostgREST
 * error unchanged; the hooks map it for users (`moduleErrorMessage`).
 */

/**
 * The nine lists in one payload, archived rows included (`isActive`), each in its sort order.
 * A caller without a professionals permission (or with the module off) gets eight empty lists.
 */
export async function fetchProfessionalsCatalog(): Promise<ProfessionalsCatalog> {
  const { data, error } = await supabase.rpc('get_professionals_catalog')
  if (error) throw error
  return parseRpc(catalogPayload, data)
}

/** The key of a usage count: `${kind}:${id}`. */
export const usageKey = (kind: ReferenceKind, id: string) => `${kind}:${id}`

const usageRows = z.array(z.object({ kind: z.enum(REFERENCE_KINDS), id: z.string(), usage: z.number() }))

/**
 * How many professionals use each row (« Utilisé par »), keyed by `usageKey`; a row nobody uses
 * is absent. For parents, the active children: titles per category or order, motifs per category.
 * Needs `professionals.settings` or `professionals.manage` (`42501` otherwise).
 */
export async function fetchReferenceUsage(): Promise<ReadonlyMap<string, number>> {
  const { data, error } = await supabase.rpc('list_professionals_reference_usage')
  if (error) throw error
  return new Map(parseRpc(usageRows, data).map((r) => [usageKey(r.kind, r.id), r.usage]))
}

/** The row type of each list. */
export interface ReferenceRows {
  professional_orders: ProfessionalOrder
  profession_categories: ProfessionCategory
  profession_titles: ProfessionTitle
  clienteles: Clientele
  motif_categories: MotifCategory
  motifs: Motif
  languages: Language
  deactivation_reasons: DeactivationReason
  document_types: DocumentType
}
export type ReferenceRow<K extends ReferenceKind> = ReferenceRows[K]

/** Where each list sits in the catalogue. */
const CATALOG_LIST = {
  professional_orders: 'orders',
  profession_categories: 'categories',
  profession_titles: 'titles',
  clienteles: 'clienteles',
  motif_categories: 'motifCategories',
  motifs: 'motifs',
  languages: 'languages',
  deactivation_reasons: 'deactivationReasons',
  document_types: 'documentTypes',
} as const satisfies { [K in ReferenceKind]: keyof ProfessionalsCatalog }

/**
 * The catalogue with one list in a new order (the optimistic write of a reorder): rows in `ids`
 * order with the sort orders the RPC gives them (10, 20…); rows missing from `ids` keep theirs, last.
 */
export function reorderedCatalog(catalog: ProfessionalsCatalog, kind: ReferenceKind, ids: readonly string[]): ProfessionalsCatalog {
  const rank = new Map(ids.map((id, i) => [id, i]))
  const rows = catalog[CATALOG_LIST[kind]] as { id: string; sortOrder: number }[]
  const position = (row: { id: string }) => rank.get(row.id) ?? ids.length
  const reordered = rows
    .map((row) => (rank.has(row.id) ? { ...row, sortOrder: (position(row) + 1) * 10 } : row))
    .sort((a, b) => position(a) - position(b))
  return { ...catalog, [CATALOG_LIST[kind]]: reordered }
}

/**
 * What each list's dialog edits (the save RPC's arguments after the name). Text is already
 * normalised by `schemas/reference.ts`; null means « none » (no order, no age, no description).
 */
export interface ReferenceFieldsByKind {
  professional_orders: { name: string; acronym: string; licenceLabel: string | null; licencePattern: string | null }
  profession_categories: { name: string }
  profession_titles: { name: string; nameFeminine: string | null; nameMasculine: string | null; categoryId: string; orderId: string | null }
  clienteles: { name: string; minAge: number | null; maxAge: number | null }
  motif_categories: { name: string; description: string | null; icon: MotifCategoryIcon }
  motifs: { name: string; categoryId: string | null; isRestricted: boolean }
  /** The code is set on create; on update send the row's code (the RPC refuses a change). */
  languages: { name: string; code: string }
  deactivation_reasons: { name: string; requiresNote: boolean; disablesAccount: boolean }
  /** « Documents requis » (save_document_type): reminders are the insurance's only (P4-402). */
  document_types: {
    name: string
    required: boolean
    expiryRule: DocumentExpiryRule
    reminderDays: number[]
    weeklyAfterExpiry: boolean
    acceptedMime: DocumentMimeType[]
    maxBytes: number
  }
}
export type ReferenceFields<K extends ReferenceKind> = ReferenceFieldsByKind[K]
/** A row to save: `id` null creates it (the key is derived from the name and never changes). */
export type ReferenceInput<K extends ReferenceKind> = ReferenceFields<K> & { id: string | null }

type Saver<K extends ReferenceKind> = (input: ReferenceInput<K>) => PromiseLike<{ data: string | null; error: unknown }>

const SAVERS: { [K in ReferenceKind]: Saver<K> } = {
  professional_orders: (i) =>
    supabase.rpc(
      'save_professional_order',
      sqlArgs<'save_professional_order'>({
        p_id: i.id,
        p_name: i.name,
        p_acronym: i.acronym,
        p_licence_label: i.licenceLabel,
        p_licence_pattern: i.licencePattern,
      }),
    ),
  profession_categories: (i) => supabase.rpc('save_profession_category', sqlArgs<'save_profession_category'>({ p_id: i.id, p_name: i.name })),
  profession_titles: (i) =>
    supabase.rpc(
      'save_profession_title',
      sqlArgs<'save_profession_title'>({
        p_id: i.id,
        p_name: i.name,
        p_name_feminine: i.nameFeminine,
        p_name_masculine: i.nameMasculine,
        p_category_id: i.categoryId,
        p_order_id: i.orderId,
      }),
    ),
  clienteles: (i) =>
    supabase.rpc('save_clientele', sqlArgs<'save_clientele'>({ p_id: i.id, p_name: i.name, p_min_age: i.minAge, p_max_age: i.maxAge })),
  motif_categories: (i) =>
    supabase.rpc(
      'save_motif_category',
      sqlArgs<'save_motif_category'>({ p_id: i.id, p_name: i.name, p_description: i.description, p_icon: i.icon }),
    ),
  motifs: (i) =>
    supabase.rpc(
      'save_motif',
      sqlArgs<'save_motif'>({ p_id: i.id, p_name: i.name, p_category_id: i.categoryId, p_is_restricted: i.isRestricted }),
    ),
  languages: (i) => supabase.rpc('save_language', sqlArgs<'save_language'>({ p_id: i.id, p_name: i.name, p_code: i.code })),
  deactivation_reasons: (i) =>
    supabase.rpc(
      'save_deactivation_reason',
      sqlArgs<'save_deactivation_reason'>({
        p_id: i.id,
        p_name: i.name,
        p_requires_note: i.requiresNote,
        p_disables_account: i.disablesAccount,
      }),
    ),
  document_types: (i) =>
    supabase.rpc(
      'save_document_type',
      sqlArgs<'save_document_type'>({
        p_id: i.id,
        p_name: i.name,
        p_required: i.required,
        p_expiry_rule: i.expiryRule,
        p_reminder_days: i.reminderDays,
        p_weekly_after_expiry: i.weeklyAfterExpiry,
        p_accepted_mime: i.acceptedMime,
        p_max_bytes: i.maxBytes,
      }),
    ),
}

/**
 * Creates (`id` null) or updates one row through its `save_*` RPC; resolves with its id.
 * Refusals a user can fix (duplicate name, archived category, 500 rows…) are French `P0001`.
 */
export async function saveReference<K extends ReferenceKind>(kind: K, input: ReferenceInput<K>): Promise<string> {
  const save = SAVERS[kind] as Saver<K>
  const { data, error } = await save(input)
  if (error) throw error
  return parseRpc(z.string(), data)
}

/**
 * Archives (`active` false) or restores a row. System rows (clientèles, French, « Autre ») cannot
 * be archived, nor a category or an order with active titles; a title is restored only once its
 * category and order are active: each refusal is a French `P0001`.
 */
export async function setReferenceActive(kind: ReferenceKind, id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_professionals_reference_active', { p_kind: kind, p_id: id, p_active: active })
  if (error) throw error
}

/**
 * Saves a list's order. The order is global to the list: send **every** row, archived ones
 * included, in the new order (an unknown, repeated or missing id is `22023`).
 */
export async function reorderReference(kind: ReferenceKind, ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_professionals_reference', { p_kind: kind, p_ids: ids })
  if (error) throw error
}
