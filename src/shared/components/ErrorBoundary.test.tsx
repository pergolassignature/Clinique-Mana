import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom')
  return <p>contenu</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught render errors; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

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

  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: /assets/x.js'],
    ['Firefox', 'error loading dynamically imported module: /assets/x.js'],
    ['Safari', 'Importing a module script failed.'],
    ['webpack-style, other casing', 'loading CHUNK 42 failed'],
  ])('reloads the page on Retry when a lazy chunk failed to load (%s)', async (_browser, message) => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    function ChunkFail(): never {
      throw new TypeError(message)
    }
    render(
      <ErrorBoundary>
        <ChunkFail />
      </ErrorBoundary>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
