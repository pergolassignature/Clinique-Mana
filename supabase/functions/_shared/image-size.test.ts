import { assertEquals } from '@std/assert'
import { type ImageKind, imageSize, imageSizeReader } from './image-size.ts'

// Headers built as bytes (no binary file is committed).
const ascii = (s: string) => new TextEncoder().encode(s)
const be32 = (
  n: number,
) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n: number) => [(n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >>> 8) & 255]
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) =>
    p instanceof Uint8Array ? p : Uint8Array.from(p)
  )
  const out = new Uint8Array(arrays.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of arrays) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const png = (width: number, height: number) =>
  concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    [0, 0, 0, 13],
    ascii('IHDR'),
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
  )

/** A JPEG segment: marker and a payload of `size` bytes. */
const segment = (marker: number, size: number) =>
  concat([0xff, marker], be16(size + 2), new Uint8Array(size))

/** SOI, `before` segments, a frame header `sof` (SOF0 by default), then SOS. */
const jpeg = (
  width: number,
  height: number,
  before: Uint8Array[] = [segment(0xe0, 14)],
  sof = 0xc0,
) =>
  concat(
    [0xff, 0xd8],
    ...before,
    [0xff, sof, 0, 11, 8, ...be16(height), ...be16(width), 1, 1, 0x11, 0],
    [0xff, 0xda, 0, 2],
    new Uint8Array(32),
    [0xff, 0xd9],
  )

const riff = (chunk: Uint8Array) => {
  const body = concat(ascii('WEBP'), chunk)
  return concat(ascii('RIFF'), [...le24(body.length), 0], body)
}
const webpLossy = (width: number, height: number) =>
  riff(
    concat(
      ascii('VP8 '),
      [20, 0, 0, 0],
      [0, 0, 0],
      [0x9d, 0x01, 0x2a],
      le16(width),
      le16(height),
      new Uint8Array(10),
    ),
  )
const webpLossless = (width: number, height: number) => {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  return riff(
    concat(ascii('VP8L'), [10, 0, 0, 0], [
      0x2f,
      bits & 255,
      (bits >>> 8) & 255,
      (bits >>> 16) & 255,
      (bits >>> 24) & 255,
    ], new Uint8Array(10)),
  )
}
const webpExtended = (width: number, height: number) =>
  riff(
    concat(
      ascii('VP8X'),
      [10, 0, 0, 0],
      [0, 0, 0, 0],
      le24(width - 1),
      le24(height - 1),
      new Uint8Array(10),
    ),
  )

/** Feeds `bytes` to a reader in chunks of `size` bytes. */
function chunked(kind: ImageKind, bytes: Uint8Array, size: number) {
  const reader = imageSizeReader(kind)
  for (let i = 0; i < bytes.length; i += size) {
    reader.push(bytes.subarray(i, i + size))
  }
  return reader.result()
}

Deno.test('imageSize: PNG IHDR, JPEG SOFn and the three WebP headers', () => {
  const cases: [string, ImageKind, Uint8Array, [number, number]][] = [
    ['PNG', 'png', png(640, 480), [640, 480]],
    ['PNG over 65535', 'png', png(70_000, 3), [70_000, 3]],
    ['JPEG baseline', 'jpeg', jpeg(1024, 768), [1024, 768]],
    ['JPEG progressive (SOF2)', 'jpeg', jpeg(5000, 10, undefined, 0xc2), [
      5000,
      10,
    ]],
    ['JPEG 65535', 'jpeg', jpeg(10, 65535), [10, 65535]],
    ['WebP lossy', 'webp', webpLossy(300, 200), [300, 200]],
    ['WebP lossless', 'webp', webpLossless(4001, 16), [4001, 16]],
    ['WebP extended', 'webp', webpExtended(16_000, 9_000), [16_000, 9_000]],
  ]
  for (const [name, kind, bytes, [width, height]] of cases) {
    assertEquals(imageSize(kind, bytes), { width, height }, name)
  }
})

Deno.test('imageSizeReader: the same answer whatever the chunking', () => {
  const big = jpeg(2000, 1500, [
    segment(0xe0, 14),
    segment(0xe1, 65_000), // EXIF
    segment(0xe2, 40_000), // ICC profile
    new Uint8Array([0xff, 0xff, 0xff]), // fill bytes
    segment(0xdb, 67), // DQT
    segment(0xc4, 30), // DHT (C4 is not a frame header)
  ])
  for (const size of [1, 2, 3, 7, 4096, 65_536, big.length]) {
    assertEquals(
      chunked('jpeg', big, size),
      { width: 2000, height: 1500 },
      `jpeg / ${size}`,
    )
    assertEquals(
      chunked('png', png(9, 7), size),
      { width: 9, height: 7 },
      `png / ${size}`,
    )
    assertEquals(chunked('webp', webpLossy(5, 6), size), {
      width: 5,
      height: 6,
    }, `webp / ${size}`)
  }
})

Deno.test('imageSizeReader: stops at the frame header; later bytes are ignored', () => {
  const reader = imageSizeReader('jpeg')
  reader.push(jpeg(12, 34))
  reader.push(new Uint8Array([0x00, 0x13, 0x37])) // garbage after: never parsed
  assertEquals(reader.result(), { width: 12, height: 34 })
})

Deno.test('imageSizeReader: extra bytes between JPEG segments are skipped up to the next marker', () => {
  const stray = jpeg(800, 600, [
    segment(0xe0, 14),
    new Uint8Array([0x00, 0x00, 0x12, 0x34]), // stray bytes after APP0
    segment(0xe1, 2000),
    new Uint8Array([0xff, 0x00, 0x7f]), // FF 00 is not a marker either
    segment(0xdb, 67),
  ])
  for (const size of [1, 2, 3, 4096, stray.length]) {
    assertEquals(
      chunked('jpeg', stray, size),
      { width: 800, height: 600 },
      `jpeg / ${size}`,
    )
  }
})

Deno.test('imageSize: null for a missing, truncated or malformed header', () => {
  const cases: [string, ImageKind, Uint8Array][] = [
    ['empty PNG', 'png', new Uint8Array()],
    ['PNG cut inside IHDR', 'png', png(1, 1).subarray(0, 20)],
    [
      'PNG without IHDR first',
      'png',
      concat(png(1, 1).subarray(0, 12), ascii('IDAT'), new Uint8Array(20)),
    ],
    [
      'JPEG with no frame header',
      'jpeg',
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xda, 0, 2]),
    ],
    [
      'JPEG cut inside a segment',
      'jpeg',
      jpeg(5, 5, [segment(0xe1, 1000)]).subarray(0, 500),
    ],
    ['JPEG cut inside the frame header', 'jpeg', jpeg(5, 5).subarray(0, 24)],
    [
      'JPEG with extra bytes and no marker after them',
      'jpeg',
      new Uint8Array([0xff, 0xd8, 0x00, 0xe0, 0x12, 0x34]),
    ],
    [
      'JPEG with a segment length under 2',
      'jpeg',
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0, 0]),
    ],
    [
      'JPEG with EOI before a frame',
      'jpeg',
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0]),
    ],
    [
      'WebP with an unknown chunk',
      'webp',
      riff(concat(ascii('ALPH'), new Uint8Array(30))),
    ],
    [
      'WebP lossy without its start code',
      'webp',
      riff(concat(ascii('VP8 '), new Uint8Array(30))),
    ],
    [
      'WebP lossless without its signature',
      'webp',
      riff(concat(ascii('VP8L'), new Uint8Array(30))),
    ],
    ['WebP cut short', 'webp', webpExtended(2, 2).subarray(0, 25)],
  ]
  for (const [name, kind, bytes] of cases) {
    assertEquals(imageSize(kind, bytes), null, name)
    assertEquals(chunked(kind, bytes, 3), null, `${name} (chunked)`)
  }
})
