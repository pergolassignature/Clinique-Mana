/**
 * `storage-upload` (Task 3.26, design §7.2): the first step of an upload.
 * Files never pass through a function body: this one registers the upload
 * and signs a one-time upload URL for the path the database chose.
 *
 * 1. CORS; `POST` only; `verifyAuth` (an active profile). The purpose's
 *    permission, and so its module, is checked by the RPC, as the caller.
 * 2. Body `{ purpose, subject_type, subject_id, original_name, mime_type,
 *    size_bytes }`, strict: no path, bucket or org is ever taken from the
 *    client. The name is checked like `stored_files.original_name`.
 * 3. One hit on `LIMITS.storageUploadUser` (60 an hour per caller): each
 *    call signs an upload of up to the purpose's size cap.
 * 4. `create_pending_upload` with the **caller's** client: permission, size
 *    and type checks, then a `pending` row and its path.
 * 5. The path must be exactly `buildObjectPath(caller's org, its module
 *    segment, the subject, the file id, the MIME type)`, in a core bucket:
 *    a path that is not is never signed.
 * 6. Service client `createSignedUploadUrl(path)` (no upsert: the object can
 *    be written once; the token is valid for 2 hours).
 *
 * The client then uploads with `uploadToSignedUrl(path, token, file)` (its
 * own Supabase URL; `signed_url` carries the function's), setting the
 * declared MIME type as the content type, and calls `storage-confirm`.
 *
 * Status mapping: 200 `{ file_id, bucket, path, token, signed_url }`; 400
 * `invalid_request` (body; P0001 with its French message; 22023); 401 / 403
 * / 503 from `verifyAuth`; 403 `forbidden` (42501: no upload permission);
 * 405; 413; 429 `rate_limited` with `Retry-After`; 503 `not_configured` (the
 * limiter is down); 500 `internal` (another RPC error, an unexpected path, or the
 * signing failed; reported with the org and file ids only) or
 * `server_misconfigured`.
 */
import { z } from 'zod'
import {
  errorResponse,
  handleCors,
  jsonResponse,
  verifyAuth,
} from '../_shared/auth.ts'
import type { Deps } from '../_shared/deps.ts'
import { rpcErrorResponse } from '../_shared/errors.ts'
import { readJson } from '../_shared/http.ts'
import { consume, limitResponse, LIMITS } from '../_shared/rate-limit.ts'
import { reportError } from '../_shared/report.ts'
import { buildObjectPath } from '../_shared/storage.ts'

const FN = 'storage-upload'

/** The core buckets (Task 3.24); nothing else is ever signed. */
const BUCKETS = ['org-assets', 'documents', 'signed-documents']

/** A character `stored_files.original_name` refuses: `/`, `\`, C0, DEL or C1. */
function forbiddenNameChar(char: string): boolean {
  const code = char.codePointAt(0)!
  return char === '/' || char === '\\' || code < 0x20 ||
    (code >= 0x7f && code <= 0x9f)
}

/** `stored_files.original_name`: 1–200 characters, not blank, no forbidden character. */
const originalName = z.string().refine((name) => {
  const chars = Array.from(name)
  return chars.length <= 200 && name.trim() !== '' &&
    !chars.some(forbiddenNameChar)
})

const bodySchema = z.strictObject({
  purpose: z.string().regex(/^[a-z_]{1,50}$/),
  subject_type: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  // guid, not uuid: seed and fixture ids are not RFC 4122 variants. Lower
  // case, as the database writes it into the path.
  subject_id: z.guid().transform((id) => id.toLowerCase()),
  original_name: originalName,
  mime_type: z.string().min(1).max(255),
  size_bytes: z.int().positive().max(2_147_483_647),
})

const pendingSchema = z.tuple([z.object({
  file_id: z.guid(),
  bucket: z.string(),
  object_path: z.string(),
})])

/** The upload handler; see the module comment. */
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
    const limited = limitResponse(
      await consume(service, LIMITS.storageUploadUser, [orgId, auth.user.id]),
      req,
    )
    if (limited) return limited

    const fail = async (code: string, fileId?: string) => {
      const ids: Record<string, string> = { org_id: orgId }
      if (fileId) ids.file_id = fileId
      await reportError({ fn: FN, code, ids }, deps.fetch)
      return errorResponse('internal', 'Upload could not be prepared', 500, req)
    }

    const pending = await auth.client.rpc('create_pending_upload', {
      p_purpose: input.purpose,
      p_subject_type: input.subject_type,
      p_subject_id: input.subject_id,
      p_original_name: input.original_name,
      p_mime_type: input.mime_type,
      p_size_bytes: input.size_bytes,
    })
    if (pending.error) {
      if (!['P0001', '42501', '22023'].includes(pending.error.code ?? '')) {
        return await fail('create_pending_failed')
      }
      return rpcErrorResponse(pending.error, req)
    }
    const parsed = pendingSchema.safeParse(pending.data)
    if (!parsed.success) return await fail('unexpected_pending_upload')
    const [{ file_id: fileId, bucket, object_path: path }] = parsed.data

    if (
      !BUCKETS.includes(bucket) ||
      path !==
        expectedPath(orgId, path, input.subject_id, fileId, input.mime_type)
    ) {
      return await fail('unexpected_pending_upload', fileId)
    }

    const signed = await service.storage.from(bucket).createSignedUploadUrl(
      path,
    )
    if (signed.error || !signed.data?.token) {
      return await fail('signed_upload_failed', fileId)
    }
    return jsonResponse(
      {
        file_id: fileId,
        bucket,
        path,
        token: signed.data.token,
        signed_url: signed.data.signedUrl,
      },
      200,
      req,
    )
  }
}

/**
 * The path `create_pending_upload` must have built, from what this request
 * knows: the caller's org, the subject, the new file id and the MIME type.
 * Only the module segment comes from the returned path (a purpose's module);
 * `buildObjectPath` checks its format. Null when a part is malformed.
 */
function expectedPath(
  orgId: string,
  returnedPath: string,
  subjectId: string,
  fileId: string,
  mimeType: string,
): string | null {
  try {
    return buildObjectPath({
      orgId,
      moduleKey: returnedPath.split('/')[1] ?? '',
      subjectId,
      fileId,
      mimeType,
    })
  } catch {
    return null
  }
}
