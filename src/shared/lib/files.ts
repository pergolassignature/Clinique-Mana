/** The steps of an upload, as `FileDropzone` shows its progress: register, send, server check. */
export const UPLOAD_STEPS = ['preparing', 'sending', 'confirming'] as const
export type UploadStep = (typeof UPLOAD_STEPS)[number]

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte)

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** How many leading bytes `sniffMimeType` reads. */
const HEAD_BYTES = 12

/**
 * The MIME type of a file's content, from its first bytes, for the types the client can name
 * this way (the signatures of `supabase/functions/_shared/storage.ts`): PNG, JPEG, WEBP and PDF.
 * Null for anything else (Word documents need their ZIP directory: the server checks those).
 */
export function sniffMimeType(head: Uint8Array): string | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp'
  if (startsWith(head, ascii('%PDF-'))) return 'application/pdf'
  return null
}

/**
 * The type to declare for an upload. Browsers derive `file.type` from the name, and a fair share
 * of real `.jpg` files are PNG or WEBP: when the content's type is one the purpose accepts, that is
 * the type declared, so a misnamed image is not refused as « pas du type annoncé ». Otherwise the
 * browser's type (the server then decides).
 */
export async function uploadMimeType(file: File, accept: readonly string[]): Promise<string> {
  const sniffed = sniffMimeType(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()))
  return sniffed !== null && accept.includes(sniffed) ? sniffed : file.type
}

/** « 2 », « 1,5 »: a size in Mo (MiB), with one decimal at most, as `create_pending_upload` words it. */
export function formatMegabytes(bytes: number): string {
  return String(Math.round((bytes / 1_048_576) * 10) / 10).replace('.', ',')
}
