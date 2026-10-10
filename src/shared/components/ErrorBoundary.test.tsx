import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { registerUnsavedChangesCheck } from '@/shared/lib/unsaved-changes-registry'
import { UnsavedChangesProvider } from './UnsavedChangesProvider'
import { ErrorBoundary } from './ErrorBoundary'

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => sentry)

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom')
  return <p>contenu</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught render errors; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    sentry.captureException.mockClear()
  })

  it('shows the fallback when a child throws', () => {
    render(
      <ErrorBoundary resetKey="/a">
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Cette section a rencontré un problème')
    expect(screen.queryByText('contenu')).not.toBeInTheDocument()
  })

  it('recovers when resetKey changes (e.g. navigation) and calls onReset', () => {
    const onReset = vi.fn()
    const { rerender } = render(
      <ErrorBoundary resetKey="/a" onReset={onReset}>
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="/b" onReset={onReset}>
        <Boom explode={false} />
      </ErrorBoundary>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('contenu')).toBeInTheDocument()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('calls onReset and re-renders children on Retry', async () => {
    const onReset = vi.fn()
    let explode = true
    function Flaky() {
      return <Boom explode={explode} />
    }
    render(
      <ErrorBoundary onReset={onReset}>
        <Flaky />
      </ErrorBoundary>,
    )
    explode = false
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onReset).toHaveBeenCalledOnce()
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('says the whole app hit a problem at the root, not that the rest still works', () => {
    render(
      <ErrorBoundary root>
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(t('common.appError.title'))
    expect(screen.getByRole('alert')).not.toHaveTextContent('fonctionne toujours')
    expect(screen.getByRole('button', { name: t('common.retry') })).toBeInTheDocument()
  })

  it('reports a crash to Sentry with its scope', () => {
    render(
      <ErrorBoundary scope="professionals">
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), expect.objectContaining({ tags: { scope: 'professionals' } }))
  })
})

describe('ErrorBoundary — a chunk that fails to load (a deploy since the tab opened)', () => {
  let reload: ReturnType<typeof vi.fn<() => void>>
  let unregister: (() => void) | undefined

  function ChunkFail(): never {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/X-abc.js')
  }
  const renderChunkFailure = (props: { compact?: boolean; headingLevel?: 1 | 2 } = {}) =>
    render(
      <ErrorBoundary {...props}>
        <ChunkFail />
      </ErrorBoundary>,
    )

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reload = vi.fn<() => void>()
    vi.spyOn(window.location, 'reload').mockImplementation(reload)
  })
  afterEach(() => {
    unregister?.()
    unregister = undefined
    sessionStorage.clear()
    vi.restoreAllMocks()
    sentry.captureException.mockClear()
  })

  it('reloads to the new version at once, showing a loading state meanwhile', () => {
    renderChunkFailure()
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is not reported to Sentry', () => {
    renderChunkFailure()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('does not reload over unsaved edits: it offers « Recharger » instead', async () => {
    unregister = registerUnsavedChangesCheck(() => true)
    renderChunkFailure({ compact: true })
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(t('common.appUpdate.title'))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(t('common.appUpdate.title'))
    // The user's own reload; the unsaved-changes guard's beforeunload prompt still asks.
    await userEvent.click(screen.getByRole('button', { name: t('common.appUpdate.reload') }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('headingLevel overrides the compact h2 (a settings section is the page\'s only title, decision UI-4)', () => {
    unregister = registerUnsavedChangesCheck(() => true)
    renderChunkFailure({ compact: true, headingLevel: 1 })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t('common.appUpdate.title'))
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  function DirtyForm() {
    useUnsavedChanges(true)
    return <p>FORMULAIRE</p>
  }

  it('keeps a dirty form that is still on screen: no reload when the failure is beside it', () => {
    const page = (failure: boolean) => (
      <UnsavedChangesProvider>
        <DirtyForm />
        <ErrorBoundary compact>{failure && <ChunkFail />}</ErrorBoundary>
      </UnsavedChangesProvider>
    )
    // The form was edited first; then, say, a sheet beside it needs a chunk that is gone.
    const { rerender } = render(page(false))
    rerender(page(true))
    expect(screen.getByText('FORMULAIRE')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: t('common.appUpdate.reload') })).toBeInTheDocument()
  })

  it('reloads when the failure took the dirty forms down with it (the app-level boundary)', () => {
    const app = (failure: boolean) => (
      <ErrorBoundary root>
        <UnsavedChangesProvider>
          <DirtyForm />
          {failure && <ChunkFail />}
        </UnsavedChangesProvider>
      </ErrorBoundary>
    )
    const { rerender } = render(app(false))
    rerender(app(true))
    // Those edits are gone with the tree: nothing left for a reload to lose.
    expect(reload).toHaveBeenCalledOnce()
  })

  it('offers « Recharger » once 3 automatic reloads have not helped', () => {
    for (let i = 0; i < 3; i++) renderChunkFailure().unmount()
    expect(reload).toHaveBeenCalledTimes(3)
    renderChunkFailure()
    expect(reload).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: t('common.appUpdate.reload') })).toBeInTheDocument()
  })

  it.each([
    ['Firefox', 'error loading dynamically imported module: /assets/x.js'],
    ['Safari', 'Importing a module script failed.'],
    ["Vite's CSS preload", 'Unable to preload CSS for /assets/x.css'],
  ])('recognises the %s message', (_source, message) => {
    function Fail(): never {
      throw new TypeError(message)
    }
    render(
      <ErrorBoundary>
        <Fail />
      </ErrorBoundary>,
    )
    expect(reload).toHaveBeenCalledOnce()
  })
})
