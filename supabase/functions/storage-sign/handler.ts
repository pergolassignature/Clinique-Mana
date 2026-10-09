/**
 * `storage-sign` (P3-33): a 5-minute read URL for one stored file. Clients
 * never sign read URLs themselves: an expiry the client chooses cannot be
 * capped, and a signed URL outlives a permission change, so its lifetime is
 * fixed here (and the client select policy on `storage.objects` goes away).
 *
 * 1. CORS; `POST` only; `verifyAuth` (an active profile).
 * 2. Body `{ file_id, download? }`, strict.
 * 3. One hit on `LIMITS.storageSignUser` (120 an hour per caller), before
 *    any lookup.
 * 4. Readability, as the **caller**: `bucket, object_path, original_name`
 *    from `stored_files` by id and `status = 'ready'`, through the caller's
 *    client, so the `stored_files_select` policy decides (the caller's org,
 *    a ready file, and its view permission or the owner branch). No row →
 *    404 `not_found`, never 403: whether a file exists is not revealed.
 * 5. Service client `createSignedUrl(path, 300, { download })`: with
 *    `download: true`, the original name (storage answers
 *    `Content-Disposition: attachment` with it); otherwise inline.
 * 6. 200 `{ url, expires_at }`. `expires_at` is taken before signing, so it
 *    is never later than the token's own expiry. With `PUBLIC_API_URL` set
 *    (local: the function reaches the API as `http://kong:8000`, which a
 *    browser cannot), the URL's origin is replaced by it; on hosted projects
 *    `SUPABASE_URL` is already public and the variable stays unset.
 *
 * **Batch mode** (`{ file_ids: [...] }`, 1 to 50 distinct ids; a list's photos,
 * one call for the visible rows instead of one per row): the same steps for every
 * id at once. One hit on the same limit per call, whatever the count. The
 * caller's RLS read of the `ready` rows decides each file; an unreadable id, or a
 * ready row whose object is missing (reported once per call), is left out, never
 * an error: 200 `{ urls: { <file_id>: <url> }, expires_at }` (possibly empty).
 * Inline URLs only (no `download`), signed per bucket with `createSignedUrls`.
 *
 * Nothing logs the file's name or path: reports carry the org and file ids.
 *
 * Status mapping: 200 `{ url, expires_at }`; 400 `invalid_request` (body);
 * 401 / 403 / 503 from `verifyAuth`; 404 `not_found` (not readable by the
 * caller, another org's, deleted, pending; or a ready row whose object is
 * missing, reported); 405; 413; 429 `rate_limited` with `Retry-After`; 503
 * `not_configured` (the limiter is down); 500 `internal` (the lookup or the
 * signing failed, reported) or `server_misconfigured` (`PUBLIC_API_URL` is
 * not an http(s) URL, reported). Batch mode: 200 `{ urls, expires_at }`
 * (unreadable or missing files left out, never 404), the same 400 to 503
 * otherwise.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { isMissingObject } from '../_shared/storage.ts'

const FN = 'storage-sign'

/** The lifetime of a read URL, in seconds (P3-33). */
export const READ_URL_SECONDS = 300

/** The most files one batch call signs. */
export const MAX_BATCH_FILES = 50

const singleSchema = z.strictObject({
  file_id: z.guid(),
  download: z.boolean().optional(),
})

const batchSchema = z.strictObject({
  file_ids: z.array(z.guid()).min(1).max(MAX_BATCH_FILES),
})

const bodySchema = z.union([singleSchema, batchSchema])

const batchRowSchema = z.object({
  id: z.guid(),
  bucket: z.string().min(1),
  object_path: z.string().min(1),
})

const signedEntrySchema = z.object({
  path: z.string().nullable().optional(),
  signedUrl: z.string().nullable().optional(),
  error: z.unknown().optional(),
})

const rowSchema = z.object({
  bucket: z.string().min(1),
  object_path: z.string().min(1),
  original_name: z.string().min(1),
})

/** The origin of `PUBLIC_API_URL` when it is an http(s) URL; undefined when unset; null when malformed. */
function publicOrigin(value: string | undefined): string | null | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.origin
      : null
  } catch {
    return null
  }
}

/** The sign handler; see the module comment. */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight
    if (req.method !== 'POST') {
      return errorResponse('invalid_request', 'Method not allowed', 405, req)
    }
    const auth = await verifyAuth(req, {}, deps.userClient)
    if (auth instanceof Response) return auth
    const input = await readJson(req, bodySchema)
    if (input instanceof Response) return input
    const service = deps.serviceClient()
    if (service instanceof Response) return service

    const origin = publicOrigin(deps.env('PUBLIC_API_URL'))
    if (origin === null) {
      await reportError(
        {
          fn: FN,
          code: 'public_api_url_invalid',
          ids: {
            org_id: auth.access.org_id,
            ...('file_id' in input && { file_id: input.file_id }),
          },
        },
        deps.fetch,
      )
      return errorResponse(
        'server_misconfigured',
        'Server misconfigured',
        500,
        req,
      )
    }
    const publicUrl = (url: string) => {
      if (!origin) return url
      const parsed = new URL(url)
      return `${origin}${parsed.pathname}${parsed.search}`
    }

    const limited = limitResponse(
      await consume(service, LIMITS.storageSignUser, [
        auth.access.org_id,
        auth.user.id,
      ]),
      req,
    )
    if (limited) return limited

    if ('file_ids' in input) {
      return await signBatch(deps, req, {
        client: auth.client,
        service,
        orgId: auth.access.org_id,
        fileIds: [...new Set(input.file_ids.map((id) => id.toLowerCase()))],
        publicUrl,
      })
    }

    const orgId = auth.access.org_id
    const fileId = input.file_id
    const report = (code: string) =>
      reportError(
        { fn: FN, code, ids: { org_id: orgId, file_id: fileId } },
        deps.fetch,
      )
    const fail = async (code: string) => {
      await report(code)
      return errorResponse('internal', 'File could not be signed', 500, req)
    }
    const notFound = () =>
      errorResponse('not_found', 'File not found', 404, req)

    const found = await auth.client.from('stored_files')
      .select('bucket, object_path, original_name')
      .eq('id', fileId)
      .eq('status', 'ready')
      .maybeSingle()
    if (found.error) return await fail('file_lookup_failed')
    if (found.data === null) return notFound()
    const row = rowSchema.safeParse(found.data)
    if (!row.success) return await fail('unexpected_file_row')
    const file = row.data

    const expiresAt = new Date(
      deps.now().getTime() + READ_URL_SECONDS * 1000,
    )
    const signed = await service.storage.from(file.bucket).createSignedUrl(
      file.object_path,
      READ_URL_SECONDS,
      { download: input.download ? file.original_name : undefined },
    )
    if (signed.error || !signed.data?.signedUrl) {
      if (signed.error && isMissingObject(signed.error)) {
        await report('object_missing')
        return notFound()
      }
      return await fail('sign_failed')
    }

    return jsonResponse(
      {
        url: publicUrl(signed.data.signedUrl),
        expires_at: expiresAt.toISOString(),
      },
      200,
      req,
    )
  }
}

type Client = Exclude<ReturnType<Deps['serviceClient']>, Response>

/**
 * Batch mode: the caller's readable `ready` rows among `fileIds`, signed per
 * bucket. What cannot be read or signed is left out of `urls`; only a failed
 * lookup, an unexpected row or a failed bucket call fails the call (500).
 */
async function signBatch(
  deps: Deps,
  req: Request,
  { client, service, orgId, fileIds, publicUrl }: {
    client: Client
    service: Client
    orgId: string
    fileIds: string[]
    publicUrl: (url: string) => string
  },
): Promise<Response> {
  const report = (code: string, fileId?: string) =>
    reportError(
      {
        fn: FN,
        code,
        ids: { org_id: orgId, ...(fileId && { file_id: fileId }) },
      },
      deps.fetch,
    )
  const fail = async (code: string) => {
    await report(code)
    return errorResponse('internal', 'Files could not be signed', 500, req)
  }

  const found = await client.from('stored_files')
    .select('id, bucket, object_path')
    .in('id', fileIds)
    .eq('status', 'ready')
  if (found.error) return await fail('file_lookup_failed')
  const rows = z.array(batchRowSchema).safeParse(found.data ?? [])
  if (!rows.success) return await fail('unexpected_file_row')

  // One `createSignedUrls` per bucket (today all photos share one).
  const byBucket = new Map<string, Map<string, string>>()
  for (const row of rows.data) {
    if (!fileIds.includes(row.id)) continue
    const paths = byBucket.get(row.bucket) ?? new Map<string, string>()
    paths.set(row.object_path, row.id)
    byBucket.set(row.bucket, paths)
  }

  const expiresAt = new Date(deps.now().getTime() + READ_URL_SECONDS * 1000)
  const signed = await Promise.all(
    [...byBucket].map(async ([bucket, paths]) => ({
      paths,
      result: await service.storage.from(bucket).createSignedUrls(
        [...paths.keys()],
        READ_URL_SECONDS,
      ),
    })),
  )

  const urls: Record<string, string> = {}
  let missing: string | undefined
  for (const { paths, result } of signed) {
    if (result.error || !Array.isArray(result.data)) {
      return await fail('sign_failed')
    }
    for (const datum of result.data) {
      const entry = signedEntrySchema.safeParse(datum)
      const fileId = entry.success && entry.data.path
        ? paths.get(entry.data.path)
        : undefined
      if (!entry.success || !fileId) continue
      if (entry.data.error || !entry.data.signedUrl) {
        missing ??= fileId
        continue
      }
      urls[fileId] = publicUrl(entry.data.signedUrl)
    }
  }
  if (missing) await report('object_missing', missing)

  return jsonResponse(
    { urls, expires_at: expiresAt.toISOString() },
    200,
    req,
  )
}
