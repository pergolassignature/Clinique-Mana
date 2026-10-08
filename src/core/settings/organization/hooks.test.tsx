import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
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

  it('keeps the loaded values fresh for a minute, so a background refetch does not reset a form being typed in', async () => {
    const { wrapper } = setup()
    mocks.api.fetchOrganization.mockResolvedValue(SAVED)
    const { result } = renderHook(() => useOrganization(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isStale).toBe(false)
    // A second card mounting (refetchOnMount) does not refetch fresh data.
    renderHook(() => useOrganization(), { wrapper })
    expect(mocks.api.fetchOrganization).toHaveBeenCalledTimes(1)
  })
})

describe('useUpdateOrganization', () => {
  it('puts the saved row in the cache before invalidating', async () => {
    const { queryClient, wrapper, invalidate } = setup()
    mocks.api.updateOrganization.mockResolvedValue(SAVED)
    invalidate.mockImplementation(async () => {
      expect(queryClient.getQueryData(organizationKeys.current())).toBe(SAVED)
    })

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Laval' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['older than the cached row (an earlier save answering last): keeps the cached row', '2026-10-07T12:00:01.5+00:00', '2026-10-07T12:00:01.25+00:00', 'cached'],
    ['newer than the cached row: replaces it', '2026-10-07T12:00:01.25+00:00', '2026-10-07T12:00:01.5+00:00', 'saved'],
    ['as recent as the cached row: replaces it', '2026-10-07T12:00:01.5+00:00', '2026-10-07T12:00:01.5+00:00', 'saved'],
    // Different offsets: the instants decide, where comparing the strings would pick the other row.
    ['an earlier instant written with a later local time (-04:00 vs -05:00): keeps the cached row', '2026-10-07T07:59:00-05:00', '2026-10-07T08:30:00-04:00', 'cached'],
    ['a later instant written with an earlier local time (-05:00 vs -04:00): replaces it', '2026-10-07T08:30:00-04:00', '2026-10-07T07:59:00-05:00', 'saved'],
    // Unparsable values fall back to comparing the strings.
    ['unparsable, older as a string: keeps the cached row', 'version-b', 'version-a', 'cached'],
  ])('saved row %s', async (_case, cachedAt, savedAt, kept) => {
    const { queryClient, wrapper } = setup()
    const cached = { ...SAVED, city: 'Laval', updated_at: cachedAt }
    const saved = { ...SAVED, city: 'Montréal', updated_at: savedAt }
    queryClient.setQueryData(organizationKeys.current(), cached)
    mocks.api.updateOrganization.mockResolvedValue(saved)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Montréal' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(organizationKeys.current())).toEqual(kept === 'cached' ? cached : saved)
  })

  it('caches the saved row when nothing was cached yet', async () => {
    const { queryClient, wrapper } = setup()
    const saved = { ...SAVED, updated_at: '2026-10-07T12:00:00+00:00' }
    mocks.api.updateOrganization.mockResolvedValue(saved)
    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Laval' } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(organizationKeys.current())).toBe(saved)
  })

  it('saves, invalidates the organization only, then confirms with the given message', async () => {
    const { wrapper, invalidate } = setup()
    mocks.api.updateOrganization.mockResolvedValue(SAVED)

    const { result } = renderHook(() => useUpdateOrganization('Signataire enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { signatory_name: 'Marie Tremblay', signatory_title: null } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.updateOrganization).toHaveBeenCalledWith('o1', { signatory_name: 'Marie Tremblay', signatory_title: null })
    expect(result.current.data).toBe(SAVED)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.all, refetchType: 'none' })
    expect(mocks.toast.success).toHaveBeenCalledWith('Signataire enregistré.')
  })

  it('shows the saved row without fetching the organization again', async () => {
    const { wrapper } = setup()
    const before = { ...SAVED, city: 'Montréal' }
    const saved = { ...SAVED, city: 'Laval' }
    mocks.api.fetchOrganization.mockResolvedValue(before)
    mocks.api.updateOrganization.mockResolvedValue(saved)

    const { result } = renderHook(() => ({ query: useOrganization(), mutation: useUpdateOrganization('Enregistré.') }), { wrapper })
    await waitFor(() => expect(result.current.query.data).toBe(before))
    result.current.mutation.mutate({ id: 'o1', patch: { city: 'Laval' } })

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true))
    expect(result.current.query.data).toEqual(saved)
    expect(mocks.api.fetchOrganization).toHaveBeenCalledTimes(1)
  })

  it('still confirms the save when the access refetch that follows fails', async () => {
    const { wrapper } = setup()
    const fetchAccess = vi.fn().mockResolvedValueOnce({ org_name: 'Clinique MANA' }).mockRejectedValue({ code: '', message: 'TypeError: Failed to fetch' })
    mocks.api.updateOrganization.mockResolvedValue(SAVED)

    const { result } = renderHook(
      () => ({
        access: useQuery({ queryKey: accessKeys.me('u1'), queryFn: fetchAccess, retry: false }),
        mutation: useUpdateOrganization('Enregistré.'),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.access.isSuccess).toBe(true))
    result.current.mutation.mutate({ id: 'o1', patch: { name: 'Clinique MANA Laval', legal_name: null, neq: null } })

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true))
    expect(fetchAccess).toHaveBeenCalledTimes(2)
    expect(mocks.toast.success).toHaveBeenCalledWith('Enregistré.')
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('shows the success toast even if the page unmounted meanwhile', async () => {
    const { wrapper } = setup()
    let resolve: (saved: unknown) => void = () => {}
    mocks.api.updateOrganization.mockReturnValue(new Promise((r) => (resolve = r)))

    const { result, unmount } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Laval' } })
    await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenCalled())
    unmount()
    resolve(SAVED)

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Enregistré.'))
  })

  it('shows the error toast even if the page unmounted meanwhile', async () => {
    const { wrapper } = setup()
    let reject: (error: unknown) => void = () => {}
    mocks.api.updateOrganization.mockReturnValue(new Promise((_r, r) => (reject = r)))

    const { result, unmount } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Laval' } })
    await waitFor(() => expect(mocks.api.updateOrganization).toHaveBeenCalled())
    unmount()
    reject({ code: '42501', message: 'no row updated' })

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden')))
    expect(mocks.toast.success).not.toHaveBeenCalled()
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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.all, refetchType: 'none' })
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
    [{ code: '42501', message: 'no row updated' }, t('common.errors.forbidden'), false],
    [{ code: '23514', message: 'violates check constraint "organizations_neq_check"' }, t('common.errors.invalidValue'), true],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, t('common.errors.generic'), true],
  ])('shows the mapped error (%o) and no success toast', async (error, message, reported) => {
    const { wrapper } = setup()
    mocks.api.updateOrganization.mockRejectedValue(error)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { neq: '123' } })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.toast.error).toHaveBeenCalledWith(message)
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.captureException).toHaveBeenCalledTimes(reported ? 1 : 0)
  })

  it('tags unexpected errors with the settings area in Sentry', async () => {
    const { wrapper } = setup()
    const error = { code: '57014', message: 'canceling statement due to statement timeout' }
    mocks.api.updateOrganization.mockRejectedValue(error)

    const { result } = renderHook(() => useUpdateOrganization('Enregistré.'), { wrapper })
    result.current.mutate({ id: 'o1', patch: { city: 'Laval' } })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RpcError 57014', message: error.message }),
      { tags: { area: 'settings', code: '57014' } },
    )
  })
})
