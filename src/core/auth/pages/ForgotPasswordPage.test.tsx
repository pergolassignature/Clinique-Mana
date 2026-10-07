import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { AuthErrorCode } from '@/core/auth/auth-context'
import { renderWithContexts } from '@/test/contexts'
import { ForgotPasswordPage } from './ForgotPasswordPage'

describe('ForgotPasswordPage', () => {
  it.each<[string, AuthErrorCode | null]>([
    ['the email was sent', null],
    ['the server failed', 'unknown'],
    ['the IP is throttled', 'rate_limited'],
  ])('shows the same neutral message when %s', async (_label, result) => {
    const sendPasswordReset = vi.fn().mockResolvedValue(result)
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null, sendPasswordReset } }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'someone@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.forgot.submit') }))
    expect(sendPasswordReset).toHaveBeenCalledWith('someone@mana.test')
    expect(await screen.findByRole('status')).toHaveTextContent(t('auth.forgot.sent'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('validates the email before calling the server', async () => {
    const sendPasswordReset = vi.fn().mockResolvedValue(null)
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null, sendPasswordReset } }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'pas-un-courriel')
    await userEvent.click(screen.getByRole('button', { name: t('auth.forgot.submit') }))
    expect(await screen.findByText(t('auth.errors.invalidEmail'))).toBeInTheDocument()
    expect(sendPasswordReset).not.toHaveBeenCalled()
  })

  it('links back to the login page', () => {
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null } }))
    expect(screen.getByRole('link', { name: t('auth.forgot.back') })).toHaveAttribute('href', '/connexion')
  })
})
