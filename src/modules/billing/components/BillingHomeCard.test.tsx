import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { BillingHomeCard } from './BillingHomeCard'

const mocks = vi.hoisted(() => ({ queue: vi.fn(), overdue: vi.fn(), interac: vi.fn(), payers: vi.fn() }))
vi.mock('../api/queue', async (o) => ({ ...(await o<typeof import('../api/queue')>()), fetchMorningQueue: mocks.queue }))
vi.mock('../api/follow-up', async (o) => ({ ...(await o<typeof import('../api/follow-up')>()), fetchOverdueInvoices: mocks.overdue }))
vi.mock('../api/stripe', async (o) => ({ ...(await o<typeof import('../api/stripe')>()), listInteracNotices: mocks.interac }))
vi.mock('../api/payers', async (o) => ({ ...(await o<typeof import('../api/payers')>()), fetchPayerQueue: mocks.payers }))

const H = 'modules.billing.home'

afterEach(() => vi.clearAllMocks())

describe('Accueil « Facturation à traiter » (L29)', () => {
  it('the queue ready and on hold, the unpaid, Interac to match, the payers due; each to its page', async () => {
    mocks.queue.mockResolvedValue([{ holdReason: null }, { holdReason: null }, { holdReason: 'balance_due' }])
    mocks.overdue.mockResolvedValue([{}])
    mocks.interac.mockResolvedValue([])
    mocks.payers.mockResolvedValue([{ pending: [{ due: true }] }, { pending: [{ due: false }] }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}>{renderWithContexts(<BillingHomeCard />, { path: '/accueil' })}</QueryClientProvider>)
    await screen.findByRole('region', { name: t(`${H}.title`) })
    await screen.findByText(t(`${H}.items.payers`))
    expect(mocks.interac).toHaveBeenCalledWith('to_match')
    expect(screen.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [`2${t(`${H}.items.ready`)}`, '/facturation'],
      [`1${t(`${H}.items.held`)}`, '/facturation'],
      [`1${t(`${H}.items.overdue`)}`, '/facturation?vue=impayes'],
      [`1${t(`${H}.items.payers`)}`, '/facturation/payeurs'],
    ])
  })
})
