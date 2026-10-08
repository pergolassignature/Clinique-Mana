import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { t } from '@/i18n'
import { useProfessionalsSettings, useSaveProfessionalsSettings } from './use-professionals-settings'
import { professionalsSettingsKeys } from './keys'
import { setupQueryClient } from '../test/query-client'

const mocks = vi.hoisted(() => ({
  api: { fetchProfessionalsSettings: vi.fn(), saveProfessionalsSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/settings', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

afterEach(() => vi.clearAllMocks())

describe('useProfessionalsSettings', () => {
  it('loads the settings', async () => {
    const { wrapper } = setupQueryClient()
    mocks.api.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false })
    const { result } = renderHook(() => useProfessionalsSettings(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ collectSin: false }))
  })
})

describe('useSaveProfessionalsSettings', () => {
  it('writes the effective settings the RPC returns, without a refetch', async () => {
    const { queryClient, wrapper, invalidated } = setupQueryClient()
    mocks.api.saveProfessionalsSettings.mockResolvedValue({ collectSin: true })
    const { result } = renderHook(() => useSaveProfessionalsSettings(), { wrapper })
    result.current.mutate({ collectSin: true })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.saveProfessionalsSettings).toHaveBeenCalledWith({ collectSin: true })
    expect(queryClient.getQueryData(professionalsSettingsKeys.settings())).toEqual({ collectSin: true })
    expect(invalidated()).toEqual([])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved'))
  })
})
