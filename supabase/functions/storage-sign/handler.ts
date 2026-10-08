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
 * Nothing logs the file's name or path: reports carry the org and file ids.
 *
 * Status mapping: 200 `{ url, expires_at }`; 400 `invalid_request` (body);
 * 401 / 403 / 503 from `verifyAuth`; 404 `not_found` (not readable by the
 * caller, another org's, deleted, pending; or a ready row whose object is
 * missing, reported); 405; 413; 429 `rate_limited` with `Retry-After`; 503
 * `not_configured` (the limiter is down); 500 `internal` (the lookup or the
 * signing failed, reported) or `server_misconfigured` (`PUBLIC_API_URL` is
 * not an http(s) URL, reported).
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

const bodySchema = z.strictObject({
  file_id: z.guid(),
  download: z.boolean().optional(),
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

    const origin = publicOrigin(deps.env('PUBLIC_API_URL'))
    if (origin === null) {
      await report('public_api_url_invalid')
      return errorResponse(
        'server_misconfigured',
        'Server misconfigured',
        500,
        req,
      )
    }

    const limited = limitResponse(
      await consume(service, LIMITS.storageSignUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

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

    let url = signed.data.signedUrl
    if (origin) {
      const parsed = new URL(url)
      url = `${origin}${parsed.pathname}${parsed.search}`
    }
    return jsonResponse(
      { url, expires_at: expiresAt.toISOString() },
      200,
      req,
    )
  }
}
