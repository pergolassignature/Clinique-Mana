import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useProfessionalsList, useProfessionalsPages } from './use-professionals-list'
import { professionalKeys } from './keys'
import { listRowFixture } from '../test/fixtures-domain'
import { setupQueryClient } from '../test/query-client'

const mocks = vi.hoisted(() => ({ fetchProfessionalsList: vi.fn(), fetchProfessionalsPage: vi.fn() }))
vi.mock('../api/list', () => ({ ...mocks, PROFESSIONALS_PAGE_SIZE: 2 }))

afterEach(() => vi.clearAllMocks())

describe('useProfessionalsList', () => {
  it('loads the whole list under list()', async () => {
    const { queryClient, wrapper } = setupQueryClient()
    const data = { rows: [listRowFixture()], truncated: false }
    mocks.fetchProfessionalsList.mockResolvedValue(data)
    const { result } = renderHook(() => useProfessionalsList(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(data))
    expect(queryClient.getQueryData(professionalKeys.list())).toBe(data)
  })
})

describe('useProfessionalsPages', () => {
  it('pages after the last row while pages are full', async () => {
    const { wrapper } = setupQueryClient()
    const [a, b, c] = [listRowFixture({ id: 'a' }), listRowFixture({ id: 'b' }), listRowFixture({ id: 'c' })]
    mocks.fetchProfessionalsPage.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([c])
    const query = { sort: 'name' as const, statuses: ['active' as const] }
    const { result } = renderHook(() => useProfessionalsPages(query), { wrapper })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    expect(mocks.fetchProfessionalsPage).toHaveBeenCalledWith(query, null)
    await act(() => result.current.fetchNextPage())
    expect(mocks.fetchProfessionalsPage).toHaveBeenLastCalledWith(query, b)
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    expect(result.current.data?.pages.flat().map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})
