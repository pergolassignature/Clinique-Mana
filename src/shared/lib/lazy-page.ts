import { createElement, lazy, useState, type ComponentType, type FunctionComponent } from 'react'

/** A code-split page: a component that loads its chunk on first render, or earlier through `preload()`. */
export type LazyPage = FunctionComponent & {
  /** Starts loading the chunk (once). Resolves when the page can render without suspending. */
  preload: () => Promise<void>
  /** Whether the chunk has loaded, so the page renders synchronously. */
  isLoaded: () => boolean
}

type Module = Record<string, unknown>

/**
 * Like React.lazy, but once the chunk has loaded the page renders synchronously, so a NEW
 * <Suspense> around it never shows its fallback. That matters with React 19: a fallback, once
 * committed, stays on screen for at least 300 ms (FALLBACK_THROTTLE_MS), even when the chunk
 * arrives a few milliseconds later. Preloading (idle prefetch, reload of a deep link) therefore
 * removes the wait entirely.
 *
 * Before the chunk has loaded, the page suspends like React.lazy (it uses one). A failed load is
 * not cached: the next preload() or mount tries again.
 *
 * `exportName` picks a named export: `lazyPage(() => import('./pages/X'), 'XPage')`.
 * Chunks are static code, the same for every user: preloading never reads or renders user data.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>): LazyPage
export function lazyPage<M extends Module, K extends keyof M & string>(
  load: () => Promise<M>,
  exportName: K,
): LazyPage
export function lazyPage(load: () => Promise<Module>, exportName = 'default'): LazyPage {
  let loaded: ComponentType | null = null
  let pending: Promise<ComponentType> | null = null

  const loadComponent = (): Promise<ComponentType> => {
    pending ??= load()
      .then((module) => {
        const component = module[exportName]
        if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
          throw new Error(`lazyPage: the chunk has no component export "${exportName}"`)
        }
        loaded = component as ComponentType
        return loaded
      })
      .catch((error: unknown) => {
        // Not cached: a failed idle prefetch is retried on real navigation.
        pending = null
        throw error
      })
    return pending
  }

  // Used only by an instance that mounts before the chunk has loaded. React.lazy keeps a rejection
  // forever, so a failed load swaps in a fresh one: the next mount (error boundary retry,
  // navigation) loads again.
  const makeLazy = () =>
    lazy(() =>
      loadComponent().then(
        (component) => ({ default: component }),
        (error: unknown) => {
          fallback = makeLazy()
          throw error
        },
      ),
    )
  let fallback = makeLazy()

  function Page() {
    // Fixed for this instance's life: switching from the lazy wrapper to the component on a later
    // render would remount the page and lose its state (an unsaved form).
    const [type] = useState<ComponentType>(() => loaded ?? fallback)
    return createElement(type)
  }
  Page.displayName = `LazyPage(${exportName})`

  return Object.assign(Page, {
    preload: () => loadComponent().then(() => undefined),
    isLoaded: () => loaded !== null,
  })
}

type IdleHandle = { cancel: () => void }

/** Runs `task` when the browser is idle (requestIdleCallback, or a timeout where it is missing). */
export function whenIdle(task: () => void, timeout = 2000): IdleHandle {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout })
    return { cancel: () => window.cancelIdleCallback(id) }
  }
  const id = window.setTimeout(task, 200)
  return { cancel: () => window.clearTimeout(id) }
}

/** Starts preloading pages at idle time; failures are ignored (navigation retries them). */
export function preloadWhenIdle(pages: Iterable<{ preload?: () => Promise<unknown> }>): IdleHandle {
  return whenIdle(() => {
    for (const page of pages) void page.preload?.().catch(() => {})
  })
}
