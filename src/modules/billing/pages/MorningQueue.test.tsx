import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { QueueRow } from '../api/queue'
import { MorningQueue } from './MorningQueue'

const mocks = vi.hoisted(() => ({
  queue: { fetchMorningQueue: vi.fn(), sendInvoices: vi.fn(), holdDraft: vi.fn(), releaseDraft: vi.fn(), deliverNow: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/queue', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.queue }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const Q = 'modules.billing.queue'

const row = (id: string, name: string, over: Partial<QueueRow> = {}): QueueRow => ({
  id,
  queueDay: '2026-10-13',
  serviceDate: '2026-10-12',
  clientId: `c-${id}`,
  clientName: name,
  clientNumber: 12,
  payerId: `c-${id}`,
  payerName: name,
  payerHasEmail: true,
  holdReason: null,
  holdNote: null,
  totalCents: 13000,
  lines: [{ id: `l-${id}`, lineType: 'service', description: 'Consultation individuelle 50 min', professionalId: 'p1', unitPriceCents: 13000, totalCents: 13000 }],
  ...over,
})

const ROWS = [
  row('i1', 'Zoé Essai', { holdReason: 'special_agreement', holdNote: 'Tarif convenu avec la famille' }),
  row('i2', 'Léa Essai'),
  row('i3', 'Théo Essai'),
]

function open(role: FixtureRole = 'admin_assistant') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<MorningQueue />, { access: { access: accessForRole(role) } })}</QueryClientProvider>)
}

beforeEach(() => {
  mocks.queue.fetchMorningQueue.mockResolvedValue(ROWS)
  mocks.queue.sendInvoices.mockResolvedValue([
    { invoiceId: 'i2', number: '2026-601', error: null },
    { invoiceId: 'i3', number: null, error: 'Indiquez le montant de chaque ligne « montant saisi à la facture ».' },
  ])
  mocks.queue.releaseDraft.mockResolvedValue(undefined)
  mocks.queue.deliverNow.mockResolvedValue({ done: 1, failed: 0 })
})
afterEach(() => vi.clearAllMocks())

describe('MorningQueue', () => {
  it('held first with its reason; « Tout envoyer » sends the ready ones, says what went and what did not', async () => {
    const user = userEvent.setup()
    open()
    const list = await screen.findByRole('list', { name: t(`${Q}.label`) })
    const items = within(list).getAllByRole('listitem')
    expect(within(items[0]!).getByText(t(`${Q}.holds.special_agreement`))).toBeInTheDocument()
    expect(within(items[0]!).getByText('Tarif convenu avec la famille')).toBeInTheDocument()
    expect(within(items[0]!).queryByRole('button', { name: t(`${Q}.send`) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${Q}.sendAll`, { count: '2' }) }))
    await waitFor(() => expect(mocks.queue.sendInvoices).toHaveBeenCalledWith(['i2', 'i3']))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${Q}.sent`, { count: '1' }))
    expect(await screen.findByText(/Pas envoyée \(Théo Essai\)/)).toBeInTheDocument()
    await waitFor(() => expect(mocks.queue.deliverNow).toHaveBeenCalled())
  })

  it('« Valider l’entente » lifts the hold', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: t(`${Q}.validate`) }))
    await waitFor(() => expect(mocks.queue.releaseDraft).toHaveBeenCalledWith('i1'))
  })

  it('a payer to complete (FP-9): no « Envoyer », the dossier\u2019s « Assurance et payeurs » instead', async () => {
    mocks.queue.fetchMorningQueue.mockResolvedValue([row('i4', 'Sam Essai', { holdReason: 'payer_incomplete' })])
    open()
    const link = await screen.findByRole('link', { name: t(`${Q}.completePayer`) })
    expect(link).toHaveAttribute('href', '/clients/c-i4/assurance-et-payeurs')
    expect(screen.getByText(t(`${Q}.holds.payer_incomplete`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${Q}.send`) })).not.toBeInTheDocument()
  })

  it('the conseillère reads the queue, never sends', async () => {
    open('counselor')
    await screen.findByRole('list', { name: t(`${Q}.label`) })
    expect(screen.queryByRole('button', { name: /Tout envoyer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${Q}.send`) })).not.toBeInTheDocument()
  })
})
