import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts, testAccess } from '@/test/contexts'
import type { InteracNotice } from '../api/stripe'
import { InteracPage } from './InteracPage'

const mocks = vi.hoisted(() => ({
  api: {
    listInteracNotices: vi.fn(),
    addInteracNotice: vi.fn(),
    matchInteracNotice: vi.fn(),
    ignoreInteracNotice: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/stripe', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/stripe')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const I = 'modules.billing.interac'

const notice = (over: Partial<InteracNotice> = {}): InteracNotice => ({
  id: 'n1',
  source: 'manual',
  received_on: '2026-11-02',
  amount_cents: 17500,
  sender_name: 'ALICE TREMBLAY',
  message: 'Facture 2026-2',
  reference: 'CA1234',
  status: 'to_match',
  invoice_id: null,
  invoice_number: null,
  matched_at: null,
  ignored_reason: null,
  suggestions: [
    { invoice_id: 'f2', number: '2026-2', issued_on: '2026-11-01', balance_cents: 17500, payer_name: 'Alice Tremblay', client_name: 'Alice Tremblay', amount_matches: true, name_score: 2 },
    { invoice_id: 'f5', number: '2026-5', issued_on: '2026-10-20', balance_cents: 9000, payer_name: 'Alice Tremblay', client_name: 'Léa Tremblay', amount_matches: false, name_score: 1 },
  ],
  ...over,
})

beforeEach(() => mocks.api.listInteracNotices.mockResolvedValue([notice()]))
afterEach(() => vi.clearAllMocks())

function renderPage(permissions = ['billing.view', 'billing.manage']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<InteracPage />, { access: { access: { ...testAccess, permissions, modules: ['billing'] } } })}</QueryClientProvider>)
}

describe('InteracPage (« Virements Interac », FS)', () => {
  it('a notice with its suggestions, the same amount first; « Rapprocher » records it', async () => {
    mocks.api.matchInteracNotice.mockResolvedValue(undefined)
    renderPage()
    const list = await screen.findByRole('list', { name: t(`${I}.suggestions`) })
    const items = within(list).getAllByRole('listitem')
    expect(within(items[0]!).getByText(t(`${I}.amountMatches`))).toBeInTheDocument()
    await userEvent.click(within(items[0]!).getByRole('button', { name: t(`${I}.match`, { number: '2026-2' }) }))
    await waitFor(() => expect(mocks.api.matchInteracNotice).toHaveBeenCalledWith('n1', 'f2'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${I}.matched`, { number: '2026-2' }))
  })

  it('a refusal (above the balance) is shown in the notice', async () => {
    mocks.api.matchInteracNotice.mockRejectedValue({ code: 'P0001', message: 'Le virement dépasse le solde de la facture.' })
    renderPage()
    const list = await screen.findByRole('list', { name: t(`${I}.suggestions`) })
    await userEvent.click(within(list).getAllByRole('button')[1]!)
    expect(await screen.findByText(/Le virement dépasse le solde/)).toBeInTheDocument()
  })

  it('« Ajouter un avis »: the amount in dollars and the sender', async () => {
    mocks.api.addInteracNotice.mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('list', { name: t(`${I}.suggestions`) })
    await userEvent.click(screen.getByRole('button', { name: t(`${I}.add.submit`) }))
    expect(await screen.findByText(t(`${I}.add.amountInvalid`))).toBeInTheDocument()
    expect(mocks.api.addInteracNotice).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(new RegExp(t(`${I}.add.amount`).replace(/[()$]/g, '\\$&'))), '130,50')
    await userEvent.type(screen.getByLabelText(new RegExp(`^${t(`${I}.add.sender`)}`)), 'Bruno Côté')
    await userEvent.click(screen.getByRole('button', { name: t(`${I}.add.submit`) }))
    await waitFor(() => expect(mocks.api.addInteracNotice).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 13050, senderName: 'Bruno Côté' })))
  })

  it('the conseillère reads, with no action', async () => {
    renderPage(['billing.view'])
    await screen.findByRole('list', { name: t(`${I}.suggestions`) })
    expect(screen.queryByRole('button', { name: t(`${I}.add.submit`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${I}.match`, { number: '2026-2' }) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${I}.ignore`) })).not.toBeInTheDocument()
  })

  it('« Ignorer » asks why', async () => {
    mocks.api.ignoreInteracNotice.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${I}.ignore`) }))
    await userEvent.type(screen.getByLabelText(new RegExp(t(`${I}.ignoreDialog.label`))), 'Pas pour la clinique')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t(`${I}.ignore`) }))
    await waitFor(() => expect(mocks.api.ignoreInteracNotice).toHaveBeenCalledWith('n1', 'Pas pour la clinique'))
  })
})
