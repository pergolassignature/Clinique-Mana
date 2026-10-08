import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { Blocks, Building2, Bug } from 'lucide-react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { SettingsSection } from '@/core/modules/types'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { lazyPage } from '@/shared/lib/lazy-page'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsSection } from './section-context'
import { SettingsLayout } from './SettingsLayout'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

const page = (text: string) => lazyPage(async () => ({ default: () => <p>{text}</p> }))
const crashingPage = () =>
  lazyPage(async () => ({
    default: () => {
      throw new Error('boom')
    },
  }))

const modulesSection: SettingsSection = { id: 'modules', path: 'modules', labelKey: 'settings.sections.modules', icon: Blocks, permission: 'modules.manage', group: 'plateforme', component: page('MODULES PAGE') }
// English id, French path (decision #24): links and routes use the path, error scopes the id.
const visibleSection: SettingsSection = { id: 'visible', path: 'visible-fr', labelKey: 'settings.title', icon: Building2, permission: 'settings.view', group: 'clinique', component: page('VISIBLE PAGE') }
const sections = [modulesSection, visibleSection]

// Mounted the way the app shell mounts it: under a `parametres/*` route.
const settingsAt = (path: string, options: Parameters<typeof renderWithContexts>[1] = {}, list = sections) =>
  renderWithContexts(
    <Routes>
      <Route path="/parametres/*" element={<SettingsLayout sections={list} />} />
    </Routes>,
    { ...options, path },
  )

const canEverything = { can: () => true }

beforeEach(() => {
  // React logs caught render errors; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  mocks.captureException.mockReset()
})

describe('SettingsLayout', () => {
  it('lists only sections the user can access and opens the first one', async () => {
    render(settingsAt('/parametres'))
    expect(screen.queryByText(t('settings.sections.modules'))).not.toBeInTheDocument()
    expect(screen.queryByText(t('settings.groups.plateforme'))).not.toBeInTheDocument()
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('href', '/parametres/visible-fr')
  })

  it('does not route to a section the user cannot access', async () => {
    render(settingsAt('/parametres/modules'))
    expect(await screen.findByText(t('common.notFound.title'))).toBeInTheDocument()
    expect(screen.queryByText('MODULES PAGE')).not.toBeInTheDocument()
  })

  it('routes to a section with several permissions when the user has any of them, and only then', async () => {
    const usersSection: SettingsSection = {
      id: 'users',
      path: 'utilisateurs',
      labelKey: 'settings.sections.users',
      icon: Building2,
      permission: ['users.view', 'roles.manage'],
      group: 'plateforme',
      component: page('USERS PAGE'),
    }
    const { unmount } = render(settingsAt('/parametres/utilisateurs', { access: { can: (p) => p === 'roles.manage' } }, [usersSection]))
    expect(await screen.findByText('USERS PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.sections.users') })).toBeInTheDocument()
    unmount()

    // users.manage alone opens neither (it never comes without users.view in practice).
    render(settingsAt('/parametres/utilisateurs', { access: { can: (p) => p === 'settings.view' || p === 'users.manage' } }, [usersSection, visibleSection]))
    expect(await screen.findByText(t('common.notFound.title'))).toBeInTheDocument()
    expect(screen.queryByText('USERS PAGE')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('settings.sections.users') })).not.toBeInTheDocument()
  })

  it('opens an accessible section from its URL', async () => {
    render(settingsAt('/parametres/modules', { access: { can: (p) => p === 'modules.manage' } }))
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
    expect(screen.queryByText('VISIBLE PAGE')).not.toBeInTheDocument()
  })

  it('builds absolute links from basePath, whatever section is open', async () => {
    render(settingsAt('/parametres/modules', { access: canEverything }))
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('href', '/parametres/visible-fr')
    expect(screen.getByRole('link', { name: t('settings.sections.modules') })).toHaveAttribute('href', '/parametres/modules')
  })

  it('marks the open section as the current page', async () => {
    render(settingsAt('/parametres/modules', { access: canEverything }))
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.sections.modules') })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: t('settings.title') })).not.toHaveAttribute('aria-current')
  })

  it('orders groups clinique, plateforme, modules, compte whatever the section order', () => {
    const inGroup = (id: string, group: SettingsSection['group'], labelKey: SettingsSection['labelKey']): SettingsSection => ({
      id, path: id, labelKey, icon: Building2, permission: 'settings.view', group, component: page(id),
    })
    const shuffled = [inGroup('me', 'compte', 'nav.logout'), inGroup('mod', 'modules', 'nav.home'), inGroup('plat', 'plateforme', 'home.title'), inGroup('clin', 'clinique', 'nav.settings')]
    render(settingsAt('/parametres/clin', {}, shuffled))
    const groups = screen.getAllByRole('group').map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)
    expect(groups).toEqual([t('settings.groups.clinique'), t('settings.groups.plateforme'), t('settings.groups.modules'), t('settings.groups.compte')])
    expect(screen.getByRole('group', { name: t('settings.groups.compte') })).toContainElement(screen.getByRole('link', { name: t('nav.logout') }))
  })

  it('honours a custom basePath', async () => {
    render(
      renderWithContexts(
        <Routes>
          <Route path="/admin/reglages/*" element={<SettingsLayout sections={sections} basePath="/admin/reglages" />} />
        </Routes>,
        { path: '/admin/reglages/visible-fr' },
      ),
    )
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('href', '/admin/reglages/visible-fr')
  })

  it.each([
    ['a core section', undefined, 'settings:crash'],
    ['a module section', 'billing', 'settings:billing:crash'],
  ])('keeps the menu working when %s crashes', async (_label, moduleKey, scope) => {
    const crash: SettingsSection = { id: 'crash', path: 'plante', labelKey: 'nav.home', icon: Bug, permission: 'settings.view', group: 'clinique', moduleKey, component: crashingPage() }
    render(settingsAt('/parametres/plante', {}, [crash, visibleSection]))

    expect(await screen.findByRole('alert')).toHaveTextContent(t('common.moduleError.title'))
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { scope } }))

    await userEvent.click(screen.getByRole('link', { name: t('settings.title') }))
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an empty state under the page title when no section is accessible', () => {
    render(settingsAt('/parametres', { access: { can: () => false } }))
    expect(screen.getByRole('heading', { level: 1, name: t('settings.title') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: t('settings.empty') })).toBeInTheDocument()
  })

  it('has one page title, a labelled menu and level-2 headings inside the pane', async () => {
    render(settingsAt('/parametres/nope'))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: t('settings.title') })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: t('settings.navLabel') })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: t('common.notFound.title') })).toBeInTheDocument()
  })

  it('renders a crashed section fallback as a level-2 heading', async () => {
    const crash: SettingsSection = { id: 'crash', path: 'plante', labelKey: 'nav.home', icon: Bug, permission: 'settings.view', group: 'clinique', component: crashingPage() }
    render(settingsAt('/parametres/plante', {}, [crash]))
    expect(await screen.findByRole('heading', { level: 2, name: t('common.moduleError.title') })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('links and routes by the French path, not the English id', async () => {
    render(settingsAt('/parametres/visible', { access: canEverything }))
    expect(await screen.findByText(t('common.notFound.title'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: t('settings.title') }))
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.title') })).toHaveAttribute('aria-current', 'page')
  })

  it('opens the first section of the menu, whatever the registration order', async () => {
    render(settingsAt('/parametres', { access: canEverything }))
    expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
    expect(screen.queryByText('MODULES PAGE')).not.toBeInTheDocument()
  })

  it('asks before leaving a section with unsaved changes', async () => {
    function DirtyPage() {
      useUnsavedChanges(true)
      return <p>DIRTY PAGE</p>
    }
    function Location() {
      return <p data-testid="location">{useLocation().pathname}</p>
    }
    const dirty: SettingsSection = { ...visibleSection, component: lazyPage(async () => ({ default: DirtyPage })) }
    render(
      renderWithContexts(
        <UnsavedChangesProvider>
          <Location />
          <Routes>
            <Route path="/parametres/*" element={<SettingsLayout sections={[dirty, modulesSection]} />} />
          </Routes>
        </UnsavedChangesProvider>,
        { path: '/parametres/visible-fr', access: canEverything },
      ),
    )
    expect(await screen.findByText('DIRTY PAGE')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: t('settings.sections.modules') }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.unsaved.stay') }))
    expect(screen.getByTestId('location')).toHaveTextContent('/parametres/visible-fr')
    expect(screen.queryByText('MODULES PAGE')).not.toBeInTheDocument()
  })

  describe('read-only sections', () => {
    function ReadOnlyProbe() {
      const { section, readOnly } = useSettingsSection()
      return <p>{`${section.id}:${readOnly ? 'read-only' : 'editable'}`}</p>
    }
    const editable: SettingsSection = {
      id: 'identity', path: 'identite', labelKey: 'settings.sections.identity', icon: Building2,
      permission: 'settings.view', editPermission: 'settings.manage', group: 'clinique',
      component: lazyPage(async () => ({ default: ReadOnlyProbe })),
    }
    const lockedName = `${t('settings.sections.identity')} ${t('settings.navReadOnlyHint')}`
    // Icons are decorative; the words carry the meaning.
    const decorativeIcons = (el: HTMLElement) => {
      const icons = Array.from(el.querySelectorAll('svg'))
      expect(icons.every((icon) => icon.getAttribute('aria-hidden') === 'true')).toBe(true)
      return icons.length
    }

    it('shows a lock, named « (lecture seule) », and tells the section, when the user can see it but not change it', async () => {
      render(settingsAt('/parametres/identite', { access: { can: (p) => p === 'settings.view' } }, [editable]))
      expect(await screen.findByText('identity:read-only')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: lockedName })
      expect(decorativeIcons(link)).toBe(2) // section icon + lock
    })

    it('shows no lock to a user who can change it', async () => {
      render(settingsAt('/parametres/identite', { access: canEverything }, [editable]))
      expect(await screen.findByText('identity:editable')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: t('settings.sections.identity') })
      expect(decorativeIcons(link)).toBe(1) // section icon only
    })

    describe('with several edit permissions (Utilisateurs et accès)', () => {
      const users: SettingsSection = {
        id: 'users', path: 'utilisateurs', labelKey: 'settings.sections.users', icon: Building2,
        permission: ['users.view', 'roles.manage'], editPermission: ['users.manage', 'roles.manage'], group: 'plateforme',
        component: lazyPage(async () => ({ default: ReadOnlyProbe })),
      }
      const lockedUsers = `${t('settings.sections.users')} ${t('settings.navReadOnlyHint')}`
      const only = (...permissions: string[]) => ({ can: (p: string) => permissions.includes(p) })

      it('shows no lock to a user with any one of them (roles.manage only)', async () => {
        render(settingsAt('/parametres/utilisateurs', { access: only('roles.manage') }, [users]))
        expect(await screen.findByText('users:editable')).toBeInTheDocument()
        expect(decorativeIcons(screen.getByRole('link', { name: t('settings.sections.users') }))).toBe(1)
      })

      it('shows no lock to an admin', async () => {
        render(settingsAt('/parametres/utilisateurs', { access: canEverything }, [users]))
        expect(await screen.findByText('users:editable')).toBeInTheDocument()
        expect(decorativeIcons(screen.getByRole('link', { name: t('settings.sections.users') }))).toBe(1)
      })

      it('shows the lock to a user with none of them (users.view only)', async () => {
        render(settingsAt('/parametres/utilisateurs', { access: only('users.view') }, [users]))
        expect(await screen.findByText('users:read-only')).toBeInTheDocument()
        expect(decorativeIcons(screen.getByRole('link', { name: lockedUsers }))).toBe(2)
      })

      it('leaves a single-permission section locked for a settings.view user', async () => {
        render(settingsAt('/parametres/identite', { access: only('settings.view', 'users.view') }, [editable, users]))
        expect(await screen.findByText('identity:read-only')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: lockedName })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: lockedUsers })).toBeInTheDocument()
      })
    })

    it('treats a section without an edit permission as editable by whoever sees it', async () => {
      const plain = { ...editable, editPermission: undefined }
      render(settingsAt('/parametres/identite', { access: { can: (p) => p === 'settings.view' } }, [plain]))
      expect(await screen.findByText('identity:editable')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: t('settings.sections.identity') })).toBeInTheDocument()
    })
  })

  describe('browser tab title', () => {
    it('names the open section under Paramètres', async () => {
      render(settingsAt('/parametres/visible-fr'))
      expect(await screen.findByText('VISIBLE PAGE')).toBeInTheDocument()
      await waitFor(() => expect(document.title).toBe(`${t('settings.title')} · ${t('pageTitles.settings')} · ${t('app.name')}`))
    })

    it('falls back to Paramètres for an unknown section', async () => {
      render(settingsAt('/parametres/nope'))
      expect(await screen.findByText(t('common.notFound.title'))).toBeInTheDocument()
      await waitFor(() => expect(document.title).toBe(`${t('pageTitles.settings')} · ${t('app.name')}`))
    })
  })

  // Below xl (phones, tablets, small laptops) the menu is a disclosure. jsdom applies no CSS: the open
  // state is read from aria-expanded and the nav's data-state, which drives `max-xl:data-[state=closed]:hidden`.
  describe('compact menu', () => {
    const headingPage = (title: string) => lazyPage(async () => ({ default: () => <h2 tabIndex={-1}>{title}</h2> }))
    const clinic: SettingsSection = { ...visibleSection, component: headingPage('VISIBLE HEADING') }
    const platform: SettingsSection = { ...modulesSection, component: headingPage('MODULES HEADING') }
    const menuButton = () => screen.getByRole('button', { name: `${t('settings.menuButtonPrefix')} ${t('settings.title')}` })
    const nav = () => screen.getByRole('navigation', { name: t('settings.navLabel') })
    const modulesLink = () => within(nav()).getByRole('link', { name: t('settings.sections.modules') })

    // jsdom has no matchMedia: a viewport the test can resize, answering any min-/max-width query
    // (so the tests hold the layout to real widths, not to the queries' spelling).
    const PHONE = 375
    const TABLET = 768
    const LAPTOP = 1024
    const DESKTOP = 1280
    let width = PHONE
    const listeners = new Set<() => void>()
    const resize = (to: number) => {
      width = to
      act(() => listeners.forEach((listener) => listener()))
    }
    const matchesWidth = (query: string) => {
      const bound = /\((min|max)-width:\s*(\d+)px\)/.exec(query)
      if (!bound) return false
      return bound[1] === 'min' ? width >= Number(bound[2]) : width <= Number(bound[2])
    }
    beforeEach(() => {
      width = PHONE
      listeners.clear()
      vi.stubGlobal('matchMedia', (query: string) => ({
        get matches() {
          return matchesWidth(query)
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it('names the current section and controls the collapsed menu', async () => {
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      expect(await screen.findByRole('heading', { name: 'VISIBLE HEADING' })).toBeInTheDocument()
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
      expect(menuButton()).toHaveAttribute('aria-controls', nav().id)
      expect(nav()).toHaveAttribute('data-state', 'closed')
    })

    it('opens and closes with the button', async () => {
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      await userEvent.click(menuButton())
      expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
      expect(nav()).toHaveAttribute('data-state', 'open')
      await userEvent.click(menuButton())
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
      expect(nav()).toHaveAttribute('data-state', 'closed')
    })

    it('closes after a section is chosen, focuses its heading and marks it current', async () => {
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      await userEvent.click(menuButton())
      await userEvent.click(modulesLink())

      const heading = await screen.findByRole('heading', { name: 'MODULES HEADING' })
      await waitFor(() => expect(heading).toHaveFocus())
      expect(nav()).toHaveAttribute('data-state', 'closed')
      expect(modulesLink()).toHaveAttribute('aria-current', 'page')
      expect(
        screen.getByRole('button', { name: `${t('settings.menuButtonPrefix')} ${t('settings.sections.modules')}` }),
      ).toHaveAttribute('aria-expanded', 'false')
    })

    it('also closes when the open section is chosen again', async () => {
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      const heading = await screen.findByRole('heading', { name: 'VISIBLE HEADING' })
      await userEvent.click(menuButton())
      await userEvent.click(within(nav()).getByRole('link', { name: t('settings.title') }))
      expect(nav()).toHaveAttribute('data-state', 'closed')
      await waitFor(() => expect(screen.getByRole('heading', { name: 'VISIBLE HEADING' })).toHaveFocus())
      expect(heading).toBeInTheDocument()
    })

    it('is the compact menu on a tablet too: choosing a section closes it and focuses its heading', async () => {
      width = TABLET
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      expect(await screen.findByRole('heading', { name: 'VISIBLE HEADING' })).toBeInTheDocument()
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
      await userEvent.click(menuButton())
      // The current page is announced inside the open menu as well as on the button.
      expect(within(nav()).getByRole('link', { name: t('settings.title') })).toHaveAttribute('aria-current', 'page')
      await userEvent.click(modulesLink())

      await waitFor(() => expect(screen.getByRole('heading', { name: 'MODULES HEADING' })).toHaveFocus())
      expect(nav()).toHaveAttribute('data-state', 'closed')
      expect(modulesLink()).toHaveAttribute('aria-current', 'page')
    })

    it('is the compact menu on a small laptop too (1024 px)', async () => {
      width = LAPTOP
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      await userEvent.click(menuButton())
      await userEvent.click(modulesLink())
      await waitFor(() => expect(screen.getByRole('heading', { name: 'MODULES HEADING' })).toHaveFocus())
      expect(nav()).toHaveAttribute('data-state', 'closed')
    })

    it('keeps the compact menu open while the window stays below xl', async () => {
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      await userEvent.click(menuButton())
      resize(TABLET)
      resize(DESKTOP - 1)
      expect(nav()).toHaveAttribute('data-state', 'open')
    })

    it('does not move focus when the column menu is used (from xl)', async () => {
      width = DESKTOP
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      await userEvent.click(modulesLink())
      expect(await screen.findByRole('heading', { name: 'MODULES HEADING' })).not.toHaveFocus()
      expect(modulesLink()).toHaveFocus()
    })

    it('closes when the window widens to xl; a link then keeps focus', async () => {
      width = LAPTOP
      render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, platform]))
      await userEvent.click(menuButton())
      resize(DESKTOP)
      expect(nav()).toHaveAttribute('data-state', 'closed')

      await userEvent.click(modulesLink())
      expect(await screen.findByRole('heading', { name: 'MODULES HEADING' })).not.toHaveFocus()
      expect(modulesLink()).toHaveFocus()
    })

    // After « Rester » nothing navigates; the section chosen in the menu must not get focus on a
    // later, unrelated navigation: the breadcrumb « Paramètres » (back to the first section), or a
    // link to another section (e.g. from the palette).
    it.each([
      ['the breadcrumb', '/parametres', 'DIRTY HEADING'],
      ['a link to another section', '/parametres/troisieme', 'THIRD HEADING'],
    ])('does not move focus after « Rester », then %s', async (_label, to, landing) => {
      function DirtyPage() {
        useUnsavedChanges(true)
        return <h2 tabIndex={-1}>DIRTY HEADING</h2>
      }
      const dirty: SettingsSection = { ...clinic, component: lazyPage(async () => ({ default: DirtyPage })) }
      const third: SettingsSection = { ...clinic, id: 'third', path: 'troisieme', labelKey: 'nav.home', component: headingPage('THIRD HEADING') }
      render(
        renderWithContexts(
          <UnsavedChangesProvider>
            {/* An unguarded link from outside the layout (the guard is not under test here). */}
            <Link to={to}>Ailleurs</Link>
            <Routes>
              <Route path="/parametres/*" element={<SettingsLayout sections={[dirty, third, platform]} />} />
            </Routes>
          </UnsavedChangesProvider>,
          { path: '/parametres/visible-fr', access: canEverything },
        ),
      )
      await screen.findByRole('heading', { name: 'DIRTY HEADING' })
      await userEvent.click(menuButton())
      await userEvent.click(modulesLink())
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.stay') }))
      expect(nav()).toHaveAttribute('data-state', 'open')

      const elsewhere = screen.getByRole('link', { name: 'Ailleurs' })
      await userEvent.click(elsewhere)
      const heading = await screen.findByRole('heading', { name: landing })
      // Flush the navigation's effects and any MutationObserver callback (microtasks): the focus
      // decision is made there, so nothing can move focus after this.
      await act(async () => {})
      expect(heading).not.toHaveFocus()
      expect(elsewhere).toHaveFocus()
      expect(nav()).toHaveAttribute('data-state', 'closed')
    })

    describe('a heading that appears late', () => {
      // The page renders a field first and its heading only when the test reveals it.
      let reveal: () => void = () => {}
      function LatePage() {
        const [shown, setShown] = useState(false)
        reveal = () => setShown(true)
        return (
          <>
            <input aria-label="Champ" />
            {shown && <h2 tabIndex={-1}>LATE HEADING</h2>}
          </>
        )
      }
      const late: SettingsSection = { ...platform, component: lazyPage(async () => ({ default: LatePage })) }

      it('gets focus when the user has not started working in the page', async () => {
        render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, late]))
        await userEvent.click(menuButton())
        await userEvent.click(modulesLink())
        await screen.findByRole('textbox', { name: 'Champ' })
        act(() => reveal())
        await waitFor(() => expect(screen.getByRole('heading', { name: 'LATE HEADING' })).toHaveFocus())
      })

      it('never steals focus once the user is in the page', async () => {
        render(settingsAt('/parametres/visible-fr', { access: canEverything }, [clinic, late]))
        await userEvent.click(menuButton())
        await userEvent.click(modulesLink())
        const field = await screen.findByRole('textbox', { name: 'Champ' })
        await userEvent.click(field)
        act(() => reveal())
        expect(await screen.findByRole('heading', { name: 'LATE HEADING' })).not.toHaveFocus()
        expect(field).toHaveFocus()
      })
    })
  })
})
