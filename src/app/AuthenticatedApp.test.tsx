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
  // The real admin defaults.
  permissions: [
    'settings.view', 'settings.manage', 'settings.bank_manage', 'users.view', 'users.manage',
    'modules.manage', 'audit.view', 'professionals.view',
  ],
  modules: ['professionals'],
}

const settingsLinks = () =>
  within(screen.getByRole('navigation', { name: t('settings.navLabel') }))
    .getAllByRole('link')
    .map((link) => link.textContent)

const ALL_SECTIONS = [
  'settings.sections.identity', 'settings.sections.tax', 'settings.sections.signatory', 'settings.sections.bank',
  'settings.sections.region', 'settings.sections.privacy', 'settings.sections.users', 'settings.sections.modules',
  'settings.sections.audit',
] as const

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

  // Real role defaults (Task 2.1): the adjointe has settings.view, the conseillère no settings permission.
  const assistantLike: Access = { ...adminLike, role: 'admin_assistant', permissions: ['settings.view', 'professionals.view'] }
  const counselorLike: Access = { ...adminLike, role: 'counselor', permissions: ['professionals.view'] }

  // Decision #19: Paramètres follows the accessible sections.
  it('shows Paramètres to the adjointe, with the clinic sections only, read-only', async () => {
    render(appAt('/parametres', assistantLike))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name'), t('nav.settings')])
    const readOnly = (key: (typeof ALL_SECTIONS)[number]) => `${t(key)} ${t('settings.readOnly.navHint')}`
    expect(settingsLinks()).toEqual([
      readOnly('settings.sections.identity'),
      readOnly('settings.sections.tax'),
      readOnly('settings.sections.signatory'),
      readOnly('settings.sections.region'),
      readOnly('settings.sections.privacy'),
    ])
    expect(await screen.findByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.readOnly.body'))).toBeInTheDocument()
  })

  it('hides Paramètres from the conseillère, and refuses the settings route', () => {
    render(appAt('/parametres', counselorLike))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name')])
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t('settings.title') })).not.toBeInTheDocument()
  })

  it('lists every section to an admin, at its French path, none of them locked', async () => {
    render(appAt('/parametres'))
    expect(settingsLinks()).toEqual(ALL_SECTIONS.map((key) => t(key)))
    const nav = screen.getByRole('navigation', { name: t('settings.navLabel') })
    expect(within(nav).getByRole('link', { name: t('settings.sections.identity') })).toHaveAttribute('href', '/parametres/identite')
    expect(within(nav).getByRole('link', { name: t('settings.sections.audit') })).toHaveAttribute('href', '/parametres/journal')
    expect(await screen.findByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.queryByText(t('settings.readOnly.body'))).not.toBeInTheDocument()
  })

  it('shows Paramètres and its section to a user who can access only that section', async () => {
    render(appAt('/parametres', { ...adminLike, permissions: ['modules.manage'] }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByRole('heading', { name: t('settings.title') })).toBeInTheDocument()
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
  })

  it('mounts the settings shell under /parametres, on the first accessible section', async () => {
    render(appAt('/parametres'))
    expect(screen.getByRole('heading', { level: 1, name: t('settings.title') })).toBeInTheDocument()
    expect(await screen.findByText(t('settings.comingSoon'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.sections.identity') })).toHaveAttribute('aria-current', 'page')
  })

  it('opens a section from its French path', async () => {
    render(appAt('/parametres/modules'))
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
    render(appAt('/professionnels', { ...adminLike, permissions: adminLike.permissions.filter((p) => p !== 'professionals.view') }))
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

  it('uses the topbar as the banner, the sidebar as an aside with the main menu, and a main region', () => {
    render(appAt('/accueil'))
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('navigation', { name: t('nav.breadcrumb') }))
    expect(screen.getByRole('complementary')).toContainElement(screen.getByRole('navigation', { name: t('nav.label') }))
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('titles the topbar with the settings section that opened', async () => {
    render(appAt('/parametres/fiscalite'))
    expect(await screen.findByRole('heading', { level: 2, name: t('settings.sections.tax') })).toBeInTheDocument()
    const breadcrumb = screen.getByRole('navigation', { name: t('nav.breadcrumb') })
    expect(within(breadcrumb).getByRole('link', { name: t('nav.settings') })).toHaveAttribute('href', '/parametres')
    expect(within(breadcrumb).getByText(t('settings.sections.tax'))).toHaveAttribute('aria-current', 'page')
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
