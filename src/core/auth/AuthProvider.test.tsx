// SUPABASE_ALLOWED: test mocks the Supabase client module and builds real AuthApiError fixtures.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { AuthApiError, type AuthChangeEvent, type Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import { AuthProvider } from './AuthProvider'
import { useAuth, type AuthContextValue, type AuthErrorCode } from './auth-context'

type Listener = (event: AuthChangeEvent, session: Session | null) => void

const auth = vi.hoisted(() => ({
  listener: undefined as ((event: string, session: unknown) => void) | undefined,
  unsubscribe: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
}))

const AUTH_STORAGE_KEY = vi.hoisted(() => 'test-auth-key')
vi.mock('@/core/supabase/client', () => ({ supabase: { auth }, AUTH_STORAGE_KEY }))

auth.onAuthStateChange.mockImplementation((callback: Listener) => {
  auth.listener = callback as typeof auth.listener
  return { data: { subscription: { unsubscribe: auth.unsubscribe } } }
})

const session = (token: string, userId = 'u1') => ({ access_token: token, user: { id: userId } }) as Session
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
  for (const fn of [auth.unsubscribe, auth.signInWithOtp, auth.signInWithPassword, auth.resetPasswordForEmail, auth.updateUser, auth.signOut, auth.getSession]) {
    fn.mockReset()
  }
  auth.listener = undefined
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

  it('tracks password recovery from the auth events', () => {
    const { latest } = renderAuth()
    emit('INITIAL_SESSION', null)
    expect(latest().isRecovery).toBe(false)
    emit('PASSWORD_RECOVERY', session('t1'))
    expect(latest().isRecovery).toBe(true)
    emit('USER_UPDATED', session('t1'))
    expect(latest().isRecovery).toBe(false)
    emit('PASSWORD_RECOVERY', session('t1'))
    emit('SIGNED_OUT', null)
    expect(latest().isRecovery).toBe(false)
  })
})

describe('sendMagicLink', () => {
  it('never creates an account and returns to /accueil by default', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await expect(renderReady().sendMagicLink('staff@mana.test')).resolves.toBeNull()
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'staff@mana.test',
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/accueil` },
    })
  })

  it.each([
    ['/professionnels?x=1', `${origin}/professionnels?x=1`],
    ['//evil.test', `${origin}/accueil`],
  ])('keeps a safe redirect target (%s)', async (target, expected) => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await renderReady().sendMagicLink('staff@mana.test', target)
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
    sendMagicLink: (value: AuthContextValue) => value.sendMagicLink('staff@mana.test'),
    sendPasswordReset: (value: AuthContextValue) => value.sendPasswordReset('staff@mana.test'),
  }
  const mockFor = { sendMagicLink: auth.signInWithOtp, sendPasswordReset: auth.resetPasswordForEmail }
  const fns = ['sendMagicLink', 'sendPasswordReset'] as const

  // GoTrue only applies the per-email throttle to existing accounts: reporting it would reveal them.
  it.each(fns)('%s treats the per-email throttle as success', async (fn) => {
    mockFor[fn].mockResolvedValue(apiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit'))
    await expect(send[fn](renderReady())).resolves.toBeNull()
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

  it('leaves recovery mode', async () => {
    auth.signOut.mockResolvedValue({ error: null })
    const latest = renderSignedIn()
    emit('PASSWORD_RECOVERY', session('t1'))
    await signOut(latest)
    expect(latest().isRecovery).toBe(false)
  })
})

describe('FR-CA messages', () => {
  // Record<AuthErrorCode, …> fails to compile if a code is added without being listed here.
  const codes: Record<AuthErrorCode, true> = {
    invalid_credentials: true,
    weak_password: true,
    same_password: true,
    reauthentication_needed: true,
    rate_limited: true,
    unknown: true,
  }

  it.each(Object.keys(codes) as AuthErrorCode[])('has a message for %s', (code) => {
    expect(t(`auth.errors.${code}`)).not.toBe(`auth.errors.${code}`)
  })
})
