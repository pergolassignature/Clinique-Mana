import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { CATALOG_STALE_TIME, useProfessionalsCatalog, useReferenceUsage } from './use-catalog'
import { professionalCatalogKeys } from './keys'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { setupQueryClient } from '../test/query-client'

const mocks = vi.hoisted(() => ({ fetchProfessionalsCatalog: vi.fn(), fetchReferenceUsage: vi.fn() }))
vi.mock('../api/catalog', () => mocks)

afterEach(() => vi.clearAllMocks())

describe('useProfessionalsCatalog', () => {
  it('caches the raw catalogue for five minutes and selects the lookups', async () => {
    const { queryClient, wrapper } = setupQueryClient()
    mocks.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
    const { result } = renderHook(() => useProfessionalsCatalog(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(professionalCatalogKeys.catalog())).toBe(CATALOG)
    expect(result.current.data?.byId.motifs.get(IDS.anxiete)?.name).toBe('Anxiété')
    expect(result.current.data?.motifGroups.at(-1)?.key).toBe('autres')
    expect(queryClient.getQueryCache().find({ queryKey: professionalCatalogKeys.catalog() })?.options).toMatchObject({ staleTime: CATALOG_STALE_TIME })
    expect(CATALOG_STALE_TIME).toBe(5 * 60_000)
  })

  it('builds the lookups once per payload, not per render', async () => {
    const { wrapper } = setupQueryClient()
    mocks.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
    const { result, rerender } = renderHook(() => useProfessionalsCatalog(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const first = result.current.data
    rerender()
    expect(result.current.data).toBe(first)
  })

  it('is shared by every caller: one request', async () => {
    const { wrapper } = setupQueryClient()
    mocks.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
    const { result } = renderHook(() => [useProfessionalsCatalog(), useProfessionalsCatalog()], { wrapper })
    await waitFor(() => expect(result.current[1]?.isSuccess).toBe(true))
    expect(mocks.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
  })
})

describe('useReferenceUsage', () => {
  it('loads the counts when enabled', async () => {
    const { wrapper } = setupQueryClient()
    const usage = new Map([['motifs:x', 2]])
    mocks.fetchReferenceUsage.mockResolvedValue(usage)
    const { result } = renderHook(() => useReferenceUsage(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(usage))
  })

  it('waits while disabled (a caller without the permission)', () => {
    const { wrapper } = setupQueryClient()
    renderHook(() => useReferenceUsage({ enabled: false }), { wrapper })
    expect(mocks.fetchReferenceUsage).not.toHaveBeenCalled()
  })
})
