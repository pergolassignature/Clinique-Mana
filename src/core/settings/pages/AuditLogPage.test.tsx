import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { AuditEntry } from '@/core/audit/api'
import { renderInSettingsSection } from '@/test/settings-section'
import { AuditLogPage } from './AuditLogPage'

const mocks = vi.hoisted(() => ({
  api: { fetchAuditEntries: vi.fn(), fetchAuditActors: vi.fn(), AUDIT_PAGE_SIZE: 2 },
}))
vi.mock('@/core/audit/api', () => mocks.api)

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

const NB = ' '
const ORG = 'b0000000-0000-0000-0000-00000000000a'
const MARIE = 'a0000000-0000-0000-0000-000000000001'
const NO_FILTERS = { table: null, actor: null, from: null }

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  // 14:30 in the clinic (America/Toronto, EDT).
  created_at: '2026-10-07T18:30:00Z',
  table_name: 'organizations',
  record_id: ORG,
  action: 'update',
  changed_fields: { neq: { before: null, after: '1234567890' } },
  actor_id: MARIE,
  actor_name: 'Marie Tremblay',
  actor_role: 'admin',
  source: 'app',
  ...overrides,
})

const UPDATE = entry({ id: 30 })
const BANK_READ = entry({
  id: 20,
  created_at: '2026-10-07T17:00:00Z',
  table_name: 'organization_bank_details',
  action: 'read',
  changed_fields: { fields: ['account_number'] },
  source: 'rpc:reveal_bank_account_number',
})
const BANK_UPDATE = entry({
  id: 15,
  created_at: '2026-10-07T16:00:00Z',
  table_name: 'organization_bank_details',
  // The trigger replaces a redacted column's whole {before, after} pair.
  changed_fields: { transit_number: '[redacted]' },
})
const SEED = entry({
  id: 10,
  created_at: '2026-10-06T12:00:00Z',
  table_name: 'tax_rates',
  record_id: '42',
  action: 'insert',
  changed_fields: { tax: 'qst' },
  actor_id: null,
  actor_name: null,
  actor_role: null,
  source: 'seed',
})

async function renderPage({ pages = [[UPDATE, BANK_READ]] as AuditEntry[][] } = {}) {
  for (const page of pages) mocks.api.fetchAuditEntries.mockResolvedValueOnce(page)
  mocks.api.fetchAuditEntries.mockResolvedValue([])
  mocks.api.fetchAuditActors.mockResolvedValue([
    { actor_id: MARIE, actor_name: 'Marie Tremblay' },
    { actor_id: 'a2', actor_name: 'Julie Roy' },
  ])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderInSettingsSection(<AuditLogPage />)}</QueryClientProvider>)
  await waitFor(() => expect(screen.queryByText(t('common.loading'))).not.toBeInTheDocument())
}

const table = () => screen.getByRole('table')
const rows = () => within(table()).getAllByRole('row').slice(1)
const toggle = (date: string) => within(table()).getByRole('button', { name: new RegExp(`^${date}`) })
const filter = (label: string) => screen.getByRole('combobox', { name: label })

describe('AuditLogPage', () => {
  it('lists the entries newest first: date, person, section, action, shortened element', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t('settings.sections.audit') })).toBeInTheDocument()
    expect(mocks.api.fetchAuditEntries).toHaveBeenCalledWith(NO_FILTERS, null)
    expect(within(table()).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Date',
      'Personne',
      'Section',
      'Action',
      'Élément',
    ])
    const [first] = rows()
    expect(within(first!).getByText('07 oct. 2026 à 14:30')).toBeInTheDocument()
    expect(within(first!).getAllByText('Marie Tremblay')[0]).toBeInTheDocument()
    expect(within(first!).getAllByText('Clinique')[0]).toBeInTheDocument()
    expect(within(first!).getAllByText('Modification')[0]).toBeInTheDocument()
    expect(within(first!).getByText('b0000000…')).toHaveAttribute('title', ORG)
  })

  it('shows the source for rows written without a named person', async () => {
    await renderPage({ pages: [[SEED]] })
    expect(within(rows()[0]!).getAllByText('Données de test')[0]).toBeInTheDocument()
    expect(within(rows()[0]!).getAllByText('Taux de taxes')[0]).toBeInTheDocument()
    expect(within(rows()[0]!).getAllByText('Création')[0]).toBeInTheDocument()
  })

  it('expands an update into « Champ : avant → après » with French labels', async () => {
    const user = userEvent.setup()
    await renderPage()
    const button = toggle('07 oct. 2026 à 14:30')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const details = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(within(details).getByText(`NEQ${NB}: (vide) → 1234567890`)).toBeInTheDocument()
    expect(within(details).getByText(`Élément${NB}: ${ORG}`)).toBeInTheDocument()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(`NEQ${NB}: (vide) → 1234567890`)).not.toBeInTheDocument()
  })

  it('shows a bank reveal as « Consultation du numéro de compte », and bank values as « (masqué) »', async () => {
    const user = userEvent.setup()
    await renderPage({ pages: [[BANK_READ, BANK_UPDATE]] })
    expect(within(rows()[0]!).getAllByText('Consultation')[0]).toBeInTheDocument()
    expect(within(rows()[0]!).getAllByText('Coordonnées bancaires')[0]).toBeInTheDocument()
    await user.click(toggle('07 oct. 2026 à 13:00'))
    expect(screen.getByText('Consultation du numéro de compte')).toBeInTheDocument()
    await user.click(toggle('07 oct. 2026 à 12:00'))
    expect(screen.getByText(`Numéro de transit${NB}: (masqué)`)).toBeInTheDocument()
  })

  it('filters by section and person, with the right arguments', async () => {
    const user = userEvent.setup()
    await renderPage()
    expect(within(filter('Section')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Toutes les sections',
      'Clinique',
      'Utilisateurs',
      'Rôles',
      'Exceptions de permissions',
      'Modules',
      'Paramètres de module',
      'Secrets',
      'Taux de taxes',
      'Coordonnées bancaires',
    ])
    await user.selectOptions(filter('Section'), 'Taux de taxes')
    await waitFor(() => expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith({ ...NO_FILTERS, table: 'tax_rates' }, null))
    await waitFor(() => expect(within(filter('Personne')).getAllByRole('option')).toHaveLength(3))
    await user.selectOptions(filter('Personne'), 'Julie Roy')
    await waitFor(() =>
      expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith({ table: 'tax_rates', actor: 'a2', from: null }, null),
    )
  })

  it('starts each period at midnight in the clinic (America/Toronto), as an instant', async () => {
    // Only Date is faked: React Query and user-event keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    // 22:30 on 7 October in the clinic, already 8 October in UTC.
    vi.setSystemTime(new Date('2026-10-08T02:30:00Z'))
    const user = userEvent.setup()
    await renderPage()
    expect(within(filter('Période')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      "Aujourd'hui",
      '7 jours',
      '30 jours',
      'Tout',
    ])
    expect(filter('Période')).toHaveValue('all')
    await user.selectOptions(filter('Période'), "Aujourd'hui")
    await waitFor(() =>
      expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith({ ...NO_FILTERS, from: '2026-10-07T04:00:00.000Z' }, null),
    )
    await user.selectOptions(filter('Période'), '7 jours')
    await waitFor(() =>
      expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith({ ...NO_FILTERS, from: '2026-10-01T04:00:00.000Z' }, null),
    )
    await user.selectOptions(filter('Période'), '30 jours')
    await waitFor(() =>
      expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith({ ...NO_FILTERS, from: '2026-09-08T04:00:00.000Z' }, null),
    )
  })

  it('« Charger plus » asks for the entries before the last one, until the beginning of the journal', async () => {
    const user = userEvent.setup()
    await renderPage({ pages: [[UPDATE, BANK_READ], [SEED]] })
    expect(screen.getByText('2 entrées affichées')).toBeInTheDocument()
    expect(screen.queryByText(t('audit.end'))).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('audit.loadMore') }))
    expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith(NO_FILTERS, 20)
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.getByText('3 entrées affichées')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('audit.loadMore') })).not.toBeInTheDocument()
    // Focus does not fall to the page when the button goes away.
    expect(screen.getByText(t('audit.end'))).toHaveFocus()
  })

  it('keeps « Charger plus » to try again when the next page fails', async () => {
    const user = userEvent.setup()
    await renderPage({ pages: [[UPDATE, BANK_READ]] })
    mocks.api.fetchAuditEntries.mockRejectedValueOnce(new Error('boom'))
    await user.click(screen.getByRole('button', { name: t('audit.loadMore') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('audit.loadMoreError'))
    expect(rows()).toHaveLength(2)
    mocks.api.fetchAuditEntries.mockResolvedValueOnce([SEED])
    await user.click(screen.getByRole('button', { name: t('audit.loadMore') }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a new filter starts again from the newest page and collapses the open rows', async () => {
    const user = userEvent.setup()
    await renderPage({ pages: [[UPDATE, BANK_READ], [SEED], [BANK_READ]] })
    await user.click(screen.getByRole('button', { name: t('audit.loadMore') }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    await user.click(toggle('07 oct. 2026 à 13:00'))
    await user.selectOptions(filter('Section'), 'Coordonnées bancaires')
    await waitFor(() =>
      expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith({ ...NO_FILTERS, table: 'organization_bank_details' }, null),
    )
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.getByText('1 entrée affichée')).toBeInTheDocument()
    expect(toggle('07 oct. 2026 à 13:00')).toHaveAttribute('aria-expanded', 'false')
  })

  it('says when the journal is empty', async () => {
    await renderPage({ pages: [[]] })
    expect(screen.getByText(t('audit.empty.title'))).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('announces a filter that matches nothing, and « Réinitialiser » clears the filters', async () => {
    const user = userEvent.setup()
    await renderPage({ pages: [[UPDATE], []] })
    const live = screen.getByTestId('audit-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toBeEmptyDOMElement()
    await user.selectOptions(filter('Section'), 'Secrets')
    await waitFor(() => expect(screen.getByText(t('audit.emptyFiltered.title'), { selector: 'p:not([data-testid])' })).toBeInTheDocument())
    expect(live).toHaveTextContent(t('audit.emptyFiltered.title'))
    await user.click(screen.getByRole('button', { name: t('audit.filters.reset') }))
    expect(filter('Section')).toHaveValue('')
    expect(filter('Section')).toHaveFocus()
    await waitFor(() => expect(mocks.api.fetchAuditEntries).toHaveBeenLastCalledWith(NO_FILTERS, null))
  })

  it('offers to retry when the journal cannot be loaded', async () => {
    const user = userEvent.setup()
    mocks.api.fetchAuditEntries.mockRejectedValueOnce(new Error('boom'))
    mocks.api.fetchAuditActors.mockResolvedValue([])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}>{renderInSettingsSection(<AuditLogPage />)}</QueryClientProvider>)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('audit.loadError'))
    mocks.api.fetchAuditEntries.mockResolvedValue([UPDATE])
    await user.click(within(alert).getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(rows()).toHaveLength(1))
  })
})
