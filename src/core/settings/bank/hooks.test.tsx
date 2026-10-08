import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { bankKeys, REVEAL_DURATION_MS, useBankDetails, useRevealedAccountNumber, useSetBankDetails } from './hooks'

const mocks = vi.hoisted(() => ({
  api: { fetchBankDetails: vi.fn(), revealAccountNumber: vi.fn(), setBankDetails: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('./api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

const DETAILS = {
  institution_number: '815',
  transit_number: '30000',
  account_last4: '4567',
  etransfer_email: null,
  updated_at: '2026-10-07T18:30:00Z',
  updated_by_name: 'Marie Tremblay',
}
const INPUT = { institution: '815', transit: '30000', account: '1234567', etransferEmail: null }

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  return { queryClient, wrapper, invalidate }
}

/** Every value React Query holds (queries and mutations), as one string to search. */
const cacheDump = (queryClient: QueryClient) =>
  JSON.stringify([
    queryClient.getQueryCache().findAll().map((q) => [q.queryKey, q.state.data]),
    queryClient.getMutationCache().findAll().map((m) => [m.state.variables, m.state.data]),
  ])

describe('useBankDetails', () => {
  it('loads the masked details under the bank keys', async () => {
    const { queryClient, wrapper } = setup()
    mocks.api.fetchBankDetails.mockResolvedValue(DETAILS)
    const { result } = renderHook(() => useBankDetails(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(DETAILS))
    expect(queryClient.getQueryData(bankKeys.details())).toBe(DETAILS)
    expect(bankKeys.details().slice(0, bankKeys.all.length)).toEqual(bankKeys.all)
  })
})

describe('useSetBankDetails', () => {
  it('saves, refreshes the details, then confirms with a toast', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.setBankDetails.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSetBankDetails(), { wrapper })
    result.current.mutate(INPUT)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.setBankDetails).toHaveBeenCalledWith(INPUT)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bankKeys.all })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.bank.saved'))
  })

  it('shows a P0001 refusal as is', async () => {
    const { wrapper } = setup()
    mocks.api.setBankDetails.mockRejectedValue({ code: 'P0001', message: 'Le numéro de compte est requis.' })
    const { result } = renderHook(() => useSetBankDetails(), { wrapper })
    result.current.mutate({ ...INPUT, account: null })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.toast.error).toHaveBeenCalledWith('Le numéro de compte est requis.')
  })

  it('does not keep the typed account number in the mutation cache once the form is gone', async () => {
    const { queryClient, wrapper } = setup()
    mocks.api.setBankDetails.mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useSetBankDetails(), { wrapper })
    result.current.mutate(INPUT)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    unmount()
    await waitFor(() => expect(cacheDump(queryClient)).not.toContain('1234567'))
  })
})

describe('useRevealedAccountNumber', () => {
  it('reveals the number in component state only, and hides it', async () => {
    const { queryClient, wrapper } = setup()
    mocks.api.revealAccountNumber.mockResolvedValue('1234567')
    const { result } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    expect(result.current.accountNumber).toBeNull()
    await act(() => result.current.reveal())
    expect(result.current.accountNumber).toBe('1234567')
    expect(mocks.api.revealAccountNumber).toHaveBeenCalledOnce()
    expect(cacheDump(queryClient)).not.toContain('1234567')
    act(() => result.current.hide())
    expect(result.current.accountNumber).toBeNull()
  })

  it('hides the number again after 60 seconds', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    mocks.api.revealAccountNumber.mockResolvedValue('1234567')
    const { result } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    await act(() => result.current.reveal())
    act(() => vi.advanceTimersByTime(REVEAL_DURATION_MS - 1))
    expect(result.current.accountNumber).toBe('1234567')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.accountNumber).toBeNull()
    expect(REVEAL_DURATION_MS).toBe(60_000)
  })

  it('stops the timer on unmount', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    mocks.api.revealAccountNumber.mockResolvedValue('1234567')
    const { result, unmount } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    await act(() => result.current.reveal())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops an answer that arrives after « Masquer »', async () => {
    const { wrapper } = setup()
    let answer: (value: string) => void = () => {}
    mocks.api.revealAccountNumber.mockReturnValue(new Promise<string>((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.reveal()
    })
    expect(result.current.pending).toBe(true)
    act(() => result.current.hide())
    await act(async () => {
      answer('1234567')
      await pending
    })
    expect(result.current.accountNumber).toBeNull()
    expect(result.current.pending).toBe(false)
  })

  it('drops an answer that arrives after unmount (no timer, no toast)', async () => {
    vi.useFakeTimers()
    const { wrapper } = setup()
    let answer: (value: string) => void = () => {}
    mocks.api.revealAccountNumber.mockReturnValue(new Promise<string>((resolve) => (answer = resolve)))
    const { result, unmount } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.reveal()
    })
    unmount()
    answer('1234567')
    await pending
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('hides the number as soon as the tab is hidden', async () => {
    const { wrapper } = setup()
    mocks.api.revealAccountNumber.mockResolvedValue('1234567')
    const { result } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    await act(() => result.current.reveal())
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.accountNumber).toBe('1234567')
    visibility.mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.accountNumber).toBeNull()
    visibility.mockRestore()
  })

  it('shows a refusal in a toast and stays masked', async () => {
    const { wrapper } = setup()
    mocks.api.revealAccountNumber.mockRejectedValue({ code: '42501', message: 'Permission refusée : settings.bank_manage' })
    const { result } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    await act(() => result.current.reveal())
    expect(result.current.accountNumber).toBeNull()
    expect(result.current.pending).toBe(false)
    expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden'))
  })

  it('refreshes the details when nothing is stored any more', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.revealAccountNumber.mockResolvedValue(null)
    const { result } = renderHook(() => useRevealedAccountNumber(), { wrapper })
    await act(() => result.current.reveal())
    expect(result.current.accountNumber).toBeNull()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bankKeys.all })
  })
})
