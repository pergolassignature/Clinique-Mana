import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { Home, Settings, Users } from 'lucide-react'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import type { AuthContextValue } from '@/core/auth/auth-context'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { AppShell, type ShellNavItem } from './AppShell'
import { SIDEBAR_COLLAPSED_KEY } from './shell/use-sidebar-collapsed'

const navItems: ShellNavItem[] = [
  { path: '/accueil', labelKey: 'nav.home', icon: Home },
  { path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users },
  {
    path: '/parametres',
    labelKey: 'nav.settings',
    icon: Settings,
    subPages: [{ path: '/parametres/modules', labelKey: 'settings.sections.modules' }],
  },
]

const NAME = 'Camille Tremblay'
const assistant: Access = { ...testAccess, display_name: NAME, role: 'admin_assistant' }

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
        <button type="button">Bouton de la page</button>
      </AppShell>
    </UnsavedChangesProvider>,
    { path, access: { access: assistant }, auth },
  )

const location = () => screen.getByTestId('location').textContent
const sidebar = () => screen.getByRole('complementary')
const mainNav = () => within(sidebar()).getByRole('navigation', { name: t('nav.label') })
const breadcrumb = () => screen.getByRole('navigation', { name: t('nav.breadcrumb') })
const userMenuButton = () => screen.getByRole('button', { name: t('nav.userMenu', { name: NAME }) })
const searchButton = () => screen.getByRole('button', { name: t('nav.searchLabel') })
const menuButton = () => screen.getByRole('button', { name: t('nav.openMenu') })
const pageButton = () => screen.getByRole('button', { name: 'Bouton de la page' })
const findPalette = () => screen.findByRole('dialog', { name: t('nav.palette.title') })
const queryPalette = () => screen.queryByRole('dialog', { name: t('nav.palette.title') })
const findSheet = () => screen.findByRole('dialog', { name: t('nav.menu') })
const querySheet = () => screen.queryByRole('dialog', { name: t('nav.menu') })
const CTRL_K = '{Control>}k{/Control}'
const CMD_K = '{Meta>}k{/Meta}'

let platform = 'Win32'

beforeEach(() => {
  localStorage.clear()
  platform = 'Win32'
  vi.spyOn(navigator, 'platform', 'get').mockImplementation(() => platform)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AppShell — landmarks', () => {
  it('uses the topbar as the banner and the sidebar as an aside holding the main menu', () => {
    render(shellAt('/accueil'))
    expect(screen.getByRole('banner')).toContainElement(breadcrumb())
    expect(sidebar()).toContainElement(screen.getByRole('navigation', { name: t('nav.label') }))
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenu')
  })

  it('keeps the skip link to the focusable main region', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('link', { name: t('nav.skipToContent') }))
    expect(screen.getByRole('main')).toHaveFocus()
  })
})

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
    expect(within(sidebar()).getByText(testAccess.org_name)).toBeInTheDocument()
  })

  it('shows who is signed in, with the French role label', () => {
    render(shellAt('/accueil'))
    expect(within(sidebar()).getByText(NAME)).toBeInTheDocument()
    expect(within(sidebar()).getByText('Adjointe administrative')).toBeInTheDocument()
  })

  it('collapses the sidebar, keeps the links named, and remembers the choice', async () => {
    const { unmount } = render(shellAt('/accueil'))
    await userEvent.click(screen.getByRole('button', { name: t('nav.collapse') }))

    expect(screen.getByRole('button', { name: t('nav.expand') })).toBeInTheDocument()
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
    // Labels stay for screen readers; the native tooltip shows them on hover.
    expect(within(mainNav()).getByRole('link', { name: t('nav.home') })).toHaveAttribute('title', t('nav.home'))
    expect(SIDEBAR_COLLAPSED_KEY).toBe('clinique-mana-sidebar-collapsed')
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true')

    unmount()
    render(shellAt('/accueil'))
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
    await userEvent.click(screen.getByRole('button', { name: t('nav.expand') }))
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false')
  })

  it('still works when the browser refuses storage', async () => {
    const boom = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    render(shellAt('/accueil'))
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')
    await userEvent.click(screen.getByRole('button', { name: t('nav.collapse') }))
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
  })
})

describe('AppShell — sign-out', () => {
  // The redirect itself is RequireAuth's job: the shell only signs out (decisions #10, #13, #17).
  it('signs out once even when clicked twice before the next render, then disables the button', async () => {
    const signOut = vi.fn(() => new Promise<void>(() => {}))
    render(shellAt('/accueil', { auth: { signOut } }))
    const button = within(sidebar()).getByRole('button', { name: t('nav.logout') })
    act(() => {
      button.click()
      button.click()
    })
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })

  it('asks before signing out over unsaved changes', async () => {
    const signOut = vi.fn(() => new Promise<void>(() => {}))
    render(shellAt('/accueil', { dirty: true, auth: { signOut } }))
    await userEvent.click(within(sidebar()).getByRole('button', { name: t('nav.logout') }))
    const confirm = await screen.findByRole('alertdialog')
    expect(signOut).not.toHaveBeenCalled()
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})

describe('AppShell — topbar', () => {
  it('titles the page from the nav item', () => {
    render(shellAt('/professionnels'))
    expect(within(breadcrumb()).getByText(t('modules.professionals.name'))).toHaveAttribute('aria-current', 'page')
    expect(within(breadcrumb()).queryAllByRole('link')).toHaveLength(0)
  })

  it('shows the parent as a link and the sub-page as the title', () => {
    render(shellAt('/parametres/modules'))
    expect(within(breadcrumb()).getByRole('link', { name: t('nav.settings') })).toHaveAttribute('href', '/parametres')
    expect(within(breadcrumb()).getByText(t('settings.sections.modules'))).toHaveAttribute('aria-current', 'page')
  })

  it('matches the location whatever its case, like the router', () => {
    render(shellAt('/Parametres/Modules'))
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

  it('names the user menu after the user, with the name, the role and two entries', async () => {
    render(shellAt('/accueil'))
    expect(userMenuButton()).toHaveAccessibleName(`Menu de ${NAME}`)
    await userEvent.click(userMenuButton())
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText(NAME)).toBeInTheDocument()
    expect(within(menu).getByText('Adjointe administrative')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: t('nav.account') })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: t('nav.logout') })).toBeInTheDocument()
  })

  it('« Mon compte » navigates to /mon-compte', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(userMenuButton())
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.account') }))
    await waitFor(() => expect(location()).toBe('/mon-compte'))
  })

  it('« Mon compte » asks before leaving unsaved changes, and « Rester » returns to the avatar', async () => {
    render(shellAt('/accueil', { dirty: true }))
    await userEvent.click(userMenuButton())
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.account') }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.stay') }))
    expect(location()).toBe('/accueil')
    await waitFor(() => expect(userMenuButton()).toHaveFocus())

    await userEvent.click(userMenuButton())
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.account') }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(location()).toBe('/mon-compte')
  })

  it('« Se déconnecter » in the menu signs out, then is disabled', async () => {
    const signOut = vi.fn(() => new Promise<void>(() => {}))
    render(shellAt('/accueil', { auth: { signOut } }))
    await userEvent.click(userMenuButton())
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.logout') }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(within(sidebar()).getByRole('button', { name: t('nav.logout') })).toBeDisabled()
    await userEvent.click(userMenuButton())
    expect(await screen.findByRole('menuitem', { name: t('nav.logout') })).toHaveAttribute('data-disabled')
  })
})

describe('AppShell — command palette', () => {
  it('opens with Ctrl+K and lists the pages the user can see, plus « Mon compte »', async () => {
    render(shellAt('/accueil'))
    await userEvent.keyboard(CTRL_K)
    const dialog = await findPalette()
    expect(within(dialog).getByText(t('nav.palette.pages'))).toBeInTheDocument()
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('nav.home'), t('modules.professionals.name'), t('nav.settings'), t('nav.account')])
    expect(within(dialog).getByRole('combobox')).toHaveFocus()
  })

  it('uses ⌘K on Apple keyboards, and only there', async () => {
    render(shellAt('/accueil'))
    await userEvent.keyboard(CMD_K)
    expect(queryPalette()).not.toBeInTheDocument()

    platform = 'MacIntel'
    await userEvent.keyboard(CTRL_K)
    expect(queryPalette()).not.toBeInTheDocument()
    await userEvent.keyboard(CMD_K)
    expect(await findPalette()).toBeInTheDocument()
  })

  it('closes with the same shortcut and gives focus back', async () => {
    render(shellAt('/accueil'))
    pageButton().focus()
    await userEvent.keyboard(CTRL_K)
    await findPalette()
    await userEvent.keyboard(CTRL_K)
    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument())
    await waitFor(() => expect(pageButton()).toHaveFocus())
  })

  it('ignores the shortcut while another dialog is open', async () => {
    render(shellAt('/accueil', { dirty: true }))
    await userEvent.click(userMenuButton())
    await userEvent.click(await screen.findByRole('menuitem', { name: t('nav.account') }))
    await screen.findByRole('alertdialog')
    await userEvent.keyboard(CTRL_K)
    expect(queryPalette()).not.toBeInTheDocument()
  })

  const shellWith = (children: ReactNode) =>
    renderWithContexts(
      <UnsavedChangesProvider>
        <AppShell navItems={navItems}>{children}</AppShell>
      </UnsavedChangesProvider>,
      { path: '/accueil', access: { access: assistant } },
    )

  // A popover is role="dialog" too, but not modal (no aria-modal): it must not block ⌘K.
  it('opens over an open popover, which then closes', async () => {
    render(
      shellWith(
        <Popover defaultOpen>
          <PopoverTrigger>Options</PopoverTrigger>
          <PopoverContent aria-label="Options de la page">Contenu</PopoverContent>
        </Popover>,
      ),
    )
    expect(screen.getByRole('dialog', { name: 'Options de la page' })).toBeInTheDocument()
    await userEvent.keyboard(CTRL_K)
    expect(await findPalette()).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Options de la page' })).not.toBeInTheDocument())
  })

  it('is not blocked by a modal that is closing (exit animation)', async () => {
    render(shellWith(<div role="dialog" aria-modal="true" aria-label="Fenêtre qui se ferme" data-state="closed" />))
    await userEvent.keyboard(CTRL_K)
    expect(await findPalette()).toBeInTheDocument()
  })

  it('is blocked by any open modal', async () => {
    render(shellWith(<div role="dialog" aria-modal="true" aria-label="Autre fenêtre" data-state="open" />))
    await userEvent.keyboard(CTRL_K)
    expect(queryPalette()).not.toBeInTheDocument()
  })

  it('opens from the search button, and Escape gives focus back to it', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(searchButton())
    await findPalette()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument())
    await waitFor(() => expect(searchButton()).toHaveFocus())
  })

  it('filters on the label, ignoring accents and case, and navigates to the chosen page', async () => {
    render(shellAt('/accueil'))
    pageButton().focus()
    await userEvent.keyboard(CTRL_K)
    const dialog = await findPalette()
    const input = within(dialog).getByRole('combobox')
    await userEvent.type(input, 'PARAMETRES')
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('nav.settings')])
    await userEvent.clear(input)
    await userEvent.type(input, 'profes')
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('modules.professionals.name')])
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/professionnels'))
    expect(queryPalette()).not.toBeInTheDocument()
    // The page's own button belongs to the page being left: focus goes to the search button.
    expect(searchButton()).toHaveFocus()
  })

  it('does not match on the path', async () => {
    render(shellAt('/accueil'))
    await userEvent.keyboard(CTRL_K)
    const dialog = await findPalette()
    await userEvent.type(within(dialog).getByRole('combobox'), 'mon-compte')
    expect(within(dialog).queryAllByRole('option')).toHaveLength(0)
    expect(within(dialog).getByText(t('nav.palette.empty'))).toBeInTheDocument()
  })

  it('asks before leaving unsaved changes; « Rester » stays with focus on the search button', async () => {
    render(shellAt('/accueil', { dirty: true }))
    await userEvent.keyboard(CTRL_K)
    await userEvent.click(within(await findPalette()).getByRole('option', { name: t('nav.settings') }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.stay') }))
    expect(location()).toBe('/accueil')
    await waitFor(() => expect(searchButton()).toHaveFocus())

    await userEvent.keyboard(CTRL_K)
    await userEvent.click(within(await findPalette()).getByRole('option', { name: t('nav.settings') }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(location()).toBe('/parametres')
  })
})

describe('AppShell — mobile', () => {
  it('opens the menu in a sheet, and closes it when an item is chosen, focus back on the menu button', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(menuButton())
    const sheet = await findSheet()
    expect(within(sheet).getByText(NAME)).toBeInTheDocument()
    const nav = within(sheet).getByRole('navigation', { name: t('nav.label') })
    await userEvent.click(within(nav).getByRole('link', { name: t('modules.professionals.name') }))
    expect(location()).toBe('/professionnels')
    await waitFor(() => expect(querySheet()).not.toBeInTheDocument())
    await waitFor(() => expect(menuButton()).toHaveFocus())
  })

  it('closes the sheet when the current page is chosen again', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(menuButton())
    await userEvent.click(within(await findSheet()).getByRole('link', { name: t('nav.home') }))
    await waitFor(() => expect(querySheet()).not.toBeInTheDocument())
    expect(location()).toBe('/accueil')
  })

  it('gives focus back to the menu button on Escape', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(menuButton())
    await findSheet()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(querySheet()).not.toBeInTheDocument())
    await waitFor(() => expect(menuButton()).toHaveFocus())
  })

  it('stays open after « Rester », with focus on the chosen link, and closes after « Quitter »', async () => {
    render(shellAt('/accueil', { dirty: true }))
    await userEvent.click(menuButton())
    const link = within(await findSheet()).getByRole('link', { name: t('modules.professionals.name') })
    await userEvent.click(link)
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.stay') }))
    expect(location()).toBe('/accueil')
    expect(querySheet()).toBeInTheDocument()
    await waitFor(() => expect(link).toHaveFocus())

    await userEvent.click(link)
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(location()).toBe('/professionnels')
    await waitFor(() => expect(querySheet()).not.toBeInTheDocument())
    await waitFor(() => expect(menuButton()).toHaveFocus())
  })

  // Radix would focus the first tabbable button (« Se déconnecter »): one Enter would sign out.
  it.each([
    ['/parametres/modules', 'nav.settings'],
    ['/nulle-part', 'nav.home'],
  ] as const)('focuses the current nav link when the sheet opens (%s)', async (path, key) => {
    render(shellAt(path))
    await userEvent.click(menuButton())
    const sheet = await findSheet()
    await waitFor(() => expect(within(sheet).getByRole('link', { name: t(key) })).toHaveFocus())
    expect(within(sheet).getByRole('button', { name: t('nav.logout') })).not.toHaveFocus()
  })

  it('closes the sheet when the palette opens', async () => {
    render(shellAt('/accueil'))
    await userEvent.click(menuButton())
    await findSheet()
    await userEvent.keyboard(CTRL_K)
    const palette = await findPalette()
    await waitFor(() => expect(querySheet()).not.toBeInTheDocument())
    expect(within(palette).getByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menuButton()).toHaveFocus())
  })
})
