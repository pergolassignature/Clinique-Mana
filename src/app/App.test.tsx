// SUPABASE_ALLOWED: test mocks the Supabase client module.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { testAccess } from '@/test/contexts'

// The whole app with real providers; only the Supabase client is faked.
const supabase = vi.hoisted(() => ({
  session: null as unknown,
  auth: {
    onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
      queueMicrotask(() => callback('INITIAL_SESSION', supabase.session))
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
  },
  rpc: async (_name: string): Promise<{ data: unknown; error: null }> => ({ data: null, error: null }),
}))
vi.mock('@/core/supabase/client', () => ({ supabase, AUTH_STORAGE_KEY: 'test-auth-key' }))

const { App } = await import('./App')

function openAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

afterEach(() => {
  supabase.session = null
})

describe('App', () => {
  it('sends a visitor to the login page, keeping the target', async () => {
    openAt('/professionnels')
    expect(await screen.findByRole('heading', { name: t('auth.login.title') })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/connexion')
    expect(window.location.search).toBe('?redirect=%2Fprofessionnels')
  })

  it('serves the reset page without a session (not behind RequireAuth)', async () => {
    openAt('/reinitialiser-mot-de-passe')
    expect(await screen.findByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
    expect(window.location.pathname).toBe('/reinitialiser-mot-de-passe')
  })

  it('serves the forgotten-password page', async () => {
    openAt('/mot-de-passe-oublie')
    expect(await screen.findByRole('heading', { name: t('auth.forgot.title') })).toBeInTheDocument()
  })

  it('opens the signed-in app with the modules from the access payload', async () => {
    supabase.session = { access_token: 'token', user: { id: 'u1' } }
    supabase.rpc = async (name) => {
      expect(name).toBe('get_my_access')
      return { data: { ...testAccess, permissions: ['settings.view', 'professionals.view'] }, error: null }
    }
    openAt('/')
    expect(await screen.findByRole('link', { name: t('modules.professionals.name') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('nav.settings') })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/accueil')
  })
})
