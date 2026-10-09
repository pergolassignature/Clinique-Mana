import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { PREFERENCE_WRITE_DELAY } from '@/core/preferences/hooks'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { PAGE_SIZE } from '../lib/constants'
import { LIST_FILTERS_PREFERENCE } from '../lib/remembered-filters'
import { setupQueryClient } from '../test/query-client'
import type { ProfessionalListRow } from '../api/parse'
import { CATALOG, GENDERED_CATALOG, listRowFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { ProfessionalsListPage } from './ProfessionalsListPage'

const mocks = vi.hoisted(() => ({
  list: { fetchProfessionalsList: vi.fn() },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn() },
  invitations: { fetchInvitationStates: vi.fn(), fetchProfessionalOnboarding: vi.fn() },
  preferences: { fetchUserPreference: vi.fn(), saveUserPreference: vi.fn(), deleteUserPreference: vi.fn(), onSessionUserChange: vi.fn(() => () => {}) },
}))
vi.mock('../api/list', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/list')>()), ...mocks.list }))
vi.mock('../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/catalog')>()), ...mocks.catalog }))
vi.mock('../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/record')>()), ...mocks.record }))
vi.mock('../api/invitations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/invitations')>()), ...mocks.invitations }))
vi.mock('@/core/preferences/api', () => mocks.preferences)
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const L = 'modules.professionals.list'

const id = (n: number) => `00000000-0000-4000-8000-${String(9000 + n).padStart(12, '0')}`
const MARIE = listRowFixture({ id: id(1), firstName: 'Marie', lastName: 'Tremblay', email: 'marie.t@exemple.ca', status: 'active' })
const HELENE = listRowFixture({
  id: id(2),
  firstName: 'Hélène',
  lastName: 'Côté',
  email: 'hcote@exemple.ca',
  status: 'draft',
  primaryTitleId: IDS.naturopathe,
  primaryLicenceNumber: null,
  languageIds: [IDS.fr, IDS.en],
  motifIds: [IDS.deuil],
  matchingComplete: false,
  acceptingNewClients: false,
})
const PAUL = listRowFixture({
  id: id(3),
  firstName: 'Paul',
  lastName: 'Gagnon',
  email: 'paul@exemple.ca',
  status: 'inactive',
  statusChangedAt: '2026-10-03T14:00:00Z',
  deactivationReasonId: IDS.leave,
  primaryLicenceNumber: '54321',
})
const ROWS = [HELENE, PAUL, MARIE]

function renderPage({ path = '/professionnels', role = 'admin_assistant' as FixtureRole } = {}) {
  const client = setupQueryClient()
  render(
    <QueryClientProvider client={client.queryClient}>
      {renderWithContexts(
        <>
          <ProfessionalsListPage />
          <LocationProbe />
          <SearchProbe />
        </>,
        { path, access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
  return client
}

/** The router's query string, next to LocationProbe's path. */
function SearchProbe() {
  return <p data-testid="search">{useLocation().search}</p>
}

const table = () => screen.getByRole('table', { name: t(`${L}.table.label`) })
const names = () => within(table()).queryAllByRole('link').map((link) => link.textContent)
const location = () => `${screen.getByTestId('location').textContent}${screen.getByTestId('search').textContent}`

beforeEach(() => {
  mocks.list.fetchProfessionalsList.mockResolvedValue({ rows: ROWS, truncated: false })
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.record.fetchProfessionalRecord.mockReturnValue(new Promise(() => {}))
  mocks.invitations.fetchInvitationStates.mockResolvedValue(new Map())
  mocks.invitations.fetchProfessionalOnboarding.mockReturnValue(new Promise(() => {}))
  mocks.preferences.fetchUserPreference.mockResolvedValue(null)
  mocks.preferences.saveUserPreference.mockResolvedValue(undefined)
  mocks.preferences.deleteUserPreference.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('ProfessionalsListPage', () => {
  it('lists the professionals with their counts, title, licence, languages, status and first watch flag', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t('modules.professionals.name') })).toBeInTheDocument()
    expect(await screen.findByText('3 professionnels · 1 actif')).toBeInTheDocument()
    await waitFor(() => expect(names()).toEqual(['Hélène Côté', 'Paul Gagnon', 'Marie Tremblay']))
    const helene = screen.getByRole('link', { name: 'Hélène Côté' }).closest('[role=row]') as HTMLElement
    expect(within(helene).getByText('Naturopathe')).toBeInTheDocument()
    expect(within(helene).getByText('FR · EN')).toBeInTheDocument()
    expect(within(helene).getByText(t('modules.professionals.status.draft'))).toBeInTheDocument()
    expect(within(helene).getByText(t('modules.professionals.watch.matching_incomplete'))).toBeInTheDocument()
    const marie = screen.getByRole('link', { name: 'Marie Tremblay' }).closest('[role=row]') as HTMLElement
    expect(within(marie).getByText('OPQ 12345')).toBeInTheDocument()
    expect(within(marie).getByText(t(`${L}.table.nothingToWatch`))).toBeInTheDocument()
    expect(screen.getByText('3 résultats')).toBeInTheDocument()
    expect(screen.getByText('3 sur 3 professionnels')).toBeInTheDocument()
    expect(screen.getByText('Page 1 sur 1')).toBeInTheDocument()
  })

  it('an inactive file: « Inactif depuis le … · {raison} » in « À surveiller » (P4-510)', async () => {
    renderPage()
    await waitFor(() => expect(names()).toContain('Paul Gagnon'))
    const paul = screen.getByRole('link', { name: 'Paul Gagnon' }).closest('[role=row]') as HTMLElement
    expect(within(paul).getByText(t('modules.professionals.watch.inactiveSinceFor', { date: '3 oct. 2026', reason: 'Congé' }))).toBeInTheDocument()
    expect(within(paul).queryByText(t(`${L}.table.nothingToWatch`))).not.toBeInTheDocument()
  })

  it('names each title in the professional\'s form, the title\'s name without a gender (P4-342)', async () => {
    const socialWorker = (n: number, firstName: string, gender: ProfessionalListRow['gender']) =>
      listRowFixture({ id: id(n), firstName, lastName: 'Roy', email: `${firstName.toLowerCase()}@exemple.ca`, primaryTitleId: IDS.travailleurSocial, gender })
    mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(GENDERED_CATALOG)
    mocks.list.fetchProfessionalsList.mockResolvedValue({
      rows: [socialWorker(4, 'Anne', 'female'), socialWorker(5, 'Luc', 'male'), socialWorker(6, 'Sam', null)],
      truncated: false,
    })
    renderPage()
    const rowOf = async (name: string) => (await screen.findByRole('link', { name })).closest('[role=row]') as HTMLElement
    expect(within(await rowOf('Anne Roy')).getByText('Travailleuse sociale')).toBeInTheDocument()
    expect(within(await rowOf('Luc Roy')).getByText('Travailleur social')).toBeInTheDocument()
    expect(within(await rowOf('Sam Roy')).getByText('Travailleuse sociale ou travailleur social')).toBeInTheDocument()
  })

  it('loads the list, the onboarding states, the catalogue and the remembered filters in parallel', () => {
    mocks.list.fetchProfessionalsList.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(mocks.list.fetchProfessionalsList).toHaveBeenCalledTimes(1)
    expect(mocks.invitations.fetchInvitationStates).toHaveBeenCalledTimes(1)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
    expect(mocks.preferences.fetchUserPreference).toHaveBeenCalledWith('u1', LIST_FILTERS_PREFERENCE)
    expect(table()).toHaveAttribute('aria-busy', 'true')
  })

  it('links each row to the record and prefetches it on hover', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Marie Tremblay' })
    expect(link).toHaveAttribute('href', `/professionnels/${MARIE.id}/apercu`)
    const row = link.closest('[role=row]') as HTMLElement
    // A pointer crossing the row on its way elsewhere prefetches nothing.
    await userEvent.hover(row)
    await userEvent.unhover(row)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(mocks.record.fetchProfessionalRecord).not.toHaveBeenCalled()
    await userEvent.hover(row)
    await waitFor(() => expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledWith(MARIE.id))
  })

  it('prefetches the record when its link gets keyboard focus', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Marie Tremblay' })
    screen.getByRole('link', { name: 'Hélène Côté' }).focus()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledWith(HELENE.id)
  })

  it('shows « Ajouter », the page’s one teal action, to the adjointe', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: t(`${L}.add`) })).toHaveClass('bg-primary')
  })

  it('has no « Ajouter » for the conseillère', async () => {
    renderPage({ role: 'counselor' })
    await screen.findByRole('link', { name: 'Marie Tremblay' })
    expect(screen.queryByRole('button', { name: t(`${L}.add`) })).not.toBeInTheDocument()
  })

  it('searches on name, email and licence, accents ignored, and keeps the search in the URL', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Marie Tremblay' })
    const search = screen.getByRole('searchbox', { name: t(`${L}.search.label`) })
    await userEvent.type(search, 'helene')
    await waitFor(() => expect(names()).toEqual(['Hélène Côté']))
    await userEvent.clear(search)
    await userEvent.type(search, '54321')
    await waitFor(() => expect(names()).toEqual(['Paul Gagnon']))
    await userEvent.clear(search)
    await userEvent.type(search, 'marie.t@')
    await waitFor(() => expect(names()).toEqual(['Marie Tremblay']))
    expect(screen.getByText('1 résultat')).toBeInTheDocument()
    expect(location()).toBe('/professionnels?q=marie.t%40')
  })

  it('reads its filters from the URL (a reload keeps them)', async () => {
    renderPage({ path: `/professionnels?statut=inactif` })
    await waitFor(() => expect(names()).toEqual(['Paul Gagnon']))
    expect(screen.getByRole('combobox', { name: t(`${L}.statusFilter.label`) })).toHaveValue('inactive')
  })

  it('joins the onboarding states: P4-43 statuses, the invitation and review flags, and the status filter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T20:00:00Z'))
    const states = new Map([
      [HELENE.id, { invitation: { state: 'sent' as const, sentAt: '2026-10-04T14:00:00Z', expiresAt: '2026-10-11T14:00:00Z', openedAt: null, usedAt: null, delivery: 'email' as const, emailStatus: 'delivered', emailError: null }, submission: null, onboardingApproved: false }],
      [MARIE.id, { invitation: null, submission: { id: 's1', kind: 'update' as const, status: 'submitted' as const, submittedAt: '2026-10-07T12:00:00Z' }, onboardingApproved: true }],
      [PAUL.id, { invitation: null, submission: null, onboardingApproved: true }],
    ])
    mocks.invitations.fetchInvitationStates.mockResolvedValue(states)
    mocks.list.fetchProfessionalsList.mockResolvedValue({
      rows: [{ ...HELENE, status: 'invited', matchingComplete: true }, { ...PAUL, status: 'in_review', hasAccount: true }, { ...MARIE, hasAccount: true }],
      truncated: false,
    })
    renderPage()
    await waitFor(() => expect(names()).toEqual(['Hélène Côté', 'Paul Gagnon', 'Marie Tremblay']))
    const row = (name: string) => screen.getByRole('link', { name }).closest('[role=row]') as HTMLElement
    expect(within(row('Hélène Côté')).getByText('Invitation sans réponse depuis 4 jours')).toBeInTheDocument()
    expect(within(row('Paul Gagnon')).getByText(t('modules.professionals.status.preparing'))).toBeInTheDocument()
    expect(within(row('Marie Tremblay')).getByText('Mise à jour à réviser')).toBeInTheDocument()
    vi.useRealTimers()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: t(`${L}.statusFilter.label`) }), 'preparing')
    await waitFor(() => expect(names()).toEqual(['Paul Gagnon']))
    expect(location()).toBe('/professionnels?statut=en-preparation')
  })

  it('narrows by status and goes back to page 1', async () => {
    mocks.list.fetchProfessionalsList.mockResolvedValue({
      rows: Array.from({ length: PAGE_SIZE + 5 }, (_, i) => listRowFixture({ id: id(100 + i), lastName: `Nom ${String(i).padStart(2, '0')}`, status: i < 3 ? 'inactive' : 'active' })),
      truncated: false,
    })
    renderPage({ path: '/professionnels?page=2' })
    await waitFor(() => expect(names()).toHaveLength(5))
    expect(screen.getByText('Page 2 sur 2')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: t(`${L}.statusFilter.label`) }), 'inactive')
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.getByText('Page 1 sur 1')).toBeInTheDocument()
    expect(location()).toBe('/professionnels?statut=inactif')
  })

  it('pages with ‹ and ›, which stay focusable at the ends', async () => {
    mocks.list.fetchProfessionalsList.mockResolvedValue({
      rows: Array.from({ length: PAGE_SIZE + 1 }, (_, i) => listRowFixture({ id: id(200 + i), lastName: `Nom ${String(i).padStart(2, '0')}` })),
      truncated: false,
    })
    renderPage()
    await waitFor(() => expect(names()).toHaveLength(PAGE_SIZE))
    const status = screen.getByText('26 résultats').closest('[role="status"]')
    expect(status).toHaveTextContent('26 résultats, page 1 sur 2')
    const next = screen.getByRole('button', { name: t(`${L}.footer.next`) })
    await userEvent.click(next)
    await waitFor(() => expect(names()).toHaveLength(1))
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).toHaveFocus()
    expect(screen.getByText('26 sur 26 professionnels')).toBeInTheDocument()
    // The focus stays on ›: the polite results status says where it led.
    expect(status).toHaveTextContent('26 résultats, page 2 sur 2')
    expect(status).toHaveAttribute('aria-atomic', 'true')
  })

  it('announces no page when there is only one', async () => {
    renderPage()
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.getByText('3 résultats').closest('[role="status"]')).not.toHaveTextContent('page')
  })

  it('filters through « Filtres », shows the filters as chips, and removes one', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Marie Tremblay' })
    await userEvent.click(screen.getByRole('button', { name: t(`${L}.filters.button`) }))
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: t(`${L}.filters.language`) }), IDS.en)
    await waitFor(() => expect(names()).toEqual(['Hélène Côté']))
    await userEvent.keyboard('{Escape}')
    const chip = screen.getByRole('button', { name: t(`${L}.chips.remove`, { label: 'Langue : Anglais' }) })
    expect(screen.getByRole('button', { name: t(`${L}.filters.buttonCount`, { count: '1' }) })).toBeInTheDocument()
    await userEvent.click(chip)
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.getByRole('button', { name: t(`${L}.filters.button`) })).toHaveFocus()
  })

  it('filters on motifs from the searchable list, and on « À surveiller »', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Marie Tremblay' })
    await userEvent.click(screen.getByRole('button', { name: t(`${L}.filters.button`) }))
    await userEvent.type(screen.getByPlaceholderText(t(`${L}.filters.motifsSearch`)), 'anxiete')
    const option = await screen.findByRole('option', { name: /Anxiété/ })
    expect(screen.queryByRole('option', { name: /Deuil/ })).not.toBeInTheDocument()
    await userEvent.click(option)
    await waitFor(() => expect(names()).toEqual(['Paul Gagnon', 'Marie Tremblay']))
    expect(screen.getByRole('option', { name: /Anxiété/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('checkbox', { name: t(`${L}.filters.watch`) }))
    await waitFor(() => expect(screen.getByText(t(`${L}.noMatch.title`))).toBeInTheDocument())
  })

  it('says when nothing matches, and « Réinitialiser » shows everyone again', async () => {
    renderPage({ path: '/professionnels?q=personne' })
    expect(await screen.findByText(t(`${L}.noMatch.title`))).toBeInTheDocument()
    expect(screen.getByText(t(`${L}.noMatch.body`))).toBeInTheDocument()
    const resets = screen.getAllByRole('button', { name: t(`${L}.reset`) })
    await userEvent.click(resets[resets.length - 1] as HTMLElement)
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })

  it('says when the clinic has no professional yet', async () => {
    mocks.list.fetchProfessionalsList.mockResolvedValue({ rows: [], truncated: false })
    renderPage()
    expect(await screen.findByText(t(`${L}.empty.title`))).toBeInTheDocument()
    expect(screen.getByText(t(`${L}.empty.body`))).toBeInTheDocument()
    expect(screen.getByText('0 professionnel · 0 actif')).toBeInTheDocument()
  })

  it('the onboarding states failing: the list still shows, with the stored statuses, a notice and « Réessayer »', async () => {
    mocks.invitations.fetchInvitationStates.mockRejectedValueOnce(new Error('network'))
    renderPage()
    expect(await screen.findByRole('link', { name: 'Marie Tremblay' })).toBeInTheDocument()
    const notice = screen.getByText(t(`${L}.statesError`))
    expect(screen.queryByText(t(`${L}.loadError`))).not.toBeInTheDocument()
    await userEvent.click(within(notice).getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(screen.queryByText(t(`${L}.statesError`))).not.toBeInTheDocument())
    expect(mocks.invitations.fetchInvitationStates).toHaveBeenCalledTimes(2)
  })

  it('warns past 500 professionals', async () => {
    mocks.list.fetchProfessionalsList.mockResolvedValue({ rows: ROWS, truncated: true })
    renderPage()
    expect(await screen.findByText(t(`${L}.truncated`))).toBeInTheDocument()
  })

  it('shows a load error with « Réessayer »', async () => {
    mocks.list.fetchProfessionalsList.mockRejectedValueOnce(new Error('network'))
    renderPage()
    expect(await screen.findByText(t(`${L}.loadError`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('link', { name: 'Marie Tremblay' })).toBeInTheDocument()
  })
})

describe('ProfessionalsListPage — remembered filters', () => {
  it('restores the person’s last filters into an empty URL', async () => {
    mocks.preferences.fetchUserPreference.mockResolvedValue({ query: 'statut=inactif' })
    renderPage()
    await waitFor(() => expect(names()).toEqual(['Paul Gagnon']))
    expect(screen.getByRole('combobox', { name: t(`${L}.statusFilter.label`) })).toHaveValue('inactive')
    expect(location()).toBe('/professionnels?statut=inactif')
  })

  it('never shows every row before restoring them', async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.preferences.fetchUserPreference.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    await waitFor(() => expect(mocks.list.fetchProfessionalsList).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(names()).toEqual([])
    resolve({ query: 'statut=actif' })
    await waitFor(() => expect(names()).toEqual(['Marie Tremblay']))
  })

  it('leaves a link that carries filters alone', async () => {
    mocks.preferences.fetchUserPreference.mockResolvedValue({ query: 'statut=inactif' })
    renderPage({ path: '/professionnels?statut=actif' })
    await waitFor(() => expect(names()).toEqual(['Marie Tremblay']))
  })

  it('saves a change after a pause, forgets them on « Réinitialiser », and uses no localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderPage()
    await screen.findByRole('link', { name: 'Marie Tremblay' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: t(`${L}.statusFilter.label`) }), 'active')
    expect(mocks.preferences.saveUserPreference).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.preferences.saveUserPreference).toHaveBeenCalledWith('u1', LIST_FILTERS_PREFERENCE, { query: 'statut=actif' }), {
      timeout: PREFERENCE_WRITE_DELAY + 1000,
    })
    await userEvent.click(screen.getByRole('button', { name: t(`${L}.reset`) }))
    await waitFor(() => expect(mocks.preferences.deleteUserPreference).toHaveBeenCalledWith('u1', LIST_FILTERS_PREFERENCE), { timeout: PREFERENCE_WRITE_DELAY + 1000 })
    expect(setItem).not.toHaveBeenCalled()
    expect(location()).toBe('/professionnels')
  })

  it('keeps working when the filters cannot be read or saved', async () => {
    mocks.preferences.fetchUserPreference.mockRejectedValue(new Error('network'))
    mocks.preferences.saveUserPreference.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(names()).toHaveLength(3))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: t(`${L}.statusFilter.label`) }), 'active')
    await waitFor(() => expect(mocks.preferences.saveUserPreference).toHaveBeenCalled(), { timeout: PREFERENCE_WRITE_DELAY + 1000 })
    expect(names()).toEqual(['Marie Tremblay'])
  })
})
