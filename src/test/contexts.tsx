import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '@/core/auth/AuthProvider'
import { AccessContext, type AccessContextValue } from '@/core/access/AccessProvider'
import type { Access } from '@/core/access/access'
import { LoginRouteProbe } from './LoginRouteProbe'

export const testAccess: Access = {
  user_id: 'u1',
  org_id: 'o1',
  org_name: 'Clinique MANA',
  org_timezone: 'America/Toronto',
  display_name: 'Test',
  email: 't@mana.test',
  status: 'active',
  role: 'staff',
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
    signInWithPassword: async () => null,
    sendMagicLink: async () => null,
    sendPasswordReset: async () => null,
    updatePassword: async () => null,
    signOut: async () => {},
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
        <MemoryRouter initialEntries={[path]}>
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
