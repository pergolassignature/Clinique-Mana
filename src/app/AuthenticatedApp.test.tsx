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

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  accountMounts: 0,
  mySubmission: null as unknown,
  mySubmissionReads: 0,
  searchProfessionalsRows: vi.fn(),
}))
// The topbar bell (and Accueil) read the caller's notices: none here, and no network.
vi.mock('@/core/notifications/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/notifications/api')>()),
  countMyUnreadNotifications: async () => ({ total: 0, important: 0 }),
  listMyNotifications: async () => ({ notices: [], hasMore: false }),
  listImportantUnreadNotifications: async () => [],
}))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))
// Accueil's « Complétez votre profil » (professionals.self) reads the professional's questionnaire:
// none unless a test sets one, and no network.
vi.mock('@/modules/professionals/api/self', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/professionals/api/self')>()),
  fetchMySubmission: async () => {
    mocks.mySubmissionReads += 1
    return mocks.mySubmission
  },
}))

// The palette's professionals group (⌘K) reads search_professionals: one row, and no network.
vi.mock('@/modules/professionals/api/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/professionals/api/search')>()),
  searchProfessionalsRows: mocks.searchProfessionalsRows,
}))

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
  mocks.mySubmission = null
  mocks.mySubmissionReads = 0
  mocks.searchProfessionalsRows.mockReset()
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

/**
 * Professionnels' list sections, « Documents requis » and « Consentements » (4c.3), « Fiche PDF »
 * (P4-353) and « Contrats » (Task 4d.3), read like them, after the core ones (group « Modules »).
 */
const PROFESSIONALS_LIST_SECTIONS = [
  'modules.professionals.settings.professions.title', 'modules.professionals.settings.clienteles.title',
  'modules.professionals.settings.motifs.title', 'modules.professionals.settings.languages.title',
  'modules.professionals.settings.deactivationReasons.title', 'modules.professionals.settings.requiredDocuments.title',
  'modules.professionals.settings.consents.title', 'modules.professionals.settings.fiche.title',
  'modules.professionals.settings.contracts.title',
] as const
/** Then « Invitations » (seen with `professionals.invite`, changed with `.settings`; Task 4b.3). */
const PROFESSIONALS_SEEN_SECTIONS = [...PROFESSIONALS_LIST_SECTIONS, 'modules.professionals.settings.invitations.title'] as const
/** Then « Rémunération » (`professionals.compensation`: the admin only, by default). */
const PROFESSIONALS_SECTIONS = [...PROFESSIONALS_SEEN_SECTIONS, 'modules.professionals.settings.compensation.title'] as const
const PROFESSIONALS_LIST_SECTION_IDS = ['professions', 'clienteles', 'motifs', 'languages', 'deactivation-reasons', 'required-documents', 'consents', 'fiche', 'contracts', 'invitations'].map(
  (id) => `professionals:${id}`,
)
const PROFESSIONALS_SECTION_IDS = [...PROFESSIONALS_LIST_SECTION_IDS, 'professionals:compensation']
const PROFESSIONALS_ROUTES = ['professionals:/professionnels', 'professionals:/professionnels/:id/:onglet?']
/** « Révision mensuelle »: professionals.compensation only (admin by default). */
const PROFESSIONALS_REVIEW_ROUTE = 'professionals:/professionnels/revision-mensuelle'
/** The provider's questionnaire (`professionals.self`; the test's admin-like access holds every key). */
const PROFESSIONALS_QUESTIONNAIRE_ROUTE = 'professionals:/mon-profil/questionnaire'
// « Mon profil » (4b.5, professionals.self).
const PROFESSIONALS_MY_PROFILE_ROUTE = 'professionals:/mon-profil'
// « Mes documents » (4c.6, professionals.self).
const PROFESSIONALS_MY_DOCUMENTS_ROUTE = 'professionals:/mes-documents'

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
      // Professionnels' lists (professionals.manage) and « Invitations » (professionals.invite): changed with professionals.settings.
      ...PROFESSIONALS_SEEN_SECTIONS.map(readOnly),
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
    // Without professionals.self too: « Mon profil » is the module's other menu entry.
    const hidden = new Set(['professionals.view', 'professionals.self'])
    render(appAt('/professionnels', { ...adminLike, permissions: adminLike.permissions.filter((p) => !hidden.has(p)) }))
    expect(menuLinks()).toEqual([t('nav.home'), t('nav.settings')])
    expect(screen.getByText(t('access.forbidden.title'))).toBeInTheDocument()
  })

  // Task 4b.5 (P4-376): « Mon profil » right after Accueil for an account linked to a professional file.
  it('shows « Mon profil » to a professional, after Accueil, and not to an admin without a file of her own', () => {
    render(appAt('/accueil', accessForRole('provider', { display_name: 'Félix Gauthier', modules: ['professionals'] })))
    expect(menuLinks()).toEqual([t('nav.home'), t('modules.professionals.myProfile.nav'), t('modules.professionals.myDocuments.nav')])
    expect(screen.getByRole('link', { name: t('modules.professionals.myProfile.nav') })).toHaveAttribute('href', '/mon-profil')
    expect(screen.getByRole('link', { name: t('modules.professionals.myDocuments.nav') })).toHaveAttribute('href', '/mes-documents')
    cleanup()
    render(appAt('/accueil'))
    expect(adminLike.permissions).toContain('professionals.self')
    expect(menuLinks()).not.toContain(t('modules.professionals.myProfile.nav'))
    expect(menuLinks()).not.toContain(t('modules.professionals.myDocuments.nav'))
  })

  it('keeps « Mon profil » for an admin who practises (her account is linked to a file)', () => {
    render(appAt('/accueil', { ...adminLike, has_professional_file: true }))
    expect(menuLinks()).toEqual([
      t('nav.home'),
      t('modules.professionals.myProfile.nav'),
      t('modules.professionals.myDocuments.nav'),
      t('modules.professionals.name'),
      t('nav.settings'),
    ])
  })

  // P4-319 (Task 4b.5): the module's Accueil card, for whoever holds professionals.self.
  it('shows a professional « Complétez votre profil » on Accueil while her questionnaire is open', async () => {
    const { mySubmission } = await import('@/modules/professionals/test/fixtures-questionnaire')
    mocks.mySubmission = mySubmission()
    render(appAt('/accueil', accessForRole('provider', { display_name: 'Félix Gauthier', modules: ['professionals'] })))
    expect(await screen.findByRole('heading', { name: t('modules.professionals.myProfile.home.onboarding.title') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('modules.professionals.myProfile.home.onboarding.action') })).toHaveAttribute('href', '/mon-profil/questionnaire')
  })

  it('never reads a questionnaire for an admin without a file (no Accueil card)', async () => {
    const { mySubmission } = await import('@/modules/professionals/test/fixtures-questionnaire')
    mocks.mySubmission = mySubmission()
    render(appAt('/accueil'))
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('heading', { name: t('modules.professionals.myProfile.home.onboarding.title') })).not.toBeInTheDocument()
    expect(mocks.mySubmissionReads).toBe(0)
  })

  // Accueil with nothing to show: a calm card and the role's shortcuts (its menu, Accueil aside).
  describe('Accueil when nothing needs attention', () => {
    const shortcuts = async () =>
      within(await screen.findByRole('navigation', { name: t('home.empty.shortcuts') }))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])

    it.each([
      ['an admin', adminLike, [[t('modules.professionals.name'), '/professionnels'], [t('nav.settings'), '/parametres']]],
      ['the adjointe', accessForRole('admin_assistant', { modules: ['professionals'] }), [[t('modules.professionals.name'), '/professionnels'], [t('nav.settings'), '/parametres']]],
      ['the conseillère', accessForRole('counselor', { modules: ['professionals'] }), [[t('modules.professionals.name'), '/professionnels']]],
      ['a professional', accessForRole('provider', { modules: ['professionals'] }), [[t('modules.professionals.myProfile.nav'), '/mon-profil'], [t('modules.professionals.myDocuments.nav'), '/mes-documents']]],
    ] as const)('%s: « Rien ne demande votre attention », with the role’s shortcuts', async (_role, access, expected) => {
      render(appAt('/accueil', access))
      expect(await screen.findByText(t('home.empty.title'))).toBeInTheDocument()
      expect(await shortcuts()).toEqual(expected)
    })

    it('says nothing of the kind while a card has something to say (the professional’s open questionnaire)', async () => {
      const { mySubmission } = await import('@/modules/professionals/test/fixtures-questionnaire')
      mocks.mySubmission = mySubmission()
      render(appAt('/accueil', accessForRole('provider', { modules: ['professionals'] })))
      expect(await screen.findByRole('heading', { name: t('modules.professionals.myProfile.home.onboarding.title') })).toBeInTheDocument()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(screen.queryByText(t('home.empty.title'))).not.toBeInTheDocument()
    })
  })

  // Outside Paramètres: a role with no settings section (here a provider) still reaches it.
  it('opens « Mon compte » for every role, titled in the topbar', async () => {
    render(appAt('/mon-compte', { ...adminLike, role: 'provider', permissions: [] }))
    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText(t('nav.account'))).toBeInTheDocument()
    expect(menuLinks()).toEqual([t('nav.home')])
  })

  // AccessProvider sets the new zone during its render, before this tree renders: done by hand here.
  it('remounts the shell and the routed page when the clinic time zone changes, and only then', async () => {
    try {
      mocks.accountMounts = 0
      const { rerender } = render(appAt('/mon-compte'))
      expect(await screen.findByTestId('account-timezone')).toHaveTextContent('America/Toronto')
      expect(mocks.accountMounts).toBe(1)
      // The shell around the page (topbar, bell, menu) is remounted too: it formats dates outside the routes.
      const banner = screen.getByRole('banner')

      rerender(appAt('/mon-compte', { ...adminLike, display_name: 'Camille A.' }))
      expect(mocks.accountMounts).toBe(1)
      expect(screen.getByRole('banner')).toBe(banner)

      setClinicTimezone('America/Vancouver')
      rerender(appAt('/mon-compte', { ...adminLike, org_timezone: 'America/Vancouver' }))
      await waitFor(() => expect(mocks.accountMounts).toBe(2))
      expect(getClinicTimezone()).toBe('America/Vancouver')
      expect(screen.getByTestId('account-timezone')).toHaveTextContent('America/Vancouver')
      expect(screen.getByRole('banner')).not.toBe(banner)
    } finally {
      resetClinicTimezone()
    }
  })

  it('shows not found for an unknown path', () => {
    render(appAt('/nulle-part'))
    expect(screen.getByText(t('common.notFound.title'))).toBeInTheDocument()
  })

  // Every « you may not see this » reads the same: « Accès refusé », its explanation and the way
  // back to Accueil, whatever the role and wherever the page is (a module route, Paramètres, one of
  // its sections). Only a URL that names nothing is « Page introuvable ».
  describe('pages the user may not open, per role', () => {
    const providerLike: Access = accessForRole('provider', { display_name: 'Félix Gauthier', modules: ['professionals'], has_professional_file: true })
    const expectForbidden = async () => {
      expect(await screen.findByRole('heading', { name: t('access.forbidden.title') })).toBeInTheDocument()
      expect(screen.getByText(t('access.forbidden.body'))).toBeInTheDocument()
      expect(screen.getByRole('link', { name: t('common.backHome') })).toHaveAttribute('href', '/accueil')
      expect(screen.queryByText(t('common.notFound.title'))).not.toBeInTheDocument()
      await waitFor(() => expect(document.title).toBe(`${t('pageTitles.forbidden')} · ${t('app.name')}`))
    }
    const expectNotFound = async () => {
      expect(await screen.findByRole('heading', { name: t('common.notFound.title') })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: t('common.backHome') })).toHaveAttribute('href', '/accueil')
      expect(screen.queryByText(t('access.forbidden.title'))).not.toBeInTheDocument()
    }

    it.each([
      ['the adjointe', 'a settings section she does not see', '/parametres/modules'],
      ['the adjointe', 'the pay settings', '/parametres/remuneration'],
      ['the conseillère', 'Paramètres', '/parametres'],
      ['the conseillère', 'a settings section', '/parametres/identite'],
      ['the professional', 'Paramètres', '/parametres'],
      ['the professional', 'a settings section', '/parametres/region'],
      ['the professional', 'the professionals list', '/professionnels'],
    ] as const)('%s, on %s: « Accès refusé »', async (role, _page, path) => {
      const access = role === 'the adjointe' ? assistantLike : role === 'the conseillère' ? counselorLike : providerLike
      render(appAt(path, access))
      await expectForbidden()
    })

    it.each([
      ['the admin', adminLike],
      ['the adjointe', assistantLike],
      ['the conseillère', counselorLike],
      ['the professional', providerLike],
    ] as const)('%s: an unknown URL, in or out of Paramètres, is « Page introuvable »', async (_role, access) => {
      const { unmount } = render(appAt('/nulle-part', access))
      await expectNotFound()
      unmount()
      render(appAt('/parametres/nulle-part', access))
      await expectNotFound()
    })
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

// The global search (⌘K): the enabled modules' record groups, for whoever holds their permission.
describe('AuthenticatedApp — global search', () => {
  const searchFor = async (query: string) => {
    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: t('nav.palette.title') })
    await userEvent.type(within(dialog).getByRole('combobox'), query)
    return dialog
  }
  const OLIVIER = {
    id: 'p9', firstName: 'Olivier', lastName: 'Bergeron', displayStatus: 'preparing',
    titleLabel: 'Psychologue', orderAcronym: 'OPQ', licenceNumber: '22222-11',
  }

  it('finds a professional for staff who read the list, and opens the record', async () => {
    mocks.searchProfessionalsRows.mockResolvedValue([OLIVIER])
    render(appAt('/accueil', accessForRole('counselor', { display_name: 'Conseillère', modules: ['professionals'] })))
    const dialog = await searchFor('olivier')
    const group = await within(dialog).findByRole('group', { name: t('modules.professionals.name') })
    const option = within(group).getByRole('option')
    expect(option).toHaveTextContent('Olivier Bergeron')
    expect(option).toHaveTextContent('Psychologue · OPQ 22222-11')
    expect(option).toHaveTextContent(t('modules.professionals.status.preparing'))
    expect(mocks.searchProfessionalsRows).toHaveBeenCalledWith('olivier', expect.any(AbortSignal))
  })

  it('never searches professionals for the provider: « Mon profil » is her only entry', async () => {
    render(appAt('/accueil', accessForRole('provider', { display_name: 'Félix Gauthier', modules: ['professionals'], has_professional_file: true })))
    const dialog = await searchFor('profil')
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([t('modules.professionals.myProfile.nav')])
    await new Promise((r) => setTimeout(r, 300))
    expect(mocks.searchProfessionalsRows).not.toHaveBeenCalled()
    expect(within(dialog).queryByRole('group', { name: t('modules.professionals.name') })).not.toBeInTheDocument()
  })

  it('asks nothing of a disabled module', async () => {
    render(appAt('/accueil', { ...adminLike, modules: [] }))
    const dialog = await searchFor('olivier')
    await new Promise((r) => setTimeout(r, 300))
    expect(mocks.searchProfessionalsRows).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('combobox')).toHaveAttribute('placeholder', t('nav.palette.placeholder'))
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
    expect(preloaded()).toEqual([...coreSettingsSections.map((s) => s.id), ...PROFESSIONALS_SECTION_IDS, ...PROFESSIONALS_ROUTES, PROFESSIONALS_REVIEW_ROUTE, PROFESSIONALS_MY_PROFILE_ROUTE, PROFESSIONALS_QUESTIONNAIRE_ROUTE, PROFESSIONALS_MY_DOCUMENTS_ROUTE])
  })

  it('skips the pages the user may not open', () => {
    const preloaded = spyOnPreloads()
    render(appAt('/accueil', accessForRole('admin_assistant', { modules: ['professionals'] })))
    runIdle()
    // The adjointe's clinic sections (no bank, users, modules or audit), « Tâches planifiées », « Courriels »,
    // « Signature électronique », and Professionnels.
    expect(preloaded()).toEqual([
      'identity', 'tax', 'signatory', 'region', 'privacy', 'jobs', 'email', 'signing', ...PROFESSIONALS_LIST_SECTION_IDS, ...PROFESSIONALS_ROUTES,
    ])
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

