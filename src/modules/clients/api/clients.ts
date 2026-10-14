import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { collectPages } from '@/shared/lib/csv'
import type { Database, Json } from '@/core/supabase/database.types'
import type { ClientSort, ClientStatusFilter, HolderRelation, LastVisitFilter, PayerKind, RelationRights, RelationType } from '../lib/constants'
import {
  duplicatePayload,
  exportExtraPayload,
  historyEntryPayload,
  listRowPayload,
  myClientPayload,
  optionPayload,
  parseRpc,
  searchRowPayload,
  summaryPayload,
  type ClientDuplicate,
  type ClientExport,
  type ClientHistoryEntry,
  type ClientListRow,
  type ClientOption,
  type ClientSearchRow,
  type ClientSummary,
  type MyClient,
} from './parse'

/**
 * The module's reads and writes. Every read of a file goes through an RPC or a view (the RLS
 * scopes it); every write is an RPC (clients.manage), whose refusals are French P0001 with the
 * field as HINT. Personal values never reach a log or an error message here.
 */

type Functions = Database['public']['Functions']
type RpcArgs<F extends keyof Functions> = Functions[F]['Args']

/** The generator types optional text and uuid parameters as non-null; the RPCs take null where SQL allows it. */
function sqlArgs<F extends keyof Functions>(args: { [K in keyof RpcArgs<F>]-?: RpcArgs<F>[K] | null }): RpcArgs<F> {
  return args as RpcArgs<F>
}

// --- The list ------------------------------------------------------------------------------------

/** Rows per page of the list (the RPC clamps to 1–200). */
export const CLIENTS_PAGE_SIZE = 50

export interface ClientsPageQuery {
  query: string
  status: ClientStatusFilter
  professionalId: string | null
  tagId: string | null
  /** By name (the default) or by the last appointment; the visit order needs `appointments.view`. */
  sort: ClientSort
  lastVisit: LastVisitFilter | null
}

/** One page of the list after `after` (the previous page's last row), in the query's order. */
export async function fetchClientsPage(
  query: ClientsPageQuery,
  after: ClientListRow['cursor'] | null,
  limit: number = CLIENTS_PAGE_SIZE,
): Promise<ClientListRow[]> {
  const { data, error } = await supabase.rpc(
    'list_clients',
    sqlArgs<'list_clients'>({
      p_query: query.query.trim() || null,
      p_status: query.status,
      p_professional_id: query.professionalId,
      p_tag_id: query.tagId,
      p_after_last: after?.last ?? null,
      p_after_first: after?.first ?? null,
      p_after_id: after?.id ?? null,
      p_limit: limit,
      p_sort: query.sort,
      p_last_visit: query.lastVisit,
      p_after_visit: after?.visit ?? null,
    }),
  )
  if (error) throw error
  return parseRpc(z.array(listRowPayload), data)
}

/** Every file the list's filters select, for its export (L7): 200 a page, 5 000 at most. */
export function fetchAllClients(query: ClientsPageQuery): Promise<{ rows: ClientListRow[]; truncated: boolean }> {
  return collectPages((after: ClientListRow['cursor'] | null) => fetchClientsPage(query, after, 200), 200, (page) => page.at(-1)?.cursor ?? null)
}

// --- A file --------------------------------------------------------------------------------------

/** The record's bundle (`get_client_summary`, staff); null when the file is not the clinic's. */
export async function fetchClientSummary(id: string): Promise<ClientSummary | null> {
  const { data, error } = await supabase.rpc('get_client_summary', { p_id: id })
  if (error) {
    // « Dossier client introuvable » (HINT client_id): not this clinic's, or never was.
    if (error.code === 'P0001' && error.hint === 'client_id') return null
    throw error
  }
  return parseRpc(summaryPayload, data)
}

/** The editable fields of a file, as `create_client` / `update_client` take them (snake_case keys). */
export type ClientFields = Record<string, string | boolean | null>

export async function createClient(fields: ClientFields, confirmMedium: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('create_client', { p_client: fields as Json, p_confirm_medium: confirmMedium })
  if (error) throw error
  return parseRpc(z.string(), data)
}

export async function updateClient(id: string, fields: ClientFields): Promise<void> {
  const { error } = await supabase.rpc('update_client', { p_id: id, p_client: fields as Json })
  if (error) throw error
}

export async function setClientNotes(id: string, adminNotes: string | null, specialAgreementNote: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_client_notes', sqlArgs<'set_client_notes'>({ p_id: id, p_admin_notes: adminNotes, p_special_agreement_note: specialAgreementNote }))
  if (error) throw error
}

export async function setClientArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.rpc(archived ? 'archive_client' : 'unarchive_client', { p_id: id })
  if (error) throw error
}

// --- Relations, insurance, payers, tags ----------------------------------------------------------

export interface RelationInput {
  clientId: string
  relatedId: string
  type: RelationType
  relatedRights: RelationRights
  clientRights: RelationRights
}

export async function setClientRelation(input: RelationInput): Promise<void> {
  const { error } = await supabase.rpc('set_client_relation', {
    p_client_id: input.clientId,
    p_related_id: input.relatedId,
    p_type: input.type,
    p_related_rights: input.relatedRights as unknown as Json,
    p_client_rights: input.clientRights as unknown as Json,
  })
  if (error) throw error
}

export async function removeClientRelation(clientId: string, relatedId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_client_relation', { p_client_id: clientId, p_related_id: relatedId })
  if (error) throw error
}

export interface InsuranceInput {
  clientId: string
  rank: 1 | 2
  insurer: string
  policyNumber: string | null
  certificateNumber: string | null
  holderRelation: HolderRelation
  holderName: string | null
}

export async function upsertClientInsurance(input: InsuranceInput): Promise<void> {
  const { error } = await supabase.rpc(
    'upsert_client_insurance',
    sqlArgs<'upsert_client_insurance'>({
      p_client_id: input.clientId,
      p_rank: input.rank,
      p_insurer: input.insurer,
      p_policy_number: input.policyNumber,
      p_certificate_number: input.certificateNumber,
      p_holder_relation: input.holderRelation,
      p_holder_name: input.holderName,
    }),
  )
  if (error) throw error
}

export async function deleteClientInsurance(clientId: string, rank: 1 | 2): Promise<void> {
  const { error } = await supabase.rpc('delete_client_insurance', { p_client_id: clientId, p_rank: rank })
  if (error) throw error
}

export interface PayerInput {
  clientId: string
  id: string | null
  kind: PayerKind
  organisationName: string | null
  fileNumber: string | null
  sessionAmountCents: number | null
  maxSessions: number | null
  maxAmountCents: number | null
  startsOn: string | null
  expiresOn: string | null
  note: string | null
  /** FP: a PAE's covered percentage (exclusive with the amount per session). */
  coveragePercent: number | null
  /** FP: the agreement's yearly renewal day (most often March 31). */
  renewalMonth: number | null
  renewalDay: number | null
  /** FP: what was used before the app, at a date. */
  priorUsedCents: number | null
  priorUsedSessions: number | null
  priorUsedOn: string | null
}

export async function saveClientPayer(input: PayerInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'save_client_payer',
    sqlArgs<'save_client_payer'>({
      p_client_id: input.clientId,
      p_id: input.id,
      p_kind: input.kind,
      p_organisation_name: input.organisationName,
      p_file_number: input.fileNumber,
      p_session_amount_cents: input.sessionAmountCents,
      p_max_sessions: input.maxSessions,
      p_max_amount_cents: input.maxAmountCents,
      p_starts_on: input.startsOn,
      p_expires_on: input.expiresOn,
      p_note: input.note,
      p_coverage_percent: input.coveragePercent,
      p_renewal_month: input.renewalMonth,
      p_renewal_day: input.renewalDay,
      p_prior_used_cents: input.priorUsedCents,
      p_prior_used_sessions: input.priorUsedSessions,
      p_prior_used_on: input.priorUsedOn,
    }),
  )
  if (error) throw error
  return parseRpc(z.string(), data)
}

export async function endClientPayer(id: string): Promise<void> {
  const { error } = await supabase.rpc('end_client_payer', { p_id: id })
  if (error) throw error
}

export async function setClientTags(clientId: string, tagIds: readonly string[]): Promise<void> {
  const { error } = await supabase.rpc('set_client_tags', { p_client_id: clientId, p_tag_ids: [...tagIds] })
  if (error) throw error
}

// --- Duplicates, search -------------------------------------------------------------------------

export interface DuplicateQuery {
  firstName: string
  lastName: string
  email: string | null
  phones: string[]
  birthday: string | null
  exclude?: string | null
}

export async function findClientDuplicates(query: DuplicateQuery, signal?: AbortSignal): Promise<ClientDuplicate[]> {
  let request = supabase.rpc(
    'find_client_duplicates',
    sqlArgs<'find_client_duplicates'>({
      p_first: query.firstName,
      p_last: query.lastName,
      p_email: query.email,
      p_phones: query.phones,
      p_birthday: query.birthday,
      p_exclude: query.exclude ?? null,
    }),
  )
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) throw error
  return parseRpc(z.array(duplicatePayload), data)
}

/** The clinic's files matching a search (the relation picker; never merged or anonymised files). */
export async function searchClients(query: string, signal?: AbortSignal): Promise<ClientSearchRow[]> {
  let request = supabase.rpc('search_clients', { p_query: query, p_limit: 8 })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) throw error
  return parseRpc(z.array(searchRowPayload), data)
}

// --- Reference lists and « Mes clients » ---------------------------------------------------------

/** The rows read per reference list (each holds a handful). */
const LIST_MAX = 500

export interface ClientsReference {
  referralSources: ClientOption[]
  tags: ClientOption[]
  /** The clinic's professionals (Professionnels' published directory); `active` false once she left. */
  professionals: ClientOption[]
}

export async function fetchClientsReference(): Promise<ClientsReference> {
  const [sources, tags, professionals] = await Promise.all([
    supabase.from('referral_sources').select('id, name, is_active').order('sort_order').order('name').limit(LIST_MAX),
    supabase.from('client_tags').select('id, name, is_active').order('sort_order').order('name').limit(LIST_MAX),
    supabase.from('professionals_directory').select('id, display_name, status').order('display_name').limit(LIST_MAX),
  ])
  for (const result of [sources, tags, professionals]) if (result.error) throw result.error
  return {
    referralSources: parseRpc(z.array(optionPayload), sources.data),
    tags: parseRpc(z.array(optionPayload), tags.data),
    professionals: parseRpc(
      z.array(
        z.object({ id: z.string(), display_name: z.string().nullable(), status: z.string() }).transform((r) => ({ id: r.id, name: r.display_name ?? '', active: r.status === 'active' })),
      ),
      professionals.data,
    ),
  }
}

/** The professional's clients (`my_clients`), by name. */
export async function fetchMyClients(): Promise<MyClient[]> {
  const { data, error } = await supabase
    .from('my_clients')
    .select('id, client_number, display_name, pronouns, birthday, language, email, mobile_e164, is_primary, reason, first_linked_at, is_archived')
    .order('display_name')
    .limit(LIST_MAX * 4)
  if (error) throw error
  return parseRpc(z.array(myClientPayload), data)
}

// --- Merge, Loi 25, history (C4) -----------------------------------------------------------------

/**
 * Merges `mergeId` into `keepId` (clients.merge): `take` names the merged file's values to keep
 * over the kept one's (`private.clients_merge_take_columns`' keys; the database copies them). The
 * kept file's empty fields are then filled from the other, and everything else moves (CL-15).
 */
export async function mergeClients(keepId: string, mergeId: string, take: readonly string[]): Promise<void> {
  const { error } = await supabase.rpc('merge_clients', { p_keep: keepId, p_merge: mergeId, p_take: [...take] })
  if (error) throw error
}

/** Everything the clinic holds on the person (clients.privacy); the read is logged. */
export async function exportClientPrivacy(id: string): Promise<ClientExport> {
  const { data, error } = await supabase.rpc('export_client_privacy', { p_id: id })
  if (error) throw error
  return { summary: parseRpc(summaryPayload, data), ...parseRpc(exportExtraPayload, data) }
}

/** Blanks the person's identity for good (clients.privacy, CL-17). */
export async function anonymizeClient(id: string): Promise<void> {
  const { error } = await supabase.rpc('anonymize_client', { p_id: id })
  if (error) throw error
}

/** Rows per page of the record's history (the RPC clamps to 1–200). */
export const CLIENT_HISTORY_PAGE_SIZE = 50

/** One page of the file's history, newest first, before `beforeId` (the previous page's last id). */
export async function fetchClientHistory(id: string, beforeId: number | null): Promise<ClientHistoryEntry[]> {
  const { data, error } = await supabase.rpc('list_client_history', {
    p_id: id,
    ...(beforeId !== null && { p_before_id: beforeId }),
    p_limit: CLIENT_HISTORY_PAGE_SIZE,
  })
  if (error) throw error
  return parseRpc(z.array(historyEntryPayload), data)
}

// --- « Payeurs à compléter » (FP-9) ----------------------------------------------------------------

export const PAYER_MISSING = ['file_number', 'organisation_name', 'coverage'] as const
export type PayerMissing = (typeof PAYER_MISSING)[number]

const payerToCompletePayload = z
  .object({
    client_payer_id: z.string(),
    client_id: z.string(),
    client_name: z.string(),
    client_number: z.number().int().nullable(),
    kind: z.enum(['ivac', 'pae']),
    is_stub: z.boolean(),
    missing: z.array(z.enum(PAYER_MISSING)),
  })
  .transform((r) => ({
    clientPayerId: r.client_payer_id,
    clientId: r.client_id,
    clientName: r.client_name,
    clientNumber: r.client_number,
    kind: r.kind,
    isStub: r.is_stub,
    missing: r.missing,
  }))
export type PayerToComplete = z.output<typeof payerToCompletePayload>

/** The active payers the split cannot use yet: the import's stubs, a missing file number, provider or coverage. */
export async function fetchPayersToComplete(): Promise<PayerToComplete[]> {
  const { data, error } = await supabase.rpc('list_client_payers_to_complete')
  if (error) throw error
  return parseRpc(z.array(payerToCompletePayload), data)
}
