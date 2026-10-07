import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/core/auth/auth-context'
import { AccessContext, type AccessContextValue } from '@/core/access/access-context'
import type { Access } from '@/core/access/access'
import { ROUTER_FUTURE } from '@/shared/lib/router-future'
import { LoginRouteProbe } from './LoginRouteProbe'

export const testAccess: Access = {
  user_id: 'u1',
  org_id: 'o1',
  org_name: 'Clinique MANA',
  org_timezone: 'America/Toronto',
  display_name: 'Test',
  email: 't@mana.test',
  status: 'active',
  role: 'admin_assistant',
  permissions: ['settings.view'],
  // Matches the real payload: enabled module keys, never 'core'.
  modules: ['professionals'],
}

export function renderWithContexts(
  ui: ReactNode,
  { auth = {}, access = {}, path = '/' }: { auth?: Partial<AuthContextValue>; access?: Partial<AccessContextValue>; path?: string } = {},
) {
  const authValue: AuthContextValue = {
    session: { user: { id: 'u1' } } as Session,
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
    ...auth,
  }
  // `can` follows the effective access (an overridden one, or testAccess), unless overridden itself.
  const effectiveAccess = access.access !== undefined ? access.access : testAccess
  const accessValue: AccessContextValue = {
    status: 'ready',
    access: effectiveAccess,
    problem: null,
    can: (p) => effectiveAccess?.permissions.includes(p) ?? false,
    reload: () => {},
    isReloading: false,
    ...access,
  }
  return (
    <AuthContext.Provider value={authValue}>
      <AccessContext.Provider value={accessValue}>
        <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
          <Routes>
            <Route path="/connexion" element={<LoginRouteProbe />} />
            <Route path="/reinitialiser-mot-de-passe" element={<p>RESET PAGE</p>} />
            <Route path="*" element={ui} />
          </Routes>
        </MemoryRouter>
      </AccessContext.Provider>
    </AuthContext.Provider>
  )
}
