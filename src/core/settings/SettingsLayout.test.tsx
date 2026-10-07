import { lazy } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Blocks, Building2, Bug } from 'lucide-react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import type { SettingsSection } from '@/core/modules/types'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsSection } from './section-context'
import { SettingsLayout } from './SettingsLayout'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

const page = (text: string) => lazy(async () => ({ default: () => <p>{text}</p> }))
const crashingPage = () =>
  lazy(async () => ({
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
    const dirty: SettingsSection = { ...visibleSection, component: lazy(async () => ({ default: DirtyPage })) }
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
      component: lazy(async () => ({ default: ReadOnlyProbe })),
    }
    const lockedName = `${t('settings.sections.identity')} ${t('settings.readOnly.navHint')}`

    it('shows a lock, and tells the section, when the user can see it but not change it', async () => {
      render(settingsAt('/parametres/identite', { access: { can: (p) => p === 'settings.view' } }, [editable]))
      expect(await screen.findByText('identity:read-only')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: lockedName })
      expect(link.querySelector('svg.lucide-lock')).not.toBeNull()
    })

    it('shows no lock to a user who can change it', async () => {
      render(settingsAt('/parametres/identite', { access: canEverything }, [editable]))
      expect(await screen.findByText('identity:editable')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: t('settings.sections.identity') })
      expect(link.querySelector('svg.lucide-lock')).toBeNull()
    })

    it('treats a section without an edit permission as editable by whoever sees it', async () => {
      const plain = { ...editable, editPermission: undefined }
      render(settingsAt('/parametres/identite', { access: { can: (p) => p === 'settings.view' } }, [plain]))
      expect(await screen.findByText('identity:editable')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: t('settings.sections.identity') })).toBeInTheDocument()
    })
  })
})
