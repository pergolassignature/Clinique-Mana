import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { AuthenticatedApp } from './AuthenticatedApp'

// The Modules section needs a query client and the Supabase client: it has its own tests.
vi.mock('@/core/settings/pages/ModulesSettingsPage', () => ({ ModulesSettingsPage: () => <p>MODULES PAGE</p> }))

const adminLike: Access = {
  ...testAccess,
  display_name: 'Camille Admin',
  role: 'admin',
  permissions: ['settings.view', 'modules.manage', 'professionals.view'],
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

  // Real role defaults: the adjointe has settings.view but no section permission (modules.manage is admin-only).
  const assistantLike: Access = { ...adminLike, role: 'admin_assistant', permissions: ['settings.view', 'professionals.view'] }

  it('hides Paramètres when no settings section is accessible, even with settings.view', () => {
    render(appAt('/accueil', assistantLike))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name')])
  })

  it('refuses the settings route when no settings section is accessible', () => {
    render(appAt('/parametres', assistantLike))
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t('settings.title') })).not.toBeInTheDocument()
  })

  it('shows Paramètres and its section to a user who can access only that section', async () => {
    render(appAt('/parametres', { ...adminLike, permissions: ['modules.manage'] }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByRole('heading', { name: t('settings.title') })).toBeInTheDocument()
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
  })

  it('mounts the settings shell under /parametres, on the first accessible section', async () => {
    render(appAt('/parametres'))
    expect(screen.getByRole('heading', { name: t('settings.title') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.sections.modules') })).toHaveAttribute('href', '/parametres/modules')
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
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
    render(appAt('/professionnels', { ...adminLike, permissions: ['settings.view', 'modules.manage'] }))
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

  it.each([
    ['/accueil', 'pageTitles.home'],
    ['/parametres', 'pageTitles.settings'],
    ['/professionnels', 'modules.professionals.name'],
    ['/nulle-part', 'pageTitles.notFound'],
  ] as const)('titles the browser tab for %s', async (path, key) => {
    render(appAt(path))
    await waitFor(() => expect(document.title).toBe(`${t(key)} · ${t('app.name')}`))
  })

  it('offers a skip link to the main content', async () => {
    render(appAt('/accueil'))
    const skip = screen.getByRole('link', { name: t('nav.skipToContent') })
    expect(skip).toHaveAttribute('href', '#contenu')
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'contenu')
    await userEvent.click(skip)
    expect(main).toHaveFocus()
  })

  it('uses a banner and main landmarks, not a complementary one', () => {
    render(appAt('/accueil'))
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('navigation', { name: t('nav.label') }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('shows the full name on hover when it is truncated', () => {
    render(appAt('/accueil'))
    expect(screen.getByText('Camille Admin')).toHaveAttribute('title', 'Camille Admin')
  })

  // The redirect itself is RequireAuth's job (covered at App level): the shell only signs out.
  it('signs out once, and disables the button meanwhile', async () => {
    const signOut = vi.fn(() => new Promise<void>(() => {}))
    render(appAt('/accueil', adminLike, { auth: { signOut } }))
    const button = screen.getByRole('button', { name: t('nav.logout') })
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })
})
