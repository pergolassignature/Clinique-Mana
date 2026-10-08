import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { InvitationPage } from './InvitationPage'

/** One ordered log of the URL change, the function calls and the auth calls. */
const log = vi.hoisted(() => [] as string[])
const mocks = vi.hoisted(() => ({ resolveLink: vi.fn(), acceptInvite: vi.fn() }))
vi.mock('@/core/invitations/api', () => mocks)
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const OTHER_TOKEN = 'BBECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const DISPLAY = { clinic_name: 'Clinique MANA', display_name: 'Nouvelle Personne', email: 'nouvelle@mana.test', expires_at: '2026-10-15T16:00:00+00:00' }
const PASSWORD = 'un mot de passe sûr'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

/** Opens another link in the same tab: only the fragment changes, as a pasted link does. */
function OpenOther({ hash }: { hash: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(`/invitation${hash}`)}>
      OTHER LINK
    </button>
  )
}

/** The page at /invitation#t=…, as the email link opens it (the browser's URL too). */
function openLink(
  hash = `#t=${TOKEN}`,
  auth: Partial<AuthContextValue> = {},
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  window.history.replaceState(null, '', `/invitation${hash}`)
  vi.spyOn(window.history, 'replaceState').mockImplementation(function (this: History, ...args) {
    log.push(`url:${String(args[2])}`)
    return History.prototype.replaceState.apply(this, args)
  })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route
            path="/invitation"
            element={
              <>
                <InvitationPage />
                <OpenOther hash={`#t=${OTHER_TOKEN}`} />
              </>
            }
          />
          <Route path="*" element={<Where />} />
        </Routes>,
        { auth: { session: null, ...auth }, access: { status: 'idle', access: null }, path: `/invitation${hash}` },
      )}
    </QueryClientProvider>,
  )
}

const passwordField = () => screen.getByLabelText(new RegExp(`^${t('invitation.password')}`))
const confirmField = () => screen.getByLabelText(new RegExp(`^${t('invitation.confirm')}`))
const submit = () => screen.getByRole('button', { name: t('invitation.submit') })

async function fillAndSubmit(password = PASSWORD, confirm = password) {
  await userEvent.type(await screen.findByLabelText(new RegExp(`^${t('invitation.password')}`)), password)
  await userEvent.type(confirmField(), confirm)
  await userEvent.click(submit())
}

beforeEach(() => {
  mocks.resolveLink.mockImplementation(async (token: string) => {
    log.push(`resolve:${token === TOKEN ? 'token' : token}`)
    return DISPLAY
  })
  mocks.acceptInvite.mockImplementation(async () => {
    log.push('accept')
    return { email: DISPLAY.email }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  log.length = 0
  window.history.replaceState(null, '', '/')
})

describe('InvitationPage — the link', () => {
  it('removes the token from the URL before the first network call, then resolves it once', async () => {
    openLink()
    expect(await screen.findByRole('heading', { name: t('invitation.welcome', { clinic: 'Clinique MANA' }) })).toBeInTheDocument()
    expect(log.slice(0, 2)).toEqual(['url:/invitation', 'resolve:token'])
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/invitation')
    expect(mocks.resolveLink).toHaveBeenCalledTimes(1)
  })

  it('another link opened in the same tab (only the fragment changes) starts afresh, and leaves the URL too', async () => {
    openLink()
    await screen.findByRole('heading', { name: t('invitation.welcome', { clinic: 'Clinique MANA' }) })
    mocks.resolveLink.mockImplementation(async (token: string) => {
      log.push(`resolve:${token === OTHER_TOKEN ? 'other' : token}`)
      return { ...DISPLAY, display_name: 'Autre Personne' }
    })
    window.history.replaceState(null, '', `/invitation#t=${OTHER_TOKEN}`)
    await userEvent.click(screen.getByRole('button', { name: 'OTHER LINK' }))
    expect(await screen.findByDisplayValue('Autre Personne')).toBeInTheDocument()
    expect(log).toContain('resolve:other')
    expect(window.location.hash).toBe('')
  })

  it('shows the invitation: the name and address read-only, the expiry; noindex while shown', async () => {
    const { unmount } = openLink()
    await screen.findByRole('heading', { name: t('invitation.welcome', { clinic: 'Clinique MANA' }) })
    expect(screen.getByLabelText(t('invitation.name'))).toHaveValue('Nouvelle Personne')
    expect(screen.getByLabelText(t('invitation.name'))).toHaveAttribute('readonly')
    expect(screen.getByLabelText(t('invitation.email'))).toHaveValue('nouvelle@mana.test')
    expect(screen.getByLabelText(t('invitation.email'))).toHaveAttribute('readonly')
    expect(screen.getByText(t('invitation.expires', { date: formatClinicDateTime(DISPLAY.expires_at) }))).toBeInTheDocument()
    expect(document.title).toBe(`${t('invitation.title')} · ${t('app.name')}`)
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it.each([
    ['no fragment', ''],
    ['no t=', '#x=1'],
    ['a malformed token', '#t=../etc'],
  ])('shows « lien non valide » for %s, with no call', async (_label, hash) => {
    openLink(hash)
    expect(await screen.findByText(t('invitation.states.link_invalid'))).toBeInTheDocument()
    expect(mocks.resolveLink).not.toHaveBeenCalled()
  })

  it('a link that is not valid: neutral, with the « most recent email » hint', async () => {
    mocks.resolveLink.mockRejectedValue(new FunctionCallError('link_invalid', 410, 'Link invalid'))
    openLink()
    expect(await screen.findByText(t('invitation.states.link_invalid'))).toBeInTheDocument()
    expect(screen.getByText(t('invitation.latestEmailHint'))).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('an expired link: ask the clinic for a new invitation', async () => {
    mocks.resolveLink.mockRejectedValue(new FunctionCallError('link_expired', 410, 'Link expired'))
    openLink()
    expect(await screen.findByText(t('invitation.states.link_expired'))).toBeInTheDocument()
  })

  it('a used link: sign in instead', async () => {
    mocks.resolveLink.mockRejectedValue(new FunctionCallError('link_used', 410, 'Link used'))
    openLink()
    expect(await screen.findByText(t('invitation.states.link_used'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: t('invitation.signIn') }))
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it.each([
    ['rate_limited', 429, t('invitation.states.rate_limited')],
    ['network', 0, t('invitation.states.error')],
    ['internal', 500, t('invitation.states.error')],
  ])('%s: a message and « Réessayer », which asks again', async (code, status, text) => {
    mocks.resolveLink.mockRejectedValueOnce(new FunctionCallError(code, status, 'x'))
    openLink()
    expect(await screen.findByText(text)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { name: t('invitation.welcome', { clinic: 'Clinique MANA' }) })).toBeInTheDocument()
    expect(mocks.resolveLink).toHaveBeenCalledTimes(2)
  })
})

describe('InvitationPage — the password', () => {
  it('refuses a short password and a mismatch before any call', async () => {
    openLink()
    await fillAndSubmit('court', 'court')
    expect(await screen.findByText(t('auth.reset.tooShort'))).toBeInTheDocument()
    await userEvent.clear(passwordField())
    await userEvent.clear(confirmField())
    await fillAndSubmit(PASSWORD, `${PASSWORD}!`)
    expect(await screen.findByText(t('auth.reset.mismatch'))).toBeInTheDocument()
    expect(mocks.acceptInvite).not.toHaveBeenCalled()
  })

  it('accepts, signs in with the account address, then opens Accueil', async () => {
    const signInWithPassword = vi.fn(async () => {
      log.push('signIn')
      return null
    })
    const signOut = vi.fn(async () => {})
    openLink(undefined, { signInWithPassword, signOut })
    await fillAndSubmit()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/accueil'))
    expect(mocks.acceptInvite).toHaveBeenCalledExactlyOnceWith(TOKEN, PASSWORD)
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith(DISPLAY.email, PASSWORD)
    expect(signOut).not.toHaveBeenCalled()
    expect(log.indexOf('accept')).toBeLessThan(log.indexOf('signIn'))
  })

  it('someone else signed in on this browser: signs them out here first, then signs in', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // As AccessProvider does when the user changes (decision #10).
    const signOut = vi.fn(async () => {
      log.push('signOut')
      queryClient.clear()
    })
    const signInWithPassword = vi.fn(async () => {
      log.push('signIn')
      return null
    })
    openLink(undefined, { session: { user: { id: 'u-other', email: 'autre@mana.test' } } as Session, signOut, signInWithPassword }, queryClient)
    expect(await screen.findByText(t('invitation.otherUser', { name: 'autre@mana.test' }))).toBeInTheDocument()
    await fillAndSubmit()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/accueil'))
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ reload: false })
    // The cleared cache neither looks the spent link up again nor drops the form meanwhile.
    expect(log.slice(log.indexOf('accept'))).toEqual(['accept', 'signOut', 'signIn'])
    expect(mocks.resolveLink).toHaveBeenCalledTimes(1)
  })

  it('the sign-in fails after acceptance: the account is active, sign in from /connexion', async () => {
    openLink(undefined, { signInWithPassword: vi.fn(async () => 'unknown' as const) })
    await fillAndSubmit()
    expect(await screen.findByText(t('invitation.activated'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('invitation.signIn') })).toHaveAttribute('href', '/connexion')
    // The spent link is not looked up again.
    expect(mocks.resolveLink).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['link_used', 410, t('invitation.states.link_used')],
    ['link_expired', 410, t('invitation.states.link_expired')],
    ['link_invalid', 410, t('invitation.states.link_invalid')],
    ['conflict', 409, t('invitation.states.conflict')],
  ])('an accept refusal %s replaces the form, with no sign-in', async (code, status, text) => {
    mocks.acceptInvite.mockRejectedValue(new FunctionCallError(code, status, 'x'))
    const signInWithPassword = vi.fn(async () => null)
    openLink(undefined, { signInWithPassword })
    await fillAndSubmit()
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByLabelText(new RegExp(`^${t('invitation.password')}`))).not.toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_request', 400, t('auth.errors.weak_password')],
    ['rate_limited', 429, t('invitation.states.rate_limited')],
    ['internal', 500, t('invitation.errors.generic')],
  ])('an accept failure %s keeps the form, with its message', async (code, status, text) => {
    mocks.acceptInvite.mockRejectedValue(new FunctionCallError(code, status, 'x'))
    openLink()
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(passwordField()).toBeInTheDocument()
  })
})
