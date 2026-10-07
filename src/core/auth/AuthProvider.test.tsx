// SUPABASE_ALLOWED: test mocks the Supabase client module and builds real AuthApiError fixtures.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AuthApiError } from '@supabase/supabase-js'
import { AuthProvider, useAuth, type AuthContextValue } from './AuthProvider'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
  signInWithOtp: vi.fn(),
}))

vi.mock('@/core/supabase/client', () => ({ supabase: { auth } }))

async function renderAuth(): Promise<AuthContextValue> {
  let current: AuthContextValue | undefined
  function Probe() {
    current = useAuth()
    return null
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  await waitFor(() => expect(current?.isLoading).toBe(false))
  return current as AuthContextValue
}

describe('sendMagicLink', () => {
  afterEach(() => auth.signInWithOtp.mockReset())

  it('never creates an account', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    const { sendMagicLink } = await renderAuth()
    await expect(sendMagicLink('staff@mana.test')).resolves.toBeNull()
    expect(auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'staff@mana.test', options: expect.objectContaining({ shouldCreateUser: false }) }),
    )
  })

  it.each([
    ['with the otp_disabled code', 'otp_disabled'],
    ['without a code', undefined],
  ])('treats "signups not allowed" (422) %s as success, so unknown emails are not revealed', async (_label, code) => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: new AuthApiError('Signups not allowed for otp', 422, code) })
    const { sendMagicLink } = await renderAuth()
    await expect(sendMagicLink('unknown@mana.test')).resolves.toBeNull()
  })

  it('reports rate limiting (429)', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit'),
    })
    const { sendMagicLink } = await renderAuth()
    await expect(sendMagicLink('staff@mana.test')).resolves.toBe('rate_limited')
  })
})
