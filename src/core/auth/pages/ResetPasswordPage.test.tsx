import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { renderWithContexts } from '@/test/contexts'
import { ResetPasswordPage } from './ResetPasswordPage'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/ui/sonner', () => ({ toast }))

afterEach(() => toast.success.mockReset())

const resetAt = (auth: Partial<AuthContextValue>) =>
  renderWithContexts(
    <Routes>
      <Route path="/" element={<ResetPasswordPage />} />
      <Route path="/accueil" element={<p>HOME PAGE</p>} />
    </Routes>,
    { auth, path: '/' },
  )

async function fill(password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText(t('auth.reset.password')), password)
  await userEvent.type(screen.getByLabelText(t('auth.reset.confirm')), confirm)
  await userEvent.click(screen.getByRole('button', { name: t('auth.reset.submit') }))
}

describe('ResetPasswordPage', () => {
  it('explains an invalid or expired link when there is no session', () => {
    render(resetAt({ session: null }))
    expect(screen.getByText(t('auth.reset.invalidLink'))).toBeInTheDocument()
    expect(screen.queryByLabelText(t('auth.reset.password'))).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.reset.requestNew') })).toHaveAttribute('href', '/mot-de-passe-oublie')
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

  it('updates the password, confirms and opens the app', async () => {
    const updatePassword = vi.fn().mockResolvedValue(null)
    render(resetAt({ updatePassword }))
    await fill('un-long-mot-de-passe', 'un-long-mot-de-passe')
    expect(updatePassword).toHaveBeenCalledWith('un-long-mot-de-passe')
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith(t('auth.reset.success'))
  })

  it.each(['same_password', 'weak_password', 'reauthentication_needed'] as const)('shows the %s error', async (code) => {
    const updatePassword = vi.fn().mockResolvedValue(code)
    render(resetAt({ updatePassword }))
    await fill('un-long-mot-de-passe', 'un-long-mot-de-passe')
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`auth.errors.${code}`))
    expect(screen.queryByText('HOME PAGE')).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
