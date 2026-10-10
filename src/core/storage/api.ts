import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction, type InvokeOptions } from '@/core/supabase/functions'
import type { UploadStep } from '@/shared/lib/files'
import { FORBIDDEN_NAME_CHAR } from './file-name'

/** The upload itself (`uploadToSignedUrl`) failed: storage's HTTP status, when it gave one. */
export class UploadSendError extends Error {
  constructor(readonly status: number | null) {
    super('Upload to the signed path failed')
    this.name = 'UploadSendError'
  }
}

/** `storage-upload`'s answer: where to send the file, with a one-time token (no URL). */
const preparedSchema = z.object({
  file_id: z.string().min(1),
  bucket: z.string().min(1),
  path: z.string().min(1),
  token: z.string().min(1),
})

const signedSchema = z.object({ url: z.url(), expires_at: z.string().min(1) })
const signedBatchSchema = z.object({ urls: z.record(z.string(), z.url()), expires_at: z.string().min(1) })

/** The most files one `storage-sign` batch call signs (its `MAX_BATCH_FILES`). */
export const SIGN_BATCH_MAX = 50

/**
 * A smaller copy of a stored image, by name (`storage-sign`'s `IMAGE_VARIANTS`, PERF-1; the
 * server fixes each size, the client never sends a width): `avatar` for avatars up to 48 px
 * (96 px wide), `card` for previews up to 96 px (192 px wide), `print` for the fiche PDF
 * (480 px wide, PNG or JPEG kept). Only for an image; a PDF is refused (single) or left out (batch).
 */
export type ImageVariant = 'avatar' | 'card' | 'print'

/** The longest name `stored_files.original_name` takes. */
const MAX_NAME = 200

/**
 * The file's name as the registry takes it: forbidden characters as `_`, trimmed, at most 200
 * characters with the extension kept, « fichier » when nothing is left. Only shown (and used as a
 * download's name); paths never contain it.
 */
export function registryName(name: string): string {
  const cleaned = name.replace(FORBIDDEN_NAME_CHAR, '_').trim()
  const chars = Array.from(cleaned)
  if (chars.length === 0) return 'fichier'
  if (chars.length <= MAX_NAME) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 ? Array.from(cleaned.slice(dot)) : []
  const keep = ext.length < 16 ? ext : []
  return [...chars.slice(0, MAX_NAME - keep.length), ...keep].join('')
}

/** A confirm that may not have reached the server, or failed there: the network, a 5xx. */
const retriable = (error: unknown) => error instanceof FunctionCallError && (error.code === 'network' || error.status >= 500)

/**
 * `storage-confirm`, tried a second time after a network failure or a 5xx: a repeated confirm of
 * a file already confirmed answers 200, so the retry is safe. Any other refusal is final.
 */
async function confirmUpload(fileId: string): Promise<void> {
  try {
    await invokeFunction('storage-confirm', { file_id: fileId })
  } catch (error) {
    if (!retriable(error)) throw error
    await invokeFunction('storage-confirm', { file_id: fileId })
  }
}

interface UploadInput {
  /** The `upload_purposes` key (`org_logo`…): its permission, size and types apply. */
  purpose: string
  subjectType: string
  subjectId: string
  file: File
  /** The type to declare (`uploadMimeType`: the content's type for a misnamed image); the browser's by default. */
  mimeType?: string
  onStep?: (step: UploadStep) => void
}

/**
 * Uploads one file (design §7.2): `storage-upload` registers it and signs a one-time upload for
 * the path the database chose → the browser sends it there on its own Supabase URL
 * (`uploadToSignedUrl`), typed as declared → `storage-confirm` checks the stored object (type,
 * size, image size) and makes the file `ready`. Stops at the first failure: a `FunctionCallError`
 * (the functions' French refusal, a 429…) or an `UploadSendError`; only the confirm is tried again,
 * once, after a network failure or a 5xx (a repeated confirm answers 200; a 409 means a concurrent
 * call settled the file otherwise).
 */
export async function uploadFile({ purpose, subjectType, subjectId, file, mimeType = file.type, onStep }: UploadInput): Promise<{ fileId: string }> {
  onStep?.('preparing')
  const prepared = preparedSchema.parse(
    await invokeFunction('storage-upload', {
      purpose,
      subject_type: subjectType,
      subject_id: subjectId,
      original_name: registryName(file.name),
      mime_type: mimeType,
      size_bytes: file.size,
    }),
  )

  onStep?.('sending')
  // A Blob of the declared type: storage records the part's type, and storage-confirm requires it
  // to equal the declared one (the File's own type comes from its name).
  const body = new Blob([file], { type: mimeType })
  const { error } = await supabase.storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, body, { contentType: mimeType })
  if (error) {
    const status = 'status' in error && typeof error.status === 'number' ? error.status : null
    throw new UploadSendError(status)
  }

  onStep?.('confirming')
  await confirmUpload(prepared.file_id)
  return { fileId: prepared.file_id }
}

/**
 * A 5-minute read URL for a stored file, from `storage-sign` (P3-33: the client never signs one
 * itself; the caller's `stored_files` visibility decides). 404 `not_found` when the file is not
 * readable; 429 `rate_limited` past 120 an hour. With `variant`, a smaller copy of the image
 * (never with `download`).
 */
export async function signedFileUrl(
  fileId: string,
  { download = false, variant, ...options }: InvokeOptions & { download?: boolean; variant?: ImageVariant } = {},
): Promise<{ url: string; expiresAt: string }> {
  const body = { file_id: fileId, ...(download && { download: true }), ...(variant && { variant }) }
  const data = signedSchema.parse(await invokeFunction('storage-sign', body, options))
  return { url: data.url, expiresAt: data.expires_at }
}

/**
 * 5-minute read URLs for up to SIGN_BATCH_MAX stored files in one `storage-sign` call (its batch
 * mode, `{ file_ids }`): a list's photos count once against the 120-an-hour limit, not once per
 * row. Inline URLs only. A file the caller cannot read (or whose object is gone) is simply absent
 * from `urls`, never an error. With `variant`, smaller copies (a file that is not an image is
 * left out).
 */
export async function signedFileUrls(
  fileIds: readonly string[],
  { variant, ...options }: InvokeOptions & { variant?: ImageVariant } = {},
): Promise<{ urls: ReadonlyMap<string, string>; expiresAt: string }> {
  if (fileIds.length === 0 || fileIds.length > SIGN_BATCH_MAX) throw new RangeError(`signedFileUrls takes 1 to ${SIGN_BATCH_MAX} files`)
  const data = signedBatchSchema.parse(await invokeFunction('storage-sign', { file_ids: fileIds, ...(variant && { variant }) }, options))
  return { urls: new Map(Object.entries(data.urls)), expiresAt: data.expires_at }
}

/** The stored file could not be read through its signed URL (the network, or storage answered an error). */
class StoredFileReadError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'Stored file unreachable' : `Stored file read failed (${status})`)
    this.name = 'StoredFileReadError'
  }
}

/**
 * A stored file's bytes, for a file the page transforms before saving it (a signed PDF split in
 * the browser, P4-500): a new 5-minute URL from `storage-sign` (never cached), read at once.
 * Throws `FunctionCallError` (404 not readable, 429) or `StoredFileReadError`.
 */
export async function fetchStoredFile(fileId: string, options: InvokeOptions = {}): Promise<Uint8Array> {
  const { url } = await signedFileUrl(fileId, options)
  let response: Response
  try {
    response = await fetch(url, { signal: options.signal, cache: 'no-store' })
  } catch {
    throw new StoredFileReadError(null)
  }
  if (!response.ok) throw new StoredFileReadError(response.status)
  return new Uint8Array(await response.arrayBuffer())
}
