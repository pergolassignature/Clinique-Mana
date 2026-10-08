/**
 * Upload content checks and object paths (design §7, P3-14, P3-17, P3-20).
 *
 * - **One fixed map** from MIME type to sniffed type and extension. A MIME
 *   type is matched exactly (lower case, no parameter, no alias such as
 *   `image/jpg`). SVG, HTML and anything else outside the map are refused.
 * - **Sniffing** reads the leading bytes for a signature, and the trailing
 *   bytes for the end structures that a complete file must carry (PDF
 *   `%%EOF`, PNG `IEND`, the ZIP end record), so a truncated upload is refused.
 *   A file whose leading bytes hold HTML or script markup is refused whatever
 *   its signature (polyglots). A docx carrying a VBA project is refused.
 * - **`inspectStream`** reads an upload once, chunk by chunk: it hashes it,
 *   keeps only the head and tail needed for sniffing, and stops (cancelling
 *   the stream) as soon as the size cap is passed.
 * - **Paths** are built from ids and the MIME type's extension only; a file's
 *   name never reaches a path or URL (Loi 25, P3-20).
 *
 * No top-level side effects: everything here is pure apart from hashing.
 */
// Web Crypto has no incremental digest; node:crypto is built into Deno and
// the Edge Runtime, so one hash serves both streamed and in-memory bytes.
import { createHash } from 'node:crypto'

/** What `sniff` recognised; `unknown` is always refused. */
export type SniffedType =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'doc'
  | 'docx'
  | 'unknown'

type KnownType = Exclude<SniffedType, 'unknown'>

/**
 * The accepted formats: the union of the bucket MIME lists (Task 3.24).
 * The MIME → extension map that Task 3.24 writes in SQL (for the paths
 * `create_pending_upload` and `register_system_file` build) must match this
 * one exactly; a test there ties the two.
 *
 * `application/msword` should be allowed only for the purposes that need
 * legacy Word files: its sniffing accepts any OLE compound file (see `isDoc`).
 */
const FORMATS: Readonly<Record<KnownType, { mime: string; ext: string }>> = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
  doc: { mime: 'application/msword', ext: 'doc' },
  docx: {
    mime:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
}

/** MIME type → extension. A Map, so inherited keys never match. */
const EXTENSIONS: ReadonlyMap<string, string> = new Map(
  Object.values(FORMATS).map(({ mime, ext }) => [mime, ext]),
)

/**
 * Leading bytes kept for sniffing: the WHATWG MIME Sniffing « resource
 * header » (1445 bytes), the window a browser inspects to guess a type.
 */
const HEAD_BYTES = 1445

/**
 * Trailing bytes kept for sniffing: the ZIP end record (22 bytes) plus the
 * longest ZIP comment (65 535). The docx central directory must sit in it.
 */
const TAIL_BYTES = 22 + 0xffff

/** `%%EOF` must appear in the last 1024 bytes (PDF 1.7 implementation note 18). */
const PDF_EOF_WINDOW = 1024

/**
 * HTML markup that a browser's content sniffing could take for a page that
 * runs script: a doctype, a document element, a script, frame or embedded
 * object. Matched case-insensitively anywhere in the leading bytes, and only
 * when followed by a tag-terminating character, so PDF `<<` dictionaries and
 * `<hex>` strings never match.
 *
 * SVG and XML are deliberately not listed. Legitimate files carry them near
 * the top: C2PA content credentials in a PNG `caBX` chunk (`<svg`), a docx
 * with stored entries (`<?xml`), uncompressed XMP in a PDF (`<?xml`). They
 * are harmless here: the served Content-Type always comes from the fixed map
 * (never from the file), and browsers never sniff SVG or XML out of a binary
 * type such as `image/png` or `application/pdf`; only HTML sniffing matters.
 */
const MARKUP =
  /<(?:!doctype\s+html|html|head|body|script|iframe|object|embed)[\s/>]/i

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** The PNG `IHDR` chunk header: length 13, then the type. */
const PNG_IHDR = [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]
/** The whole `IEND` chunk (no data, so a fixed CRC): it must end the file. */
const PNG_IEND = [
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e,
  0x44,
  0xae,
  0x42,
  0x60,
  0x82,
]
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]
const ZIP_CENTRAL = [0x50, 0x4b, 0x01, 0x02]
const ZIP_END = [0x50, 0x4b, 0x05, 0x06]
const DOCX_PARTS = ['[Content_Types].xml', 'word/document.xml']
/** The VBA project of a macro-enabled document, compared in lower case. */
const DOCX_MACROS = 'word/vbaproject.bin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The `modules.key` check (`20261007140517_core_access.sql`). */
const MODULE_KEY = /^[a-z][a-z_]*$/

function startsWith(bytes: Uint8Array, prefix: number[], at = 0): boolean {
  if (at < 0 || bytes.length < at + prefix.length) return false
  return prefix.every((b, i) => bytes[at + i] === b)
}

function endsWith(bytes: Uint8Array, suffix: number[]): boolean {
  return startsWith(bytes, suffix, bytes.length - suffix.length)
}

/** `bytes` as a string of one char per byte (Latin-1), for ASCII matching. */
function latin1(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8)
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) |
    (bytes[at + 3] << 24)) >>> 0
}

/** `%PDF-1.x` / `%PDF-2.x` at offset 0, and `%%EOF` near the end. */
function isPdf(head: Uint8Array, tail: Uint8Array): boolean {
  return /^%PDF-[12]\.\d/.test(latin1(head.subarray(0, 8))) &&
    latin1(tail.subarray(Math.max(0, tail.length - PDF_EOF_WINDOW)))
      .includes('%%EOF')
}

/** The signature, `IHDR` first, and `IEND` as the last 12 bytes. */
function isPng(head: Uint8Array, tail: Uint8Array): boolean {
  return startsWith(head, PNG_SIGNATURE) && startsWith(head, PNG_IHDR, 8) &&
    endsWith(tail, PNG_IEND)
}

/**
 * SOI then a marker (`FF D8 FF xx`, xx a segment marker, not RST/SOI/EOI).
 * The end is not checked: phones append data after EOI (motion photos).
 */
function isJpeg(head: Uint8Array): boolean {
  if (!startsWith(head, [0xff, 0xd8, 0xff]) || head.length < 4) return false
  const marker = head[3]
  return marker >= 0xc0 && marker <= 0xfe && !(marker >= 0xd0 && marker <= 0xd9)
}

/** `RIFF` + size + `WEBP` + a VP8 chunk; the RIFF size must match the file. */
function isWebp(head: Uint8Array, size: number): boolean {
  if (head.length < 20) return false
  const text = latin1(head.subarray(0, 16))
  return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(text.slice(12, 16)) &&
    u32(head, 4) + 8 === size
}

/**
 * An OLE compound file (legacy `.doc`): the signature, little-endian byte
 * order, a version 3 (512-byte sectors) or 4 (4096) header, and room for the
 * header, one FAT sector and one directory sector. The directory and streams
 * are not read (the directory may sit anywhere in the file, outside the head
 * and tail kept by `inspectStream`), so any compound file (`.xls`, `.msi`, a
 * `.doc` with macros) passes as `doc`. Allow `application/msword` only for the
 * purposes that need legacy Word files.
 */
function isDoc(head: Uint8Array, size: number): boolean {
  if (!startsWith(head, OLE_SIGNATURE) || head.length < 32) return false
  if (u16(head, 28) !== 0xfffe) return false
  const major = u16(head, 26)
  const shift = u16(head, 30)
  const sector = major === 3 && shift === 9
    ? 512
    : major === 4 && shift === 12
    ? 4096
    : 0
  return sector > 0 && size >= 3 * sector
}

/**
 * A ZIP that starts with a local header and whose central directory (found
 * from the end record, inside `tail`) lists `[Content_Types].xml` and
 * `word/document.xml`, and no `word/vbaProject.bin` (any case: a macro-enabled
 * `.docm` renamed `.docx`). Offsets must be consistent: no prepended or
 * appended data, one disk, no ZIP64 (a docx under the bucket limit never
 * needs it).
 */
function isDocx(head: Uint8Array, tail: Uint8Array, size: number): boolean {
  if (!startsWith(head, ZIP_LOCAL)) return false
  const tailStart = size - tail.length
  for (let end = tail.length - 22; end >= 0; end--) {
    if (!startsWith(tail, ZIP_END, end)) continue
    if (end + 22 + u16(tail, end + 20) !== tail.length) continue
    if (u16(tail, end + 4) !== 0 || u16(tail, end + 6) !== 0) return false
    const entries = u16(tail, end + 10)
    const cdSize = u32(tail, end + 12)
    const cdStart = u32(tail, end + 16) - tailStart
    if (cdStart < 0 || cdStart + cdSize !== end) return false
    return listsDocxParts(tail, cdStart, end, entries)
  }
  return false
}

/**
 * Walks `entries` central-directory headers in `[start, end)`: true when they
 * fill the range exactly, list every docx part, and list no VBA project.
 */
function listsDocxParts(
  bytes: Uint8Array,
  start: number,
  end: number,
  entries: number,
): boolean {
  const found = new Set<string>()
  let at = start
  for (let i = 0; i < entries; i++) {
    if (at + 46 > end || !startsWith(bytes, ZIP_CENTRAL, at)) return false
    const nameLength = u16(bytes, at + 28)
    const next = at + 46 + nameLength + u16(bytes, at + 30) +
      u16(bytes, at + 32)
    if (next > end) return false
    const name = latin1(bytes.subarray(at + 46, at + 46 + nameLength))
    if (name.toLowerCase() === DOCX_MACROS) return false
    if (DOCX_PARTS.includes(name)) found.add(name)
    at = next
  }
  return at === end && found.size === DOCX_PARTS.length
}

/** The type of a file from its head, tail and total size. */
function classify(
  head: Uint8Array,
  tail: Uint8Array,
  size: number,
): SniffedType {
  if (size === 0 || MARKUP.test(latin1(head))) return 'unknown'
  if (isPdf(head, tail)) return 'pdf'
  if (isPng(head, tail)) return 'png'
  if (isJpeg(head)) return 'jpeg'
  if (isWebp(head, size)) return 'webp'
  if (isDoc(head, size)) return 'doc'
  if (isDocx(head, tail, size)) return 'docx'
  return 'unknown'
}

/**
 * The content type of a whole file in memory (design §7.2): a signature in
 * the first bytes, the end structure in the last ones (docx: the ZIP central
 * directory in the last 64 KB, without unzipping). An empty, truncated or
 * unrecognised file, one whose first 1445 bytes hold HTML or script markup,
 * or a docx with a VBA project, is `unknown`. For an upload in storage, use
 * `inspectStream`.
 */
export function sniff(bytes: Uint8Array): SniffedType {
  return classify(
    bytes.subarray(0, HEAD_BYTES),
    bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES)),
    bytes.length,
  )
}

/**
 * True when `mime` is exactly the MIME type of `type` in the fixed map.
 * `unknown` matches nothing; aliases, upper case and parameters do not match.
 */
export function sniffMatchesMime(type: SniffedType, mime: string): boolean {
  return type !== 'unknown' && FORMATS[type].mime === mime
}

/**
 * The object extension for an accepted MIME type (`image/jpeg` → `jpg`), or
 * null for any other value. The extension never comes from a file name.
 */
export function extensionForMime(mime: string): string | null {
  return EXTENSIONS.get(mime) ?? null
}

/**
 * SHA-256 of bytes already in memory (e.g. a rendered PDF), as 64 lower-case
 * hex digits: the `stored_files.sha256` format. For an upload, use
 * `inspectStream`, which hashes while reading.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** What `inspectStream` found: `too_large` carries no partial result. */
export type Inspection =
  | { status: 'ok'; type: SniffedType; size: number; sha256: string }
  | { status: 'too_large' }

/**
 * Reads `stream` once (e.g. `blob.stream()` or a fetch body) and returns its
 * size, SHA-256 (64 lower-case hex digits) and sniffed type. Only the head
 * and tail that `sniff` needs are kept in memory. As soon as more than
 * `maxBytes` have arrived, the stream is cancelled and `too_large` returned
 * (even if the cancel itself fails). A read error propagates.
 *
 * @param maxBytes the purpose's limit in bytes (a positive safe integer).
 * @throws TypeError when `maxBytes` is not a positive safe integer.
 */
export async function inspectStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Inspection> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('inspectStream: maxBytes must be a positive integer')
  }
  const hash = createHash('sha256')
  const head = new Uint8Array(HEAD_BYTES)
  let headLength = 0
  const tail: Uint8Array[] = []
  let tailLength = 0
  let size = 0
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) {
        // The verdict does not depend on the source acknowledging the cancel.
        await reader.cancel().catch(() => {})
        return { status: 'too_large' }
      }
      hash.update(value)
      if (headLength < HEAD_BYTES) {
        const take = value.subarray(0, HEAD_BYTES - headLength)
        head.set(take, headLength)
        headLength += take.length
      }
      if (value.length >= TAIL_BYTES) {
        // A copy of the last bytes only, so the large chunk is not retained.
        tail.length = 0
        tail.push(value.slice(-TAIL_BYTES))
        tailLength = TAIL_BYTES
      } else {
        tail.push(value)
        tailLength += value.length
        while (tailLength - tail[0].length >= TAIL_BYTES) {
          tailLength -= tail.shift()!.length
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  // Join only the last TAIL_BYTES: the first chunk may start earlier.
  const kept = new Uint8Array(Math.min(tailLength, TAIL_BYTES))
  let skip = tailLength - kept.length
  let at = 0
  for (const chunk of tail) {
    const part = skip > 0 ? chunk.subarray(Math.min(skip, chunk.length)) : chunk
    skip = Math.max(0, skip - chunk.length)
    kept.set(part, at)
    at += part.length
  }
  return {
    status: 'ok',
    type: classify(head.subarray(0, headLength), kept, size),
    size,
    sha256: hash.digest('hex'),
  }
}

/** The ids and MIME type that make an object path. */
export interface ObjectPathParts {
  orgId: string
  moduleKey: string
  subjectId: string
  fileId: string
  mimeType: string
}

/**
 * `{org_id}/{module_key}/{subject_id}/{file_id}.{ext}` (design §7.1, P3-20):
 * the TypeScript twin of the path `create_pending_upload` and
 * `register_system_file` build in SQL. Ids are canonical lower-case UUIDs, the
 * module key is a `modules.key`, and the extension comes from the MIME type.
 * No file name is ever part of the path.
 *
 * @throws TypeError when a part is malformed or the MIME type is not accepted
 *   (the message names the part, never its value).
 */
export function buildObjectPath(parts: ObjectPathParts): string {
  for (const key of ['orgId', 'subjectId', 'fileId'] as const) {
    if (!UUID.test(parts[key])) {
      throw new TypeError(`buildObjectPath: invalid ${key}`)
    }
  }
  if (!MODULE_KEY.test(parts.moduleKey)) {
    throw new TypeError('buildObjectPath: invalid moduleKey')
  }
  const ext = extensionForMime(parts.mimeType)
  if (!ext) throw new TypeError('buildObjectPath: MIME type not accepted')
  return `${parts.orgId}/${parts.moduleKey}/${parts.subjectId}/${parts.fileId}.${ext}`
}
