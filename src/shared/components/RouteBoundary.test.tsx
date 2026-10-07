import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { RouteBoundary } from './RouteBoundary'

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

function Data({ fetcher }: { fetcher: () => Promise<string> }) {
  const { data } = useQuery({ queryKey: ['data'], queryFn: fetcher, throwOnError: true })
  return <p>{data ?? '…'}</p>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('RouteBoundary', () => {
  it('Retry resets the failed query so it is fetched again', async () => {
    const fetcher = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('down')).mockResolvedValue('DONNÉES')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RouteBoundary scope="test">
            <Data fetcher={fetcher} />
          </RouteBoundary>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('DONNÉES')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
