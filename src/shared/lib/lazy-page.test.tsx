import { Component, Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { lazyPage, preloadWhenIdle, useLazyPageReady, type LazyPage } from './lazy-page'

const Page = () => <p>PAGE</p>

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children
  }
}

const inSuspense = (ui: ReactNode) => (
  <Boundary>
    <Suspense fallback={<p role="status">LOADING</p>}>{ui}</Suspense>
  </Boundary>
)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('lazyPage', () => {
  it('suspends until its chunk has loaded on first render', async () => {
    const LazyPage = lazyPage(async () => ({ default: Page }))
    render(inSuspense(<LazyPage />))
    expect(screen.getByRole('status')).toHaveTextContent('LOADING')
    expect(await screen.findByText('PAGE')).toBeInTheDocument()
  })

  it('renders synchronously, with no fallback, once preloaded', async () => {
    const LazyPage = lazyPage(async () => ({ default: Page }))
    expect(LazyPage.isLoaded()).toBe(false)
    await LazyPage.preload()
    expect(LazyPage.isLoaded()).toBe(true)
    render(inSuspense(<LazyPage />))
    // Same tick as render: no Suspense fallback was ever committed.
    expect(screen.getByText('PAGE')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('loads the chunk once, however often it is preloaded or rendered', async () => {
    const load = vi.fn(async () => ({ default: Page }))
    const LazyPage = lazyPage(load)
    await Promise.all([LazyPage.preload(), LazyPage.preload()])
    render(inSuspense(<><LazyPage /><LazyPage /></>))
    await LazyPage.preload()
    expect(screen.getAllByText('PAGE')).toHaveLength(2)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('picks a named export', async () => {
    const LazyPage = lazyPage(async () => ({ SettingsPage: Page, other: 1 }), 'SettingsPage')
    render(inSuspense(<LazyPage />))
    expect(await screen.findByText('PAGE')).toBeInTheDocument()
  })

  it('fails clearly when the chunk lacks the export', async () => {
    const LazyPage = lazyPage(async () => ({ Other: Page }), 'Missing' as 'Other')
    await expect(LazyPage.preload()).rejects.toThrow('no component export "Missing"')
  })

  it('does not cache a failed preload: the next attempt loads again', async () => {
    const load = vi
      .fn<() => Promise<{ default: typeof Page }>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: Page })
    const LazyPage = lazyPage(load)
    await expect(LazyPage.preload()).rejects.toThrow('Failed to fetch')
    expect(LazyPage.isLoaded()).toBe(false)
    // Navigation after a failed idle prefetch: the page loads and renders.
    render(inSuspense(<LazyPage />))
    expect(await screen.findByText('PAGE')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('sends a failed render-time load to the error boundary, and loads again on remount', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn<() => Promise<{ default: typeof Page }>>().mockRejectedValue(new Error('chunk failed'))
    const LazyPage = lazyPage(load)
    const { unmount } = render(inSuspense(<LazyPage />))
    expect(await screen.findByRole('alert')).toHaveTextContent('chunk failed')
    unmount()
    // Back online: the error boundary's retry (or a navigation) mounts the page again.
    load.mockResolvedValue({ default: Page })
    render(inSuspense(<LazyPage />))
    expect(await screen.findByText('PAGE')).toBeInTheDocument()
  })

  it('keeps the same component for a mounted page once its chunk loads (no remount, state kept)', async () => {
    const { useState } = await import('react')
    function Counter() {
      const [n, setN] = useState(0)
      return <button onClick={() => setN(n + 1)}>{n}</button>
    }
    const LazyPage = lazyPage(async () => ({ default: Counter }))
    const { rerender } = render(inSuspense(<LazyPage />))
    const button = await screen.findByRole('button')
    button.click()
    expect(await screen.findByRole('button', { name: '1' })).toBe(button)
    rerender(inSuspense(<LazyPage />))
    expect(screen.getByRole('button', { name: '1' })).toBe(button)
  })
})

describe('useLazyPageReady', () => {
  // Like App's SignedInApp: its own loading screen, no Suspense (no 300 ms fallback hold).
  function Gate({ page: Page, also }: { page: LazyPage; also?: Parameters<typeof useLazyPageReady>[1] }) {
    return useLazyPageReady(Page, also) ? <Page /> : <p role="status">WAITING</p>
  }

  it('shows the caller\'s loading screen, then the page, without suspending', async () => {
    let resolve: (m: { default: typeof Page }) => void = () => {}
    const LazyPage = lazyPage(() => new Promise<{ default: typeof Page }>((r) => (resolve = r)))
    render(inSuspense(<Gate page={LazyPage} />))
    expect(screen.getByRole('status')).toHaveTextContent('WAITING')
    resolve({ default: Page })
    expect(await screen.findByText('PAGE')).toBeInTheDocument()
  })

  it('also waits for a second page, ignoring its failure', async () => {
    let resolveInner: () => void = () => {}
    const inner = { preload: vi.fn(() => new Promise<void>((r) => (resolveInner = r))), isLoaded: () => false }
    const LazyPage = lazyPage(async () => ({ default: Page }))
    await LazyPage.preload()
    render(inSuspense(<Gate page={LazyPage} also={inner} />))
    expect(screen.getByRole('status')).toHaveTextContent('WAITING')
    resolveInner()
    expect(await screen.findByText('PAGE')).toBeInTheDocument()

    const failing = { preload: () => Promise.reject(new Error('offline')), isLoaded: () => false }
    render(inSuspense(<Gate page={LazyPage} also={failing} />))
    await waitFor(() => expect(screen.getAllByText('PAGE')).toHaveLength(2))
  })

  it('renders at once when already loaded', async () => {
    const LazyPage = lazyPage(async () => ({ default: Page }))
    await LazyPage.preload()
    render(inSuspense(<Gate page={LazyPage} />))
    expect(screen.getByText('PAGE')).toBeInTheDocument()
  })

  it('sends a failed load to the error boundary, and loads again on remount', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn<() => Promise<{ default: typeof Page }>>().mockRejectedValue(new Error('chunk failed'))
    const LazyPage = lazyPage(load)
    const { unmount } = render(inSuspense(<Gate page={LazyPage} />))
    expect(await screen.findByRole('alert')).toHaveTextContent('chunk failed')
    unmount()
    load.mockResolvedValue({ default: Page })
    render(inSuspense(<Gate page={LazyPage} />))
    expect(await screen.findByText('PAGE')).toBeInTheDocument()
  })
})

describe('preloadWhenIdle', () => {
  it('preloads every page when the browser is idle, ignoring failures', () => {
    let idle: IdleRequestCallback = () => {}
    vi.stubGlobal('requestIdleCallback', vi.fn((cb: IdleRequestCallback) => ((idle = cb), 7)))
    const ok = vi.fn(async () => {})
    const failing = vi.fn(() => Promise.reject(new Error('offline')))
    preloadWhenIdle([{ preload: ok }, { preload: failing }, {}])
    expect(ok).not.toHaveBeenCalled()
    idle({ didTimeout: false, timeRemaining: () => 50 })
    expect(ok).toHaveBeenCalledTimes(1)
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('can be cancelled before the browser is idle', () => {
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 7))
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)
    preloadWhenIdle([]).cancel()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it('falls back to a timeout without requestIdleCallback', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const preload = vi.fn(async () => {})
    preloadWhenIdle([{ preload }])
    expect(preload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(preload).toHaveBeenCalledTimes(1)
  })
})
