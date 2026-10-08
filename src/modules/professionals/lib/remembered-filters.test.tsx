import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useRef, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, type AccessContextValue } from '@/core/access/access-context'
import { PREFERENCE_WRITE_DELAY, useUserPreference } from '@/core/preferences/hooks'
import { ROUTER_FUTURE } from '@/shared/lib/router-future'
import { testAccess } from '@/test/contexts'
import { DEFAULT_FILTERS } from './filters'
import { fromRememberedFilters, LIST_FILTERS_PREFERENCE, toRememberedFilters, useRememberedProfessionalsFilters } from './remembered-filters'
import { setupQueryClient } from '../test/query-client'
import { IDS } from '../test/fixtures'

const mocks = vi.hoisted(() => ({ fetchUserPreference: vi.fn(), saveUserPreference: vi.fn(), deleteUserPreference: vi.fn(), onSessionUserChange: vi.fn(() => () => {}) }))
vi.mock('@/core/preferences/api', () => mocks)

const access: AccessContextValue = { status: 'ready', access: testAccess, problem: null, can: () => true, reload: () => {}, isReloading: false }

function setup(initial = '') {
  let search = ''
  function Probe() {
    search = useLocation().search
    return null
  }
  const { queryClient } = setupQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AccessContext.Provider value={access}>
        <MemoryRouter initialEntries={[`/professionnels${initial}`]} future={ROUTER_FUTURE}>
          {children}
          <Probe />
        </MemoryRouter>
      </AccessContext.Provider>
    </QueryClientProvider>
  )
  const hook = renderHook(() => useRememberedProfessionalsFilters(), { wrapper })
  return { hook, search: () => search }
}

beforeEach(() => {
  mocks.fetchUserPreference.mockResolvedValue(null)
  mocks.saveUserPreference.mockResolvedValue(undefined)
  mocks.deleteUserPreference.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('toRememberedFilters / fromRememberedFilters', () => {
  it('stores the query string without the page, and reads it back', () => {
    const filters = { ...DEFAULT_FILTERS, q: 'Hélène', status: 'active' as const, motifIds: [IDS.anxiete], page: 3 }
    const value = toRememberedFilters(filters)
    expect(value).toEqual({ query: `q=H%C3%A9l%C3%A8ne&statut=actif&motif=${IDS.anxiete}` })
    expect(fromRememberedFilters(value)).toEqual({ ...filters, page: 1 })
  })

  it('stores nothing when nothing narrows the list', () => {
    expect(toRememberedFilters({ ...DEFAULT_FILTERS, page: 2 })).toBeNull()
    expect(toRememberedFilters({ ...DEFAULT_FILTERS, q: '   ' })).toBeNull()
  })

  it('ignores a missing, malformed or empty value', () => {
    expect(fromRememberedFilters(null)).toBeNull()
    expect(fromRememberedFilters({ query: 42 })).toBeNull()
    expect(fromRememberedFilters({ query: 'statut=inconnu&langue=pas-un-id' })).toBeNull()
  })
})

describe('useRememberedProfessionalsFilters', () => {
  it('restores the saved filters into an empty URL, restoring until they are in it', async () => {
    mocks.fetchUserPreference.mockResolvedValue({ query: 'statut=inactif&nouveaux=1' })
    const { hook, search } = setup()
    expect(hook.result.current.restoring).toBe(true)
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    expect(search()).toBe('?statut=inactif&nouveaux=1')
    expect(hook.result.current.filters).toMatchObject({ status: 'inactive', acceptingNewClients: true })
    expect(mocks.fetchUserPreference).toHaveBeenCalledWith(testAccess.user_id, LIST_FILTERS_PREFERENCE)
    // Restoring is not a choice: nothing is written back.
    expect(mocks.saveUserPreference).not.toHaveBeenCalled()
  })

  it('stops restoring when the person types while the saved filters are being put in the URL', async () => {
    mocks.fetchUserPreference.mockResolvedValue({ query: 'statut=inactif' })
    let search = ''
    function Probe() {
      search = useLocation().search
      return null
    }
    const { queryClient } = setupQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AccessContext.Provider value={access}>
          <MemoryRouter initialEntries={['/professionnels']} future={ROUTER_FUTURE}>
            {children}
            <Probe />
          </MemoryRouter>
        </AccessContext.Provider>
      </QueryClientProvider>
    )
    const hook = renderHook(
      () => {
        const state = useRememberedProfessionalsFilters()
        const read = useUserPreference(LIST_FILTERS_PREFERENCE)
        const typed = useRef(false)
        // Runs in the same commit as the restore (declared after it): a keystroke lands before the
        // restored URL does, so the URL never equals what was restored.
        useEffect(() => {
          if (read.isPending || typed.current) return
          typed.current = true
          state.setFilters({ q: 'mar' })
        })
        return state
      },
      { wrapper },
    )
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    expect(search).toBe('?q=mar&statut=inactif')
    expect(hook.result.current.filters).toMatchObject({ q: 'mar', status: 'inactive' })
  })

  it('leaves a URL that carries filters alone', async () => {
    mocks.fetchUserPreference.mockResolvedValue({ query: 'statut=inactif' })
    const { hook, search } = setup('?statut=actif')
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    expect(search()).toBe('?statut=actif')
  })

  it('goes on without the preference when it cannot be read', async () => {
    mocks.fetchUserPreference.mockRejectedValue(new Error('network'))
    const { hook, search } = setup()
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    expect(search()).toBe('')
  })

  it('saves a chosen filter after the debounce, and forgets the preference on reset', async () => {
    const { hook } = setup()
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    vi.useFakeTimers()
    act(() => {
      hook.result.current.setFilters({ q: 'mar' })
      hook.result.current.setFilters({ q: 'marie' })
    })
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).toHaveBeenCalledExactlyOnceWith(testAccess.user_id, LIST_FILTERS_PREFERENCE, { query: 'q=marie' })
    act(() => hook.result.current.reset())
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.deleteUserPreference).toHaveBeenCalledExactlyOnceWith(testAccess.user_id, LIST_FILTERS_PREFERENCE)
  })

  it('does not save a page change', async () => {
    const { hook } = setup('?statut=actif')
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    vi.useFakeTimers()
    act(() => hook.result.current.setPage(2))
    await act(() => vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DELAY))
    expect(mocks.saveUserPreference).not.toHaveBeenCalled()
  })

  it('keeps nothing in localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { hook } = setup()
    await waitFor(() => expect(hook.result.current.restoring).toBe(false))
    act(() => hook.result.current.setFilters({ status: 'active' }))
    hook.unmount()
    await waitFor(() => expect(mocks.saveUserPreference).toHaveBeenCalled())
    expect(setItem).not.toHaveBeenCalled()
  })
})
