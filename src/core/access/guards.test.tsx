import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { RequireAccess, RequireAuth } from './guards'

describe('RequireAuth', () => {
  it('redirects to login when signed out, keeping the target', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { auth: { session: null }, path: '/professionnels?x=1' }))
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.getByTestId('login-search')).toHaveTextContent('?redirect=%2Fprofessionnels%3Fx%3D1')
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('sends an explicit sign-out to the plain login page (no way back to the last page)', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { auth: { session: null, signedOutHere: true }, path: '/parametres' }))
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.getByTestId('login-search')).toHaveTextContent('')
  })

  it.each([
    ['auth is loading', { auth: { isLoading: true } }],
    ['access is loading', { access: { status: 'loading' as const, access: null } }],
    ['access is idle', { access: { status: 'idle' as const, access: null } }],
  ])('never renders children while %s', (_label, options) => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, options))
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('sends a password-recovery session to the reset page', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { auth: { isRecovery: true }, path: '/accueil' }))
    expect(screen.getByText('RESET PAGE')).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('shows a retry screen when access fails to load', async () => {
    const reload = vi.fn()
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { access: { status: 'error', reload } }))
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(reload).toHaveBeenCalled()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('disables the retry button while access is reloading', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { access: { status: 'error', isReloading: true } }))
    expect(screen.getByRole('button', { name: t('common.retry') })).toBeDisabled()
  })

  it('explains a disabled account', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { access: { status: 'denied', problem: 'profile_disabled' } }))
    expect(screen.getByText(t('access.denied.profile_disabled'))).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument()
  })

  it('renders children when ready', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>))
    expect(screen.getByText('SECRET')).toBeInTheDocument()
  })
})

describe('RequireAccess', () => {
  it('renders children with the permission', () => {
    render(renderWithContexts(<RequireAccess permission="settings.view"><p>SETTINGS</p></RequireAccess>))
    expect(screen.getByText('SETTINGS')).toBeInTheDocument()
  })

  it('derives the permission check from an overridden access', () => {
    const access = { ...testAccess, permissions: ['settings.manage'] }
    render(renderWithContexts(<RequireAccess permission="settings.manage"><p>SETTINGS</p></RequireAccess>, { access: { access } }))
    expect(screen.getByText('SETTINGS')).toBeInTheDocument()
  })

  it('shows forbidden without the permission', () => {
    render(renderWithContexts(<RequireAccess permission="settings.manage"><p>SETTINGS</p></RequireAccess>))
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })
})
