import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { Home, Settings, Users } from 'lucide-react'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { AppShell, type ShellNavItem } from './AppShell'
import { SIDEBAR_COLLAPSED_KEY } from './shell/use-sidebar-collapsed'

const navItems: ShellNavItem[] = [
  { path: '/accueil', labelKey: 'nav.home', icon: Home },
  {
    path: '/professionnels',
    labelKey: 'modules.professionals.name',
    icon: Users,
  },
  {
    path: '/parametres',
    labelKey: 'nav.settings',
    icon: Settings,
    subPages: [{ path: '/parametres/modules', labelKey: 'settings.sections.modules' }],
  },
]

const assistant: Access = {
  ...testAccess,
  display_name: 'Camille Tremblay',
  role: 'admin_assistant',
}

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function DirtyForm() {
  useUnsavedChanges(true)
  return null
}

const shellAt = (path: string, { dirty = false, auth = {} }: { dirty?: boolean; auth?: Partial<AuthContextValue> } = {}) =>
  renderWithContexts(
    <UnsavedChangesProvider>
      <AppShell navItems={navItems}>
        {dirty && <DirtyForm />}
        <Location />
      </AppShell>
    </UnsavedChangesProvider>,
    { path, access: { access: assistant }, auth },
  )

const location = () => screen.getByTestId('location').textContent
const mainNav = () => screen.getByRole('navigation', { name: t('nav.label') })
const breadcrumb = () => screen.getByRole('navigation', { name: t('nav.breadcrumb') })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('AppShell — sidebar', () => {
  it('renders the nav items as links to their paths', () => {
    render(shellAt('/accueil'))
    const links = within(mainNav()).getAllByRole('link')
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [t('nav.home'), '/accueil'],
      [t('modules.professionals.name'), '/professionnels'],
      [t('nav.settings'), '/parametres'],
    ])
  })

  it('marks the current section as the current page', () => {
    render(shellAt('/parametres/modules'))
    expect(within(mainNav()).getByRole('link', { name: t('nav.settings') })).toHaveAttribute('aria-current', 'page')
    expect(within(mainNav()).getByRole('link', { name: t('nav.home') })).not.toHaveAttribute('aria-current')
  })

  it('shows the logo with the clinic name', () => {
    render(shellAt('/accueil'))
    const banner = screen.getByRole('banner')
    expect(within(banner).getByText(testAccess.org_name)).toBeInTheDocument()
  })

  it('shows who is signed in, with the French role label', () => {
    render(shellAt('/accueil'))
    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('Camille Tremblay')).toBeInTheDocument()
    expect(within(banner).getByText('Adjointe administrative')).toBeInTheDocument()
  })

  // The redirect itself is RequireAuth's job: the shell only signs out (decisions #10, #13, #17).
  it('signs out once from the footer, and disables the button meanwhile', async () => {
    const signOut = vi.fn(() => new Promise<void>(() => {}))
    render(shellAt('/accueil', { auth: { signOut } }))
    const button = screen.getByRole('button', { name: t('nav.logout') })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })

  it('collapses the sidebar, keeps the links named, and remembers the choice', async () => {
    const { unmount } = render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.collapse') }))

    expect(screen.getByRole('button', { name: t('nav.expand') })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'true')
    // Labels stay for screen readers; the native tooltip shows them on hover.
    const home = within(mainNav()).getByRole('link', { name: t('nav.home') })
    expect(home).toHaveAttribute('title', t('nav.home'))
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true')

    unmount()
    render(shellAt('/accueil'))
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'true')
    await userEvent.click(screen.getByRole('button', { name: t('nav.expand') }))
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'false')
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false')
  })

  it('still works when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    render(shellAt('/accueil'))
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'false')
    await userEvent.click(screen.getByRole('button', { name: t('nav.collapse') }))
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'true')
  })
})

describe('AppShell — topbar', () => {
  it('titles the page from the nav item', () => {
    render(shellAt('/professionnels'))
    expect(within(breadcrumb()).getByText(t('modules.professionals.name'))).toHaveAttribute('aria-current', 'page')
    expect(within(breadcrumb()).queryAllByRole('link')).toHaveLength(0)
  })

  it('shows the parent as a link and the sub-page as the title', async () => {
    render(shellAt('/parametres/modules'))
    const parent = within(breadcrumb()).getByRole('link', {
      name: t('nav.settings'),
    })
    expect(parent).toHaveAttribute('href', '/parametres')
    expect(within(breadcrumb()).getByText(t('settings.sections.modules'))).toHaveAttribute('aria-current', 'page')
  })

  it('titles « Mon compte »', () => {
    render(shellAt('/mon-compte'))
    expect(within(breadcrumb()).getByText(t('nav.account'))).toHaveAttribute('aria-current', 'page')
  })

  it('shows no title for a page it does not know', () => {
    render(shellAt('/nulle-part'))
    expect(screen.queryByRole('navigation', { name: t('nav.breadcrumb') })).not.toBeInTheDocument()
  })

  it('has a user menu with the name, the role, « Mon compte » and « Se déconnecter »', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.userMenu') }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Camille Tremblay')).toBeInTheDocument()
    expect(within(menu).getByText('Adjointe administrative')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: t('nav.account') })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: t('nav.logout') })).toBeInTheDocument()
  })

  it('« Mon compte » navigates to /mon-compte', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.userMenu') }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.account') }))
    expect(location()).toBe('/mon-compte')
  })

  it('« Mon compte » asks before leaving unsaved changes', async () => {
    render(shellAt('/accueil', { dirty: true }))
    await userEvent.click(screen.getByRole('button', { name: t('nav.userMenu') }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.account') }))
    const dialog = await screen.findByRole('alertdialog')
    expect(location()).toBe('/accueil')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(location()).toBe('/mon-compte')
  })

  it('« Se déconnecter » in the menu signs out once, then is disabled', async () => {
    const signOut = vi.fn(() => new Promise<void>(() => {}))
    render(shellAt('/accueil', { auth: { signOut } }))
    await userEvent.click(screen.getByRole('button', { name: t('nav.userMenu') }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.logout') }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: t('nav.logout') })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: t('nav.userMenu') }))
    expect(await screen.findByRole('menuitem', { name: t('nav.logout') })).toHaveAttribute('data-disabled')
  })
})

describe('AppShell — command palette', () => {
  const palette = () => screen.findByRole('dialog', { name: t('nav.palette.title') })

  it.each([
    ['Ctrl+K', '{Control>}k{/Control}'],
    ['⌘K', '{Meta>}k{/Meta}'],
  ])('opens with %s and lists the pages the user can see, plus « Mon compte »', async (_, keys) => {
    render(shellAt('/accueil'))
    await userEvent.keyboard(keys)
    const dialog = await palette()
    expect(within(dialog).getByText(t('nav.palette.pages'))).toBeInTheDocument()
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('nav.home'), t('modules.professionals.name'), t('nav.settings'), t('nav.account')])
    expect(within(dialog).getByRole('combobox')).toHaveFocus()
  })

  it('opens from the search button in the topbar', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.searchLabel') }))
    expect(await palette()).toBeInTheDocument()
  })

  it('filters as you type and navigates to the chosen page', async () => {
    render(shellAt('/accueil'))
    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = await palette()
    await userEvent.type(within(dialog).getByRole('combobox'), 'profes')
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('modules.professionals.name')])
    await userEvent.keyboard('{Enter}')
    expect(location()).toBe('/professionnels')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says when nothing matches', async () => {
    render(shellAt('/accueil'))
    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = await palette()
    await userEvent.type(within(dialog).getByRole('combobox'), 'zzz')
    expect(within(dialog).getByText(t('nav.palette.empty'))).toBeInTheDocument()
  })

  it('asks before leaving unsaved changes', async () => {
    render(shellAt('/accueil', { dirty: true }))
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.click(within(await palette()).getByRole('option', { name: t('nav.settings') }))
    const confirm = await screen.findByRole('alertdialog')
    expect(location()).toBe('/accueil')
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(location()).toBe('/parametres')
  })
})

describe('AppShell — mobile', () => {
  it('opens the menu in a sheet, and closes it when an item is chosen', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.openMenu') }))
    const sheet = await screen.findByRole('dialog', { name: t('nav.menu') })
    const nav = within(sheet).getByRole('navigation', { name: t('nav.label') })
    expect(within(sheet).getByText('Camille Tremblay')).toBeInTheDocument()
    await userEvent.click(within(nav).getByRole('link', { name: t('modules.professionals.name') }))
    expect(location()).toBe('/professionnels')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('nav.menu') })).not.toBeInTheDocument())
  })

  it('closes the sheet when the current page is chosen again', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.openMenu') }))
    const sheet = await screen.findByRole('dialog', { name: t('nav.menu') })
    await userEvent.click(within(sheet).getByRole('link', { name: t('nav.home') }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('nav.menu') })).not.toBeInTheDocument())
  })
})

describe('AppShell — content', () => {
  it('keeps the skip link and the focusable main region', async () => {
    render(shellAt('/accueil'))
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'contenu')
    await userEvent.click(screen.getByRole('link', { name: t('nav.skipToContent') }))
    expect(main).toHaveFocus()
  })
})
