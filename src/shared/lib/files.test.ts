import { describe, expect, it } from 'vitest'
import { formatMegabytes, sniffMimeType, uploadMimeType } from './files'

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

  it("keeps the browser's type when the content type is not accepted, or not known", async () => {
    await expect(uploadMimeType(fileOf(WEBP, 'photo.jpg', 'image/jpeg'), IMAGES)).resolves.toBe('image/jpeg')
    await expect(uploadMimeType(fileOf([1, 2, 3], 'notes.txt', 'text/plain'), IMAGES)).resolves.toBe('text/plain')
  })

  it('a correctly named file keeps its type', async () => {
    await expect(uploadMimeType(fileOf(JPEG, 'photo.jpg', 'image/jpeg'), IMAGES)).resolves.toBe('image/jpeg')
  })
})

describe('formatMegabytes', () => {
  it('words a size as the database does (one decimal, comma)', () => {
    expect(formatMegabytes(2_097_152)).toBe('2')
    expect(formatMegabytes(10_485_760)).toBe('10')
    expect(formatMegabytes(1_572_864)).toBe('1,5')
  })
})
