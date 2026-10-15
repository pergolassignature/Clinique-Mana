import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { InboxRow } from '../api/demandes'
import { DemandesInboxPage } from './DemandesInboxPage'

const mocks = vi.hoisted(() => ({
  api: { listDemandes: vi.fn(), fetchCounts: vi.fn(), createDemande: vi.fn(), logContact: vi.fn(), findDemandeMatches: vi.fn() },
  realtime: { handlers: null as null | { onChange: (c: unknown) => void; onResync: () => void }, module: null as string | null },
  toast: { success: vi.fn(), error: vi.fn() },
  preferences: { fetchUserPreference: vi.fn(), saveUserPreference: vi.fn(), deleteUserPreference: vi.fn() },
}))
vi.mock('@/core/preferences/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/preferences/api')>()), ...mocks.preferences }))
vi.mock('../api/demandes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/demandes')>()), ...mocks.api }))
vi.mock('@/core/realtime/use-org-realtime', () => ({
  useOrgRealtime: (module: string | null, handlers: { onChange: (c: unknown) => void; onResync: () => void }) => {
    mocks.realtime.module = module
    mocks.realtime.handlers = handlers
  },
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const I = 'modules.demandes.inbox'
const D1 = 'e0000000-0000-0000-0000-000000000001'
const D2 = 'e0000000-0000-0000-0000-000000000002'

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: D1,
  reference: 'DEM-2026-0001',
  received_at: '2026-10-05T14:00:00Z',
  channel: 'phone',
  state: 'new',
  is_urgent: false,
  client_id: null,
  client_number: null,
  person_name: 'Élodie Ancienne',
  beneficiary: null,
  assigned_to: null,
  assigned_name: null,
  contact_attempts: 0,
  last_contact_at: null,
  last_outcome: null,
  next_contact_at: null,
  first_contact_at: null,
  waiting_hours: 60,
  promise: 'late',
  no_answer: false,
  handled_by: null,
  handled_by_name: null,
  handled_at: null,
  open_tasks: 0,
  next_task_due: null,
  motif_count: 0,
  ...over,
})

beforeEach(() => {
  mocks.api.listDemandes.mockResolvedValue([
    row({ is_urgent: true, id: D2, reference: 'DEM-2026-0002', person_name: 'Urgent Maintenant', promise: 'ok', waiting_hours: 1 }),
    row({ handled_by: 'u2', handled_by_name: 'Conseillère B' }),
    row({
      id: 'e0000000-0000-0000-0000-000000000003',
      reference: 'DEM-2026-0003',
      person_name: 'Alice Tremblay',
      client_id: 'c1',
      client_number: 42,
      promise: 'met',
      no_answer: true,
      contact_attempts: 2,
      last_contact_at: '2026-10-12T15:00:00Z',
      last_outcome: 'no_answer',
      next_contact_at: '2026-10-13T14:00:00Z',
      assigned_name: 'Conseillère A',
    }),
  ])
  mocks.api.fetchCounts.mockResolvedValue({ open: 3, late: 1, no_answer: 1, due: 0, mine: 1, unassigned: 2, waitlist: 4 })
  mocks.api.createDemande.mockResolvedValue('e0000000-0000-0000-0000-000000000009')
  mocks.api.logContact.mockResolvedValue(undefined)
  mocks.api.findDemandeMatches.mockResolvedValue({ clients: [], open_demandes: [] })
  mocks.preferences.fetchUserPreference.mockResolvedValue(null)
  mocks.preferences.saveUserPreference.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage(path = '/demandes', role: 'counselor' | 'provider' = 'counselor') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole(role, { modules: ['demandes', 'clients', 'professionals'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="demandes" element={<DemandesInboxPage />} />
          <Route path="demandes/:id/:onglet" element={<p>FICHE</p>} />
        </Routes>,
        { access: { access }, path },
      )}
    </QueryClientProvider>,
  )
  return queryClient
}

describe('DemandesInboxPage', () => {
  it('lists the open requests with the promise, who handles them and the follow-up', async () => {
    renderPage()
    await screen.findByText('Urgent Maintenant')
    const table = screen.getByRole('table', { name: t(`${I}.table`) })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Urgent Maintenant')
    expect(rows[0]).toHaveTextContent(t(`${I}.urgent`))
    expect(rows[1]).toHaveTextContent(t('modules.demandes.promise.late', { hours: '60' }))
    expect(rows[1]).toHaveTextContent(t(`${I}.handledBy`, { name: 'Conseillère B' }))
    expect(rows[2]).toHaveTextContent(t(`${I}.fileNumber`, { number: 'CLI-000042' }))
    expect(rows[2]).toHaveTextContent(t(`${I}.noAnswer`, { count: '2' }))
    expect(within(rows[0]!).getByRole('link', { name: 'Urgent Maintenant' })).toHaveAttribute('href', `/demandes/${D2}/accueil`)
    expect(mocks.api.listDemandes).toHaveBeenCalledWith({ view: 'open', assigned: 'any', flags: [], search: '', sort: 'priority' }, 0)
    // The counters on the tabs and filters.
    expect(screen.getByRole('tab', { name: new RegExp(t(`${I}.view.open`)) })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: new RegExp(t(`${I}.flags.late`)) })).toHaveTextContent('1')
    expect(mocks.realtime.module).toBe('demandes')
  })

  it('filters by flag, view and counselor, in the address (never the search words)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Urgent Maintenant')
    await user.click(screen.getByRole('button', { name: new RegExp(t(`${I}.flags.no_answer`)) }))
    await waitFor(() => expect(mocks.api.listDemandes).toHaveBeenLastCalledWith({ view: 'open', assigned: 'any', flags: ['no_answer'], search: '', sort: 'priority' }, 0))
    expect(screen.getByRole('button', { name: new RegExp(t(`${I}.flags.no_answer`)) })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: t(`${I}.assigned.meCount`, { count: '1' }) }))
    await waitFor(() => expect(mocks.api.listDemandes).toHaveBeenLastCalledWith({ view: 'open', assigned: 'me', flags: ['no_answer'], search: '', sort: 'priority' }, 0))
    await user.click(screen.getByRole('tab', { name: new RegExp(t(`${I}.view.closed`)) }))
    await waitFor(() => expect(mocks.api.listDemandes).toHaveBeenLastCalledWith({ view: 'closed', assigned: 'me', flags: ['no_answer'], search: '', sort: 'priority' }, 0))
    await user.type(screen.getByRole('searchbox', { name: t(`${I}.searchLabel`) }), 'alice')
    await waitFor(() => expect(mocks.api.listDemandes).toHaveBeenLastCalledWith({ view: 'closed', assigned: 'me', flags: ['no_answer'], search: 'alice', sort: 'priority' }, 0))
  })

  it('sorts as chosen, in the address; shows the columns she chose and remembers them (A-4)', async () => {
    const user = userEvent.setup()
    mocks.preferences.fetchUserPreference.mockResolvedValue({ columns: ['state', 'motifs'] })
    mocks.api.listDemandes.mockResolvedValue([row({ motif_count: 3, beneficiary: 'couple' })])
    renderPage('/demandes?tri=anciennes')
    await screen.findByText('Élodie Ancienne')
    expect(mocks.api.listDemandes).toHaveBeenLastCalledWith({ view: 'open', assigned: 'any', flags: [], search: '', sort: 'received_asc' }, 0)
    const sort = screen.getByRole('combobox', { name: t(`${I}.sort.label`) })
    expect(sort).toHaveValue('received_asc')
    await user.selectOptions(sort, 'waiting_desc')
    await waitFor(() => expect(mocks.api.listDemandes).toHaveBeenLastCalledWith({ view: 'open', assigned: 'any', flags: [], search: '', sort: 'waiting_desc' }, 0))
    // Her columns: the state and the motifs, not who handles it nor the follow-up.
    const table = screen.getByRole('table', { name: t(`${I}.table`) })
    await waitFor(() => expect(within(table).getByRole('columnheader', { name: t(`${I}.columns.motifs`) })).toBeInTheDocument())
    expect(within(table).queryByRole('columnheader', { name: t(`${I}.columns.assigned`) })).not.toBeInTheDocument()
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(t(`${I}.columnPicker.motifCount`, { count: '3' }))
    await user.click(screen.getByRole('button', { name: t(`${I}.columnPicker.label`) }))
    await user.click(await screen.findByRole('checkbox', { name: t(`${I}.columns.beneficiary`) }))
    expect(await within(table).findByRole('columnheader', { name: t(`${I}.columns.beneficiary`) })).toBeInTheDocument()
    await waitFor(() => expect(mocks.preferences.saveUserPreference).toHaveBeenCalledWith(expect.anything(), 'demandes.inbox_columns', { columns: ['state', 'beneficiary', 'motifs'] }), { timeout: 3000 })
  })

  it('reads the list again when another counselor changes a request', async () => {
    renderPage()
    await screen.findByText('Urgent Maintenant')
    const calls = mocks.api.listDemandes.mock.calls.length
    mocks.realtime.handlers!.onChange({ module: 'demandes', table: 'demandes', recordId: D1, op: 'update' })
    await waitFor(() => expect(mocks.api.listDemandes.mock.calls.length).toBeGreaterThan(calls))
  })

  it('« Noter un appel » from the row: no answer, the next try tomorrow', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Urgent Maintenant')
    await user.click(screen.getByRole('button', { name: t('modules.demandes.contact.openFor', { person: 'Élodie Ancienne' }) }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.contact.save') }))
    await waitFor(() => expect(mocks.api.logContact).toHaveBeenCalledTimes(1))
    const [id, channel, outcome, next] = mocks.api.logContact.mock.calls[0]!
    expect([id, channel, outcome]).toEqual([D1, 'phone', 'no_answer'])
    expect(typeof next).toBe('string')
  })

  it('« Nouvelle demande »: the quick entry creates and opens the record', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.new.open') }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.new.create') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('modules.demandes.new.someone'))
    await user.type(within(dialog).getByRole('textbox', { name: new RegExp(`^${t('modules.demandes.new.firstName')}`) }), 'Nouvelle')
    await user.type(within(dialog).getByRole('textbox', { name: t('modules.demandes.new.lastName') }), 'Personne')
    await user.type(within(dialog).getByRole('textbox', { name: t('modules.demandes.new.phone') }), '514 555-0123')
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.new.create') }))
    await waitFor(() => expect(mocks.api.createDemande).toHaveBeenCalledTimes(1))
    expect(mocks.api.createDemande.mock.calls[0]![0]).toMatchObject({
      channel: 'phone',
      contact_first_name: 'Nouvelle',
      contact_last_name: 'Personne',
      contact_phone_e164: '+15145550123',
    })
    expect(await screen.findByText('FICHE')).toBeInTheDocument()
  })

  it('a professional (no demandes.manage) has neither « Nouvelle demande » nor « Noter un appel »', async () => {
    renderPage('/demandes', 'provider')
    await screen.findByText('Urgent Maintenant')
    expect(screen.queryByRole('button', { name: t('modules.demandes.new.open') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Noter un appel/ })).not.toBeInTheDocument()
  })
})
