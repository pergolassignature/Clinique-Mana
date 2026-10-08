import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { renderWithContexts } from '@/test/contexts'
import { testOrganization } from '@/test/organization'
import { accessForRole } from '@/test/role-fixtures'
import { coreSettingsSections } from '@/core/settings/sections'
import { getClinicTimezone, resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { AuthenticatedApp } from './AuthenticatedApp'
import { ALL_MODULES } from './modules'

const mocks = vi.hoisted(() => ({ captureException: vi.fn(), accountMounts: 0 }))
// The topbar bell (and Accueil) read the caller's notices: none here, and no network.
vi.mock('@/core/notifications/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/notifications/api')>()),
  countMyUnreadNotifications: async () => ({ total: 0, important: 0 }),
  listMyNotifications: async () => ({ notices: [], hasMore: false }),
  listImportantUnreadNotifications: async () => [],
}))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

// The Modules section needs a query client and the Supabase client: it has its own tests.
vi.mock('@/core/settings/pages/ModulesSettingsPage', () => ({ ModulesSettingsPage: () => <p>MODULES PAGE</p> }))
// Identité légale, the first clinic section, is real (its read-only notice is asserted below); only its data is stubbed.
vi.mock('@/core/settings/organization/api', () => ({
  fetchOrganization: async () => testOrganization,
  updateOrganization: async () => testOrganization,
}))
// Same for « Mon compte », which also probes the time-zone remount: it counts its mounts and shows the zone it sees.
vi.mock('@/core/account/pages/AccountPage', async () => {
  const { useEffect } = await import('react')
  const { getClinicTimezone } = await import('@/shared/lib/clinic-timezone')
  return {
    AccountPage: () => {
      useEffect(() => {
        mocks.accountMounts += 1
      }, [])
      return (
        <>
          <p>ACCOUNT PAGE</p>
          <p data-testid="account-timezone">{getClinicTimezone()}</p>
        </>
      )
    },
  }
})

// The real module list, with one crashing settings section added to Professionals. It needs a
// permission no role has ('test.crash'), so only the test that grants it sees it.
vi.mock('./modules', async (importOriginal) => {
  const { lazyPage } = await import('@/shared/lib/lazy-page')
  const { Bug } = await import('lucide-react')
  const actual = await importOriginal<typeof import('./modules')>()
  const crash = lazyPage(async () => ({
    default: () => {
      throw new Error('boom')
    },
  }))
  return {
    ALL_MODULES: actual.ALL_MODULES.map((m) =>
      m.key === 'professionals'
        ? { ...m, settingsSections: [...m.settingsSections, { id: 'crash', path: 'plante', labelKey: 'nav.home', icon: Bug, permission: 'test.crash', group: 'modules', component: crash }] }
        : m,
    ),
  }
})

// Warm the module cache for the code-split pages the tests wait on: a cold transform of a page's
// import graph can outlast findBy's 1 s timeout when the suite is shuffled. The pages themselves
// still load lazily (their lazyPage is not preloaded).
beforeAll(async () => {
  await Promise.all([
    import('@/core/settings/pages/IdentitySettingsPage'),
    import('@/core/settings/pages/TaxSettingsPage'),
    import('@/modules/professionals/pages/ProfessionalRecordPage'),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  mocks.captureException.mockReset()
})

const adminLike: Access = accessForRole('admin', { display_name: 'Camille Admin', modules: ['professionals'] })

const settingsLinks = () =>
  within(screen.getByRole('navigation', { name: t('settings.navLabel') }))
    .getAllByRole('link')
    .map((link) => link.textContent)

const ALL_SECTIONS = [
  'settings.sections.identity', 'settings.sections.tax', 'settings.sections.signatory', 'settings.sections.bank',
  'settings.sections.region', 'settings.sections.privacy', 'settings.sections.users', 'settings.sections.modules',
  'settings.sections.audit', 'settings.sections.jobs', 'settings.sections.email', 'settings.sections.signing',
] as const

/** Professionnels' list sections, after the core ones (group « Modules »). */
const PROFESSIONALS_SECTIONS = [
  'modules.professionals.settings.professions.title', 'modules.professionals.settings.specialties.title',
  'modules.professionals.settings.motifs.title', 'modules.professionals.settings.languages.title',
  'modules.professionals.settings.deactivationReasons.title',
] as const
const PROFESSIONALS_SECTION_IDS = ['professions', 'specialties', 'motifs', 'languages', 'deactivation-reasons'].map((id) => `professionals:${id}`)
const PROFESSIONALS_ROUTES = ['professionals:/professionnels', 'professionals:/professionnels/:id/:onglet?']

const appAt = (path: string, access: Access = adminLike, auth: Parameters<typeof renderWithContexts>[1] = {}) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {renderWithContexts(<AuthenticatedApp />, { ...auth, access: { access }, path })}
  </QueryClientProvider>
)

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
  const assistantLike: Access = accessForRole('admin_assistant', { display_name: 'Camille Admin', modules: ['professionals'] })
  const counselorLike: Access = accessForRole('counselor', { display_name: 'Camille Admin', modules: ['professionals'] })

  // Decision #19: Paramètres follows the accessible sections.
  it('shows Paramètres to the adjointe, with the clinic sections, « Tâches planifiées », « Courriels » and « Signature électronique », read-only', async () => {
    render(appAt('/parametres', assistantLike))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name'), t('nav.settings')])
    const readOnly = (key: (typeof ALL_SECTIONS)[number] | (typeof PROFESSIONALS_SECTIONS)[number]) => `${t(key)} ${t('settings.navReadOnlyHint')}`
    expect(settingsLinks()).toEqual([
      readOnly('settings.sections.identity'),
      readOnly('settings.sections.tax'),
      readOnly('settings.sections.signatory'),
      readOnly('settings.sections.region'),
      readOnly('settings.sections.privacy'),
      readOnly('settings.sections.jobs'),
      readOnly('settings.sections.email'),
      readOnly('settings.sections.signing'),
      // Professionnels' lists: seen with professionals.manage, changed with professionals.settings.
      ...PROFESSIONALS_SECTIONS.map(readOnly),
    ])
    expect(await screen.findByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.getByText(t('common.readOnlyNotice.body'))).toBeInTheDocument()
  })

  it('hides Paramètres from the conseillère, and refuses the settings route', () => {
    render(appAt('/parametres', counselorLike))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.name')])
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t('settings.title') })).not.toBeInTheDocument()
  })

  it('lists every section to an admin, at its French path, none of them locked', async () => {
    render(appAt('/parametres'))
    expect(settingsLinks()).toEqual([...ALL_SECTIONS, ...PROFESSIONALS_SECTIONS].map((key) => t(key)))
    const nav = screen.getByRole('navigation', { name: t('settings.navLabel') })
    expect(within(nav).getByRole('link', { name: t('settings.sections.identity') })).toHaveAttribute('href', '/parametres/identite')
    expect(within(nav).getByRole('link', { name: t('settings.sections.audit') })).toHaveAttribute('href', '/parametres/journal')
    expect(await screen.findByRole('heading', { level: 2, name: t('settings.sections.identity') })).toBeInTheDocument()
    expect(screen.queryByText(t('common.readOnlyNotice.body'))).not.toBeInTheDocument()
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
    expect(await screen.findByRole('form', { name: t('settings.identity.clinic.title') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('settings.sections.identity') })).toHaveAttribute('aria-current', 'page')
  })

  it('opens a section from its French path', async () => {
    render(appAt('/parametres/modules'))
    expect(await screen.findByText('MODULES PAGE')).toBeInTheDocument()
  })

  it('renders a module page at its route (the record; not a record id, so « introuvable » without a request)', async () => {
    render(appAt('/professionnels/0b6c/apercu'))
    expect(await screen.findByRole('heading', { level: 1, name: t('modules.professionals.record.notFound.title') })).toBeInTheDocument()
  })

  it('hides a disabled module and does not route to it', () => {
    render(appAt('/professionnels', { ...adminLike, modules: [] }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByText(t('common.notFound.title'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: t('modules.professionals.name') })).not.toBeInTheDocument()
  })

  it('hides an enabled module the user may not view, and refuses its route', () => {
    render(appAt('/professionnels', { ...adminLike, permissions: adminLike.permissions.filter((p) => p !== 'professionals.view') }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })

  // Outside Paramètres: a role with no settings section (here a provider) still reaches it.
  it('opens « Mon compte » for every role, titled in the topbar', async () => {
    render(appAt('/mon-compte', { ...adminLike, role: 'provider', permissions: [] }))
    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText(t('nav.account'))).toBeInTheDocument()
    expect(menuLinks()).toEqual([t('nav.home')])
  })

  // AccessProvider sets the new zone during its render, before this tree renders: done by hand here.
  it('remounts the routed page when the clinic time zone changes, and only then', async () => {
    try {
      mocks.accountMounts = 0
      const { rerender } = render(appAt('/mon-compte'))
      expect(await screen.findByTestId('account-timezone')).toHaveTextContent('America/Toronto')
      expect(mocks.accountMounts).toBe(1)

      rerender(appAt('/mon-compte', { ...adminLike, display_name: 'Camille A.' }))
      expect(mocks.accountMounts).toBe(1)

      setClinicTimezone('America/Vancouver')
      rerender(appAt('/mon-compte', { ...adminLike, org_timezone: 'America/Vancouver' }))
      await waitFor(() => expect(mocks.accountMounts).toBe(2))
      expect(getClinicTimezone()).toBe('America/Vancouver')
      expect(screen.getByTestId('account-timezone')).toHaveTextContent('America/Vancouver')
    } finally {
      resetClinicTimezone()
    }
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
    ['/accueil', t('pageTitles.home')],
    ['/parametres', `${t('settings.sections.identity')} · ${t('pageTitles.settings')}`],
    ['/parametres/fiscalite', `${t('settings.sections.tax')} · ${t('pageTitles.settings')}`],
    ['/professionnels', t('modules.professionals.name')],
    ['/nulle-part', t('pageTitles.notFound')],
  ] as const)('titles the browser tab for %s', async (path, title) => {
    render(appAt(path))
    await waitFor(() => expect(document.title).toBe(`${title} · ${t('app.name')}`))
  })

  it("reports a module section's crash under the module's scope", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(appAt('/parametres/plante', { ...adminLike, permissions: [...adminLike.permissions, 'test.crash'] }))
    expect(await screen.findByRole('heading', { level: 2, name: t('common.moduleError.title') })).toBeInTheDocument()
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { scope: 'settings:professionals:crash' } }),
    )
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

// The shell prefetches, when the browser is idle, the code of the pages THIS user can open.
describe('AuthenticatedApp — idle prefetch', () => {
  let runIdle: () => void = () => {}

  /** Spies on every registered page's preload (core sections, and module sections and routes). */
  function spyOnPreloads() {
    const pages = [
      ...coreSettingsSections.map((s) => [s.id, s.component] as const),
      ...ALL_MODULES.flatMap((m) => [
        ...m.settingsSections.map((s) => [`${m.key}:${s.id}`, s.component] as const),
        ...m.routes.map((r) => [`${m.key}:/${r.path}`, r.component] as const),
      ]),
    ]
    const spies = pages.map(([name, page]) => [name, vi.spyOn(page, 'preload').mockResolvedValue(undefined)] as const)
    return () => spies.filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name)
  }

  beforeEach(() => {
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      runIdle = () => callback({ didTimeout: false, timeRemaining: () => 50 })
      return 1
    })
    vi.stubGlobal('cancelIdleCallback', () => {})
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    runIdle = () => {}
  })

  it('waits for idle, then prefetches every section and module page an admin can open', () => {
    const preloaded = spyOnPreloads()
    render(appAt('/accueil'))
    expect(preloaded()).toEqual([])
    runIdle()
    expect(preloaded()).toEqual([...coreSettingsSections.map((s) => s.id), ...PROFESSIONALS_SECTION_IDS, ...PROFESSIONALS_ROUTES])
  })

  it('skips the pages the user may not open', () => {
    const preloaded = spyOnPreloads()
    render(appAt('/accueil', accessForRole('admin_assistant', { modules: ['professionals'] })))
    runIdle()
    // The adjointe's clinic sections (no bank, users, modules or audit), « Tâches planifiées », « Courriels »,
    // « Signature électronique », and Professionnels.
    expect(preloaded()).toEqual(['identity', 'tax', 'signatory', 'region', 'privacy', 'jobs', 'email', 'signing', ...PROFESSIONALS_SECTION_IDS, ...PROFESSIONALS_ROUTES])
  })

  it("skips a disabled module's pages and sections", () => {
    const preloaded = spyOnPreloads()
    render(appAt('/accueil', { ...adminLike, modules: [], permissions: [...adminLike.permissions, 'test.crash'] }))
    runIdle()
    expect(preloaded()).toEqual(coreSettingsSections.map((s) => s.id))
  })

  it("prefetches an enabled module's section once the user may open it", () => {
    const preloaded = spyOnPreloads()
    render(appAt('/accueil', { ...adminLike, permissions: [...adminLike.permissions, 'test.crash'] }))
    runIdle()
    expect(preloaded()).toContain('professionals:crash')
  })
})

