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

const accessFor = (userId: string, org_timezone = 'America/Edmonton'): Access => ({
  user_id: userId,
  org_id: 'o1',
  org_name: 'Clinique Ouest',
  org_timezone,
  display_name: `User ${userId}`,
  email: `${userId}@mana.test`,
  status: 'active',
  role: 'staff',
  permissions: ['settings.view'],
  modules: ['professionals'],
})

const sessionFor = (userId: string) => ({ access_token: `token-${userId}`, user: { id: userId } }) as Session

function authValue(session: Session | null): AuthContextValue {
  return {
    session,
    isLoading: false,
    isRecovery: false,
    signInWithPassword: async () => null,
    sendMagicLink: async () => null,
    sendPasswordReset: async () => null,
    updatePassword: async () => null,
    signOut: async () => {},
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
    await waitFor(() => expect(state()).toBe('ready:B:settled'))
    expect(fetchMyAccess).toHaveBeenCalledTimes(2)
    expect(log.filter((entry) => entry.sessionUser === 'B' && entry.accessUser === 'A')).toEqual([])
    expect(log.find((entry) => entry.sessionUser === 'B' && entry.status === 'ready')?.timezone).toBe('America/Halifax')
    expect(queryClient.getQueryData(accessKeys.me('A'))).toBeUndefined()
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
