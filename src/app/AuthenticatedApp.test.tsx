import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { AuthenticatedApp } from './AuthenticatedApp'

const adminLike: Access = {
  ...testAccess,
  display_name: 'Camille Admin',
  role: 'admin',
  permissions: ['settings.view', 'professionals.view'],
  modules: ['professionals'],
}

const appAt = (path: string, access: Access = adminLike, auth: Parameters<typeof renderWithContexts>[1] = {}) =>
  renderWithContexts(<AuthenticatedApp />, { ...auth, access: { access }, path })

const menuLinks = () =>
  within(screen.getByRole('navigation', { name: t('nav.label') }))
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('AuthenticatedApp', () => {
  it('opens the home page from the root', () => {
    render(appAt('/'))
    expect(screen.getByRole('heading', { name: `${t('home.title')}, Camille Admin` })).toBeInTheDocument()
  })

  it('shows Accueil, Professionnels and Paramètres to an admin-like user', () => {
    render(appAt('/accueil'))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name'), t('nav.settings')])
    expect(screen.getByRole('link', { name: t('modules.professionals.name') })).toHaveAttribute('href', '/professionnels')
  })

  it('hides Paramètres without settings.view', () => {
    render(appAt('/accueil', { ...adminLike, permissions: ['professionals.view'] }))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name')])
  })

  it('refuses the settings route without settings.view', () => {
    render(appAt('/parametres', { ...adminLike, permissions: ['professionals.view'] }))
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })

  it('mounts the settings shell under /parametres', () => {
    render(appAt('/parametres'))
    // No modules.manage: the shell renders, with no section to show.
    expect(screen.getByRole('heading', { name: t('settings.title') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.empty'))).toBeInTheDocument()
  })

  it('renders the module placeholder at its route', async () => {
    render(appAt('/professionnels'))
    expect(await screen.findByText(t('modules.professionals.placeholder'))).toBeInTheDocument()
  })

  it('hides a disabled module and does not route to it', () => {
    render(appAt('/professionnels', { ...adminLike, modules: [] }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByText(t('common.notFound.title'))).toBeInTheDocument()
    expect(screen.queryByText(t('modules.professionals.placeholder'))).not.toBeInTheDocument()
  })

  it('hides an enabled module the user may not view, and refuses its route', () => {
    render(appAt('/professionnels', { ...adminLike, permissions: ['settings.view'] }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })

  it('shows not found for an unknown path', () => {
    render(appAt('/nulle-part'))
    expect(screen.getByText(t('common.notFound.title'))).toBeInTheDocument()
  })

  it('shows who is signed in, and where', () => {
    render(appAt('/accueil'))
    expect(screen.getByText('Camille Admin')).toBeInTheDocument()
    expect(screen.getByText(adminLike.org_name)).toBeInTheDocument()
  })

  it('signs out and returns to the login page', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(appAt('/accueil', adminLike, { auth: { signOut } }))
    await userEvent.click(screen.getByRole('button', { name: t('nav.logout') }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.getByTestId('login-search')).toHaveTextContent('')
  })
})
