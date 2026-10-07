// SUPABASE_ALLOWED: test mocks the Supabase client module.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { RECOVERY_STORAGE_KEY } from '@/core/auth/recovery'
import { testAccess } from '@/test/contexts'
import { fakeAccessToken } from '@/test/jwt'

/**
 * The whole app with its real providers, guards and routes; only the Supabase client is faked.
 * The fake behaves like auth-js where it matters: INITIAL_SESSION on subscribe, SIGNED_OUT on a
 * local sign-out, USER_UPDATED on updateUser, nothing local for a sign-out of the other sessions.
 */
const fake = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void
  type RpcResult = { data: unknown; error: unknown }
  const state = {
    session: null as { access_token: string; user: { id: string; email?: string } } | null,
    listener: undefined as Listener | undefined,
    rpcCalls: [] as { name: string; userId: string | undefined }[],
    signOutScopes: [] as string[],
    updateUserCalls: [] as unknown[],
    respond: undefined as ((userId: string) => RpcResult) | undefined,
  }
  // Warm the module transform once: the first cold import of the whole app can
// exceed the 5 s test timeout on a loaded machine.
beforeAll(async () => {
  await import('./App')
}, 30_000)

const emit = (event: string, session: typeof state.session) => {
    state.session = session
    state.listener?.(event, session)
  }
  const supabase = {
    auth: {
      onAuthStateChange: (listener: Listener) => {
        state.listener = listener
        queueMicrotask(() => listener('INITIAL_SESSION', state.session))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async ({ scope }: { scope: string }) => {
        state.signOutScopes.push(scope)
        if (scope !== 'others') emit('SIGNED_OUT', null)
        return { error: null }
      },
      getSession: async () => ({ data: { session: state.session }, error: null }),
      updateUser: async (attributes: unknown) => {
        state.updateUserCalls.push(attributes)
        emit('USER_UPDATED', state.session)
        return { data: { user: state.session?.user }, error: null }
      },
    },
    rpc: async (name: string) => {
      // The Modules settings section (admins land on it under /parametres) lists the org's modules.
      if (name === 'list_modules') return { data: [], error: null }
      const userId = state.session?.user.id
      state.rpcCalls.push({ name, userId })
      return state.respond?.(userId ?? '') ?? { data: null, error: null }
    },
  }
  return { state, emit, supabase }
})
vi.mock('@/core/supabase/client', () => ({ supabase: fake.supabase, AUTH_STORAGE_KEY: 'test-auth-key' }))

const accessFor = (userId: string) => ({
  ...testAccess,
  user_id: userId,
  display_name: `Personne ${userId}`,
  role: 'admin',
  permissions: ['settings.view', 'modules.manage', 'professionals.view'],
  modules: ['professionals'],
})
const grantAccess = (userId: string) => ({ data: accessFor(userId), error: null })

const sessionFor = (userId: string, sessionId = `session-${userId}`) => ({
  access_token: fakeAccessToken(sessionId),
  user: { id: userId, email: `${userId}@mana.test` },
})

function resetFake() {
  fake.state.session = null
  fake.state.listener = undefined
  fake.state.rpcCalls = []
  fake.state.signOutScopes = []
  fake.state.updateUserCalls = []
  fake.state.respond = grantAccess
}
resetFake()

/** Opens the app at `path` like a fresh page load: new module instances (query cache, URL hash read). */
async function openAt(path: string, session: typeof fake.state.session = null) {
  fake.state.session = session
  window.history.replaceState(null, '', path)
  vi.resetModules()
  const { App } = await import('./App')
  return render(<App />)
}

// Warm the module transform once: the first cold import of the whole app can
// exceed the 5 s test timeout on a loaded machine.
beforeAll(async () => {
  await import('./App')
}, 30_000)

const emit = (event: string, session: typeof fake.state.session) => act(() => fake.emit(event, session))
const where = () => window.location.pathname + window.location.search

afterEach(() => {
  resetFake()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('App — signed out', () => {
  it('sends a visitor to the login page, keeping the target', async () => {
    await openAt('/professionnels')
    expect(await screen.findByRole('heading', { name: t('auth.login.title') })).toBeInTheDocument()
    expect(where()).toBe('/connexion?redirect=%2Fprofessionnels')
  })

  it('serves the reset page without a session (not behind RequireAuth)', async () => {
    await openAt('/reinitialiser-mot-de-passe')
    expect(await screen.findByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
    expect(where()).toBe('/reinitialiser-mot-de-passe')
  })

  it('serves the forgotten-password page', async () => {
    await openAt('/mot-de-passe-oublie')
    expect(await screen.findByRole('heading', { name: t('auth.forgot.title') })).toBeInTheDocument()
  })
})

describe('App — signed in', () => {
  it('opens the app with the modules from the access payload', async () => {
    await openAt('/', sessionFor('u1'))
    expect(await screen.findByRole('link', { name: t('modules.professionals.name') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('nav.settings') })).toBeInTheDocument()
    expect(where()).toBe('/accueil')
    expect(fake.state.rpcCalls).toEqual([{ name: 'get_my_access', userId: 'u1' }])
  })

  it('shows a retry screen when access fails to load, and recovers on retry', async () => {
    fake.state.respond = () => ({ data: null, error: { message: 'Failed to fetch', code: '' } })
    await openAt('/accueil', sessionFor('u1'))
    // One automatic retry (about 1 s) before the error state.
    expect(await screen.findByRole('heading', { name: t('access.error.title') }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fake.state.respond = grantAccess
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { name: `${t('home.title')}, Personne u1` })).toBeInTheDocument()
  })

  it.each([
    ['has no profile', () => ({ data: null, error: null }), 'access.denied.profile_not_found'],
    ['is disabled', (id: string) => ({ data: { ...accessFor(id), status: 'disabled' }, error: null }), 'access.denied.profile_disabled'],
    ['has no role', (id: string) => ({ data: { ...accessFor(id), role: null }, error: null }), 'access.denied.no_role'],
  ] as const)('explains, without opening the app, an account that %s', async (_label, respond, key) => {
    fake.state.respond = respond
    await openAt('/accueil', sessionFor('u1'))
    expect(await screen.findByRole('heading', { name: t(key) })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  // Shared reception PCs: nothing cached for one user may be served to the next.
  it('drops the cached access when the user changes', async () => {
    await openAt('/accueil', sessionFor('u1'))
    expect(await screen.findByRole('heading', { name: `${t('home.title')}, Personne u1` })).toBeInTheDocument()
    emit('SIGNED_IN', sessionFor('u2'))
    expect(await screen.findByRole('heading', { name: `${t('home.title')}, Personne u2` })).toBeInTheDocument()
    emit('SIGNED_IN', sessionFor('u1', 'session-u1-again'))
    expect(await screen.findByRole('heading', { name: `${t('home.title')}, Personne u1` })).toBeInTheDocument()
    // u1's access was fetched again: the cache was cleared on each switch (staleTime is 5 min).
    expect(fake.state.rpcCalls.map((c) => c.userId)).toEqual(['u1', 'u2', 'u1'])
  })
})

describe('App — sign-out', () => {
  it('sends an explicit sign-out to the plain login page', async () => {
    await openAt('/parametres', sessionFor('u1'))
    await userEvent.click(await screen.findByRole('button', { name: t('nav.logout') }))
    expect(await screen.findByRole('heading', { name: t('auth.login.title') })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/connexion')
    expect(window.location.search).toBe('')
    expect(fake.state.signOutScopes).toEqual(['local'])
  })

  it('keeps the way back when the session ends elsewhere (another tab, expiry)', async () => {
    await openAt('/parametres/modules', sessionFor('u1'))
    await screen.findByRole('button', { name: t('nav.logout') })
    emit('SIGNED_OUT', null)
    expect(await screen.findByRole('heading', { name: t('auth.login.title') })).toBeInTheDocument()
    expect(where()).toBe('/connexion?redirect=%2Fparametres%2Fmodules')
  })
})

describe('App — password recovery', () => {
  const recovery = sessionFor('u1', 'recovery-session')

  it('keeps a reloaded recovery session on the reset page', async () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 'recovery-session')
    await openAt('/accueil', recovery)
    expect(await screen.findByLabelText(t('auth.reset.password'))).toBeInTheDocument()
    expect(where()).toBe('/reinitialiser-mot-de-passe')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('marks the session from the recovery link, so a reload or new tab stays in recovery', async () => {
    const hash = `#access_token=${recovery.access_token}&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery`
    const firstTab = await openAt(`/reinitialiser-mot-de-passe${hash}`, recovery)
    expect(await screen.findByLabelText(t('auth.reset.password'))).toBeInTheDocument()
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe('recovery-session')
    firstTab.unmount()

    await openAt('/parametres', recovery)
    expect(await screen.findByLabelText(t('auth.reset.password'))).toBeInTheDocument()
    expect(where()).toBe('/reinitialiser-mot-de-passe')
  })

  it('does not trap an ordinary session on the reset page', async () => {
    await openAt('/reinitialiser-mot-de-passe', sessionFor('u1'))
    expect(await screen.findByRole('heading', { name: `${t('home.title')}, Personne u1` })).toBeInTheDocument()
    expect(where()).toBe('/accueil')
  })

  // auth-js keeps the existing session when an expired link lands with #error_code=….
  it('explains an expired link even with a session, and offers a way home', async () => {
    await openAt('/reinitialiser-mot-de-passe#error=access_denied&error_code=otp_expired&error_description=x', sessionFor('u1'))
    expect(await screen.findByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
    expect(screen.queryByLabelText(t('auth.reset.password'))).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.reset.backHome') })).toHaveAttribute('href', '/accueil')
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('changes the password, ends the other sessions and opens the app', async () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 'recovery-session')
    await openAt('/reinitialiser-mot-de-passe', recovery)
    await userEvent.type(await screen.findByLabelText(t('auth.reset.password')), 'un-long-mot-de-passe')
    await userEvent.type(screen.getByLabelText(t('auth.reset.confirm')), 'un-long-mot-de-passe')
    await userEvent.click(screen.getByRole('button', { name: t('auth.reset.submit') }))

    expect(await screen.findByRole('heading', { name: `${t('home.title')}, Personne u1` })).toBeInTheDocument()
    expect(where()).toBe('/accueil')
    expect(fake.state.updateUserCalls).toEqual([{ password: 'un-long-mot-de-passe' }])
    expect(fake.state.signOutScopes).toEqual(['others'])
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('lets a recovery session cancel: signed out, back to the plain login page', async () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 'recovery-session')
    await openAt('/reinitialiser-mot-de-passe', recovery)
    await userEvent.click(await screen.findByRole('button', { name: t('auth.reset.cancel') }))
    await waitFor(() => expect(where()).toBe('/connexion'))
    expect(fake.state.signOutScopes).toEqual(['local'])
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
  })
})
