import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/** Rows per page of `list_audit_entries` (its default; the RPC clamps the limit to 1–200). */
export const AUDIT_PAGE_SIZE = 50

/** The journal's filters; null means « all ». `from` is an instant (see `periodStart`). */
export interface AuditFilters {
  table: string | null
  actor: string | null
  from: string | null
}

/**
 * One `audit_log` row as `list_audit_entries` returns it. The generated types say non-null for
 * every column, but rows written by the seed, a migration or the system have no actor, the name
 * comes from a left join (only for an actor of the row's org), and `changed_fields` may be null.
 * `changed_fields` is:
 * - update: `{column: {before, after}}` for the changed columns;
 * - insert / delete: the row;
 * - read: `{fields: [column, …]}` (what was revealed, never the value).
 * Redacted values are the string `"[redacted]"`.
 */
const auditEntrySchema = z.object({
  id: z.number(),
  created_at: z.string(),
  table_name: z.string(),
  record_id: z.string(),
  action: z.string(),
  changed_fields: z.unknown().nullable(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_role: z.string().nullable(),
  source: z.string(),
})
export type AuditEntry = z.infer<typeof auditEntrySchema>

const auditActorSchema = z.object({ actor_id: z.string(), actor_name: z.string() })
export type AuditActor = z.infer<typeof auditActorSchema>

/**
 * One page of the org's journal, newest first (keyset on `id`): the entries before `beforeId`
 * (null for the newest). Needs `audit.view` (else `42501`).
 */
export async function fetchAuditEntries(filters: AuditFilters, beforeId: number | null): Promise<AuditEntry[]> {
  // Unset filters are left out, so SQL uses its defaults (null = no filter).
  const { data, error } = await supabase.rpc('list_audit_entries', {
    ...(filters.table !== null && { p_table: filters.table }),
    ...(filters.actor !== null && { p_actor: filters.actor }),
    ...(filters.from !== null && { p_from: filters.from }),
    ...(beforeId !== null && { p_before_id: beforeId }),
    p_limit: AUDIT_PAGE_SIZE,
  })
  if (error) throw error
  return z.array(auditEntrySchema).parse(data)
}

/** The org's people who appear in its journal, by name (the « Personne » filter). */
export async function fetchAuditActors(): Promise<AuditActor[]> {
  const { data, error } = await supabase.rpc('list_audit_actors')
  if (error) throw error
  return z.array(auditActorSchema).parse(data)
}
