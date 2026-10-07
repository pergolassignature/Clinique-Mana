import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { RequireAccess, RequireAuth } from './guards'

describe('RequireAuth', () => {
  it('redirects to login when signed out', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { auth: { session: null }, path: '/professionnels' }))
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
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

  it('explains a disabled account', () => {
    render(renderWithContexts(<RequireAuth><p>SECRET</p></RequireAuth>, { access: { status: 'denied', problem: 'profile_disabled' } }))
    expect(screen.getByText(t('access.denied.profile_disabled'))).toBeInTheDocument()
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

  it('shows forbidden without the permission', () => {
    render(renderWithContexts(<RequireAccess permission="settings.manage"><p>SETTINGS</p></RequireAccess>))
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })
})
