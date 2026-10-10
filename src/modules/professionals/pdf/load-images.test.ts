import { afterEach, describe, expect, it, vi } from 'vitest'
import { storedImageDataUrl } from './load-images'

const mocks = vi.hoisted(() => ({ signedFileUrl: vi.fn() }))
vi.mock('@/core/storage/api', () => ({ signedFileUrl: mocks.signedFileUrl }))

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const PNG = new Uint8Array([137, 80, 78, 71])

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** storage-sign answers a URL naming the variant; storage answers each URL with `answers[url]`. */
function stub(answers: Record<string, Response | 'network'>) {
  mocks.signedFileUrl.mockImplementation((_id: string, options: { variant?: string }) =>
    Promise.resolve({ url: `https://x.test/${options.variant ?? 'original'}`, expiresAt: 'x' }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const answer = answers[url]
      if (answer === 'network') return Promise.reject(new TypeError('network'))
      return Promise.resolve(answer ?? new Response(null, { status: 404 }))
    }),
  )
}

const png = () => new Response(new Blob([PNG], { type: 'image/png' }))

describe('storedImageDataUrl', () => {
  it('the print variant first: the smaller PNG is embedded', async () => {
    stub({ 'https://x.test/print': png() })
    expect(await storedImageDataUrl(FILE_ID, { variant: 'print' })).toMatch(/^data:image\/png;base64,/)
    expect(mocks.signedFileUrl).toHaveBeenCalledExactlyOnceWith(FILE_ID, { variant: 'print' })
  })

  it('the variant unavailable (transformations off, failing): the original instead, so the fiche keeps its photo', async () => {
    for (const failure of [new Response(null, { status: 500 }), 'network' as const]) {
      stub({ 'https://x.test/print': failure, 'https://x.test/original': png() })
      expect(await storedImageDataUrl(FILE_ID, { variant: 'print' })).toMatch(/^data:image\/png;base64,/)
      expect(mocks.signedFileUrl.mock.calls.map(([, options]) => options)).toEqual([{ variant: 'print' }, {}])
      vi.clearAllMocks()
    }
  })

  it('neither readable, another type, or no file: null (the initials)', async () => {
    stub({})
    expect(await storedImageDataUrl(FILE_ID, { variant: 'print' })).toBeNull()
    stub({ 'https://x.test/original': new Response(new Blob(['x'], { type: 'image/webp' })) })
    expect(await storedImageDataUrl(FILE_ID)).toBeNull()
    expect(await storedImageDataUrl(null)).toBeNull()
  })
})
