/** The steps of an upload, as `FileDropzone` shows its progress: register, send, server check. */
export const UPLOAD_STEPS = ['preparing', 'sending', 'confirming'] as const
export type UploadStep = (typeof UPLOAD_STEPS)[number]

/** The byte at `i`, 0 past the end (the readers below check lengths first). */
const byteAt = (bytes: Uint8Array, i: number) => bytes[i] ?? 0

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte)

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** How many leading bytes `sniffMimeType` reads. */
const HEAD_BYTES = 12

/** The types `sniffMimeType` can name. */
const SNIFFABLE: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])

/**
 * The MIME type of a file's content, from its first bytes, for the types the client can name
 * this way: PNG, JPEG, WEBP and PDF. A looser subset of the server's check (`sniff` in
 * `supabase/functions/_shared/storage.ts`, which also reads the tail and Word's ZIP directory):
 * it only gives fast feedback, and `storage-confirm` decides. Null for anything else.
 */
export function sniffMimeType(head: Uint8Array): string | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp'
  if (startsWith(head, ascii('%PDF-'))) return 'application/pdf'
  return null
}

/**
 * The type to declare for an upload, or null when the content shows it is none of the accepted
 * types.
 *
 * - Browsers derive `file.type` from the name, and a fair share of real `.jpg` files are PNG or
 *   WEBP: when the content's type is one the purpose accepts, that is the type declared, so a
 *   misnamed image is not refused as « pas du type annoncé ».
 * - When every accepted type can be sniffed (images, PDF), a file whose content is none of them
 *   (a `.txt` renamed `.png`, a GIF) is refused here: null.
 * - Otherwise the browser's type, and the server decides.
 */
export async function uploadMimeType(file: Blob, accept: readonly string[]): Promise<string | null> {
  const sniffed = sniffMimeType(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()))
  if (sniffed !== null && accept.includes(sniffed)) return sniffed
  if (accept.every((type) => SNIFFABLE.has(type))) return null
  return file.type
}

/** Width and height in pixels, as an image's header states them. */
export interface ImageSize {
  width: number
  height: number
}

const be16 = (b: Uint8Array, at: number) => (byteAt(b, at) << 8) | byteAt(b, at + 1)
const be32 = (b: Uint8Array, at: number) => ((byteAt(b, at) << 24) | (byteAt(b, at + 1) << 16) | (byteAt(b, at + 2) << 8) | byteAt(b, at + 3)) >>> 0
const le16 = (b: Uint8Array, at: number) => byteAt(b, at) | (byteAt(b, at + 1) << 8)
const le24 = (b: Uint8Array, at: number) => byteAt(b, at) | (byteAt(b, at + 1) << 8) | (byteAt(b, at + 2) << 16)
const le32 = (b: Uint8Array, at: number) => (le24(b, at) | (byteAt(b, at + 3) << 24)) >>> 0
const text = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** PNG: the `IHDR` chunk, which comes first (bytes 16–23). */
function pngSize(b: Uint8Array): ImageSize | null {
  return b.length >= 24 && text(b, 12, 16) === 'IHDR' ? { width: be32(b, 16), height: be32(b, 20) } : null
}

/** WebP: the first chunk's header (`VP8 `, `VP8L` or `VP8X`). */
function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null
  switch (text(b, 12, 16)) {
    case 'VP8 ':
      return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff } : null
    case 'VP8L': {
      if (b[20] !== 0x2f) return null
      const bits = le32(b, 21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    case 'VP8X':
      return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
    default:
      return null
  }
}

/** True for SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
const isFrameHeader = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** JPEG: the first frame header, found by walking the segments after SOI (as the server does). */
function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) {
      const next = b.indexOf(0xff, i)
      if (next === -1) return null
      i = next
      continue
    }
    const marker = byteAt(b, i + 1)
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda || i + 4 > b.length) return null
    const length = be16(b, i + 2)
    if (length < 2) return null
    if (isFrameHeader(marker)) return i + 9 <= b.length ? { width: be16(b, i + 7), height: be16(b, i + 5) } : null
    i += 2 + length
  }
  return null
}

const IMAGE_READERS: Readonly<Record<string, (bytes: Uint8Array) => ImageSize | null>> = {
  'image/png': pngSize,
  'image/jpeg': jpegSize,
  'image/webp': webpSize,
}

/** How much of a file `readImageSize` reads: EXIF and ICC segments can push a JPEG's frame header past 100 KB. */
const IMAGE_HEADER_BYTES = 512 * 1024

/**
 * An image's width and height from its header, without decoding it (a small PNG can decode to
 * hundreds of MB), with the logic of the server's `_shared/image-size.ts`. Null for another type,
 * or a header that is missing, truncated, malformed or zero-sized: the server then decides.
 */
export async function readImageSize(file: Blob, mimeType: string): Promise<ImageSize | null> {
  const reader = IMAGE_READERS[mimeType]
  if (!reader) return null
  const size = reader(new Uint8Array(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer()))
  return size && size.width > 0 && size.height > 0 ? size : null
}

/** « 2 », « 1,5 »: a size in Mo (MiB), with one decimal at most, as `create_pending_upload` words it. */
export function formatMegabytes(bytes: number): string {
  return String(Math.round((bytes / 1_048_576) * 10) / 10).replace('.', ',')
}

/** « 4 000 »: an image side in pixels, as `storage-confirm` words it. */
export function formatPixels(pixels: number): string {
  return new Intl.NumberFormat('fr-CA').format(pixels)
}
