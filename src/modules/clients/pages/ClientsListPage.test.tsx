import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MemoryRouterProps } from 'react-router-dom'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { CIDS, REFERENCE, listRowFixture } from '../test/fixtures'
import { ClientsListPage } from './ClientsListPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchClientsPage: vi.fn(),
    fetchClientsReference: vi.fn(),
    findClientDuplicates: vi.fn(),
    createClient: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
  navigate: vi.fn(),
  preferences: { fetchUserPreference: vi.fn(), saveUserPreference: vi.fn(), deleteUserPreference: vi.fn() },
}))
vi.mock('@/core/preferences/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/preferences/api')>()), ...mocks.preferences }))
vi.mock('../api/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/clients')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }))

type RouterEntry = NonNullable<MemoryRouterProps['initialEntries']>[number]

const L = 'modules.clients.list'
const C = 'modules.clients.create'

beforeEach(() => {
  mocks.api.fetchClientsPage.mockResolvedValue([listRowFixture(), listRowFixture({ id: CIDS.lea, clientNumber: 2, firstName: 'Léa', lastName: 'Gagnon', isBanned: true, tagIds: [] })])
  mocks.api.fetchClientsReference.mockResolvedValue(REFERENCE)
  mocks.api.findClientDuplicates.mockResolvedValue([])
  mocks.preferences.fetchUserPreference.mockResolvedValue(null)
  mocks.preferences.saveUserPreference.mockResolvedValue(undefined)
  mocks.preferences.deleteUserPreference.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ role = 'counselor' as FixtureRole, path = '/clients' as RouterEntry, modules = undefined as string[] | undefined } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <ClientsListPage />
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role, modules ? { modules } : {}) } },
      )}
    </QueryClientProvider>,
  )
}

describe('ClientsListPage', () => {
  it('lists the files with their number, birthday, contact, professional and flags', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: t(`${L}.table`) })
    const alice = (await within(table).findByRole('link', { name: 'Alice Tremblay' })).closest('tr') as HTMLElement
    expect(alice).toHaveTextContent('CLI-000001')
    expect(alice).toHaveTextContent('alice@exemple.test')
    expect(alice).toHaveTextContent('514 555-0101')
    expect(alice).toHaveTextContent('Félix Gauthier')
    expect(alice).toHaveTextContent('Atelier')
    expect(within(table).getByRole('link', { name: 'Léa Gagnon' }).closest('tr')).toHaveTextContent(t(`${L}.flags.banned`))
    expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith({ query: '', status: 'active', professionalId: null, tagId: null, sort: 'name', lastVisit: null }, null)
  })

  it('reads its filters from the URL, the search words from the history state (never the URL), and sends them', async () => {
    renderPage({ path: { pathname: '/clients', search: `?statut=archives&professionnel=${CIDS.pro}`, state: { q: 'trem' } } })
    await screen.findByRole('table', { name: t(`${L}.table`) })
    await waitFor(() =>
      expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith({ query: 'trem', status: 'archived', professionalId: CIDS.pro, tagId: null, sort: 'name', lastVisit: null }, null),
    )
    expect(screen.getByRole('searchbox', { name: t(`${L}.searchLabel`) })).toHaveValue('trem')
  })

  it('remembered filters: the saved ones apply on arrival without filters; a link with filters wins; never the search words', async () => {
    mocks.preferences.fetchUserPreference.mockResolvedValue({ query: 'statut=archives' })
    renderPage()
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith({ query: '', status: 'archived', professionalId: null, tagId: null, sort: 'name', lastVisit: null }, null))
    expect(mocks.api.fetchClientsPage).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), null)
  })

  it('… a link that carries filters is left alone', async () => {
    mocks.preferences.fetchUserPreference.mockResolvedValue({ query: 'statut=archives' })
    renderPage({ path: '/clients?statut=tous' })
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' }), null))
    expect(mocks.api.fetchClientsPage).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }), null)
  })

  it('A-2: with the agenda\'s right and Rendez-vous on, « Dernier rendez-vous » shows, filters and orders (from the URL)', async () => {
    const user = userEvent.setup()
    mocks.api.fetchClientsPage.mockResolvedValue([listRowFixture({ lastVisitAt: '2026-10-02T14:00:00Z' }), listRowFixture({ id: CIDS.lea, firstName: 'Léa', lastName: 'Gagnon' })])
    renderPage({ path: '/clients?tri=anciens&dernier=plus-de-90-jours', modules: ['professionals', 'clients', 'appointments'] })
    const table = await screen.findByRole('table', { name: t(`${L}.table`) })
    expect(within(table).getByRole('columnheader', { name: t(`${L}.columns.lastVisit`) })).toBeInTheDocument()
    expect((await within(table).findByRole('link', { name: 'Alice Tremblay' })).closest('tr')).toHaveTextContent('2 oct. 2026')
    expect(within(table).getByRole('link', { name: 'Léa Gagnon' }).closest('tr')).toHaveTextContent(t(`${L}.noVisit`))
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ sort: 'visit_oldest', lastVisit: 'over_90' }), null))
    await user.selectOptions(screen.getByRole('combobox', { name: t(`${L}.sortLabel`) }), 'visit_recent')
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ sort: 'visit_recent', lastVisit: 'over_90' }), null))
    await user.selectOptions(screen.getByRole('combobox', { name: t(`${L}.lastVisitLabel`) }), 'never')
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ sort: 'visit_recent', lastVisit: 'never' }), null))
  })

  it('… without Rendez-vous: no column, no filter, and a visit order in the URL is ignored', async () => {
    renderPage({ path: '/clients?tri=anciens&dernier=jamais' })
    const table = await screen.findByRole('table', { name: t(`${L}.table`) })
    expect(within(table).queryByRole('columnheader', { name: t(`${L}.columns.lastVisit`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: t(`${L}.lastVisitLabel`) })).not.toBeInTheDocument()
    expect(within(screen.getByRole('combobox', { name: t(`${L}.sortLabel`) })).queryByRole('option', { name: t(`${L}.sort.visit_oldest`) })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ sort: 'name', lastVisit: null }), null))
  })

  it('« Réinitialiser » clears the URL and forgets the remembered filters at once (no write left waiting)', async () => {
    const user = userEvent.setup()
    mocks.preferences.fetchUserPreference.mockResolvedValue({ query: 'statut=archives' })
    mocks.api.fetchClientsPage.mockResolvedValue([])
    renderPage({ path: '/clients?statut=archives' })
    await user.click(await screen.findByRole('button', { name: t(`${L}.reset`) }))
    await waitFor(() => expect(mocks.preferences.deleteUserPreference).toHaveBeenCalled())
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), null))
  })

  it('A-3: « Trier par » numéro or newest files without Rendez-vous (never a visit order); « Colonnes » remembered for her', async () => {
    const user = userEvent.setup()
    renderPage({ path: '/clients?tri=numero' })
    const table = await screen.findByRole('table', { name: t(`${L}.table`) })
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ sort: 'number' }), null))
    const sort = screen.getByRole('combobox', { name: t(`${L}.sortLabel`) })
    expect(within(sort).queryByRole('option', { name: t(`${L}.sort.visit_recent`) })).not.toBeInTheDocument()
    await user.selectOptions(sort, 'created_recent')
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith(expect.objectContaining({ sort: 'created_recent' }), null))
    // « Colonnes »: « Ouvert le » on, « Naissance » off; written to her preference.
    expect(within(table).queryByRole('columnheader', { name: t(`${L}.columns.opened`) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${L}.columnPicker.label`) }))
    const picker = await screen.findByRole('dialog', { name: t(`${L}.columnPicker.title`) })
    expect(within(picker).queryByRole('checkbox', { name: t(`${L}.columns.lastVisit`) })).not.toBeInTheDocument()
    await user.click(within(picker).getByRole('checkbox', { name: t(`${L}.columns.opened`) }))
    expect(await within(table).findByRole('columnheader', { name: t(`${L}.columns.opened`) })).toBeInTheDocument()
    await user.click(within(picker).getByRole('checkbox', { name: t(`${L}.columns.birthday`) }))
    await waitFor(() => expect(within(table).queryByRole('columnheader', { name: t(`${L}.columns.birthday`) })).not.toBeInTheDocument())
    await waitFor(() =>
      expect(mocks.preferences.saveUserPreference).toHaveBeenCalledWith(expect.any(String), 'clients.list_columns', {
        columns: ['number', 'contact', 'professional', 'lastVisit', 'opened', 'flags'],
      }),
      { timeout: 3000 },
    )
  })

  it('« Nouveau client » for whoever manages files only', async () => {
    renderPage({ role: 'provider' })
    await waitFor(() => expect(mocks.api.fetchClientsPage).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: t(`${C}.add`) })).not.toBeInTheDocument()
  })

  it('creation: the duplicate panel refuses a file that exists, then a new person is created and opened', async () => {
    const user = userEvent.setup()
    mocks.api.findClientDuplicates.mockImplementation(async (query: { firstName: string }) =>
      query.firstName === 'Alice'
        ? [{ clientId: CIDS.alice, level: 'high', reasons: ['email', 'same_name'], clientNumber: 1, displayName: 'Alice Tremblay', birthday: null, email: 'alice@exemple.test', mobile: null, isArchived: false }]
        : [],
    )
    mocks.api.createClient.mockResolvedValue('new-id')
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${C}.add`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${C}.title`) })
    await user.type(within(sheet).getByRole('textbox', { name: /^Prénom/ }), 'Alice')
    await user.type(within(sheet).getByRole('textbox', { name: /^Nom/ }), 'Tremblay')
    expect(await within(sheet).findByText(t(`${C}.duplicates.high`))).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: t(`${C}.duplicates.open`) })).toHaveAttribute('href', `/clients/${CIDS.alice}/apercu`)
    expect(within(sheet).getByRole('button', { name: t(`${C}.submit`) })).toHaveAttribute('aria-disabled', 'true')

    await user.clear(within(sheet).getByRole('textbox', { name: /^Prénom/ }))
    await user.type(within(sheet).getByRole('textbox', { name: /^Prénom/ }), 'Béatrice')
    await waitFor(() => expect(within(sheet).queryByText(t(`${C}.duplicates.high`))).not.toBeInTheDocument())
    await user.click(within(sheet).getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(mocks.api.createClient).toHaveBeenCalled())
    expect(mocks.api.createClient.mock.calls[0]?.[0]).toMatchObject({ first_name: 'Béatrice', last_name: 'Tremblay', language: 'fr', reminders_by_sms: true })
    expect(mocks.api.createClient.mock.calls[0]?.[1]).toBe(false)
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/clients/new-id/apercu'))
  })

  it('« C\'est une autre personne » answers for the similar files shown: another one needs a new tick', async () => {
    const user = userEvent.setup()
    const similar = (id: string, name: string) => ({ clientId: id, level: 'medium', reasons: ['shared_contact'], clientNumber: 3, displayName: name, birthday: null, email: null, mobile: null, isArchived: false })
    mocks.api.findClientDuplicates.mockImplementation(async (query: { email: string | null }) =>
      query.email === 'a@exemple.test' ? [similar(CIDS.marc, 'Marc Tremblay')] : query.email === 'b@exemple.test' ? [similar(CIDS.lea, 'Léa Tremblay')] : [],
    )
    mocks.api.createClient.mockResolvedValue('new-id')
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${C}.add`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${C}.title`) })
    await user.type(within(sheet).getByRole('textbox', { name: /^Prénom/ }), 'Zoé')
    await user.type(within(sheet).getByRole('textbox', { name: /^Nom/ }), 'Tremblay')
    await user.type(within(sheet).getByRole('textbox', { name: /^Courriel/ }), 'a@exemple.test')
    const confirm = await within(sheet).findByRole('checkbox', { name: t(`${C}.confirmMedium`) })
    await user.click(confirm)
    expect(confirm).toBeChecked()

    await user.clear(within(sheet).getByRole('textbox', { name: /^Courriel/ }))
    await user.type(within(sheet).getByRole('textbox', { name: /^Courriel/ }), 'b@exemple.test')
    await within(sheet).findByText('Léa Tremblay')
    expect(within(sheet).getByRole('checkbox', { name: t(`${C}.confirmMedium`) })).not.toBeChecked()
    await user.click(within(sheet).getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(mocks.api.createClient).toHaveBeenCalled())
    expect(mocks.api.createClient.mock.calls[0]?.[1]).toBe(false)
  })
})
