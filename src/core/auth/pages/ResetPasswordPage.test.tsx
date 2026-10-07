import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { renderWithContexts } from '@/test/contexts'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ResetPasswordPage } from './ResetPasswordPage'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/ui/sonner', () => ({ toast }))

afterEach(() => toast.success.mockReset())

const recoverySession = { user: { id: 'u1', email: 'staff@mana.test' } } as Session

const resetAt = (auth: Partial<AuthContextValue>, path = '/') =>
  renderWithContexts(
    <Routes>
      <Route path="/" element={<ResetPasswordPage />} />
      <Route path="/accueil" element={<p>HOME PAGE</p>} />
      <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
    </Routes>,
    { auth: { session: recoverySession, isRecovery: true, ...auth }, path },
  )

async function fill(password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText(t('auth.reset.password')), password)
  await userEvent.type(screen.getByLabelText(t('auth.reset.confirm')), confirm)
  await userEvent.click(screen.getByRole('button', { name: t('auth.reset.submit') }))
}

describe('ResetPasswordPage', () => {
  it('explains an invalid or expired link when there is no session', () => {
    render(resetAt({ session: null, isRecovery: false }))
    expect(screen.getByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
    expect(screen.queryByLabelText(t('auth.reset.password'))).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.reset.requestNew') })).toHaveAttribute('href', '/mot-de-passe-oublie')
    expect(screen.queryByRole('link', { name: t('auth.reset.backHome') })).not.toBeInTheDocument()
  })

  // auth-js keeps an existing session when an expired link lands here with #error_code=….
  it('explains a failed link even when a session exists, with a way home', () => {
    render(resetAt({ isRecovery: false }, '/#error=access_denied&error_code=otp_expired&error_description=x'))
    expect(screen.getByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
    expect(screen.queryByLabelText(t('auth.reset.password'))).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.reset.backHome') })).toHaveAttribute('href', '/accueil')
  })

  it('sends an ordinary (non-recovery) session to the app', () => {
    render(resetAt({ isRecovery: false }))
    expect(screen.getByText('HOME PAGE')).toBeInTheDocument()
  })

  it('waits for the session instead of calling the link invalid', () => {
    render(resetAt({ session: null, isLoading: true }))
    expect(screen.getByText(t('common.loading'))).toBeInTheDocument()
    expect(screen.queryByText(t('auth.reset.invalidLink'))).not.toBeInTheDocument()
  })

  it('requires both passwords to match', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null)
    render(resetAt({ updatePassword }))
    await fill('un-long-mot-de-passe', 'un-autre-mot-de-passe')
    expect(await screen.findByText(t('auth.reset.mismatch'))).toBeInTheDocument()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('requires at least 10 characters', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null)
    render(resetAt({ updatePassword }))
    await fill('court', 'court')
    expect(await screen.findByText(t('auth.reset.tooShort'))).toBeInTheDocument()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('accepts at most 72 bytes (the bcrypt limit)', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null)
    render(resetAt({ updatePassword }))
    const long = 'é'.repeat(37) // 37 characters, 74 bytes
    await fill(long, long)
    expect(await screen.findByText(t('auth.reset.tooLong'))).toBeInTheDocument()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('tells password managers which account the new password belongs to', () => {
    const { container } = render(resetAt({}))
    expect(container.querySelector('input[autocomplete="username"]')).toHaveValue('staff@mana.test')
  })

  it('announces loading through the same live region', () => {
    render(resetAt({ session: null, isLoading: true }))
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
  })

  it('updates the password, confirms and opens the app', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null)
    render(resetAt({ updatePassword }))
    await fill('un-long-mot-de-passe', 'un-long-mot-de-passe')
    expect(updatePassword).toHaveBeenCalledWith('un-long-mot-de-passe')
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith(t('auth.reset.success'))
  })

  it.each(['same_password', 'weak_password'] as const)('shows the %s error', async (code) => {
    const updatePassword = vi.fn().mockResolvedValue(code)
    render(resetAt({ updatePassword }))
    await fill('un-long-mot-de-passe', 'un-long-mot-de-passe')
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`auth.errors.${code}`))
    expect(screen.queryByText('HOME PAGE')).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  // No trap: a recovery session that GoTrue no longer accepts is signed out and sent to ask again.
  it('signs out and asks for a new link when reauthentication is needed', async () => {
    const updatePassword = vi.fn().mockResolvedValue('reauthentication_needed')
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(resetAt({ updatePassword, signOut }))
    await fill('un-long-mot-de-passe', 'un-long-mot-de-passe')
    expect(signOut).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: t('auth.forgot.title') })).toBeInTheDocument()
    expect(screen.getByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
  })

  it('lets the user cancel: signs out and returns to the login page', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(resetAt({ signOut }))
    await userEvent.click(screen.getByRole('button', { name: t('auth.reset.cancel') }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.getByTestId('login-search')).toHaveTextContent('')
  })
})
