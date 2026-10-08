import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { ZodError } from 'zod'
import { AuthContext, type AuthContextValue } from '@/core/auth/auth-context'
import { getClinicTimezone, resetClinicTimezone } from '@/shared/lib/timezone'
import { AccessProvider } from './AccessProvider'
import { accessKeys, useAccess } from './access-context'
import type { Access } from './access'

const fetchMyAccess = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ fetchMyAccess }))
// Auth events, as auth-js reports them before React re-renders: `authEvent(id)` plays one.
const authListeners = vi.hoisted(() => new Set<(userId: string | null) => void>())
vi.mock('@/core/auth/session-events', () => ({
  onSessionUserChange: (listener: (userId: string | null) => void) => {
    authListeners.add(listener)
    return () => authListeners.delete(listener)
  },
}))
const authEvent = (userId: string | null) => authListeners.forEach((listener) => listener(userId))

const accessFor = (userId: string, org_timezone = 'America/Edmonton'): Access => ({
  user_id: userId,
  org_id: 'o1',
  org_name: 'Clinique Ouest',
  org_timezone,
  display_name: `User ${userId}`,
  email: `${userId}@mana.test`,
  status: 'active',
  role: 'admin_assistant',
  permissions: ['settings.view'],
  modules: ['professionals'],
})

const sessionFor = (userId: string) => ({ access_token: `token-${userId}`, user: { id: userId } }) as Session

function authValue(session: Session | null): AuthContextValue {
  return {
    session,
    isLoading: false,
    isRecovery: false,
    signedOutHere: false,
    signInWithPassword: async () => null,
    sendMagicLink: async () => null,
    sendPasswordReset: async () => null,
    updatePassword: async () => null,
    sendReauthenticationCode: async () => null,
    updateEmail: async () => null,
    signOut: async () => {},
    signOutEverywhere: async () => null,
    verifyEmailLink: async () => ({ ok: true, sessionAccessToken: null }),
  }
}

interface Snapshot {
  sessionUser: string | null
  status: string
  accessUser: string | null
  timezone: string
}

/** Records what every render of the signed-in tree saw. */
function makeProbe(log: Snapshot[], sessionUser: string | null) {
  return function Probe() {
    const { status, access, reload, isReloading } = useAccess()
    log.push({ sessionUser, status, accessUser: access?.user_id ?? null, timezone: getClinicTimezone() })
    return (
      <>
        <p data-testid="state">{`${status}:${access?.user_id ?? '-'}:${isReloading ? 'reloading' : 'settled'}`}</p>
        <button onClick={reload}>reload</button>
      </>
    )
  }
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  const log: Snapshot[] = []
  const tree = (session: Session | null): ReactNode => {
    const Probe = makeProbe(log, session?.user.id ?? null)
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue(session)}>
          <AccessProvider>
            <Probe />
          </AccessProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  }
  return { queryClient, log, tree }
}

const state = () => screen.getByTestId('state').textContent

afterEach(() => {
  fetchMyAccess.mockReset()
  resetClinicTimezone()
})

describe('AccessProvider', () => {
  it('applies the org timezone before the tree renders as ready', async () => {
    fetchMyAccess.mockResolvedValue({ access: accessFor('A') })
    const { log, tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))
    expect(log.find((entry) => entry.status === 'ready')?.timezone).toBe('America/Edmonton')
  })

  it('resets the clinic timezone and clears the query cache when the session disappears', async () => {
    fetchMyAccess.mockResolvedValue({ access: accessFor('A') })
    const { queryClient, tree } = setup()
    const { rerender } = render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))

    rerender(tree(null))
    expect(state()).toBe('idle:-:settled')
    await waitFor(() => expect(getClinicTimezone()).toBe('America/Toronto'))
    // Only the disabled, empty 'anonymous' placeholder may be re-registered by useQuery.
    expect(queryClient.getQueryCache().getAll().filter((query) => query.state.data !== undefined)).toEqual([])
    expect(queryClient.getQueryData(accessKeys.me('A'))).toBeUndefined()
  })

  it("loads the new user's access on a user switch and never shows the previous user's", async () => {
    fetchMyAccess.mockResolvedValueOnce({ access: accessFor('A') }).mockResolvedValueOnce({ access: accessFor('B', 'America/Halifax') })
    const { queryClient, log, tree } = setup()
    const { rerender } = render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))

    rerender(tree(sessionFor('B')))
    // The cache clear must run before useQuery's effect re-points the observer at B's query;
    // in the wrong order it destroys B's query and the tree stays loading.
    expect(queryClient.getQueryCache().find({ queryKey: accessKeys.me('B') })).toBeDefined()
    await waitFor(() => expect(state()).toBe('ready:B:settled'))
    expect(fetchMyAccess).toHaveBeenCalledTimes(2)
    expect(log.filter((entry) => entry.sessionUser === 'B' && entry.accessUser === 'A')).toEqual([])
    expect(log.find((entry) => entry.sessionUser === 'B' && entry.status === 'ready')?.timezone).toBe('America/Halifax')
    expect(queryClient.getQueryData(accessKeys.me('A'))).toBeUndefined()
  })

  it('clears the cache at the auth event of another user, before any re-render, cancelling what is in flight', async () => {
    fetchMyAccess.mockResolvedValueOnce({ access: accessFor('A') }).mockResolvedValueOnce({ access: accessFor('B') })
    const { queryClient, log, tree } = setup()
    const { rerender } = render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))
    queryClient.setQueryData(['records', 'r1'], { owner: 'A' })
    // A focus refetch of A's page, already carrying B's token: it must never land.
    let answer: (value: unknown) => void = () => {}
    const inFlight = queryClient.fetchQuery({ queryKey: ['records', 'r2'], queryFn: () => new Promise((resolve) => (answer = resolve)) }).catch(() => 'cancelled')
    const renders = log.length

    authEvent('B')
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(log).toHaveLength(renders)
    answer({ owner: 'B' })
    expect(await inFlight).toBe('cancelled')
    expect(queryClient.getQueryData(['records', 'r2'])).toBeUndefined()

    rerender(tree(sessionFor('B')))
    await waitFor(() => expect(state()).toBe('ready:B:settled'))
    expect(fetchMyAccess).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryData(accessKeys.me('A'))).toBeUndefined()
  })

  it('keeps the cache at an auth event of the same user (a token refresh)', async () => {
    fetchMyAccess.mockResolvedValue({ access: accessFor('A') })
    const { queryClient, tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))
    queryClient.setQueryData(['records', 'r1'], { owner: 'A' })
    authEvent('A')
    expect(queryClient.getQueryData(['records', 'r1'])).toEqual({ owner: 'A' })
    expect(queryClient.getQueryData(accessKeys.me('A'))).toBeDefined()
  })

  it('clears the cache at a sign-out heard from auth', async () => {
    fetchMyAccess.mockResolvedValue({ access: accessFor('A') })
    const { queryClient, tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))
    authEvent(null)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })

  it('keeps can stable across a refetch that returns the same access', async () => {
    // The refetch is held in flight, so the tree renders while it runs (isReloading).
    let finishRefetch: () => void = () => {}
    fetchMyAccess
      .mockResolvedValueOnce({ access: accessFor('A') })
      .mockImplementationOnce(() => new Promise((resolve) => (finishRefetch = () => resolve({ access: accessFor('A') }))))
    const queryClient = new QueryClient()
    const seen: { can: unknown; isReloading: boolean }[] = []
    function CanProbe() {
      const { can, reload, isReloading } = useAccess()
      seen.push({ can, isReloading })
      return (
        <>
          <p data-testid="state">{isReloading ? 'reloading' : 'settled'}</p>
          <p data-testid="can">{String(can('settings.view'))}</p>
          <button onClick={reload}>reload</button>
        </>
      )
    }
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue(sessionFor('A'))}>
          <AccessProvider>
            <CanProbe />
          </AccessProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('can').textContent).toBe('true'))
    const settledCan = seen.at(-1)?.can
    await userEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('reloading'))
    finishRefetch()
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('settled'))
    expect(fetchMyAccess).toHaveBeenCalledTimes(2)
    // Every render since the first load (reloading, then settled) saw the same can.
    const sinceLoad = seen.slice(seen.findIndex((entry) => entry.can === settledCan))
    expect(new Set(sinceLoad.map((entry) => entry.can))).toEqual(new Set([settledCan]))
  })

  it('reports a failed load as an error, then recovers on reload', async () => {
    fetchMyAccess.mockRejectedValue(new Error('network'))
    const { tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('error:-:settled'))
    expect(fetchMyAccess).toHaveBeenCalledTimes(2) // one retry for transient errors

    fetchMyAccess.mockResolvedValue({ access: accessFor('A') })
    await userEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))
  })

  it('does not retry an unexpected payload', async () => {
    fetchMyAccess.mockRejectedValue(new ZodError([]))
    const { tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('error:-:settled'))
    expect(fetchMyAccess).toHaveBeenCalledOnce()
  })

  it('reports a denied profile', async () => {
    fetchMyAccess.mockResolvedValue({ problem: 'profile_disabled' })
    const { tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('denied:-:settled'))
  })

  it('keeps verified access when a background refetch fails', async () => {
    fetchMyAccess.mockResolvedValueOnce({ access: accessFor('A') })
    const { tree } = setup()
    render(tree(sessionFor('A')))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))

    fetchMyAccess.mockRejectedValue(new Error('network'))
    await userEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => expect(fetchMyAccess).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(state()).toBe('ready:A:settled'))
  })
})
