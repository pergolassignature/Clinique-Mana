import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { ProfessionalStatus } from '../lib/constants'
import { listRowPayload, parseRpc, type ProfessionalListRow } from './parse'
import type { RpcArgs } from './sql-args'

/**
 * The list page reads `professionals_list` whole (≤ 500 rows, ~50 today) and filters in the
 * browser: search on name, email and licence needs every row. `list_professionals` pages the same
 * rows on the server with a keyset cursor, for callers that must not load them all.
 */

/** The most rows the list loads (bounded payload; 501 → « Affinez la recherche »). */
export const PROFESSIONALS_LIST_MAX = 500

/** Every column of the view but org_id. */
export const LIST_COLUMNS =
  'id, first_name, last_name, email, status, status_changed_at, deactivation_reason_id, has_account, primary_title_id, primary_licence_number, gender, language_ids, clientele_ids, motif_ids, accepting_new_clients, matching_complete, ready, email_matches_login, created_at, updated_at, insurance_status, insurance_expires_on, documents_done, documents_required, photo_file_id' as const

const listRows = z.array(listRowPayload)

/** The clinic's professionals by name; `truncated` when there are more than PROFESSIONALS_LIST_MAX. */
export async function fetchProfessionalsList(): Promise<{ rows: ProfessionalListRow[]; truncated: boolean }> {
  const { data, error } = await supabase
    .from('professionals_list')
    .select(LIST_COLUMNS)
    .order('last_name')
    .order('first_name')
    .order('id')
    .limit(PROFESSIONALS_LIST_MAX + 1)
  if (error) throw error
  const rows = parseRpc(listRows, data)
  return { rows: rows.slice(0, PROFESSIONALS_LIST_MAX), truncated: rows.length > PROFESSIONALS_LIST_MAX }
}

/** Rows per `list_professionals` page (its default; the RPC clamps to 1–200). */
export const PROFESSIONALS_PAGE_SIZE = 50

/**
 * Server-side filters of `list_professionals`. Within a set any id matches, sets combine with
 * « and »; an empty or missing set is no filter. `titleIds` matches any of the professional's
 * titles (the view's `primary_title_id` is only the primary one).
 */
export interface ProfessionalsPageQuery {
  sort: 'name' | 'recent'
  statuses?: ProfessionalStatus[]
  titleIds?: string[]
  languageIds?: string[]
  clienteleIds?: string[]
  motifIds?: string[]
  acceptingNewClients?: boolean | null
}

const nonEmpty = <T>(values: T[] | undefined): values is T[] => values !== undefined && values.length > 0

/**
 * One page of the list, after `after` (the previous page's last row; null for the first page).
 * The cursor follows the sort: name (last name, first name, id) or the status change (newest first).
 */
export async function fetchProfessionalsPage(query: ProfessionalsPageQuery, after: ProfessionalListRow | null): Promise<ProfessionalListRow[]> {
  const { sort, statuses, titleIds, languageIds, clienteleIds, motifIds, acceptingNewClients } = query
  // Unset filters are left out, so SQL uses its defaults (null = no filter).
  const args: RpcArgs<'list_professionals'> = {
    p_sort: sort,
    p_limit: PROFESSIONALS_PAGE_SIZE,
    ...(nonEmpty(statuses) && { p_statuses: statuses }),
    ...(nonEmpty(titleIds) && { p_title_ids: titleIds }),
    ...(nonEmpty(languageIds) && { p_language_ids: languageIds }),
    ...(nonEmpty(clienteleIds) && { p_clientele_ids: clienteleIds }),
    ...(nonEmpty(motifIds) && { p_motif_ids: motifIds }),
    ...(acceptingNewClients != null && { p_accepting_new_clients: acceptingNewClients }),
    ...(after && sort === 'name' && { p_after_last_name: after.lastName, p_after_first_name: after.firstName, p_after_id: after.id }),
    ...(after && sort === 'recent' && { p_after_status_changed_at: after.statusChangedAt, p_after_id: after.id }),
  }

  const { data, error } = await supabase.rpc('list_professionals', args)
  if (error) throw error
  return parseRpc(listRows, data)
}
