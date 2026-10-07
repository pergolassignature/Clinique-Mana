import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { renderWithContexts } from '@/test/contexts'
import { LoginPage } from './LoginPage'

// Mounted at '/' with a stand-in for the post-login target, so navigation is observable.
const loginAt = (path: string, auth: Partial<AuthContextValue>) =>
  renderWithContexts(
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/accueil" element={<p>HOME PAGE</p>} />
      <Route path="/professionnels" element={<p>PROFESSIONALS PAGE</p>} />
    </Routes>,
    { auth: { session: null, ...auth }, path },
  )

describe('LoginPage', () => {
  it('signs in with email and password', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue(null)
    render(loginAt('/', { signInWithPassword }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.type(screen.getByLabelText(t('auth.login.password')), 'x')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.submit') }))
    expect(signInWithPassword).toHaveBeenCalledWith('admin@mana.test', 'x')
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument()
  })

  it('returns to the sanitised redirect target after signing in', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue(null)
    render(loginAt('/?redirect=%2Fprofessionnels', { signInWithPassword }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.type(screen.getByLabelText(t('auth.login.password')), 'x')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.submit') }))
    expect(await screen.findByText('PROFESSIONALS PAGE')).toBeInTheDocument()
  })

  it('shows the error for wrong credentials', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue('invalid_credentials')
    render(loginAt('/', { signInWithPassword }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.type(screen.getByLabelText(t('auth.login.password')), 'bad')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.submit') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('auth.errors.invalid_credentials'))
    expect(screen.queryByText('HOME PAGE')).not.toBeInTheDocument()
  })

  it('validates the email before calling the server', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue(null)
    render(loginAt('/', { signInWithPassword }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'pas-un-courriel')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.submit') }))
    expect(await screen.findByText(t('auth.errors.invalidEmail'))).toBeInTheDocument()
    expect(screen.getByText(t('auth.errors.required'))).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('sends a magic link without creating accounts', async () => {
    const sendMagicLink = vi.fn().mockResolvedValue(null)
    render(loginAt('/', { sendMagicLink }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.magicLink') }))
    expect(sendMagicLink).toHaveBeenCalledWith('admin@mana.test', '/accueil')
    expect(await screen.findByText(t('auth.login.magicLinkSent'))).toBeInTheDocument()
  })

  it('passes the redirect target to the magic link', async () => {
    const sendMagicLink = vi.fn().mockResolvedValue(null)
    render(loginAt('/?redirect=%2Fprofessionnels%3Fx%3D1', { sendMagicLink }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.magicLink') }))
    expect(sendMagicLink).toHaveBeenCalledWith('admin@mana.test', '/professionnels?x=1')
  })

  it('never passes an external redirect target to the magic link', async () => {
    const sendMagicLink = vi.fn().mockResolvedValue(null)
    render(loginAt('/?redirect=https%3A%2F%2Fevil.example', { sendMagicLink }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.magicLink') }))
    expect(sendMagicLink).toHaveBeenCalledWith('admin@mana.test', '/accueil')
  })

  it('does not send a magic link to an invalid email', async () => {
    const sendMagicLink = vi.fn().mockResolvedValue(null)
    render(loginAt('/', { sendMagicLink }))
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.magicLink') }))
    expect(await screen.findByText(t('auth.errors.invalidEmail'))).toBeInTheDocument()
    expect(sendMagicLink).not.toHaveBeenCalled()
  })

  it('shows a rate-limit error from the magic link', async () => {
    const sendMagicLink = vi.fn().mockResolvedValue('rate_limited')
    render(loginAt('/', { sendMagicLink }))
    await userEvent.type(screen.getByLabelText(t('auth.login.email')), 'admin@mana.test')
    await userEvent.click(screen.getByRole('button', { name: t('auth.login.magicLink') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('auth.errors.rate_limited'))
    expect(screen.queryByText(t('auth.login.magicLinkSent'))).not.toBeInTheDocument()
  })

  it('sends an already signed-in user to the target', () => {
    render(loginAt('/?redirect=%2Fprofessionnels', { session: { user: { id: 'u1' } } as Session }))
    expect(screen.getByText('PROFESSIONALS PAGE')).toBeInTheDocument()
  })

  it('links to the forgotten-password page', () => {
    render(loginAt('/', {}))
    expect(screen.getByRole('link', { name: t('auth.login.forgot') })).toHaveAttribute('href', '/mot-de-passe-oublie')
  })
})
