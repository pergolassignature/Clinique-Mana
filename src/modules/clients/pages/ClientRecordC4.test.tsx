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
    findClientDuplicates: vi.fn(),
    searchClients: vi.fn(),
    mergeClients: vi.fn(),
    anonymizeClient: vi.fn(),
    fetchClientHistory: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
  navigate: vi.fn(),
}))
vi.mock('../api/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/clients')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }))

const R = 'modules.clients.record'
const M = 'modules.clients.merge'

const alice = summaryFixture({ client: clientFixture({ email: 'alice@exemple.test', birthday: null }) })
const alicia = summaryFixture({
  client: clientFixture({ id: CIDS.marc, clientNumber: 7, firstName: 'Alicia', email: 'alicia@exemple.test', birthday: '1990-03-04' }),
  relations: [],
  tags: [],
})

beforeEach(() => {
  mocks.api.fetchClientSummary.mockImplementation(async (id: string) => (id === CIDS.marc ? alicia : alice))
  mocks.api.fetchClientsReference.mockResolvedValue(REFERENCE)
  mocks.api.findClientDuplicates.mockResolvedValue([])
  mocks.api.searchClients.mockResolvedValue([])
  mocks.api.mergeClients.mockResolvedValue(undefined)
  mocks.api.anonymizeClient.mockResolvedValue(undefined)
  mocks.api.fetchClientHistory.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

function renderPage({ role = 'admin' as FixtureRole, path = `/clients/${CIDS.alice}/apercu` } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <Routes>
            <Route path="clients/:id/:onglet?" element={<ClientRecordPage />} />
          </Routes>
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

describe('the record, C4', () => {
  it('« … »: merge and « Confidentialité » for the admin; nothing for a conseillère', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${R}.menu.label`) }))
    expect(await screen.findByRole('menuitem', { name: t(`${R}.menu.merge`) })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: t(`${R}.menu.export`) })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: t(`${R}.menu.anonymize`) })).toBeInTheDocument()
  })

  it('… a conseillère (no clients.merge nor clients.privacy) has no menu', async () => {
    renderPage({ role: 'counselor' })
    await screen.findByRole('heading', { level: 1, name: /Alice Tremblay/ })
    expect(screen.queryByRole('button', { name: t(`${R}.menu.label`) })).not.toBeInTheDocument()
  })

  it('« Doublons possibles » → « Fusionner »: the value chosen side by side is sent, then the kept file opens', async () => {
    const user = userEvent.setup()
    mocks.api.findClientDuplicates.mockResolvedValue([
      { clientId: CIDS.marc, level: 'high', reasons: ['phone', 'similar_name'], clientNumber: 7, displayName: 'Alicia Tremblay', birthday: null, email: null, mobile: null, isArchived: false },
    ])
    renderPage()
    expect(await screen.findByText(t(`${R}.duplicates.title`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${R}.duplicates.merge`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${M}.title`) })
    // The older file (CLI-000001, this one) is kept by default; its email first, the other's offered.
    expect(await within(dialog).findByRole('radio', { name: /Alice Tremblay/ })).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: 'alicia@exemple.test' }))
    expect(within(dialog).getByText(t(`${M}.filledTitle`))).toBeInTheDocument()
    expect(within(dialog).getByText(t(`${M}.final`))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t(`${M}.submit`) }))
    await waitFor(() => expect(mocks.api.mergeClients).toHaveBeenCalledWith(CIDS.alice, CIDS.marc, ['email']))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/clients/${CIDS.alice}/apercu`))
  })

  it('« Anonymiser »: only once the file number is typed', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${R}.menu.label`) }))
    await user.click(await screen.findByRole('menuitem', { name: t(`${R}.menu.anonymize`) }))
    const dialog = await screen.findByRole('alertdialog', { name: t('modules.clients.privacy.anonymize.title') })
    const submit = within(dialog).getByRole('button', { name: t('modules.clients.privacy.anonymize.submit') })
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    await user.click(submit)
    expect(mocks.api.anonymizeClient).not.toHaveBeenCalled()
    await user.type(within(dialog).getByRole('textbox'), 'cli-000001')
    expect(submit).not.toHaveAttribute('aria-disabled')
    await user.click(submit)
    await waitFor(() => expect(mocks.api.anonymizeClient).toHaveBeenCalledWith(CIDS.alice))
  })

  it('« Historique »: who, what, the changed fields; a personal value as « (masqué) »', async () => {
    mocks.api.fetchClientHistory.mockResolvedValue([
      {
        id: 5,
        created_at: '2026-10-13T15:00:00Z',
        table_name: 'clients',
        record_id: CIDS.alice,
        action: 'update',
        changed_fields: { email: { before: '[redacted]', after: '[redacted]' }, is_banned: { before: false, after: true }, updated_at: { before: 'x', after: 'y' } },
        actor_id: 'u1',
        actor_name: 'Christine',
        actor_role: 'admin',
        source: 'app',
      },
    ])
    renderPage({ path: `/clients/${CIDS.alice}/historique` })
    const entry = (await screen.findByText('Christine')).closest('li') as HTMLElement
    expect(entry).toHaveTextContent(t('audit.actions.update'))
    expect(entry).toHaveTextContent('Clients')
    expect(entry).toHaveTextContent(t('modules.clients.audit.fields.clients.email'))
    expect(entry).not.toHaveTextContent('updated_at')
    expect(mocks.api.fetchClientHistory).toHaveBeenCalledWith(CIDS.alice, null)
  })
})
