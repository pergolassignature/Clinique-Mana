import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { WaitlistEntry, WaitlistEntryDetail, WaitlistList } from '../api/waitlist'
import { WaitlistPage } from './WaitlistPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchWaitlistLists: vi.fn(),
    listWaitlist: vi.fn(),
    getWaitlistEntry: vi.fn(),
    setWaitlistFee: vi.fn(),
    logWaitlistContact: vi.fn(),
    addWaitlistOffer: vi.fn(),
    answerWaitlistOffer: vi.fn(),
    exitWaitlist: vi.fn(),
    updateWaitlistEntry: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/waitlist', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/core/realtime/use-org-realtime', () => ({ useOrgRealtime: () => undefined }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const W = 'modules.demandes.waitlist'
const PSY = '10000000-0000-0000-0000-000000000001'
const PRO = '20000000-0000-0000-0000-000000000001'

const lists: WaitlistList[] = [
  { target_kind: 'title', target_id: PSY, name: 'Psychologie', open_count: 2, incomplete_count: 1, to_call_count: 1, offered_count: 0, average_wait_days: 34 },
  { target_kind: 'professional', target_id: PRO, name: 'Pro Un', open_count: 0, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: null },
]

function entry(over: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: 'e1',
    demande_id: 'd1',
    reference: 'DEM-2026-0001',
    client_id: 'c1',
    client_number: 12,
    person_name: 'Alice Attente',
    target_kind: 'title',
    target_id: PSY,
    target_name: 'Psychologie',
    priority: 'priority',
    priority_reason: 'Détresse importante',
    registered_at: '2026-09-01T14:00:00Z',
    waited_days: 42,
    state: 'to_call',
    fee_status: 'to_invoice',
    fee_waived_reason: null,
    consent_state: 'missing',
    last_contact_at: null,
    next_contact_at: null,
    bridge_professional_id: null,
    bridge_name: null,
    exit_reason: null,
    exited_at: null,
    rank: 1,
    list_size: 2,
    pending_offer: false,
    followup_unanswered: true,
    ...over,
  }
}

function detail(over: Partial<WaitlistEntryDetail> = {}): WaitlistEntryDetail {
  return {
    entry: {
      ...entry(),
      availability_periods: ['evening'],
      availability_days: [2],
      modality: 'video',
      language: 'fr',
      preferred_pro_gender: 'any',
      clientele_id: null,
      payer_kind: 'self',
      motif_ids: [],
      consent_signed_at: null,
    },
    contacts: [{ id: 'k1', kind: 'followup_email', outcome: 'no_answer', at: '2026-10-10T11:00:00Z', by_name: null }],
    offers: [],
    fee: { code: 50100, name: 'Inscription à la liste d’attente', price_cents: 1891, tax_rule: 'taxable' },
    can: { manage: true },
    ...over,
  }
}

beforeEach(() => {
  mocks.api.fetchWaitlistLists.mockResolvedValue(lists)
  mocks.api.listWaitlist.mockResolvedValue([entry(), entry({ id: 'e2', demande_id: 'd2', person_name: 'Bruno Attente', priority: 'normal', priority_reason: null, rank: 2, state: 'incomplete', followup_unanswered: false, consent_state: 'not_required' })])
  mocks.api.getWaitlistEntry.mockResolvedValue(detail())
  for (const fn of ['setWaitlistFee', 'logWaitlistContact', 'answerWaitlistOffer', 'exitWaitlist', 'updateWaitlistEntry'] as const) mocks.api[fn].mockResolvedValue(undefined)
  mocks.api.addWaitlistOffer.mockResolvedValue('o1')
})
afterEach(() => vi.clearAllMocks())

function renderPage(path = '/liste-attente') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="liste-attente" element={<WaitlistPage />} />
        </Routes>,
        { access: { access: accessForRole('counselor', { modules: ['demandes', 'clients', 'professionals'] }) }, path },
      )}
    </QueryClientProvider>,
  )
}

describe('WaitlistPage', () => {
  it('one list from the address: its average wait, its people in order with their rank and what is missing', async () => {
    renderPage(`/liste-attente?liste=t-${PSY}`)
    expect(await screen.findByText(/Attente moyenne avant une place : 34 jours/)).toBeInTheDocument()
    expect(mocks.api.listWaitlist).toHaveBeenCalledWith({ target: { kind: 'title', id: PSY }, states: null })
    const rows = within(screen.getByRole('table', { name: t(`${W}.page.table`) })).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('1re sur 2')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(t(`${W}.priority.priority`))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(t(`${W}.followupUnanswered`))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(t(`${W}.consent.missing`))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(t(`${W}.fee.status.to_invoice`))).toBeInTheDocument()
    expect(within(rows[1]!).getByText('2e sur 2')).toBeInTheDocument()
    expect(within(rows[0]!).getByRole('link', { name: 'Alice Attente' })).toHaveAttribute('href', '/demandes/d1/suivi')
  })

  it('« À rappeler » narrows the list; the lists show their counts', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('option', { name: 'Psychologie (2)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${W}.page.filters.to_call`) }))
    await waitFor(() => expect(mocks.api.listWaitlist).toHaveBeenLastCalledWith({ target: null, states: ['to_call'] }))
  })

  it('the side sheet: the fee (price plus taxes) marked paid, a call noted', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${W}.page.openFor`, { person: 'Alice Attente' }) }))
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText(/18,91\s\$ plus taxes/)).toBeInTheDocument()
    expect(within(sheet).getByText(t(`${W}.sheet.consentHelp`))).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: t(`${W}.sheet.markPaid`) }))
    await waitFor(() => expect(mocks.api.setWaitlistFee).toHaveBeenCalledWith('e1', 'paid', null))
    await user.click(within(sheet).getByRole('button', { name: t(`${W}.sheet.logContact`) }))
    await waitFor(() => expect(mocks.api.logWaitlistContact).toHaveBeenCalledWith('e1', 'call', 'reached', null))
  })

  it('the side sheet: waiving needs a reason; leaving « placée » needs the professional', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${W}.page.openFor`, { person: 'Alice Attente' }) }))
    const sheet = await screen.findByRole('dialog')
    await user.click(await within(sheet).findByRole('button', { name: t(`${W}.sheet.waive`) }))
    await user.type(within(sheet).getByRole('textbox', { name: t(`${W}.sheet.waiveReason`) }), 'PAE')
    await user.click(within(sheet).getByRole('button', { name: t(`${W}.sheet.waiveSave`) }))
    await waitFor(() => expect(mocks.api.setWaitlistFee).toHaveBeenCalledWith('e1', 'waived', 'PAE'))

    const exit = within(sheet).getByRole('form', { name: t(`${W}.sheet.exitTitle`) })
    await user.selectOptions(within(exit).getByRole('combobox', { name: t(`${W}.sheet.exitReason`) }), 'placed')
    await user.click(within(exit).getByRole('button', { name: t(`${W}.sheet.exit`) }))
    expect(within(exit).getByRole('alert')).toHaveTextContent(t(`${W}.sheet.offerProNeeded`))
    await user.selectOptions(within(exit).getByRole('combobox', { name: t(`${W}.sheet.placedWith`) }), PRO)
    await user.click(within(exit).getByRole('button', { name: t(`${W}.sheet.exit`) }))
    await waitFor(() => expect(mocks.api.exitWaitlist).toHaveBeenCalledWith('e1', 'placed', PRO))
  })

  it('a pending offer: « Acceptée » places the person', async () => {
    const user = userEvent.setup()
    mocks.api.getWaitlistEntry.mockResolvedValue(
      detail({
        offers: [
          {
            id: 'o1',
            professional_id: PRO,
            professional_name: 'Pro Un',
            slots: [],
            channel: 'phone',
            offered_at: '2026-10-12T15:00:00Z',
            response: 'pending',
            responded_at: null,
            by_name: 'Conseillère A',
          },
        ],
      }),
    )
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${W}.page.openFor`, { person: 'Alice Attente' }) }))
    const sheet = await screen.findByRole('dialog')
    await user.click(await within(sheet).findByRole('button', { name: t(`${W}.sheet.accepted`) }))
    await waitFor(() => expect(mocks.api.answerWaitlistOffer).toHaveBeenCalledWith('e1', 'o1', 'accepted'))
  })
})
