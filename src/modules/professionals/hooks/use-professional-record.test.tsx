import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  prefetchProfessionalHistory,
  prefetchProfessionalRecord,
  useProfessionalHistory,
  useProfessionalRecord,
} from './use-professional-record'
import { professionalKeys } from './keys'
import { recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { setupQueryClient } from '../test/query-client'
import type { HistoryEntry } from '../api/parse'

const mocks = vi.hoisted(() => ({ fetchProfessionalRecord: vi.fn(), fetchProfessionalHistory: vi.fn() }))
vi.mock('../api/record', () => ({ fetchProfessionalRecord: mocks.fetchProfessionalRecord }))
vi.mock('../api/history', () => ({ fetchProfessionalHistory: mocks.fetchProfessionalHistory, PROFESSIONAL_HISTORY_PAGE_SIZE: 2 }))

afterEach(() => vi.clearAllMocks())

const ID = IDS.professional
const entry = (id: number): HistoryEntry => ({
  id,
  createdAt: '2026-10-08T12:00:00Z',
  tableName: 'professionals',
  recordId: ID,
  action: 'update',
  changedFields: null,
  actorId: null,
  actorName: null,
  actorRole: null,
  source: 'app',
})

describe('useProfessionalRecord', () => {
  it('loads the record under record(id)', async () => {
    const { queryClient, wrapper } = setupQueryClient()
    const record = recordFixture()
    mocks.fetchProfessionalRecord.mockResolvedValue(record)
    const { result } = renderHook(() => useProfessionalRecord(ID), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(record))
    expect(mocks.fetchProfessionalRecord).toHaveBeenCalledWith(ID)
    expect(queryClient.getQueryData(professionalKeys.record(ID))).toBe(record)
  })

  it('resolves null for a record the caller cannot read', async () => {
    const { wrapper } = setupQueryClient()
    mocks.fetchProfessionalRecord.mockResolvedValue(null)
    const { result } = renderHook(() => useProfessionalRecord(ID), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('waits without an id', () => {
    const { wrapper } = setupQueryClient()
    renderHook(() => useProfessionalRecord(''), { wrapper })
    expect(mocks.fetchProfessionalRecord).not.toHaveBeenCalled()
  })
})

describe('prefetchProfessionalRecord', () => {
  it('fills the cache once (list-row hover)', async () => {
    const { queryClient } = setupQueryClient({ appDefaults: true })
    const record = recordFixture()
    mocks.fetchProfessionalRecord.mockResolvedValue(record)
    await prefetchProfessionalRecord(queryClient, ID)
    await prefetchProfessionalRecord(queryClient, ID)
    expect(queryClient.getQueryData(professionalKeys.record(ID))).toBe(record)
    expect(mocks.fetchProfessionalRecord).toHaveBeenCalledTimes(1)
  })
})

describe('useProfessionalHistory', () => {
  it('pages before the last id while pages are full', async () => {
    const { wrapper } = setupQueryClient()
    mocks.fetchProfessionalHistory.mockResolvedValueOnce([entry(9), entry(8)]).mockResolvedValueOnce([entry(7)])
    const { result } = renderHook(() => useProfessionalHistory(ID), { wrapper })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    expect(mocks.fetchProfessionalHistory).toHaveBeenCalledWith(ID, undefined)
    await act(() => result.current.fetchNextPage())
    expect(mocks.fetchProfessionalHistory).toHaveBeenLastCalledWith(ID, 8)
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
  })

  it('is prefetched on tab hover, then read from the cache', async () => {
    const { queryClient, wrapper } = setupQueryClient()
    mocks.fetchProfessionalHistory.mockResolvedValue([entry(1)])
    await prefetchProfessionalHistory(queryClient, ID)
    const { result } = renderHook(() => useProfessionalHistory(ID), { wrapper })
    expect(result.current.data?.pages).toEqual([[entry(1)]])
    expect(mocks.fetchProfessionalHistory).toHaveBeenCalledTimes(1)
  })
})
