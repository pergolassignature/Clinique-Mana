// SUPABASE_ALLOWED: test mocks the Supabase client module.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { t } from '@/i18n'
import { RECOVERY_STORAGE_KEY } from '@/core/auth/recovery'
import { fakeAccessToken } from '@/test/jwt'

/**
 * When the signed-in code starts loading (App's PreloadSignedInCode, its boot preload and
 * SignedInApp). The signed-in chunk is a stub whose loads are counted; the page at the URL is a
 * controllable double. The Supabase client is faked like in App.test.tsx.
 */
const fake = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void
  const state = {
    session: null as { access_token: string; user: { id: string; email?: string } } | null,
    listener: undefined as Listener | undefined,
  }
  const supabase = {
    auth: {
      onAuthStateChange: (listener: Listener) => {
        state.listener = listener
        queueMicrotask(() => listener('INITIAL_SESSION', state.session))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: state.session }, error: null }),
    },
    rpc: async () => ({ data: { ...testAccessHoisted, user_id: state.session?.user.id ?? 'u1' }, error: null }),
  }
  // Like testAccess (src/test/contexts.tsx), inlined: vi.hoisted runs before imports.
  const testAccessHoisted = {
    user_id: 'u1', org_id: 'o1', org_name: 'Clinique MANA', org_timezone: 'America/Toronto', display_name: 'Test',
    email: 't@mana.test', status: 'active', role: 'admin', permissions: ['settings.view'], modules: [],
  }
  return { state, supabase }
})
vi.mock('@/core/supabase/client', () => ({ supabase: fake.supabase, AUTH_STORAGE_KEY: 'test-auth-key' }))

/**
 * The signed-in chunk. Vitest evaluates a mock factory once, even across vi.resetModules, so a load
 * is counted when lazyPage reads the export: once per App instance whose chunk has loaded.
 */
const shell = vi.hoisted(() => ({ loads: 0 }))
vi.mock('./AuthenticatedApp', () => {
  const AuthenticatedApp = () => <p>SIGNED-IN APP</p>
  return {
    get AuthenticatedApp() {
      shell.loads += 1
      return AuthenticatedApp
    },
  }
})

/** The page at the URL (routePage), and what preloadRouteCode is asked. */
const route = vi.hoisted(() => ({
  stored: false,
  preloadRouteCode: vi.fn(),
  page: undefined as { preload: () => Promise<void>; isLoaded: () => boolean } | undefined,
}))
vi.mock('./route-preload', () => ({
  hasStoredSession: () => route.stored,
  preloadRouteCode: route.preloadRouteCode,
  routePage: () => route.page,
}))

const sessionFor = (userId: string, sessionId = `session-${userId}`) => ({
  access_token: fakeAccessToken(sessionId),
  user: { id: userId, email: `${userId}@mana.test` },
})

let runIdle: () => void = () => {}
const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
  runIdle = () => callback({ didTimeout: false, timeRemaining: () => 50 })
  return 1
})

/** Imports App like a fresh page load (new module instances, boot code run again). */
async function bootApp() {
  vi.resetModules()
  return (await import('./App')).App
}

async function openAt(path: string, session: typeof fake.state.session = null) {
  fake.state.session = session
  window.history.replaceState(null, '', path)
  const App = await bootApp()
  return render(<App />)
}

beforeEach(() => {
  vi.stubGlobal('requestIdleCallback', requestIdleCallback)
  vi.stubGlobal('cancelIdleCallback', vi.fn())
})

afterEach(() => {
  // Unmount first: the idle task's cancel() runs on unmount, while cancelIdleCallback is still stubbed.
  cleanup()
  fake.state.session = null
  fake.state.listener = undefined
  shell.loads = 0
  route.stored = false
  route.page = undefined
  route.preloadRouteCode.mockReset()
  requestIdleCallback.mockClear()
  runIdle = () => {}
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})

describe('PreloadSignedInCode', () => {
  it('on the login page, loads the signed-in chunk once the browser is idle', async () => {
    await openAt('/connexion')
    expect(await screen.findByRole('heading', { name: t('auth.login.title') })).toBeInTheDocument()
    // Once auth-js has said there is no session.
    await waitFor(() => expect(requestIdleCallback).toHaveBeenCalled())
    expect(shell.loads).toBe(0)
    act(() => runIdle())
    await waitFor(() => expect(shell.loads).toBe(1))
    // The page the user may go to is not known yet: nothing else is fetched.
    expect(route.preloadRouteCode).not.toHaveBeenCalled()
  })

  it('as soon as there is a session, loads the signed-in chunk and the destination page, without waiting for idle', async () => {
    await openAt(`/connexion?redirect=${encodeURIComponent('/parametres/fiscalite')}`)
    await screen.findByRole('heading', { name: t('auth.login.title') })
    act(() => fake.state.listener?.('SIGNED_IN', sessionFor('u1')))
    await waitFor(() => expect(shell.loads).toBe(1))
    expect(route.preloadRouteCode).toHaveBeenCalled()
    expect(await screen.findByText('SIGNED-IN APP')).toBeInTheDocument()
  })

  it('loads nothing signed-in for a recovery session', async () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 'recovery-session')
    await openAt('/reinitialiser-mot-de-passe', sessionFor('u1', 'recovery-session'))
    expect(await screen.findByLabelText(t('auth.reset.password'))).toBeInTheDocument()
    await act(async () => {})
    expect(shell.loads).toBe(0)
    expect(route.preloadRouteCode).not.toHaveBeenCalled()
    expect(requestIdleCallback).not.toHaveBeenCalled()
  })
})

describe('boot preload', () => {
  it('with a stored session, starts the signed-in chunk and the page at the URL before the first render', async () => {
    route.stored = true
    await bootApp()
    expect(route.preloadRouteCode).toHaveBeenCalledOnce()
    await waitFor(() => expect(shell.loads).toBe(1))
  })

  it('without one, starts nothing', async () => {
    await bootApp()
    await act(async () => {})
    expect(route.preloadRouteCode).not.toHaveBeenCalled()
    expect(shell.loads).toBe(0)
  })
})

describe('SignedInApp', () => {
  it("keeps the loading screen until the page at the URL has loaded too, so that page shows no fallback", async () => {
    let finish: () => void = () => {}
    let loaded = false
    route.page = {
      preload: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            loaded = true
            resolve()
          }
        }),
      isLoaded: () => loaded,
    }
    await openAt('/parametres/fiscalite', sessionFor('u1'))
    await waitFor(() => expect(shell.loads).toBe(1))
    // Access verified and the shell loaded: only the page is missing.
    expect(await screen.findByRole('status')).toHaveTextContent(t('common.loading'))
    await act(async () => {})
    expect(screen.queryByText('SIGNED-IN APP')).not.toBeInTheDocument()
    await act(async () => finish())
    expect(await screen.findByText('SIGNED-IN APP')).toBeInTheDocument()
  })

  it('renders the shell anyway once the page has taken 1 s (its own Suspense takes over)', async () => {
    route.page = { preload: () => new Promise<void>(() => {}), isLoaded: () => false }
    await openAt('/parametres/fiscalite', sessionFor('u1'))
    expect(await screen.findByRole('status')).toHaveTextContent(t('common.loading'))
    expect(await screen.findByText('SIGNED-IN APP', {}, { timeout: 3000 })).toBeInTheDocument()
  })
})
