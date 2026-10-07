import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { AuthErrorCode } from '@/core/auth/auth-context'
import { renderWithContexts } from '@/test/contexts'
import { ForgotPasswordPage } from './ForgotPasswordPage'

describe('ForgotPasswordPage', () => {
  it('shows a neutral message when the email was sent, and moves focus to the heading', async () => {
    const sendPasswordReset = vi.fn().mockResolvedValue(null)
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null, sendPasswordReset } }))
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'someone@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.forgot.submit') }))
    expect(sendPasswordReset).toHaveBeenCalledWith('someone@mana.test')
    await waitFor(() => expect(region).toHaveTextContent(t('auth.forgot.sent')))
    // The live region announces the message; focusing the heading (not the message) avoids a
    // second announcement of the same text.
    expect(screen.getByRole('heading', { level: 1, name: t('auth.forgot.title') })).toHaveFocus()
    expect(screen.getByText(t('auth.forgot.sent'))).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Neither error reveals whether an account exists (the per-email throttle is reported as success).
  it.each<AuthErrorCode>(['rate_limited', 'unknown'])('shows the %s error, so the user knows nothing was sent', async (code) => {
    const sendPasswordReset = vi.fn().mockResolvedValue(code)
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null, sendPasswordReset } }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'someone@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.forgot.submit') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`auth.errors.${code}`))
    expect(screen.queryByText(t('auth.forgot.sent'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('auth.forgot.submit') })).toBeInTheDocument()
  })

  it('does not capitalise or spell-check the email', () => {
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null } }))
    const email = screen.getByLabelText(t('auth.login.email'))
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('spellcheck', 'false')
  })

  it('validates the email before calling the server', async () => {
    const sendPasswordReset = vi.fn().mockResolvedValue(null)
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null, sendPasswordReset } }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'pas-un-courriel')
    await userEvent.click(screen.getByRole('button', { name: t('auth.forgot.submit') }))
    expect(await screen.findByText(t('auth.errors.invalidEmail'))).toBeInTheDocument()
    expect(sendPasswordReset).not.toHaveBeenCalled()
  })

  it('titles the browser tab', () => {
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null } }))
    expect(document.title).toBe(`${t('pageTitles.forgot')} · ${t('app.name')}`)
  })

  it('links back to the login page', () => {
    render(renderWithContexts(<ForgotPasswordPage />, { auth: { session: null } }))
    expect(screen.getByRole('link', { name: t('auth.forgot.back') })).toHaveAttribute('href', '/connexion')
  })
})
