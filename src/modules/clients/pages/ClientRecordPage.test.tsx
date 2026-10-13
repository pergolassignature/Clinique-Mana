import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { CIDS, REFERENCE, clientFixture, summaryFixture } from '../test/fixtures'
import { ClientRecordPage } from './ClientRecordPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchClientSummary: vi.fn(),
    fetchClientsReference: vi.fn(),
    updateClient: vi.fn(),
    setClientArchived: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/clients')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.clients.record'

beforeEach(() => {
  mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture())
  mocks.api.fetchClientsReference.mockResolvedValue(REFERENCE)
  mocks.api.updateClient.mockResolvedValue(undefined)
  mocks.api.setClientArchived.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ role = 'counselor' as FixtureRole, path = `/clients/${CIDS.alice}/apercu` } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <Routes>
            <Route path="clients/:id/:onglet?" element={<ClientRecordPage />} />
            <Route path="clients" element={<p>LISTE</p>} />
          </Routes>
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

describe('ClientRecordPage', () => {
  it('heads the file with its name, number, age, state, flags and tags; the tabs are real tabs', async () => {
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ client: clientFixture({ isBanned: true }) }))
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: /Alice Tremblay/ })).toHaveTextContent('(elle)')
    expect(screen.getByText('CLI-000001')).toBeInTheDocument()
    expect(screen.getByText(t(`${R}.active`))).toBeInTheDocument()
    expect(screen.getByText(t('modules.clients.list.flags.banned'))).toBeInTheDocument()
    expect(screen.getByText('Atelier')).toBeInTheDocument()
    const tabs = screen.getByRole('tablist', { name: t(`${R}.tabs.label`) })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Aperçu',
      'Informations',
      'Proches',
      'Assurance et payeurs',
      'Consentements',
      'Visites et paiements',
    ])
    expect(within(tabs).getByRole('tab', { name: 'Aperçu' })).toHaveAttribute('aria-selected', 'true')
    expect(mocks.api.fetchClientSummary).toHaveBeenCalledWith(CIDS.alice)
  })

  it('« Dossier introuvable » for an id that is not a record, without a request', async () => {
    renderPage({ path: '/clients/pas-un-id' })
    expect(await screen.findByRole('heading', { name: t(`${R}.notFound.title`) })).toBeInTheDocument()
    expect(mocks.api.fetchClientSummary).not.toHaveBeenCalled()
  })

  it('« Dossier introuvable » when the server has no such file', async () => {
    mocks.api.fetchClientSummary.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('heading', { name: t(`${R}.notFound.title`) })).toBeInTheDocument()
  })

  it('« Informations »: a card saves its own field over the stored file', async () => {
    const user = userEvent.setup()
    renderPage({ path: `/clients/${CIDS.alice}/informations` })
    const email = await screen.findByRole('textbox', { name: /^Courriel/ })
    await user.clear(email)
    await user.type(email, 'nouveau@exemple.test')
    const card = email.closest('form') as HTMLElement
    await user.click(within(card).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.updateClient).toHaveBeenCalled())
    expect(mocks.api.updateClient.mock.calls[0]?.[0]).toBe(CIDS.alice)
    expect(mocks.api.updateClient.mock.calls[0]?.[1]).toMatchObject({ email: 'nouveau@exemple.test', first_name: 'Alice', mobile_e164: '+15145550101' })
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.clients.saved.updated')))
  })

  it('« Archiver » for whoever manages files', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${R}.archive`) }))
    await waitFor(() => expect(mocks.api.setClientArchived).toHaveBeenCalledWith(CIDS.alice, true))
  })

  it('a provider reads the file without « Archiver » nor « Enregistrer »', async () => {
    renderPage({ role: 'provider', path: `/clients/${CIDS.alice}/informations` })
    expect(await screen.findByRole('textbox', { name: /^Courriel/ })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: t(`${R}.archive`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })

  it('a merged file points to the kept one and cannot be edited', async () => {
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ client: clientFixture({ mergedIntoId: CIDS.marc }) }))
    renderPage()
    expect(await screen.findByRole('link', { name: t(`${R}.openKept`) })).toHaveAttribute('href', `/clients/${CIDS.marc}/apercu`)
    expect(screen.getByText(t(`${R}.merged`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${R}.archive`) })).not.toBeInTheDocument()
  })
})
