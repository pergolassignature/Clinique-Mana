import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation, type NavigateOptions, type To } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { fakeAccessToken } from '@/test/jwt'
import { setRecoveryMarker } from '@/core/auth/recovery'
import { ConfirmPage } from './ConfirmPage'

/** One ordered log for the marker and every navigation, so the test can assert which came first. */
const log = vi.hoisted(() => [] as string[])

vi.mock('@/core/auth/recovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth/recovery')>()
  return { ...actual, setRecoveryMarker: vi.fn((id: string | null) => log.push(`marker:${id}`)) }
})

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate()
      return (to: To | number, options?: NavigateOptions) => {
        log.push(`navigate:${typeof to === 'string' ? to : JSON.stringify(to)}`)
        if (typeof to === 'number') navigate(to)
        else navigate(to, options)
      }
    },
  }
})

afterEach(() => {
  log.length = 0
})

function Where() {
  const location = useLocation()
  return (
    <>
      <p data-testid="where">{location.pathname + location.search}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
    </>
  )
}

/** The page at /connexion/confirmer, and stand-ins for where it goes (the reset page is renderWithContexts'). */
const confirmAt = (search: string, auth: Partial<AuthContextValue> = {}, access = {}) =>
  render(
    renderWithContexts(
      <Routes>
        <Route path="/connexion/confirmer" element={<><ConfirmPage /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { auth: { session: null, ...auth }, access, path: `/connexion/confirmer${search}` },
    ),
  )

const okWith = (sessionId: string | null) =>
  vi.fn().mockResolvedValue({ ok: true, sessionAccessToken: sessionId ? fakeAccessToken(sessionId) : null })
const failWith = (code: string) => vi.fn().mockResolvedValue({ ok: false, code })
const continueButton = () => screen.getByRole('button', { name: t('auth.confirm.continue') })
const where = () => screen.getByTestId('where').textContent

describe('ConfirmPage — before the click', () => {
  it('verifies nothing on mount (a mail scanner prefetch burns nothing) and offers « Continuer »', () => {
    const verifyEmailLink = okWith('s1')
    confirmAt('?token_hash=h1&type=recovery', { verifyEmailLink })
    expect(continueButton()).toBeInTheDocument()
    expect(verifyEmailLink).not.toHaveBeenCalled()
    expect(setRecoveryMarker).not.toHaveBeenCalled()
  })

  it('removes the token from the URL at once (it stays out of history)', () => {
    confirmAt('?token_hash=h1&type=email&next=%2Faccueil', { verifyEmailLink: okWith('s1') })
    expect(where()).toBe('/connexion/confirmer')
  })

  it('titles the browser tab « Confirmation »', () => {
    confirmAt('?token_hash=h1&type=email', { verifyEmailLink: okWith('s1') })
    expect(document.title).toBe(`${t('auth.confirm.title')} · ${t('app.name')}`)
  })

  it.each([
    ['an unknown type', '?token_hash=h1&type=signup'],
    ['no type', '?token_hash=h1'],
    ['no token_hash', '?type=recovery'],
  ])('shows the error state at once for %s, with no button', (_label, search) => {
    const verifyEmailLink = okWith('s1')
    confirmAt(search, { verifyEmailLink })
    expect(screen.getByText(t('auth.confirm.invalid'))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(verifyEmailLink).not.toHaveBeenCalled()
  })
})

describe('ConfirmPage — success', () => {
  it('recovery: sets the marker from the returned session, then opens the reset page', async () => {
    const verifyEmailLink = okWith('s1')
    confirmAt('?token_hash=h1&type=recovery', { verifyEmailLink })
    await userEvent.click(continueButton())
    expect(await screen.findByText('RESET PAGE')).toBeInTheDocument()
    expect(verifyEmailLink).toHaveBeenCalledExactlyOnceWith('h1', 'recovery')
    const marker = log.indexOf('marker:s1')
    expect(marker).toBeGreaterThanOrEqual(0)
    expect(marker).toBeLessThan(log.indexOf('navigate:/reinitialiser-mot-de-passe'))
  })

  it('email change: opens « Mon compte » with the neutral notice state', async () => {
    confirmAt('?token_hash=h1&type=email_change', { verifyEmailLink: okWith(null) })
    await userEvent.click(continueButton())
    expect(await screen.findByText('/mon-compte')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('state').textContent ?? 'null')).toEqual({ emailChangeConfirmed: true })
    expect(setRecoveryMarker).not.toHaveBeenCalled()
  })

  it('magic link: goes to the same-origin `next`', async () => {
    const next = encodeURIComponent(`${window.location.origin}/parametres/identite?x=1`)
    confirmAt(`?token_hash=h1&type=email&next=${next}`, { verifyEmailLink: okWith('s2') })
    await userEvent.click(continueButton())
    expect(await screen.findByText('/parametres/identite?x=1')).toBeInTheDocument()
    expect(setRecoveryMarker).not.toHaveBeenCalled()
  })

  it('magic link: an off-site `next` lands on /accueil', async () => {
    confirmAt(`?token_hash=h1&type=email&next=${encodeURIComponent('https://evil.test/x')}`, { verifyEmailLink: okWith('s2') })
    await userEvent.click(continueButton())
    expect(await screen.findByText('/accueil')).toBeInTheDocument()
  })
})

describe('ConfirmPage — errors', () => {
  it.each([
    ['recovery', '/mot-de-passe-oublie'],
    ['email', '/connexion'],
    ['email_change', '/connexion'],
  ])('%s: an expired or used link shows the message and « Demander un nouveau lien » → %s', async (type, target) => {
    confirmAt(`?token_hash=h1&type=${type}`, { verifyEmailLink: failWith('link_invalid') })
    await userEvent.click(continueButton())
    expect(await screen.findByText(t('auth.confirm.invalid'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.confirm.requestNew') })).toHaveAttribute('href', target)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // Never the reset page, never the marker.
    expect(screen.queryByText('RESET PAGE')).not.toBeInTheDocument()
    expect(setRecoveryMarker).not.toHaveBeenCalled()
    expect(where()).toBe('/connexion/confirmer')
  })

  it('a failure that did not use the link (network, throttle) keeps « Continuer » to try again', async () => {
    const verifyEmailLink = failWith('rate_limited')
    confirmAt('?token_hash=h1&type=recovery', { verifyEmailLink })
    await userEvent.click(continueButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(t('auth.errors.rate_limited'))
    expect(setRecoveryMarker).not.toHaveBeenCalled()
    verifyEmailLink.mockResolvedValue({ ok: true, sessionAccessToken: fakeAccessToken('s1') })
    await userEvent.click(continueButton())
    expect(await screen.findByText('RESET PAGE')).toBeInTheDocument()
  })

  it('recovery without a session id never opens the reset page unmarked', async () => {
    confirmAt('?token_hash=h1&type=recovery', { verifyEmailLink: okWith(null) })
    await userEvent.click(continueButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(t('auth.errors.unknown'))
    expect(screen.queryByText('RESET PAGE')).not.toBeInTheDocument()
    expect(setRecoveryMarker).not.toHaveBeenCalled()
  })
})

describe('ConfirmPage — another user signed in (decision #14)', () => {
  const signedIn = { session: { user: { id: 'u1', email: 'conseillere@mana.test' } } as Session }

  it('names the signed-in user above the button', () => {
    confirmAt('?token_hash=h1&type=recovery', { ...signedIn, verifyEmailLink: okWith('s1') }, { access: { ...testAccess, display_name: 'Camille' } })
    expect(screen.getByText(t('auth.confirm.otherUser', { name: 'Camille' }))).toBeInTheDocument()
    expect(continueButton()).toBeInTheDocument()
  })

  it('falls back to the session email while access is not loaded', () => {
    confirmAt('?token_hash=h1&type=email', { ...signedIn, verifyEmailLink: okWith('s1') }, { status: 'loading', access: null })
    expect(screen.getByText(t('auth.confirm.otherUser', { name: 'conseillere@mana.test' }))).toBeInTheDocument()
  })

  it('on error, leaves that session alone (no sign-out)', async () => {
    const signOut = vi.fn()
    confirmAt('?token_hash=h1&type=recovery', { ...signedIn, signOut, verifyEmailLink: failWith('link_invalid') })
    await userEvent.click(continueButton())
    expect(await screen.findByText(t('auth.confirm.invalid'))).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()
    expect(setRecoveryMarker).not.toHaveBeenCalled()
  })

  it('on success, lets verifyOtp replace the session (the page signs nobody out)', async () => {
    const signOut = vi.fn()
    confirmAt('?token_hash=h1&type=email&next=%2Faccueil', { ...signedIn, signOut, verifyEmailLink: okWith('s2') })
    await userEvent.click(continueButton())
    expect(await screen.findByText('/accueil')).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()
  })
})
