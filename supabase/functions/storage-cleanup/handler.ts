/**
 * `storage-cleanup` (Task 3.26, job `core.storage_cleanup`, P3-17, P3-30):
 * removes the objects of files that can no longer become or stay readable:
 * uploads never confirmed after 24 h, files deleted over 30 days ago, and
 * staged files past their `retain_until` (rules in `list_files_to_purge`).
 *
 * A function job (`runJob`, `X-Job-Signature`): cron runs every org from
 * `list_job_orgs`, « Exécuter maintenant » the caller's org. Per org:
 *
 * - up to 5 pages of 500 rows (`list_files_to_purge(org, 500)`, oldest
 *   first); a page under 500 rows is the last;
 * - per page, the paths are grouped by bucket and removed in chunks of 100
 *   (`remove(paths[])`, never one call per file), the chunks in parallel;
 * - **objects first, then rows:** `mark_files_purged(org, ids)` for the rows
 *   whose chunk was removed. It re-checks the purge rules, so a row that
 *   changed in between (confirmed, attached) is never marked purged;
 * - a failed chunk is not marked, the run stops paging (its rows would be
 *   listed again) and ends as `error` / `storage_remove_failed`, after the
 *   other chunks are marked. The next run retries them.
 *
 * Removing a path whose object never existed (an upload that never came) is
 * not an error. The run detail holds a count only (« 250 fichiers
 * supprimés »), never a path or name.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Deps } from '../_shared/deps.ts'
import { runJob } from '../_shared/jobs.ts'

const JOB = 'core.storage_cleanup'
/** `list_files_to_purge` and `mark_files_purged` take at most 500. */
const PAGE = 500
/** Pages per org and run: 2 500 files, well within the 60 s per org. */
const MAX_PAGES = 5
/** Paths per `remove` call (plan « No N+1 »). */
const CHUNK = 100

const pageSchema = z.array(z.object({
  id: z.guid(),
  bucket: z.string(),
  object_path: z.string(),
})).max(PAGE)

/** An error whose `code` `runJob` records as the run's detail. */
const failure = (code: string) => Object.assign(new Error(code), { code })

/** « 250 fichiers supprimés » (singular up to 1, as in French). */
function detail(count: number): string {
  if (count === 0) return 'Aucun fichier à supprimer'
  return count === 1 ? '1 fichier supprimé' : `${count} fichiers supprimés`
}

/**
 * One org's cleanup (the job's `perOrg`; see the module comment). Returns
 * the run detail, or throws with a `code`.
 */
export async function purgeOrg(
  orgId: string,
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  let purged = 0
  for (let page = 0; page < MAX_PAGES && !signal.aborted; page++) {
    const listed = await client.rpc('list_files_to_purge', {
      p_org_id: orgId,
      p_limit: PAGE,
    })
    const parsed = pageSchema.safeParse(listed.data)
    if (listed.error || !parsed.success) throw failure('list_files_failed')
    const rows = parsed.data
    if (rows.length === 0) break

    const chunks: { bucket: string; rows: typeof rows }[] = []
    const byBucket = Map.groupBy(rows, (row) => row.bucket)
    for (const [bucket, bucketRows] of byBucket) {
      for (let i = 0; i < bucketRows.length; i += CHUNK) {
        chunks.push({ bucket, rows: bucketRows.slice(i, i + CHUNK) })
      }
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        client.storage.from(chunk.bucket).remove(
          chunk.rows.map((row) => row.object_path),
        )
      ),
    )
    const removed = chunks.filter((_, i) => !results[i].error)
      .flatMap((chunk) => chunk.rows.map((row) => row.id))

    if (removed.length > 0) {
      const marked = await client.rpc('mark_files_purged', {
        p_org_id: orgId,
        p_ids: removed,
      })
      if (marked.error || typeof marked.data !== 'number') {
        throw failure('mark_purged_failed')
      }
      purged += marked.data
    }
    if (removed.length < rows.length) throw failure('storage_remove_failed')
    if (rows.length < PAGE) break
  }
  return detail(purged)
}

/** The job handler: `runJob` with `purgeOrg` for each org. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return (req) => runJob(deps, req, JOB, purgeOrg)
}
