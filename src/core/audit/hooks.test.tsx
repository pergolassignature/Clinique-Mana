import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuditEntry, AuditFilters } from './api'
import { auditKeys, useAuditActors, useAuditEntries } from './hooks'

const mocks = vi.hoisted(() => ({ api: { fetchAuditEntries: vi.fn(), fetchAuditActors: vi.fn(), AUDIT_PAGE_SIZE: 3 } }))
vi.mock('./api', () => mocks.api)

afterEach(() => vi.clearAllMocks())

const FILTERS: AuditFilters = { table: null, actor: null, from: null }

const entry = (id: number): AuditEntry => ({
  id,
  created_at: '2026-10-07T18:30:00Z',
  table_name: 'organizations',
  record_id: 'o1',
  action: 'update',
  changed_fields: {},
  actor_id: null,
  actor_name: null,
  actor_role: null,
  source: 'seed',
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, wrapper }
}

describe('useAuditEntries', () => {
  it('loads the newest page, then the page before the last id while pages are full', async () => {
    mocks.api.fetchAuditEntries.mockResolvedValueOnce([entry(9), entry(8), entry(7)]).mockResolvedValueOnce([entry(6)])
    const { wrapper } = setup()
    const { result } = renderHook(() => useAuditEntries(FILTERS), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.fetchAuditEntries).toHaveBeenCalledWith(FILTERS, null)
    expect(result.current.hasNextPage).toBe(true)

    await act(() => result.current.fetchNextPage())
    expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith(FILTERS, 7)
    await waitFor(() => expect(result.current.data?.pages.flat().map((e) => e.id)).toEqual([9, 8, 7, 6]))
    // A short page is the beginning of the journal.
    expect(result.current.hasNextPage).toBe(false)
  })

  it('refetches the loaded pages in turn, each from the last id of the page before, with no gap', async () => {
    mocks.api.fetchAuditEntries.mockResolvedValueOnce([entry(9), entry(8), entry(7)]).mockResolvedValueOnce([entry(6)])
    const { wrapper } = setup()
    const { result } = renderHook(() => useAuditEntries(FILTERS), { wrapper })
    // Reading `data` here makes React Query re-render this hook when it changes (tracked properties).
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))

    // Entry 10 was written meanwhile: the first page now ends at 8, so the second starts before 8.
    mocks.api.fetchAuditEntries.mockClear()
    mocks.api.fetchAuditEntries.mockResolvedValueOnce([entry(10), entry(9), entry(8)]).mockResolvedValueOnce([entry(7), entry(6)])
    await act(() => result.current.refetch())
    expect(mocks.api.fetchAuditEntries.mock.calls).toEqual([
      [FILTERS, null],
      [FILTERS, 8],
    ])
    await waitFor(() => expect(result.current.data?.pages.flat().map((e) => e.id)).toEqual([10, 9, 8, 7, 6]))
  })

  it('is always stale, never refetched on focus, and dropped once unused', async () => {
    mocks.api.fetchAuditEntries.mockResolvedValue([])
    const { wrapper, queryClient } = setup()
    const { result, unmount } = renderHook(() => useAuditEntries(FILTERS), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = queryClient.getQueryCache().find({ queryKey: auditKeys.entries(FILTERS) })!
    expect(result.current.isStale).toBe(true)
    expect(query.observers[0]?.options.refetchOnWindowFocus).toBe(false)
    unmount()
    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: auditKeys.entries(FILTERS) })).toBeUndefined())
  })

  it('keys each filter combination apart, so a new filter starts again from the newest page', async () => {
    mocks.api.fetchAuditEntries.mockResolvedValue([])
    const { wrapper } = setup()
    const { result, rerender } = renderHook(({ filters }) => useAuditEntries(filters), { wrapper, initialProps: { filters: FILTERS } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const taxes = { ...FILTERS, table: 'tax_rates' }
    rerender({ filters: taxes })
    await waitFor(() => expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith(taxes, null))
    expect(auditKeys.entries(taxes)).not.toEqual(auditKeys.entries(FILTERS))
    expect(auditKeys.entries(taxes).slice(0, 1)).toEqual(auditKeys.all)
  })
})

describe('useAuditActors', () => {
  it('lists the actors', async () => {
    mocks.api.fetchAuditActors.mockResolvedValue([{ actor_id: 'a1', actor_name: 'Marie Tremblay' }])
    const { wrapper } = setup()
    const { result } = renderHook(() => useAuditActors(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ actor_id: 'a1', actor_name: 'Marie Tremblay' }]))
  })
})
