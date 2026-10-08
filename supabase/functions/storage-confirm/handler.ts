/**
 * `storage-confirm` (Task 3.26, design §7.2, P3-14): the last step of an
 * upload. The server is the authority on what was stored: the declared MIME
 * type, the purpose's size cap and image cap are checked against the object
 * itself before the file becomes `ready`.
 *
 * 1. CORS; `POST` only; `verifyAuth`. Body `{ file_id }`.
 * 2. `get_pending_upload` with the **caller's** client: the uploader's own
 *    `pending` file (under 24 h, upload permission still held), with the
 *    purpose's `max_bytes` and `max_image_side`; else 404 `not_found`.
 * 3. Service `info(path)`: a missing object → 400 « Le fichier n'a pas été
 *    reçu. » (the row stays pending: the client may finish and retry). The
 *    content type storage recorded (set by the client on the signed upload)
 *    must equal the declared MIME type, and storage's size must be within
 *    `max_bytes`; otherwise the file is refused without being downloaded.
 * 4. Service `download(path).asStream()`, read once through `inspectStream`
 *    (SHA-256, size, sniffed type; only a head and a tail are kept, and the
 *    stream is cancelled once `max_bytes` is passed). When `max_image_side`
 *    is set, an image's width and height are read from its header on the way
 *    (`imageSizeReader`), without decoding it.
 * 5. Any mismatch → `remove([path])` and `reject_stored_file` (in parallel;
 *    a failed removal is reported, and the rejected row's object is purged
 *    after 30 days), then 400 with a French message.
 * 6. Otherwise `confirm_stored_file(file_id, sha256, real size)` → `ready`.
 *
 * Status mapping: 200 `{ file_id }`; 400 `invalid_request` (body; not
 * received; wrong type, too large, image too large or unreadable: French
 * message, file refused); 401 / 403 / 503 from `verifyAuth`; 403 `forbidden`
 * (42501); 404 `not_found`; 405; 413; 500 `internal` (an RPC or storage
 * failure, reported with the org and file ids only; nothing is refused) or
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
import { type ImageKind, imageSizeReader } from '../_shared/image-size.ts'
import { reportError } from '../_shared/report.ts'
import { inspectStream, sniffMatchesMime } from '../_shared/storage.ts'

const FN = 'storage-confirm'

const NOT_RECEIVED = "Le fichier n'a pas été reçu."
const WRONG_TYPE = "Ce fichier n'est pas du type annoncé."
const UNREADABLE_IMAGE = 'Cette image ne peut pas être lue.'

/** The image formats whose size is read when the purpose caps it. */
const IMAGE_KINDS: Readonly<Record<string, ImageKind>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
}

const bodySchema = z.strictObject({ file_id: z.guid() })

const pendingSchema = z.array(z.object({
  bucket: z.string(),
  object_path: z.string(),
  mime_type: z.string(),
  max_bytes: z.int().positive(),
  max_image_side: z.int().positive().nullable(),
})).max(1)

/** « Ce fichier dépasse la taille permise (2 Mo). », as `create_pending_upload` words it. */
function tooLarge(maxBytes: number): string {
  const mo = String(Math.round((maxBytes / 1_048_576) * 10) / 10)
  return `Ce fichier dépasse la taille permise (${mo.replace('.', ',')} Mo).`
}

function imageTooLarge(maxSide: number): string {
  const side = new Intl.NumberFormat('fr-CA').format(maxSide)
  return `Cette image dépasse la taille permise (${side} pixels de côté).`
}

/** A storage error for a missing object (storage-js `exists` uses the same test). */
function isMissing(error: unknown): boolean {
  const { status, statusCode } = (error ?? {}) as {
    status?: unknown
    statusCode?: unknown
  }
  return status === 400 || status === 404 || statusCode === '404'
}

/** Passes chunks through, feeding each to `push`. */
function tap(push: (chunk: Uint8Array) => void) {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      push(chunk)
      controller.enqueue(chunk)
    },
  })
}

/** The confirm handler; see the module comment. */
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

    const fileId = input.file_id
    const ids = { org_id: auth.access.org_id, file_id: fileId }
    const report = (code: string) =>
      reportError({ fn: FN, code, ids }, deps.fetch)
    const fail = async (code: string) => {
      await report(code)
      return errorResponse(
        'internal',
        'Upload could not be confirmed',
        500,
        req,
      )
    }

    const pending = await auth.client.rpc('get_pending_upload', {
      p_file_id: fileId,
    })
    if (pending.error) {
      if (!['P0001', '42501', '22023'].includes(pending.error.code ?? '')) {
        return await fail('get_pending_failed')
      }
      return rpcErrorResponse(pending.error, req)
    }
    const parsed = pendingSchema.safeParse(pending.data)
    if (!parsed.success) return await fail('unexpected_pending_upload')
    const file = parsed.data[0]
    if (!file) {
      return errorResponse('not_found', 'Upload not found', 404, req)
    }

    const objects = service.storage.from(file.bucket)
    const refuse = async (message: string) => {
      const [removed, rejected] = await Promise.all([
        objects.remove([file.object_path]),
        service.rpc('reject_stored_file', { p_file_id: fileId }),
      ])
      if (removed.error) await report('object_remove_failed')
      if (rejected.error) await report('reject_failed')
      return errorResponse('invalid_request', message, 400, req)
    }

    const info = await objects.info(file.object_path)
    if (info.error) {
      return isMissing(info.error)
        ? errorResponse('invalid_request', NOT_RECEIVED, 400, req)
        : await fail('object_info_failed')
    }
    if (info.data.contentType !== file.mime_type) {
      return await refuse(WRONG_TYPE)
    }
    if ((info.data.size ?? 0) > file.max_bytes) {
      return await refuse(tooLarge(file.max_bytes))
    }

    const download = await objects.download(file.object_path).asStream()
    if (download.error || !download.data) {
      return isMissing(download.error)
        ? errorResponse('invalid_request', NOT_RECEIVED, 400, req)
        : await fail('object_download_failed')
    }
    const kind = file.max_image_side ? IMAGE_KINDS[file.mime_type] : undefined
    const sizeReader = kind ? imageSizeReader(kind) : null
    let inspection
    try {
      inspection = await inspectStream(
        sizeReader
          ? download.data.pipeThrough(tap((c) => sizeReader.push(c)))
          : download.data,
        file.max_bytes,
      )
    } catch {
      return await fail('object_read_failed')
    }
    if (inspection.status === 'too_large') {
      return await refuse(tooLarge(file.max_bytes))
    }
    if (!sniffMatchesMime(inspection.type, file.mime_type)) {
      return await refuse(WRONG_TYPE)
    }
    if (sizeReader && file.max_image_side) {
      const size = sizeReader.result()
      if (!size || size.width === 0 || size.height === 0) {
        return await refuse(UNREADABLE_IMAGE)
      }
      if (
        size.width > file.max_image_side || size.height > file.max_image_side
      ) {
        return await refuse(imageTooLarge(file.max_image_side))
      }
    }

    const confirmed = await service.rpc('confirm_stored_file', {
      p_file_id: fileId,
      p_sha256: inspection.sha256,
      p_size_bytes: inspection.size,
    })
    if (confirmed.error) return await fail('confirm_failed')
    return jsonResponse({ file_id: fileId }, 200, req)
  }
}
