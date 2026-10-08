import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes, useNavigate, useNavigationType } from 'react-router-dom'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { ShellCrumbProvider, useShellCrumbLabel } from '@/shared/lib/shell-crumb'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { RECORD_TAB_DEFS } from '../components/record/record-tabs'
import { professionalKeys } from '../hooks/keys'
import { setupQueryClient } from '../test/query-client'
import { CATALOG, recordFixture, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { ProfessionalRecordPage } from './ProfessionalRecordPage'

const mocks = vi.hoisted(() => ({
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn(), deactivateProfessional: vi.fn() },
  history: { fetchProfessionalHistory: vi.fn() },
  invitations: { fetchProfessionalOnboarding: vi.fn(), fetchProfessionalEmails: vi.fn() },
}))
vi.mock('../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/catalog')>()), ...mocks.catalog }))
vi.mock('../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/record')>()), ...mocks.record }))
vi.mock('../api/history', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/history')>()), ...mocks.history }))
vi.mock('../api/invitations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/invitations')>()), ...mocks.invitations }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.professionals.record'
const base = `/professionnels/${IDS.professional}`

/** The topbar's crumb and how the router got here (PUSH / REPLACE). */
function Probes() {
  return (
    <>
      <LocationProbe />
      <p data-testid="crumb">{useShellCrumbLabel()}</p>
      <p data-testid="navigation">{useNavigationType()}</p>
    </>
  )
}

/** A card of the open tab with unsaved edits. */
function DirtyForm() {
  useUnsavedChanges(true)
  return null
}

/** Opens another URL from inside the router (another record, as a link elsewhere would). */
function GoTo({ path }: { path: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(path)}>
      go
    </button>
  )
}

function renderPage({ path = `${base}/apercu`, role = 'counselor' as FixtureRole, dirty = false, extra = null as ReactNode, before = (_: ReturnType<typeof setupQueryClient>) => {} } = {}) {
  const client = setupQueryClient()
  before(client)
  render(
    <QueryClientProvider client={client.queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <ShellCrumbProvider>
            <Routes>
              <Route path="/professionnels/:id/:onglet?" element={<ProfessionalRecordPage />} />
            </Routes>
            <Probes />
            {dirty && <DirtyForm />}
            {extra}
          </ShellCrumbProvider>
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
  return client
}

const location = () => screen.getByTestId('location').textContent
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
const tab = (key: string) => screen.getByRole('tab', { name: t(`${R}.tabs.${key}` as Parameters<typeof t>[0]) })

beforeEach(() => {
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(recordFixture())
  mocks.history.fetchProfessionalHistory.mockResolvedValue([])
  mocks.invitations.fetchProfessionalOnboarding.mockResolvedValue(null)
  mocks.invitations.fetchProfessionalEmails.mockResolvedValue([])
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.title = ''
})

describe('ProfessionalRecordPage', () => {
  it('requests the record, its onboarding line and the catalogue in the same tick (P4-270)', () => {
    mocks.record.fetchProfessionalRecord.mockReturnValue(new Promise(() => {}))
    mocks.catalog.fetchProfessionalsCatalog.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledWith(IDS.professional)
    expect(mocks.invitations.fetchProfessionalOnboarding).toHaveBeenCalledWith(IDS.professional)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
  })

  it('shows the header and Aperçu, names the browser tab and the crumb', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(tab('apercu')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 3, name: t(`${R}.overview.matching.title`) })).toBeInTheDocument()
    expect(document.title).toBe(`Marie Tremblay · ${t('app.name')}`)
    expect(screen.getByTestId('crumb')).toHaveTextContent('Marie Tremblay')
  })

  it('opens the tab the URL names', async () => {
    // The tab's chunk loaded first: a cold import may outlast findBy's wait.
    await RECORD_TAB_DEFS.find((def) => def.tab === 'historique')?.panel.preload?.()
    renderPage({ path: `${base}/historique` })
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(tab('historique')).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { level: 2, name: t(`${R}.tabs.historique`) })).toBeInTheDocument()
    expect(await screen.findByText(t('modules.professionals.history.empty.title'))).toBeInTheDocument()
    expect(mocks.history.fetchProfessionalHistory).toHaveBeenCalledTimes(1)
  })

  it('puts the chosen tab in the URL, replacing the history entry', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: t(`${R}.tabs.jumelage`) }))
    expect(location()).toBe(`${base}/jumelage`)
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE')
    expect(tab('jumelage')).toHaveAttribute('aria-selected', 'true')
    // The tabs read the page's record and catalogue: a switch requests neither again.
    expect(await screen.findByRole('heading', { level: 3, name: t(`${R}.matching.clienteles.title`) })).toBeInTheDocument()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledTimes(1)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
  })

  it('switches tabs with the arrow keys (one tab stop)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    act(() => tab('apercu').focus())
    await userEvent.keyboard('{ArrowRight}')
    // Radix moves the focus in a timeout after the keydown: wait for it rather than race it.
    await waitFor(() => expect(location()).toBe(`${base}/jumelage`))
    expect(tab('jumelage')).toHaveFocus()
    expect(tab('profil-public')).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(location()).toBe(`${base}/profil-public`))
    expect(await screen.findByRole('heading', { level: 3, name: t(`${R}.publicProfile.portrait.title`) })).toBeInTheDocument()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledTimes(1)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
  })

  it('asks before leaving a tab with unsaved edits', async () => {
    renderPage({ dirty: true })
    await userEvent.click(await screen.findByRole('tab', { name: t(`${R}.tabs.identite`) }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
    expect(location()).toBe(`${base}/apercu`)
    await userEvent.click(screen.getByRole('button', { name: t('common.unsaved.leave') }))
    await waitFor(() => expect(location()).toBe(`${base}/identite`))
  })

  it('starts loading a tab’s code when the pointer rests on it', async () => {
    const jumelage = RECORD_TAB_DEFS.find((def) => def.tab === 'jumelage')?.panel
    const preload = vi.spyOn(jumelage as Required<NonNullable<typeof jumelage>>, 'preload')
    renderPage()
    await userEvent.hover(await screen.findByRole('tab', { name: t(`${R}.tabs.jumelage`) }))
    expect(preload).toHaveBeenCalled()
  })

  it('starts loading the history with its code when the pointer rests on Historique', async () => {
    const historique = RECORD_TAB_DEFS.find((def) => def.tab === 'historique')?.panel
    const preload = vi.spyOn(historique as Required<NonNullable<typeof historique>>, 'preload')
    renderPage()
    await userEvent.hover(await screen.findByRole('tab', { name: t(`${R}.tabs.historique`) }))
    expect(preload).toHaveBeenCalled()
    expect(mocks.history.fetchProfessionalHistory).toHaveBeenCalledWith(IDS.professional, undefined)
    // Opening the tab then reads the prefetched page: no second request.
    await userEvent.click(tab('historique'))
    expect(await screen.findByText(t('modules.professionals.history.empty.title'))).toBeInTheDocument()
    expect(mocks.history.fetchProfessionalHistory).toHaveBeenCalledTimes(1)
  })

  it('starts loading a tab’s code when it takes the focus', async () => {
    const identite = RECORD_TAB_DEFS.find((def) => def.tab === 'identite')?.panel
    const preload = vi.spyOn(identite as Required<NonNullable<typeof identite>>, 'preload')
    renderPage()
    const trigger = await screen.findByRole('tab', { name: t(`${R}.tabs.identite`) })
    expect(preload).not.toHaveBeenCalled()
    act(() => trigger.focus())
    expect(preload).toHaveBeenCalled()
  })

  it('asks before following an in-page link to another tab while a card is dirty', async () => {
    renderPage({ dirty: true })
    await userEvent.click(await screen.findByRole('link', { name: t(`${R}.overview.matching.edit`) }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
    expect(location()).toBe(`${base}/apercu`)
    await userEvent.click(screen.getByRole('button', { name: t('common.unsaved.leave') }))
    await waitFor(() => expect(location()).toBe(`${base}/jumelage`))
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE')
  })

  it('follows an in-page link to another tab at once when nothing is dirty', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('link', { name: t(`${R}.overview.matching.edit`) }))
    expect(location()).toBe(`${base}/jumelage`)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE')
  })

  it('starts another record from the cache at once, every motif written out', async () => {
    const otherId = '00000000-0000-4000-8000-0000000000b2'
    const big = seventyTwoMotifsCatalog()
    const allMotifs = big.motifs.filter((m) => m.isActive).map((m) => m.id)
    const first = { ...recordFixture(), motifIds: allMotifs }
    const second = { ...first, professional: { ...first.professional, id: otherId, firstName: 'Julie', lastName: 'Roy' }, motifIds: allMotifs.slice(0, 2) }
    mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(big)
    mocks.record.fetchProfessionalRecord.mockImplementation((id: string) => Promise.resolve(id === otherId ? second : first))
    renderPage({
      extra: <GoTo path={`/professionnels/${otherId}/apercu`} />,
      before: ({ queryClient }) => queryClient.setQueryData(professionalKeys.record(otherId), second),
    })
    expect(await screen.findByText('Motif 8.9', { selector: 'li' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'go' }))
    // The cached record shows at once, with its own motifs.
    expect(screen.getByRole('heading', { level: 1, name: 'Julie Roy' })).toBeInTheDocument()
    expect(screen.getByText('Motif 1.2', { selector: 'li' })).toBeVisible()
    expect(screen.queryByText('Motif 8.9', { selector: 'li' })).not.toBeInTheDocument()
  })

  it('shows the status actions in the header for staff who manage files, none for the counselor', async () => {
    renderPage({ role: 'admin' })
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement
    expect(within(header).getByRole('button', { name: t(`${R}.actions.activate`) })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: t(`${R}.actions.more`) })).toBeInTheDocument()
    cleanup()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(within(screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
  })

  it('moves focus to the name once a deactivation leaves no action to return to', async () => {
    let record = recordFixture()
    mocks.record.fetchProfessionalRecord.mockImplementation(async () => record)
    mocks.record.deactivateProfessional.mockImplementation(async () => {
      record = { ...record, professional: { ...record.professional, status: 'inactive' } }
      return { status: 'inactive', accountChange: null, profileId: null }
    })
    renderPage({ role: 'admin_assistant' })
    await userEvent.click(await screen.findByRole('button', { name: t(`${R}.actions.more`) }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${R}.actions.deactivate`) }))
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: new RegExp(`^${t(`${R}.deactivate.reason`)}`) }), 'Congé')
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.deactivate.confirm`) }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.record.deactivateProfessional).toHaveBeenCalledExactlyOnceWith(IDS.professional, IDS.leave, null)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Marie Tremblay' })).toHaveFocus())
  })

  it('shows the counselor no compensation tab, and the admin one', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(tabNames()).not.toContain(t(`${R}.tabs.remuneration`))
    expect(tabNames()).toEqual(['apercu', 'jumelage', 'profil-public', 'identite', 'historique'].map((k) => t(`${R}.tabs.${k}` as Parameters<typeof t>[0])))
    cleanup()
    renderPage({ role: 'admin' })
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(tabNames()).toContain(t(`${R}.tabs.remuneration`))
  })

  it.each([
    ['a hidden tab', `${base}/remuneration`],
    ['an unknown tab', `${base}/inconnu`],
    ['no tab', base],
  ])('sends %s to Aperçu', async (_, path) => {
    renderPage({ path })
    await waitFor(() => expect(location()).toBe(`${base}/apercu`))
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
  })

  it('says « introuvable » when the record cannot be read, with a way back', async () => {
    mocks.record.fetchProfessionalRecord.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${R}.notFound.title`) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${R}.notFound.back`) })).toHaveAttribute('href', '/professionnels')
    expect(document.title).toBe(`${t(`${R}.notFound.title`)} · ${t('app.name')}`)
    expect(screen.getByTestId('crumb')).toBeEmptyDOMElement()
  })

  it('does not ask the database about an id that is not one', async () => {
    renderPage({ path: '/professionnels/0b6c/apercu' })
    expect(await screen.findByRole('heading', { level: 1, name: t(`${R}.notFound.title`) })).toBeInTheDocument()
    expect(mocks.record.fetchProfessionalRecord).not.toHaveBeenCalled()
    expect(mocks.catalog.fetchProfessionalsCatalog).not.toHaveBeenCalled()
  })

  it('offers « Réessayer » when a load fails, and retries only what failed', async () => {
    mocks.record.fetchProfessionalRecord.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledTimes(2)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
  })

  it('shows the status as staff read it: « En préparation » once the questionnaire is approved (P4-43)', async () => {
    const record = recordFixture()
    mocks.record.fetchProfessionalRecord.mockResolvedValue({ ...record, professional: { ...record.professional, status: 'in_review', profileId: IDS.providerUser } })
    mocks.invitations.fetchProfessionalOnboarding.mockResolvedValue({ invitation: null, submission: null, onboardingApproved: true })
    renderPage()
    const header = (await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).closest('header') as HTMLElement
    expect(within(header).getByText(t('modules.professionals.status.preparing'))).toBeInTheDocument()
  })

  it('offers « Réessayer » when the onboarding line fails, and retries only it', async () => {
    mocks.invitations.fetchProfessionalOnboarding.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(mocks.invitations.fetchProfessionalOnboarding).toHaveBeenCalledTimes(2)
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledTimes(1)
  })

  it('offers « Réessayer » when the catalogue fails, and retries only the catalogue', async () => {
    mocks.catalog.fetchProfessionalsCatalog.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }))
    renderPage()
    expect(await screen.findByText(t(`${R}.loadError`))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(2)
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledTimes(1)
  })
})
