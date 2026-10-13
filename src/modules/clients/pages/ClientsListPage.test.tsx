import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
}))
vi.mock('../api/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/clients')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }))

const L = 'modules.clients.list'
const C = 'modules.clients.create'

beforeEach(() => {
  mocks.api.fetchClientsPage.mockResolvedValue([listRowFixture(), listRowFixture({ id: CIDS.lea, clientNumber: 2, firstName: 'Léa', lastName: 'Gagnon', isBanned: true, tagIds: [] })])
  mocks.api.fetchClientsReference.mockResolvedValue(REFERENCE)
  mocks.api.findClientDuplicates.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

function renderPage({ role = 'counselor' as FixtureRole, path = '/clients' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <ClientsListPage />
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role) } },
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
    expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith({ query: '', status: 'active', professionalId: null, tagId: null }, null)
  })

  it('reads its filters from the URL and sends them to the server', async () => {
    renderPage({ path: `/clients?q=trem&statut=archives&professionnel=${CIDS.pro}` })
    await screen.findByRole('table', { name: t(`${L}.table`) })
    await waitFor(() =>
      expect(mocks.api.fetchClientsPage).toHaveBeenCalledWith({ query: 'trem', status: 'archived', professionalId: CIDS.pro, tagId: null }, null),
    )
    expect(screen.getByRole('searchbox', { name: t(`${L}.searchLabel`) })).toHaveValue('trem')
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
})
