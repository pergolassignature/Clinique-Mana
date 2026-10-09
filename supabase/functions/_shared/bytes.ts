/**
 * Byte helpers shared by the request, provider, storage, image and PDF code.
 * Dependency-free, so any module may import it (the PDF renderer included,
 * ADR 0008).
 */

/**
 * The bytes of `body`, or null as soon as they exceed `maxBytes` (the reader
 * is cancelled; a failed cancel is ignored). A read error is thrown as is:
 * the caller maps it to its own failure.
 */
export async function readStreamCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return concatBytes(chunks)
}

/** One array holding `chunks` in order. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Standard base64, in 32 KB chunks so a 10 MB file does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** `bytes[from, to)` as one char per byte (Latin-1), for ASCII matching. */
export const latin1 = (bytes: Uint8Array, from = 0, to = bytes.length) =>
  String.fromCharCode(...bytes.subarray(from, to))

/** Unsigned integers at `at`, big- or little-endian. */
export const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
export const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
export const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
export const le24 = (b: Uint8Array, at: number) =>
  b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
export const le32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
