import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { organizationKeys, useOrganization, useUpdateOrganization } from './hooks'

const mocks = vi.hoisted(() => ({
  api: { fetchOrganization: vi.fn(), updateOrganization: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('./api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const SAVED = { id: 'o1', name: 'Clinique MANA', timezone: 'America/Toronto' }

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  return { queryClient, wrapper, invalidate }
}

describe('useOrganization', () => {
  it('loads the organization under its query key', async () => {
    const { queryClient, wrapper } = setup()
    mocks.api.fetchOrganization.mockResolvedValue(SAVED)
    const { result } = renderHook(() => useOrganization(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(SAVED))
    expect(queryClient.getQueryData(organizationKeys.current())).toBe(SAVED)
  })
})

describe('useUpdateOrganization', () => {
  it('saves, invalidates the organization only, then confirms with the given message', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.updateOrganization.mockResolvedValue(SAVED)

    const { result } = renderHook(() => useUpdateOrganization('Signataire enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { signatory_name: 'Marie Tremblay', signatory_title: null } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.updateOrganization).toHaveBeenCalledWith('o1', { signatory_name: 'Marie Tremblay', signatory_title: null })
    expect(result.current.data).toBe(SAVED)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.all })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: accessKeys.all })
    expect(mocks.toast.success).toHaveBeenCalledWith('Signataire enregistré.')
  })

  it.each([
    ['name', { name: 'Clinique MANA', legal_name: null, neq: null }],
    ['timezone', { timezone: 'America/Halifax' }],
  ])('also invalidates the access payload when %s changes (shell name, clinic timezone)', async (_field, patch) => {
    const { wrapper, invalidate } = setup()
    mocks.api.updateOrganization.mockResolvedValue(SAVED)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
  })

  it('stays pending until the invalidations resolve, and only then confirms', async () => {
    const { queryClient, wrapper } = setup()
    let release: () => void = () => {}
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    mocks.api.updateOrganization.mockResolvedValue(SAVED)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { email: null } })
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled())
    expect(result.current.isPending).toBe(true)
    expect(mocks.toast.success).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.toast.success).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ code: '42501', message: 'no row updated' }, t('common.errors.forbidden')],
    [{ code: '23514', message: 'violates check constraint "organizations_neq_check"' }, t('common.errors.invalidValue')],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, t('common.errors.generic')],
  ])('shows the mapped error (%o) and no success toast', async (error, message) => {
    const { wrapper } = setup()
    mocks.api.updateOrganization.mockRejectedValue(error)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { neq: '123' } })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.toast.error).toHaveBeenCalledWith(message)
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('tags unexpected errors with the settings area in Sentry', async () => {
    const { wrapper } = setup()
    const error = { code: '57014', message: 'canceling statement due to statement timeout' }
    mocks.api.updateOrganization.mockRejectedValue(error)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Laval' } })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.captureException).toHaveBeenCalledWith(error, { tags: { area: 'settings' } })
  })
})
