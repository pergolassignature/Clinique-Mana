/**
 * In-app notices from edge functions and function jobs: a typed wrapper of the
 * service-role RPC `create_notification` (Task 3.12), which wraps
 * `private.notify`. SQL callers (module RPCs, SQL jobs) call `private.notify`
 * directly.
 *
 * A notice reaches every holder of `recipientPermission` in the org (optionally
 * narrowed to one user) and shows in their topbar bell; an important one also
 * shows in Accueil « À surveiller ». Titles and bodies are French, ready to
 * display: the bell never needs a module's labels.
 *
 * The database checks the input and raises; this wrapper turns any RPC error
 * into a `FunctionError('internal')` whose message holds the SQLSTATE only,
 * never a value of the notice:
 * - 23514: `kind` is not `<moduleKey>.<name>`, `linkPath` is not an app path
 *   (`/…`, never `//` or `/\`), a blank or control character, a text over its
 *   cap (title 160, body 500, link 500, dedupe key 200);
 * - 22023: the permission is not the module's own, the narrowed user is not an
 *   active member of the org, or `expiresAt` is not in the future.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FunctionError } from './errors.ts'

/** One notice. `orgId` comes from a database row, never from a request. */
export interface NotifyInput {
  orgId: string
  /** The module that owns the notice (`core` for core notices). */
  moduleKey: string
  /** `<moduleKey>.<name>`, e.g. `professionals.insurance_expiring`. */
  kind: string
  /** `important` also shows in Accueil « À surveiller » and turns the dot red. Default `normal`. */
  importance?: 'normal' | 'important'
  /** French, at most 160 characters. */
  title: string
  /** French, at most 500 characters. */
  body?: string | null
  /** Where a click on the notice goes: an app path such as `/professionnels/<id>`. */
  linkPath?: string | null
  /** The record the notice is about, so the module can find (or expire) its notices. */
  subject?: { type: string; id: string } | null
  /** Who sees it: every holder of this permission of `moduleKey` in the org. */
  recipientPermission: string
  /** Narrows the notice to this user (who still needs the permission to see it). */
  recipientUserId?: string | null
  /**
   * With the same org and kind, a second call creates nothing and returns the
   * first notice's id: a re-run job or a retried request never duplicates it.
   */
  dedupeKey?: string | null
  /** The notice disappears from the bell after this instant (in the future). */
  expiresAt?: Date | null
}

/**
 * Creates a notice (or finds the one with the same dedupe key) and returns its
 * id. Needs a service-role client. Throws `FunctionError('internal')` on an RPC
 * error or an unexpected result.
 */
export async function notify(
  client: SupabaseClient,
  input: NotifyInput,
): Promise<string> {
  const { data, error } = await client.rpc('create_notification', {
    p_org_id: input.orgId,
    p_module_key: input.moduleKey,
    p_kind: input.kind,
    p_importance: input.importance ?? 'normal',
    p_title: input.title,
    p_body: input.body ?? null,
    p_link_path: input.linkPath ?? null,
    p_subject_type: input.subject?.type ?? null,
    p_subject_id: input.subject?.id ?? null,
    p_recipient_permission: input.recipientPermission,
    p_recipient_user_id: input.recipientUserId ?? null,
    p_dedupe_key: input.dedupeKey ?? null,
    p_expires_at: input.expiresAt?.toISOString() ?? null,
  })
  if (error) {
    throw new FunctionError(
      'internal',
      `create_notification failed (${error.code ?? 'unknown'})`,
    )
  }
  if (typeof data !== 'string') {
    throw new FunctionError('internal', 'create_notification: bad result')
  }
  return data
}
