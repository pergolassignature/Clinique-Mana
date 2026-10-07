// SUPABASE_ALLOWED: test mocks the Supabase client module and builds real AuthApiError fixtures.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { AuthApiError, type AuthChangeEvent, type Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import { AuthProvider } from './AuthProvider'
import { useAuth, type AuthContextValue, type AuthErrorCode } from './auth-context'
import { RECOVERY_STORAGE_KEY, setRecoveryMarker } from './recovery'
import { fakeAccessToken } from '@/test/jwt'

type Listener = (event: AuthChangeEvent, session: Session | null) => void

const auth = vi.hoisted(() => ({
  listener: undefined as ((event: string, session: unknown) => void) | undefined,
  unsubscribe: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  reauthenticate: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
}))

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }))
vi.mock('@sentry/react', () => sentry)

const AUTH_STORAGE_KEY = vi.hoisted(() => 'test-auth-key')
vi.mock('@/core/supabase/client', () => ({ supabase: { auth }, AUTH_STORAGE_KEY }))

auth.onAuthStateChange.mockImplementation((callback: Listener) => {
  auth.listener = callback as typeof auth.listener
  return { data: { subscription: { unsubscribe: auth.unsubscribe } } }
})

const session = (token: string, userId = 'u1') => ({ access_token: token, user: { id: userId } }) as Session
/** A session whose access token carries a JWT session_id, like GoTrue's. */
const sessionWithId = (sessionId: string, userId = 'u1') => session(fakeAccessToken(sessionId), userId)
const apiError = (message: string, status: number, code?: string) => ({ data: {}, error: new AuthApiError(message, status, code) })
const origin = window.location.origin

function emit(event: AuthChangeEvent, next: Session | null) {
  act(() => auth.listener?.(event, next))
}

/** Renders the provider and returns a getter for the latest context value. */
function renderAuth() {
  const values: AuthContextValue[] = []
  function Probe() {
    values.push(useAuth())
    return null
  }
  const view = render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  const latest = (): AuthContextValue => {
    const value = values[values.length - 1]
    if (!value) throw new Error('AuthProvider has not rendered')
    return value
  }
  return { ...view, values, latest }
}

/** Renders and settles the initial (signed-out) session. */
function renderReady() {
  const view = renderAuth()
  emit('INITIAL_SESSION', null)
  return view.latest()
}

afterEach(() => {
  for (const fn of [auth.unsubscribe, auth.signInWithOtp, auth.signInWithPassword, auth.resetPasswordForEmail, auth.updateUser, auth.reauthenticate, auth.signOut, auth.getSession, sentry.captureMessage, sentry.captureException]) {
    fn.mockReset()
  }
  auth.listener = undefined
  setRecoveryMarker(null)
  localStorage.clear()
})

describe('session lifecycle', () => {
  it('stays loading until INITIAL_SESSION, which sets the session', () => {
    const { latest } = renderAuth()
    expect(latest().isLoading).toBe(true)
    emit('INITIAL_SESSION', session('t1'))
    expect(latest().isLoading).toBe(false)
    expect(latest().session?.access_token).toBe('t1')
  })

  it('stops loading on any event, even if INITIAL_SESSION never arrives', () => {
    const { latest } = renderAuth()
    emit('SIGNED_IN', session('t1'))
    expect(latest().isLoading).toBe(false)
  })

  it('ignores a session update with the same token and user', () => {
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', session('t1'))
    const before = latest()
    emit('TOKEN_REFRESHED', session('t1'))
    expect(latest()).toBe(before)
    emit('TOKEN_REFRESHED', session('t2'))
    expect(latest().session?.access_token).toBe('t2')
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderAuth()
    auth.unsubscribe.mockClear() // the previous test's cleanup unmount may have run after afterEach
    expect(auth.unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(auth.unsubscribe).toHaveBeenCalledOnce()
  })

  it('tracks password recovery from the auth events, in a marker bound to the session', () => {
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', null)
    expect(latest().isRecovery).toBe(false)
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    expect(latest().isRecovery).toBe(true)
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe('s1')
    emit('USER_UPDATED', sessionWithId('s1'))
    expect(latest().isRecovery).toBe(false)
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    emit('SIGNED_OUT', null)
    expect(latest().isRecovery).toBe(false)
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
  })
})

describe('password recovery across reloads and tabs', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('stays in recovery mode after a reload (marker in storage, same session)', () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 's1')
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', sessionWithId('s1'))
    expect(latest().isRecovery).toBe(true)
  })

  it('keeps recovery mode across token refreshes (same session_id)', () => {
    const { latest } = renderAuth()
    emit('PASSWORD_RECOVERY', session(fakeAccessToken('s1', { iat: 1 })))
    emit('TOKEN_REFRESHED', session(fakeAccessToken('s1', { iat: 2 })))
    expect(latest().isRecovery).toBe(true)
  })

  it('ignores a stale marker for another session', () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 's1')
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', sessionWithId('s2'))
    expect(latest().isRecovery).toBe(false)
  })

  it('follows a marker set or cleared in another tab', () => {
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', sessionWithId('s1'))
    expect(latest().isRecovery).toBe(false)
    localStorage.setItem(RECOVERY_STORAGE_KEY, 's1')
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: RECOVERY_STORAGE_KEY })))
    expect(latest().isRecovery).toBe(true)
    localStorage.clear()
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: null })))
    expect(latest().isRecovery).toBe(false)
  })

  /** Re-evaluates AuthProvider with the current URL (the hash is read at module evaluation). */
  async function renderFresh() {
    vi.resetModules()
    const { AuthProvider: FreshAuthProvider } = await import('./AuthProvider')
    const { useAuth: freshUseAuth } = await import('./auth-context')
    const values: AuthContextValue[] = []
    function Probe() {
      values.push(freshUseAuth())
      return null
    }
    render(
      <FreshAuthProvider>
        <Probe />
      </FreshAuthProvider>,
    )
    return () => values[values.length - 1]
  }

  // auth-js emits PASSWORD_RECOVERY once, possibly before the provider subscribes: the URL is read
  // when the module is evaluated, before auth-js strips the hash.
  it('marks the session from a recovery link URL', async () => {
    const token = fakeAccessToken('s1')
    window.history.replaceState(null, '', `/reinitialiser-mot-de-passe#access_token=${token}&refresh_token=y&type=recovery`)
    const latest = await renderFresh()
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe('s1')
    emit('INITIAL_SESSION', session(token))
    expect(latest()?.isRecovery).toBe(true)
  })

  it('does not mark anything for an expired link (no type=recovery)', async () => {
    window.history.replaceState(null, '', '/reinitialiser-mot-de-passe#error=access_denied&error_code=otp_expired')
    const latest = await renderFresh()
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
    emit('INITIAL_SESSION', sessionWithId('s1'))
    expect(latest()?.isRecovery).toBe(false)
  })
})

describe('sendMagicLink', () => {
  it('never creates an account and returns to /accueil by default', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await expect(renderReady().sendMagicLink('adjointe@mana.test')).resolves.toBeNull()
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'adjointe@mana.test',
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/accueil` },
    })
  })

  it.each([
    ['/professionnels?x=1', `${origin}/professionnels?x=1`],
    ['//evil.test', `${origin}/accueil`],
  ])('keeps a safe redirect target (%s)', async (target, expected) => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await renderReady().sendMagicLink('adjointe@mana.test', target)
    expect(auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: expected }) }),
    )
  })

  it.each([
    ['with the otp_disabled code', 'otp_disabled'],
    ['without a code', undefined],
  ])('treats "signups not allowed" (422) %s as success, so unknown emails are not revealed', async (_label, code) => {
    auth.signInWithOtp.mockResolvedValue(apiError('Signups not allowed for otp', 422, code))
    await expect(renderReady().sendMagicLink('unknown@mana.test')).resolves.toBeNull()
  })
})

describe('email rate limits (no account enumeration)', () => {
  const send = {
    sendMagicLink: (value: AuthContextValue) => value.sendMagicLink('adjointe@mana.test'),
    sendPasswordReset: (value: AuthContextValue) => value.sendPasswordReset('adjointe@mana.test'),
  }
  const mockFor = { sendMagicLink: auth.signInWithOtp, sendPasswordReset: auth.resetPasswordForEmail }
  const fns = ['sendMagicLink', 'sendPasswordReset'] as const

  // GoTrue only applies the per-email throttle to existing accounts: reporting it would reveal them.
  it.each(fns)('%s treats the per-email throttle as success', async (fn) => {
    mockFor[fn].mockResolvedValue(apiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit'))
    await expect(send[fn](renderReady())).resolves.toBeNull()
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  // Same code, project-wide: the SMTP quota is spent and nobody receives emails. Still neutral for
  // the user, but it must be visible to us.
  it.each(fns)('%s reports an exhausted email quota to Sentry, still as success', async (fn) => {
    mockFor[fn].mockResolvedValue(apiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit'))
    await expect(send[fn](renderReady())).resolves.toBeNull()
    expect(sentry.captureMessage).toHaveBeenCalledWith('Auth email quota exceeded', 'warning')
  })

  it.each(fns)('%s reports IP-level throttling as rate_limited', async (fn) => {
    mockFor[fn].mockResolvedValue(apiError('Request rate limit reached', 429, 'over_request_rate_limit'))
    await expect(send[fn](renderReady())).resolves.toBe('rate_limited')
  })

  it.each(fns)('%s reports any other 429 as rate_limited', async (fn) => {
    mockFor[fn].mockResolvedValue(apiError('Too many requests', 429, undefined))
    await expect(send[fn](renderReady())).resolves.toBe('rate_limited')
  })
})

describe('error codes', () => {
  it('maps invalid credentials by code, with a message fallback', async () => {
    const value = renderReady()
    auth.signInWithPassword.mockResolvedValueOnce(apiError('Invalid login credentials', 400, 'invalid_credentials'))
    await expect(value.signInWithPassword('a@mana.test', 'x')).resolves.toBe('invalid_credentials')
    auth.signInWithPassword.mockResolvedValueOnce(apiError('Invalid login credentials', 400, undefined))
    await expect(value.signInWithPassword('a@mana.test', 'x')).resolves.toBe('invalid_credentials')
  })

  it.each(['weak_password', 'same_password', 'reauthentication_needed'] as const)('maps %s', async (code) => {
    auth.updateUser.mockResolvedValue(apiError('some server message', 422, code))
    await expect(renderReady().updatePassword('x')).resolves.toBe(code)
  })

  it('maps anything else to unknown', async () => {
    auth.updateUser.mockResolvedValue(apiError('boom', 500, 'unexpected_failure'))
    await expect(renderReady().updatePassword('x')).resolves.toBe('unknown')
  })

  it.each([
    ['email_exists', 'email_exists'],
    ['email_address_invalid', 'invalid_email'],
  ] as const)('maps %s for an email change', async (serverCode, code) => {
    auth.updateUser.mockResolvedValue(apiError('some server message', 422, serverCode))
    await expect(renderReady().updateEmail('a@mana.test')).resolves.toBe(code)
  })

  it('maps reauthentication_not_valid (wrong or expired code) to invalid_code', async () => {
    auth.updateUser.mockResolvedValue(apiError('Requires reauthentication', 400, 'reauthentication_not_valid'))
    await expect(renderReady().updatePassword('un-long-mot-de-passe', '123456')).resolves.toBe('invalid_code')
  })
})

describe('updatePassword', () => {
  it('sends only the password without a code', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    await expect(renderReady().updatePassword('un-long-mot-de-passe')).resolves.toBeNull()
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'un-long-mot-de-passe' })
  })

  // GoTrue asks for a code (secure_password_change) when the session is older than 24 h.
  it('passes the reauthentication code as the nonce', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    await expect(renderReady().updatePassword('un-long-mot-de-passe', '123456')).resolves.toBeNull()
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'un-long-mot-de-passe', nonce: '123456' })
  })
})

describe('sendReauthenticationCode', () => {
  it('asks GoTrue to email a code', async () => {
    auth.reauthenticate.mockResolvedValue({ data: { user: null, session: null }, error: null })
    await expect(renderReady().sendReauthenticationCode()).resolves.toBeNull()
    expect(auth.reauthenticate).toHaveBeenCalledOnce()
  })

  // The caller is signed in: no enumeration concern, so the per-email throttle is reported.
  it('reports the email throttle as rate_limited', async () => {
    auth.reauthenticate.mockResolvedValue(apiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit'))
    await expect(renderReady().sendReauthenticationCode()).resolves.toBe('rate_limited')
  })
})

describe('updateEmail', () => {
  it('asks for the change and brings the confirmation links back to « Mon compte »', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    await expect(renderReady().updateEmail('nouvelle@mana.test')).resolves.toBeNull()
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ email: 'nouvelle@mana.test' }, { emailRedirectTo: `${origin}/mon-compte` })
  })

  it('reports the email throttle as rate_limited', async () => {
    auth.updateUser.mockResolvedValue(apiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit'))
    await expect(renderReady().updateEmail('nouvelle@mana.test')).resolves.toBe('rate_limited')
  })
})

describe('updatePassword after a recovery link', () => {
  it('signs out the other sessions once the password is changed', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    auth.signOut.mockResolvedValue({ error: null })
    const { latest } = renderAuth()
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    await expect(latest().updatePassword('un-long-mot-de-passe')).resolves.toBeNull()
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'others' })
  })

  it('keeps the other sessions for an ordinary password change', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', sessionWithId('s1'))
    await latest().updatePassword('un-long-mot-de-passe')
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps the other sessions when the update fails', async () => {
    auth.updateUser.mockResolvedValue(apiError('same', 422, 'same_password'))
    const { latest } = renderAuth()
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    await expect(latest().updatePassword('x')).resolves.toBe('same_password')
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it.each([
    ['returns an error', () => auth.signOut.mockResolvedValue(apiError('Failed to fetch', 0))],
    ['throws', () => auth.signOut.mockRejectedValue(new Error('network'))],
  ])('still succeeds, and reports to Sentry, when signing out the others %s', async (_label, fail) => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    fail()
    const { latest } = renderAuth()
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    await expect(latest().updatePassword('un-long-mot-de-passe')).resolves.toBeNull()
    expect(sentry.captureException).toHaveBeenCalledOnce()
  })
})

describe('signOut (this device only)', () => {
  /** Renders signed in as t1 and returns the latest-value getter. */
  function renderSignedIn() {
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', session('t1'))
    return latest
  }

  async function signOut(latest: () => AuthContextValue) {
    await act(async () => {
      await latest().signOut()
    })
  }

  afterEach(() => localStorage.clear())

  it('makes exactly one local sign-out call when it succeeds', async () => {
    auth.signOut.mockResolvedValue({ error: null })
    const latest = renderSignedIn()
    await signOut(latest)
    expect(auth.signOut).toHaveBeenCalledOnce()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(latest().session).toBeNull()
  })

  it.each([
    ['returns an error (e.g. offline)', () => auth.signOut.mockResolvedValueOnce(apiError('Failed to fetch', 0))],
    ['throws (e.g. a lock timeout)', () => auth.signOut.mockRejectedValueOnce(new Error('lock timeout'))],
  ])('forgets the stored session before retrying locally when the first call %s', async (_label, failFirst) => {
    localStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"t1"}')
    const storedAtRetry: (string | null)[] = []
    failFirst()
    auth.signOut.mockImplementation(async () => {
      storedAtRetry.push(localStorage.getItem(AUTH_STORAGE_KEY))
      return { error: null }
    })
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const latest = renderSignedIn()

    await signOut(latest)

    expect(auth.signOut).toHaveBeenCalledTimes(2)
    expect(auth.signOut).toHaveBeenNthCalledWith(1, { scope: 'local' })
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' })
    expect(storedAtRetry).toEqual([null])
    expect(latest().session).toBeNull()
  })

  it('forgets again if a concurrent refresh re-saved the session', async () => {
    auth.signOut.mockResolvedValueOnce(apiError('Failed to fetch', 0)).mockResolvedValue({ error: null })
    auth.getSession.mockResolvedValue({ data: { session: session('t2') }, error: null })
    const latest = renderSignedIn()

    await signOut(latest)

    expect(auth.signOut).toHaveBeenCalledTimes(3)
    expect(latest().session).toBeNull()
  })

  // RequireAuth sends an explicit sign-out to plain /connexion (no ?redirect= back to the last page).
  it('remembers that this tab signed out, from the click until the next session', async () => {
    let finish: (value: { error: null }) => void = () => {}
    auth.signOut.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const latest = renderSignedIn()
    expect(latest().signedOutHere).toBe(false)
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = latest().signOut()
    })
    expect(latest().signedOutHere).toBe(true) // set first, before the server answers
    await act(async () => {
      finish({ error: null })
      await pending
    })
    expect(latest().signedOutHere).toBe(true)
    expect(latest().session).toBeNull()
    emit('SIGNED_IN', session('t2'))
    expect(latest().signedOutHere).toBe(false)
  })

  it('does not flag a sign-out that happened elsewhere (another tab, expiry)', () => {
    const latest = renderSignedIn()
    emit('SIGNED_OUT', null)
    expect(latest().signedOutHere).toBe(false)
  })

  it('leaves recovery mode and clears the marker', async () => {
    auth.signOut.mockResolvedValue({ error: null })
    const latest = renderSignedIn()
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    expect(latest().isRecovery).toBe(true)
    await signOut(latest)
    expect(latest().isRecovery).toBe(false)
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
  })
})

describe('signOutEverywhere', () => {
  function renderSignedIn() {
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', session('t1'))
    return latest
  }

  async function signOutEverywhere(latest: () => AuthContextValue) {
    let code: AuthErrorCode | null = null
    await act(async () => {
      code = await latest().signOutEverywhere()
    })
    return code
  }

  it('ends every session of the account, then forgets this one like signOut', async () => {
    auth.signOut.mockResolvedValue({ error: null })
    const latest = renderSignedIn()
    emit('PASSWORD_RECOVERY', sessionWithId('s1'))
    await expect(signOutEverywhere(latest)).resolves.toBeNull()
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'global' })
    expect(latest().session).toBeNull()
    expect(latest().signedOutHere).toBe(true)
    expect(latest().isRecovery).toBe(false)
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
  })

  // auth-js emits SIGNED_OUT during the call: RequireAuth must already know it was explicit (#17).
  it('flags the explicit sign-out before the server answers', async () => {
    let finish: (value: { error: null }) => void = () => {}
    auth.signOut.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const latest = renderSignedIn()
    let pending: Promise<AuthErrorCode | null> = Promise.resolve(null)
    act(() => {
      pending = latest().signOutEverywhere()
    })
    expect(latest().signedOutHere).toBe(true)
    await act(async () => {
      finish({ error: null })
      await pending
    })
    expect(latest().session).toBeNull()
  })

  it.each([
    ['returns an error', () => auth.signOut.mockResolvedValue(apiError('boom', 500, 'unexpected_failure')), 'unknown'],
    ['is throttled', () => auth.signOut.mockResolvedValue(apiError('Request rate limit reached', 429, 'over_request_rate_limit')), 'rate_limited'],
    ['throws (offline, lock timeout)', () => auth.signOut.mockRejectedValue(new Error('network')), 'unknown'],
  ])('keeps this session and reports the failure when the call %s', async (_label, fail, code) => {
    fail()
    const latest = renderSignedIn()
    await expect(signOutEverywhere(latest)).resolves.toBe(code)
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'global' })
    expect(latest().session?.access_token).toBe('t1')
    expect(latest().signedOutHere).toBe(false)
  })
})

describe('FR-CA messages', () => {
  // Record<AuthErrorCode, …> fails to compile if a code is added without being listed here.
  const codes: Record<AuthErrorCode, true> = {
    invalid_credentials: true,
    weak_password: true,
    same_password: true,
    reauthentication_needed: true,
    invalid_code: true,
    email_exists: true,
    invalid_email: true,
    rate_limited: true,
    unknown: true,
  }

  it.each(Object.keys(codes) as AuthErrorCode[])('has a message for %s', (code) => {
    expect(t(`auth.errors.${code}`)).not.toBe(`auth.errors.${code}`)
  })
})
