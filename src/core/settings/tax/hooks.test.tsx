import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { taxRateKeys, useAddTaxRate, useDeleteTaxRate, useTaxRates } from './hooks'

const mocks = vi.hoisted(() => ({
  api: { fetchTaxRates: vi.fn(), addTaxRate: vi.fn(), deleteTaxRate: vi.fn(), taxRateOn: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('./api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.clearAllMocks())

const RATES = [{ id: 'r1', tax: 'gst', rate: 0.05, effective_from: '2008-01-01', effective_to: null, created_at: '2026-10-07T12:00:00Z' }]

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  return { queryClient, wrapper, invalidate }
}

describe('useTaxRates', () => {
  it('loads the rates under the tax-rate keys', async () => {
    const { queryClient, wrapper } = setup()
    mocks.api.fetchTaxRates.mockResolvedValue(RATES)
    const { result } = renderHook(() => useTaxRates(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(RATES))
    expect(queryClient.getQueryData(taxRateKeys.list())).toBe(RATES)
    expect(taxRateKeys.list().slice(0, taxRateKeys.all.length)).toEqual(taxRateKeys.all)
  })
})

describe('useAddTaxRate', () => {
  it('adds the rate, refreshes the rates, then confirms with a toast', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.addTaxRate.mockResolvedValue('new-id')
    const { result } = renderHook(() => useAddTaxRate(), { wrapper })
    result.current.mutate({ tax: 'qst', rate: 0.1, effectiveFrom: '2027-01-01' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.addTaxRate).toHaveBeenCalledWith('qst', 0.1, '2027-01-01')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taxRateKeys.all })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.tax.dialog.added'))
  })

  it('leaves a failure to the dialog (no toast), and still refreshes the rates: another admin may have changed them', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.addTaxRate.mockRejectedValue({ code: 'P0001', message: 'Le nouveau taux doit commencer après le 2013-01-01.' })
    const { result } = renderHook(() => useAddTaxRate(), { wrapper })
    result.current.mutate({ tax: 'qst', rate: 0.1, effectiveFrom: '2012-01-01' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taxRateKeys.all })
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})

describe('useDeleteTaxRate', () => {
  it('deletes the rate, refreshes the rates, then confirms with a toast', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.deleteTaxRate.mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteTaxRate(), { wrapper })
    result.current.mutate('r2')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.deleteTaxRate).toHaveBeenCalledWith('r2')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taxRateKeys.all })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.tax.rates.deleted'))
  })

  it('leaves a failure to the confirm dialog (no toast), and still refreshes the rates', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.deleteTaxRate.mockRejectedValue({ code: 'P0001', message: 'Un taux déjà en vigueur ne peut pas être supprimé.' })
    const { result } = renderHook(() => useDeleteTaxRate(), { wrapper })
    result.current.mutate('r2')
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taxRateKeys.all })
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})
