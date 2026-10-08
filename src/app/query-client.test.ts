import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessKeys } from '@/core/access/access-context'
import { ACCESS_REFRESH_BURST_MS, createQueryClient, isPermissionRefusal } from './query-client'

const REFUSED = { code: '42501', message: 'permission denied' }
const NETWORK = new TypeError('Failed to fetch')

/** Runs one query of `key` that always fails with `error`; resolves with how often it ran. */
async function failingQuery(queryClient: ReturnType<typeof createQueryClient>, key: readonly unknown[], error: unknown) {
  const queryFn = vi.fn(() => Promise.reject(error))
  await queryClient.fetchQuery({ queryKey: key, queryFn, retryDelay: 0 }).catch(() => {})
  return queryFn.mock.calls.length
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('createQueryClient', () => {
  it('retries a failed query once, but never a 42501', async () => {
    const queryClient = createQueryClient()
    expect(await failingQuery(queryClient, ['a'], NETWORK)).toBe(2)
    expect(await failingQuery(queryClient, ['b'], { code: 'P0001', message: 'Refusé.' })).toBe(2)
    expect(await failingQuery(queryClient, ['c'], REFUSED)).toBe(1)
  })

  it('refetches the access once per burst of 42501s, again after the burst', async () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await Promise.all([failingQuery(queryClient, ['a'], REFUSED), failingQuery(queryClient, ['b'], REFUSED), failingQuery(queryClient, ['c'], REFUSED)])
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: accessKeys.all })

    vi.setSystemTime(Date.now() + ACCESS_REFRESH_BURST_MS)
    await failingQuery(queryClient, ['d'], REFUSED)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('leaves other failures and the access query’s own refusal alone', async () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await failingQuery(queryClient, ['a'], NETWORK)
    await failingQuery(queryClient, accessKeys.me('u1'), REFUSED)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('isPermissionRefusal', () => {
  it('reads the SQLSTATE only', () => {
    expect(isPermissionRefusal(REFUSED)).toBe(true)
    expect(isPermissionRefusal(Object.assign(new Error('x'), { code: '42501' }))).toBe(true)
    expect(isPermissionRefusal({ code: 'PGRST301' })).toBe(false)
    expect(isPermissionRefusal('42501')).toBe(false)
    expect(isPermissionRefusal(null)).toBe(false)
  })
})
