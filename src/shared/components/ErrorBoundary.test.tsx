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

  it('recovers when resetKey changes (e.g. navigation)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom explode={false} />
      </ErrorBoundary>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('contenu')).toBeInTheDocument()
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

  it('reloads the page on Retry when a lazy chunk failed to load', async () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    function ChunkFail(): never {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/x.js')
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
