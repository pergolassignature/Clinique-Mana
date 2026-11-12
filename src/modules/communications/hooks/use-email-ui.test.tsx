import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEmailUiModifyMany, useEmailUiModifyThread } from './use-email-ui'

const mocks = vi.hoisted(() => ({ modifyMailThreads: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/inbox')>()),
  modifyMailThreads: mocks.modifyMailThreads,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const id = (n: number) => `a0000000-0000-0000-0000-${String(n).padStart(12, '0')}`

describe('useEmailUiModifyThread', () => {
  it('runs a row’s action through gmail-modify on MANA’s thread id, and nothing it cannot do', async () => {
    mocks.modifyMailThreads.mockResolvedValue({ changed: 1, failed: [] })
    const { result } = renderHook(() => useEmailUiModifyThread(), { wrapper })
    await act(async () => result.current({ threadId: id(1), connectionId: 'c1', action: 'unarchive' }))
    await act(async () => result.current({ threadId: id(1), connectionId: 'c1', action: 'delete' }))
    await act(async () => result.current({ connectionId: 'c1', action: 'read' }))
    expect(mocks.modifyMailThreads).toHaveBeenCalledTimes(1)
    expect(mocks.modifyMailThreads).toHaveBeenCalledWith([id(1)], { kind: 'inbox' })
  })
})

describe('useEmailUiModifyMany', () => {
  it('one call per action, 50 threads at most, « star » by its row’s id; settles even when one call fails', async () => {
    mocks.modifyMailThreads.mockResolvedValueOnce({ changed: 50, failed: [] }).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ changed: 1, failed: [] })
    const { result } = renderHook(() => useEmailUiModifyMany(), { wrapper })
    const archive = Array.from({ length: 51 }, (_, i) => ({ threadId: id(i + 1), connectionId: 'c1', action: 'archive' as const }))
    await act(() => result.current([...archive, { gmailMessageId: id(99), connectionId: 'c1', action: 'star' }, { threadId: id(1), connectionId: 'c1', action: 'spam' }]))
    expect(mocks.modifyMailThreads).toHaveBeenCalledTimes(3)
    expect(mocks.modifyMailThreads.mock.calls[0]![0]).toHaveLength(50)
    expect(mocks.modifyMailThreads.mock.calls[0]![1]).toEqual({ kind: 'archive' })
    expect(mocks.modifyMailThreads.mock.calls[1]).toEqual([[id(51)], { kind: 'archive' }])
    expect(mocks.modifyMailThreads.mock.calls[2]).toEqual([[id(99)], { kind: 'star' }])
    // The refusal is said by useMailAction's toast, not thrown at the toolbar.
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })
})
