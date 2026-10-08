import { describe, expect, it } from 'vitest'
import { formatMegabytes, formatPixels, readImageSize, sniffMimeType, uploadMimeType } from './files'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)))
const PDF = [...'%PDF-1.7'].map((c) => c.charCodeAt(0))

const fileOf = (bytes: number[], name: string, type: string) => new File([new Uint8Array(bytes)], name, { type })

describe('sniffMimeType', () => {
  it.each([
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [WEBP, 'image/webp'],
    [PDF, 'application/pdf'],
  ])('reads the content signature (%#)', (bytes, mime) => {
    expect(sniffMimeType(new Uint8Array(bytes))).toBe(mime)
  })

  it('knows nothing of other or truncated content', () => {
    expect(sniffMimeType(new Uint8Array([]))).toBeNull()
    expect(sniffMimeType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull()
    expect(sniffMimeType(new TextEncoder().encode('GIF89a'))).toBeNull()
    // RIFF without WEBP (a WAV file).
    expect(sniffMimeType(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull()
  })
})

describe('uploadMimeType', () => {
  const IMAGES = ['image/png', 'image/jpeg']

  it('declares a misnamed image by its content when the purpose accepts that type', async () => {
    await expect(uploadMimeType(fileOf(PNG, 'photo.jpg', 'image/jpeg'), IMAGES)).resolves.toBe('image/png')
  })

  it('a correctly named file keeps its type', async () => {
    await expect(uploadMimeType(fileOf(JPEG, 'photo.jpg', 'image/jpeg'), IMAGES)).resolves.toBe('image/jpeg')
  })

  describe('every accepted type can be sniffed (images, PDF)', () => {
    it('refuses content of no known type, whatever the name says (a .txt renamed .png)', async () => {
      await expect(uploadMimeType(fileOf([...new TextEncoder().encode('Bonjour')], 'logo.png', 'image/png'), IMAGES)).resolves.toBeNull()
      await expect(uploadMimeType(fileOf([], 'vide.png', 'image/png'), IMAGES)).resolves.toBeNull()
    })

    it('refuses content of a known type the purpose does not accept (a WEBP named .jpg, a PDF)', async () => {
      await expect(uploadMimeType(fileOf(WEBP, 'photo.jpg', 'image/jpeg'), IMAGES)).resolves.toBeNull()
      await expect(uploadMimeType(fileOf(PDF, 'logo.png', 'image/png'), IMAGES)).resolves.toBeNull()
    })
  })

  it("otherwise keeps the browser's type when the content is not an accepted type (the server decides)", async () => {
    const DOCUMENTS = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    await expect(uploadMimeType(fileOf([0x50, 0x4b, 3, 4], 'contrat.docx', docx), DOCUMENTS)).resolves.toBe(docx)
    await expect(uploadMimeType(fileOf(PDF, 'contrat.docx', docx), DOCUMENTS)).resolves.toBe('application/pdf')
    await expect(uploadMimeType(fileOf([1, 2, 3], 'notes.txt', 'text/plain'), DOCUMENTS)).resolves.toBe('text/plain')
  })
})

/** A PNG header (signature, IHDR) stating `width` × `height`. */
function pngHeader(width: number, height: number): number[] {
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  return [...PNG.slice(0, 8), 0, 0, 0, 0x0d, ...[...'IHDR'].map((c) => c.charCodeAt(0)), ...be32(width), ...be32(height), 8, 6, 0, 0, 0]
}

/** A JPEG: SOI, an APP1 segment of `appBytes` payload bytes, then a SOF0 stating `width` × `height`. */
function jpegHeader(width: number, height: number, appBytes = 16): number[] {
  const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff]
  return [0xff, 0xd8, 0xff, 0xe1, ...be16(appBytes + 2), ...new Array<number>(appBytes).fill(0), 0xff, 0xc0, 0, 17, 8, ...be16(height), ...be16(width), 3]
}

describe('readImageSize', () => {
  const read = (bytes: number[], mime: string) => readImageSize(new Blob([new Uint8Array(bytes)]), mime)

  it("reads a PNG's IHDR", async () => {
    await expect(read(pngHeader(4001, 300), 'image/png')).resolves.toEqual({ width: 4001, height: 300 })
  })

  it("walks a JPEG's segments to its frame header, past a large EXIF segment", async () => {
    await expect(read(jpegHeader(640, 4800), 'image/jpeg')).resolves.toEqual({ width: 640, height: 4800 })
    await expect(read(jpegHeader(1200, 800, 120_000), 'image/jpeg')).resolves.toEqual({ width: 1200, height: 800 })
  })

  it('reads a WebP VP8X canvas', async () => {
    const riff = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8X'].map((c) => c.charCodeAt(0)), [10, 0, 0, 0, 0, 0, 0, 0])
    // Canvas width − 1 and height − 1, 24-bit little-endian: 4999 × 99.
    await expect(read([...riff, 0x87, 0x13, 0, 0x63, 0, 0], 'image/webp')).resolves.toEqual({ width: 5000, height: 100 })
  })

  it('knows nothing of a missing, truncated or zero-sized header, nor of other types (the server decides)', async () => {
    await expect(read(PNG, 'image/png')).resolves.toBeNull()
    await expect(read(pngHeader(0, 10), 'image/png')).resolves.toBeNull()
    await expect(read(jpegHeader(10, 10).slice(0, 25), 'image/jpeg')).resolves.toBeNull()
    await expect(read([0xff, 0xd8, 0xff, 0xda, 0, 2], 'image/jpeg')).resolves.toBeNull()
    await expect(read(PDF, 'application/pdf')).resolves.toBeNull()
  })
})

describe('formatMegabytes', () => {
  it('words a size as the database does (one decimal, comma)', () => {
    expect(formatMegabytes(2_097_152)).toBe('2')
    expect(formatMegabytes(10_485_760)).toBe('10')
    expect(formatMegabytes(1_572_864)).toBe('1,5')
  })
})

describe('formatPixels', () => {
  it('words a side as storage-confirm does (fr-CA grouping)', () => {
    expect(formatPixels(4000)).toBe(new Intl.NumberFormat('fr-CA').format(4000))
    expect(formatPixels(4000).replace(/\s/g, ' ')).toBe('4 000')
  })
})
