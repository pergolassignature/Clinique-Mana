import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithContexts } from '@/test/contexts'
import { CATALOG_VIEW, listRowFixture } from '../../test/fixtures-domain'
import { ProfessionalsTable } from './ProfessionalsTable'

const mocks = vi.hoisted(() => ({ storage: { signedFileUrls: vi.fn(), signedFileUrl: vi.fn() } }))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/storage/api')>()), ...mocks.storage }))

/** jsdom never loads an image: Radix preloads the photo with `new window.Image()`; this one loads each `src` a tick later, or fails it (`BROKEN`). */
const BROKEN = new Set<string>()
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
    setTimeout(() => {
      if (this.#src !== value) return
      if (BROKEN.has(value)) return void this.dispatchEvent(new Event('error'))
      this.complete = true
      this.naturalWidth = 400
      this.dispatchEvent(new Event('load'))
    }, 0)
  }
}

/** An IntersectionObserver the test drives: `show(id)` brings that row into view. */
const observed = new Map<Element, FakeObserver>()
class FakeObserver {
  constructor(readonly callback: IntersectionObserverCallback) {}
  observe(element: Element) {
    observed.set(element, this)
  }
  unobserve(element: Element) {
    observed.delete(element)
  }
  disconnect() {
    for (const [element, owner] of observed) if (owner === this) observed.delete(element)
  }
}
function show(name: string) {
  const row = screen.getByRole('link', { name }).closest('[role=row]') as Element
  const owner = observed.get(row)
  owner?.callback([{ target: row, isIntersecting: true } as unknown as IntersectionObserverEntry], owner as unknown as IntersectionObserver)
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  BROKEN.clear()
  observed.clear()
})

const FILE = (n: number) => `00000000-0000-4000-8000-0000000f${String(n).padStart(4, '0')}`
const ROW = (n: number) => `00000000-0000-4000-8000-0000000a${String(n).padStart(4, '0')}`
const urlOf = (file: string, n = 1) => `https://x.test/object/sign/${file}?token=${n}`
const rows = [
  listRowFixture({ id: ROW(1), firstName: 'Ana', lastName: 'Avec', photoFileId: FILE(1) }),
  listRowFixture({ id: ROW(2), firstName: 'Bea', lastName: 'Bis', photoFileId: FILE(2) }),
  listRowFixture({ id: ROW(3), firstName: 'Cleo', lastName: 'Sans', photoFileId: null }),
  listRowFixture({ id: ROW(4), firstName: 'Dina', lastName: 'Plus', photoFileId: FILE(4) }),
]

/** storage-sign's batch: every file readable but those in `hidden`. */
const answer =
  (hidden: string[] = [], n = 1) =>
  (ids: readonly string[]) =>
    Promise.resolve({ urls: new Map(ids.filter((id) => !hidden.includes(id)).map((id) => [id, urlOf(id, n)])), expiresAt: '2026-10-09T12:05:00Z' })

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{renderWithContexts(<ProfessionalsTable rows={rows} catalog={CATALOG_VIEW} onPrefetch={() => {}} />)}</QueryClientProvider>)
}

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('[role=row]') as HTMLElement
const imageOf = (name: string) => rowOf(name).querySelector('img')

describe('ProfessionalsTable — photos', () => {
  it('signs only the rows in view, in one batch per arrival, never the same file twice; initials otherwise', async () => {
    mocks.storage.signedFileUrls.mockImplementation(answer())
    renderTable()
    // Nothing in view yet: initials, nothing signed.
    expect(within(rowOf('Ana Avec')).getByText('AA')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(mocks.storage.signedFileUrls).not.toHaveBeenCalled()

    act(() => {
      show('Ana Avec')
      show('Bea Bis')
      show('Cleo Sans')
    })
    await waitFor(() => expect(imageOf('Ana Avec')).toHaveAttribute('src', urlOf(FILE(1))))
    expect(imageOf('Bea Bis')).toHaveAttribute('src', urlOf(FILE(2)))
    expect(imageOf('Cleo Sans')).toBeNull()
    expect(within(rowOf('Cleo Sans')).getByText('CS')).toBeInTheDocument()
    expect(imageOf('Dina Plus')).toBeNull()
    expect(mocks.storage.signedFileUrls).toHaveBeenCalledExactlyOnceWith([FILE(1), FILE(2)], { signal: expect.any(AbortSignal), variant: 'avatar' })

    act(() => show('Dina Plus'))
    await waitFor(() => expect(imageOf('Dina Plus')).toHaveAttribute('src', urlOf(FILE(4))))
    expect(mocks.storage.signedFileUrls.mock.calls.map(([ids]) => ids)).toEqual([[FILE(1), FILE(2)], [FILE(4)]])
    // Never one call per row.
    expect(mocks.storage.signedFileUrl).not.toHaveBeenCalled()
  })

  it('a photo the caller cannot read keeps the initials', async () => {
    mocks.storage.signedFileUrls.mockImplementation(answer([FILE(2)]))
    renderTable()
    act(() => {
      show('Ana Avec')
      show('Bea Bis')
    })
    await waitFor(() => expect(imageOf('Ana Avec')).not.toBeNull())
    expect(imageOf('Bea Bis')).toBeNull()
    expect(within(rowOf('Bea Bis')).getByText('BB')).toBeInTheDocument()
  })

  it('an expired URL is replaced once', async () => {
    BROKEN.add(urlOf(FILE(1)))
    mocks.storage.signedFileUrls.mockImplementationOnce(answer()).mockImplementation(answer([], 2))
    renderTable()
    act(() => show('Ana Avec'))
    await waitFor(() => expect(imageOf('Ana Avec')).toHaveAttribute('src', urlOf(FILE(1), 2)))
    expect(mocks.storage.signedFileUrls).toHaveBeenCalledTimes(2)
  })

  it('a photo that fails again keeps the initials, and is not signed in a loop', async () => {
    BROKEN.add(urlOf(FILE(1)))
    BROKEN.add(urlOf(FILE(1), 2))
    mocks.storage.signedFileUrls.mockImplementationOnce(answer()).mockImplementation(answer([], 2))
    renderTable()
    act(() => show('Ana Avec'))
    await waitFor(() => expect(mocks.storage.signedFileUrls).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(imageOf('Ana Avec')).toBeNull()
    expect(within(rowOf('Ana Avec')).getByText('AA')).toBeInTheDocument()
    expect(mocks.storage.signedFileUrls).toHaveBeenCalledTimes(2)
  })

  it('without IntersectionObserver every row counts as in view', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    mocks.storage.signedFileUrls.mockImplementation(answer())
    renderTable()
    await waitFor(() => expect(imageOf('Dina Plus')).not.toBeNull())
    expect(mocks.storage.signedFileUrls).toHaveBeenCalledExactlyOnceWith([FILE(1), FILE(2), FILE(4)], { signal: expect.any(AbortSignal), variant: 'avatar' })
  })
})
