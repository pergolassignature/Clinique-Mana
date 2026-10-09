import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { renderWithContexts } from '@/test/contexts'
import { CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { ProfessionalAvatar, ProfessionalPhotoAvatar } from './ProfessionalAvatar'
import { RecordHeader } from './record/RecordHeader'

const mocks = vi.hoisted(() => ({ storage: { signedFileUrl: vi.fn() } }))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), ...mocks.storage }))

/**
 * jsdom never loads an image: Radix's avatar preloads the photo with `new window.Image()`, so a
 * fake one settles each `src` a tick later: loaded, failed (`BROKEN`) or never (`PENDING`).
 */
const BROKEN = new Set<string>()
const PENDING = new Set<string>()
class FakeImage extends EventTarget {
  complete = false
  naturalWidth = 0
  referrerPolicy = ''
  crossOrigin: string | null = null
  #src = ''
  get src() {
    return this.#src
  }
  set src(value: string) {
    this.#src = value
    if (PENDING.has(value)) return
    setTimeout(() => {
      if (this.#src !== value) return
      if (BROKEN.has(value)) return void this.dispatchEvent(new Event('error'))
      this.complete = true
      this.naturalWidth = 400
      this.dispatchEvent(new Event('load'))
    }, 0)
  }
}

beforeEach(() => vi.stubGlobal('Image', FakeImage))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  BROKEN.clear()
  PENDING.clear()
})

function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{renderWithContexts(ui)}</QueryClientProvider>)
}

const signed = (url: string) => ({ url, expiresAt: '2026-10-09T12:05:00Z' })
const photo = (container: HTMLElement) => container.querySelector('img')

describe('ProfessionalPhotoAvatar', () => {
  it('without a photo: the initials, and nothing is signed', () => {
    const { container } = renderUi(<ProfessionalPhotoAvatar name="Anne Dubé" fileId={null} size="lg" />)
    expect(screen.getByText('AD')).toBeInTheDocument()
    expect(photo(container)).toBeNull()
    expect(mocks.storage.signedFileUrl).not.toHaveBeenCalled()
  })

  it('with a photo: the signed photo replaces the initials once loaded, on the soft background, cropped from the top', async () => {
    mocks.storage.signedFileUrl.mockResolvedValue(signed('https://files.test/photo.png'))
    const { container } = renderUi(<ProfessionalPhotoAvatar name="Anne Dubé" fileId="file-photo" size="lg" />)
    await waitFor(() => expect(photo(container)).not.toBeNull())
    const img = photo(container) as HTMLImageElement
    expect(img).toHaveAttribute('src', 'https://files.test/photo.png')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveClass('h-full', 'w-full', 'object-cover', 'object-top', 'bg-primary-soft')
    expect(screen.queryByText('AD')).not.toBeInTheDocument()
    expect(mocks.storage.signedFileUrl).toHaveBeenCalledTimes(1)
    expect(mocks.storage.signedFileUrl).toHaveBeenCalledWith('file-photo', expect.anything())
  })

  it('while the URL is signed, then while the photo loads: the initials', async () => {
    let resolve: (value: ReturnType<typeof signed>) => void = () => {}
    mocks.storage.signedFileUrl.mockReturnValue(new Promise((r) => (resolve = r)))
    PENDING.add('https://files.test/slow.png')
    const { container } = renderUi(<ProfessionalPhotoAvatar name="Anne Dubé" fileId="file-photo" />)
    expect(screen.getByText('AD')).toBeInTheDocument()
    resolve(signed('https://files.test/slow.png'))
    await waitFor(() => expect(mocks.storage.signedFileUrl).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByText('AD')).toBeInTheDocument()
    expect(photo(container)).toBeNull()
  })

  it('a photo that fails: one new URL (the old one may have expired), then the initials for good', async () => {
    BROKEN.add('https://files.test/one.png')
    BROKEN.add('https://files.test/two.png')
    mocks.storage.signedFileUrl.mockResolvedValueOnce(signed('https://files.test/one.png')).mockResolvedValue(signed('https://files.test/two.png'))
    const { container } = renderUi(<ProfessionalPhotoAvatar name="Anne Dubé" fileId="file-photo" />)
    await waitFor(() => expect(mocks.storage.signedFileUrl).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.storage.signedFileUrl).toHaveBeenCalledTimes(2)
    expect(screen.getByText('AD')).toBeInTheDocument()
    expect(photo(container)).toBeNull()
  })

  it('an expired URL: the new one shows the photo', async () => {
    BROKEN.add('https://files.test/expired.png')
    mocks.storage.signedFileUrl.mockResolvedValueOnce(signed('https://files.test/expired.png')).mockResolvedValue(signed('https://files.test/fresh.png'))
    const { container } = renderUi(<ProfessionalPhotoAvatar name="Anne Dubé" fileId="file-photo" />)
    await waitFor(() => expect(photo(container)).toHaveAttribute('src', 'https://files.test/fresh.png'))
    expect(screen.queryByText('AD')).not.toBeInTheDocument()
  })

  it('a URL that cannot be signed (404, 429): the initials', async () => {
    mocks.storage.signedFileUrl.mockRejectedValue(new Error('not_found'))
    const { container } = renderUi(<ProfessionalPhotoAvatar name="Anne Dubé" fileId="file-photo" />)
    await waitFor(() => expect(mocks.storage.signedFileUrl).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByText('AD')).toBeInTheDocument()
    expect(photo(container)).toBeNull()
  })
})

describe('ProfessionalAvatar', () => {
  it('is decorative: the name is written next to it', () => {
    const { container } = renderUi(<ProfessionalAvatar name="Anne Dubé" url={null} />)
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('AD')
  })
})

describe('RecordHeader avatar', () => {
  it('shows the record\'s photo (photoFileId) in the 48 px avatar', async () => {
    mocks.storage.signedFileUrl.mockResolvedValue(signed('https://files.test/marie.png'))
    const { container } = renderUi(<RecordHeader record={{ ...recordFixture(), photoFileId: 'file-marie' }} onboarding={null} catalog={CATALOG_VIEW} />)
    await waitFor(() => expect(photo(container)).toHaveAttribute('src', 'https://files.test/marie.png'))
    expect(mocks.storage.signedFileUrl).toHaveBeenCalledWith('file-marie', expect.anything())
    expect(photo(container)?.parentElement).toHaveClass('h-12', 'w-12', 'rounded-full')
  })

  it('without a photo: the initials, nothing signed', () => {
    renderUi(<RecordHeader record={recordFixture()} onboarding={null} catalog={CATALOG_VIEW} />)
    expect(screen.getByText('MT')).toBeInTheDocument()
    expect(mocks.storage.signedFileUrl).not.toHaveBeenCalled()
  })
})
