import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/core/auth/AuthProvider'
import { getClinicTimezone, resetClinicTimezone } from '@/shared/lib/timezone'
import { AccessProvider, useAccess } from './AccessProvider'
import type { Access } from './access'

const fetchMyAccess = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ fetchMyAccess }))

const access: Access = {
  user_id: 'u1',
  org_id: 'o1',
  org_name: 'Clinique Ouest',
  org_timezone: 'America/Edmonton',
  display_name: 'Test',
  email: 't@mana.test',
  status: 'active',
  role: 'staff',
  permissions: ['settings.view'],
  modules: ['core'],
}

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

/** Renders the clinic timezone as seen by the signed-in tree on its first ready render. */
function Probe() {
  const { status } = useAccess()
  return <p>{status === 'ready' ? `ready:${getClinicTimezone()}` : status}</p>
}

function tree(queryClient: QueryClient, session: Session | null): ReactNode {
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

describe('AccessProvider', () => {
  afterEach(() => {
    fetchMyAccess.mockReset()
    resetClinicTimezone()
  })

  it('applies the org timezone before the tree renders as ready', async () => {
    fetchMyAccess.mockResolvedValue({ access })
    render(tree(new QueryClient(), { user: { id: 'u1' } } as Session))
    expect(await screen.findByText('ready:America/Edmonton')).toBeInTheDocument()
  })

  it('resets the clinic timezone when the session disappears', async () => {
    fetchMyAccess.mockResolvedValue({ access })
    const queryClient = new QueryClient()
    const { rerender } = render(tree(queryClient, { user: { id: 'u1' } } as Session))
    await screen.findByText('ready:America/Edmonton')

    rerender(tree(queryClient, null))
    expect(screen.getByText('idle')).toBeInTheDocument()
    await waitFor(() => expect(getClinicTimezone()).toBe('America/Toronto'))
  })
})
