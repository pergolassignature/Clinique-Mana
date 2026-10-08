/**
 * Image width and height from the header, without decoding (Task 3.26: the
 * `max_image_side` cap of an upload purpose; Task 3.30: the PDF renderer's
 * 4000 px cap). A small PNG can decode to hundreds of MB, so the size is read
 * before anything decodes it.
 *
 * - **PNG:** the `IHDR` chunk, which must come first (bytes 16–23).
 * - **JPEG:** the first frame header (SOF0–SOF15 except DHT, JPG and DAC),
 *   found by walking the segments after SOI. EXIF and ICC segments can push
 *   it past 100 KB, so the reader skips segment payloads by their length
 *   instead of keeping them.
 * - **WebP:** the first chunk's header: `VP8 ` (lossy), `VP8L` (lossless) or
 *   `VP8X` (extended: the canvas size).
 *
 * `imageSizeReader` takes the bytes in chunks (a stream) and keeps at most a
 * few dozen of them; `imageSize` reads bytes already in memory. Pure, no
 * top-level side effects.
 */

/** Width and height in pixels, as the header states them. */
export interface ImageSize {
  width: number
  height: number
}

/** The image formats whose header this module reads. */
export type ImageKind = 'png' | 'jpeg' | 'webp'

/** Takes a file's bytes in order, then answers its size. */
export interface ImageSizeReader {
  /** The next bytes of the file; ignored once the size is known or refused. */
  push(chunk: Uint8Array): void
  /** The size, or null when the header is missing, truncated or malformed. */
  result(): ImageSize | null
}

/** Bytes a PNG (signature, IHDR) or WebP (RIFF, first chunk) header needs. */
const FIXED_HEADER = { png: 24, webp: 30 } as const

const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const le24 = (b: Uint8Array, at: number) =>
  b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to))

/** A new array holding `a` then `b`. */
function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** The size in a complete PNG or WebP header (`FIXED_HEADER` bytes), or null. */
function fixedHeaderSize(
  kind: 'png' | 'webp',
  b: Uint8Array,
): ImageSize | null {
  if (kind === 'png') {
    return ascii(b, 12, 16) === 'IHDR'
      ? { width: be32(b, 16), height: be32(b, 20) }
      : null
  }
  switch (ascii(b, 12, 16)) {
    case 'VP8 ': // frame tag (3), start code 9d 01 2a, then 14-bit sizes
      return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a
        ? { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
        : null
    case 'VP8L': { // signature 0x2f, then 14-bit width − 1 and height − 1
      if (b[20] !== 0x2f) return null
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      }
    }
    case 'VP8X': // flags (4), then 24-bit canvas width − 1 and height − 1
      return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
    default:
      return null
  }
}

/** True for SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
const isFrameHeader = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)

/**
 * A reader for `kind` (see the module comment). Feed it the whole file from
 * its first byte; `result()` is final once the header has been read.
 */
export function imageSizeReader(kind: ImageKind): ImageSizeReader {
  let size: ImageSize | null = null
  let finished = false
  /** Unparsed bytes: less than one segment header, so never more than 30. */
  let pending: Uint8Array = new Uint8Array(0)
  /** JPEG: bytes still to skip (SOI first, then segment payloads). */
  let skip = kind === 'jpeg' ? 2 : 0

  const finish = (value: ImageSize | null) => {
    size = value
    finished = true
    pending = new Uint8Array(0)
  }

  /** Walks JPEG segments in `b`; keeps the unparsed rest, or sets `skip`. */
  const walkJpeg = (b: Uint8Array) => {
    let i = 0
    while (i + 2 <= b.length) {
      if (b[i] !== 0xff) return finish(null)
      const marker = b[i + 1]
      if (marker === 0xff) { // fill byte
        i++
        continue
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // TEM, RSTn: no length
        i += 2
        continue
      }
      // SOI, EOI or SOS (scan data) before any frame header: none to find.
      if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) {
        return finish(null)
      }
      if (i + 4 > b.length) break
      const length = be16(b, i + 2)
      if (length < 2) return finish(null)
      if (isFrameHeader(marker)) {
        if (i + 9 > b.length) break
        return finish({ width: be16(b, i + 7), height: be16(b, i + 5) })
      }
      const next = i + 2 + length
      if (next > b.length) {
        skip = next - b.length
        i = b.length
        break
      }
      i = next
    }
    // A copy, so a large chunk is not retained through a view.
    pending = b.slice(i)
  }

  return {
    push(chunk) {
      if (finished) return
      let data = chunk
      if (skip > 0) {
        const n = Math.min(skip, data.length)
        skip -= n
        data = data.subarray(n)
        if (data.length === 0) return
      }
      if (kind === 'jpeg') {
        return walkJpeg(pending.length === 0 ? data : join(pending, data))
      }
      const need = FIXED_HEADER[kind]
      const head = join(pending, data.subarray(0, need - pending.length))
      if (head.length < need) {
        pending = head
        return
      }
      finish(fixedHeaderSize(kind, head))
    },
    result() {
      return size
    },
  }
}

/** The size of an image already in memory (see `imageSizeReader`). */
export function imageSize(
  kind: ImageKind,
  bytes: Uint8Array,
): ImageSize | null {
  const reader = imageSizeReader(kind)
  reader.push(bytes)
  return reader.result()
}
