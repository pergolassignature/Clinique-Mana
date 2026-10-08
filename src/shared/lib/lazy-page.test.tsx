import { Component, lazy, Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ModuleRoute } from '@/core/modules/types'
import { ALSO_WAIT_FOR_MAX_MS, lazyPage, preloadWhenIdle, useLazyPageReady, whenIdle, type LazyPage, type Preloadable } from './lazy-page'

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

  it('only accepts, by type, a named export that is a component without props', () => {
    const load = async () => ({ Page, Labelled: ({ label }: { label: string }) => <p>{label}</p>, VERSION: 3 })
    expect(lazyPage(load, 'Page').isLoaded()).toBe(false)
    // @ts-expect-error -- not a component
    lazyPage(load, 'VERSION')
    // @ts-expect-error -- a component that needs props cannot be a page
    lazyPage(load, 'Labelled')
  })

  it('is the only kind of page a manifest takes: a plain React.lazy cannot be preloaded', () => {
    const route: ModuleRoute = { path: 'x', permission: 'x.view', component: lazyPage(async () => ({ default: Page })) }
    // @ts-expect-error -- React.lazy has no preload()/isLoaded()
    const plain: ModuleRoute = { ...route, component: lazy(async () => ({ default: Page })) }
    expect(plain.path).toBe(route.path)
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

  // A slow or stuck page chunk must not hold the whole app on the loading screen.
  it('waits for the second page at most ALSO_WAIT_FOR_MAX_MS, then renders', async () => {
    vi.useFakeTimers()
    const stuck: Preloadable = { preload: () => new Promise<void>(() => {}), isLoaded: () => false }
    const LazyPage = lazyPage(async () => ({ default: Page }))
    await LazyPage.preload()
    render(inSuspense(<Gate page={LazyPage} also={stuck} />))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ALSO_WAIT_FOR_MAX_MS - 1)
    })
    expect(screen.getByRole('status')).toHaveTextContent('WAITING')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('PAGE')).toBeInTheDocument()
    expect(ALSO_WAIT_FOR_MAX_MS).toBe(1000)
  })

  it('still waits for the first page past that cap', async () => {
    vi.useFakeTimers()
    let resolve: (m: { default: typeof Page }) => void = () => {}
    const LazyPage = lazyPage(() => new Promise<{ default: typeof Page }>((r) => (resolve = r)))
    const stuck: Preloadable = { preload: () => new Promise<void>(() => {}), isLoaded: () => false }
    render(inSuspense(<Gate page={LazyPage} also={stuck} />))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * ALSO_WAIT_FOR_MAX_MS)
    })
    expect(screen.getByRole('status')).toHaveTextContent('WAITING')
    await act(async () => resolve({ default: Page }))
    expect(screen.getByText('PAGE')).toBeInTheDocument()
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

const page = (preload = vi.fn(async () => {})): Preloadable & { preload: typeof preload } => ({ preload, isLoaded: () => false })

describe('whenIdle', () => {
  it('asks requestIdleCallback, with the timeout as its deadline', () => {
    const requestIdleCallback = vi.fn(() => 7)
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    const task = vi.fn()
    whenIdle(task, 500)
    expect(requestIdleCallback).toHaveBeenCalledWith(task, { timeout: 500 })
  })

  it('falls back to a short delay without requestIdleCallback', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const task = vi.fn()
    whenIdle(task)
    vi.advanceTimersByTime(199)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
  })

  it('never runs later than the timeout in the fallback either', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const task = vi.fn()
    whenIdle(task, 50)
    vi.advanceTimersByTime(50)
    expect(task).toHaveBeenCalledOnce()
  })

  it('can be cancelled in the fallback', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const task = vi.fn()
    whenIdle(task).cancel()
    vi.advanceTimersByTime(1000)
    expect(task).not.toHaveBeenCalled()
  })
})

describe('preloadWhenIdle', () => {
  /** Stubs requestIdleCallback and returns a function that runs the queued idle task. */
  const stubIdle = () => {
    let idle: IdleRequestCallback = () => {}
    vi.stubGlobal('requestIdleCallback', vi.fn((cb: IdleRequestCallback) => ((idle = cb), 7)))
    return () => idle({ didTimeout: false, timeRemaining: () => 50 })
  }
  const stubConnection = (connection: { saveData?: boolean; effectiveType?: string } | undefined) =>
    vi.spyOn(navigator as Navigator & { connection?: unknown }, 'connection', 'get').mockReturnValue(connection)

  beforeEach(() => {
    // happy-dom has no Network Information API; define it so tests can stub it.
    if (!('connection' in navigator)) {
      Object.defineProperty(navigator, 'connection', { configurable: true, get: () => undefined })
    }
  })

  it('preloads every page when the browser is idle, ignoring failures', () => {
    const runIdle = stubIdle()
    const ok = page()
    const failing = page(vi.fn(() => Promise.reject(new Error('offline'))))
    preloadWhenIdle([ok, failing])
    expect(ok.preload).not.toHaveBeenCalled()
    runIdle()
    expect(ok.preload).toHaveBeenCalledTimes(1)
    expect(failing.preload).toHaveBeenCalledTimes(1)
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
    const p = page()
    preloadWhenIdle([p])
    expect(p.preload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(p.preload).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Data Saver is on', { saveData: true, effectiveType: '4g' }],
    ['the link is 2G', { effectiveType: '2g' }],
    ['the link is slow 2G', { effectiveType: 'slow-2g' }],
  ])('skips the prefetch when %s', (_case, connection) => {
    const runIdle = stubIdle()
    stubConnection(connection)
    const p = page()
    preloadWhenIdle([p])
    runIdle()
    expect(p.preload).not.toHaveBeenCalled()
  })

  it.each([
    ['a fast link', { saveData: false, effectiveType: '4g' }],
    ['a 3G link', { effectiveType: '3g' }],
    ['no Network Information API (Firefox, Safari)', undefined],
  ])('prefetches on %s', (_case, connection) => {
    const runIdle = stubIdle()
    stubConnection(connection)
    const p = page()
    preloadWhenIdle([p])
    runIdle()
    expect(p.preload).toHaveBeenCalledOnce()
  })

  it('reads the connection when idle, not when scheduled', () => {
    const runIdle = stubIdle()
    const connection = stubConnection({ effectiveType: '4g' })
    const p = page()
    preloadWhenIdle([p])
    connection.mockReturnValue({ saveData: true })
    runIdle()
    expect(p.preload).not.toHaveBeenCalled()
  })
})
