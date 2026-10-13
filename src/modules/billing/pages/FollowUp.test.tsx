import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { FeeDecision, OverdueRow } from '../api/follow-up'
import { FeeDecisions, MyFeesPanel, OverdueInvoices } from './FollowUp'

const mocks = vi.hoisted(() => ({
  api: { fetchOverdueInvoices: vi.fn(), fetchFeeDecisions: vi.fn(), decideFee: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/follow-up', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const O = 'modules.billing.overdue'
const F = 'modules.billing.fees'

const OVERDUE: OverdueRow[] = [
  {
    id: 'i1', number: '2026-12', clientId: 'c1', clientName: 'Léa Essai', payerId: 'c3', payerName: 'Camille Essai', dueOn: '2026-10-01',
    days: 12, balanceCents: 13000, lastStep: 10, blocking: true, payerHasEmail: true,
  },
]

const fee = (over: Partial<FeeDecision> = {}): FeeDecision => ({
  appointmentId: 'a1', kind: 'late_cancellation', status: 'pending', startsAt: '2026-10-12T14:00:00Z', clientId: 'c1', clientName: 'Zoé Essai',
  professionalId: 'p1', professionalName: 'Félix Gauthier', feePercent: 50, amountCents: 6500, invoiceId: null, decidedAs: null, decidedAt: null,
  note: null, ...over,
})

function open(ui: React.ReactElement, role: FixtureRole = 'admin_assistant') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(ui, { access: { access: accessForRole(role) } })}</QueryClientProvider>)
}

beforeEach(() => {
  mocks.api.fetchOverdueInvoices.mockResolvedValue(OVERDUE)
  mocks.api.fetchFeeDecisions.mockResolvedValue([fee(), fee({ appointmentId: 'a2', kind: 'no_show', status: 'applied', decidedAs: 'professional', invoiceId: 'i9' })])
  mocks.api.decideFee.mockResolvedValue('i10')
})
afterEach(() => vi.clearAllMocks())

describe('OverdueInvoices', () => {
  it('« Impayés »: the delay, the balance, the last reminder, a dossier blocked', async () => {
    open(<OverdueInvoices />)
    const table = await screen.findByRole('table', { name: t(`${O}.label`) })
    expect(within(table).getByRole('link', { name: '2026-12' })).toHaveAttribute('href', '/facturation/factures/i1')
    expect(within(table).getByText(t(`${O}.daysValue`, { days: '12' }))).toBeInTheDocument()
    expect(within(table).getByText(t(`${O}.reminderValue`, { step: '10' }))).toBeInTheDocument()
    expect(within(table).getByText(t(`${O}.blocking`))).toBeInTheDocument()
  })
})

describe('FeeDecisions', () => {
  it('the staff apply a fee for the professional; a decided one says by whom', async () => {
    const user = userEvent.setup()
    open(<FeeDecisions />)
    const list = await screen.findByRole('list', { name: t(`${F}.label`) })
    const [pending, applied] = within(list).getAllByRole('listitem')
    expect(within(pending!).getByText(t(`${F}.amount`, { percent: '50', amount: '65,00 $' }).replace(/\s+/g, ' '))).toBeInTheDocument()
    expect(within(applied!).getByText(t(`${F}.decidedAs.professional`))).toBeInTheDocument()
    await user.click(within(pending!).getByRole('button', { name: t(`${F}.apply`) }))
    await waitFor(() => expect(mocks.api.decideFee).toHaveBeenCalledWith('a1', true, null))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.billing.saved.feeApplied'))
  })

  it('the conseillère reads, never decides', async () => {
    open(<FeeDecisions />, 'counselor')
    await screen.findByRole('list', { name: t(`${F}.label`) })
    expect(screen.queryByRole('button', { name: t(`${F}.apply`) })).not.toBeInTheDocument()
  })
})

describe('MyFeesPanel', () => {
  it('« Mon agenda »: the professional’s fees to decide, « Ne pas facturer »', async () => {
    const user = userEvent.setup()
    mocks.api.fetchFeeDecisions.mockResolvedValue([fee()])
    open(<MyFeesPanel />, 'provider')
    expect(await screen.findByRole('heading', { name: t(`${F}.mineTitle`) })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${F}.waive`) }))
    await waitFor(() => expect(mocks.api.decideFee).toHaveBeenCalledWith('a1', false, null))
    expect(mocks.api.fetchFeeDecisions).toHaveBeenCalledWith('pending')
  })

  it('nothing to decide: nothing shown', async () => {
    mocks.api.fetchFeeDecisions.mockResolvedValue([])
    open(<MyFeesPanel />, 'provider')
    await waitFor(() => expect(mocks.api.fetchFeeDecisions).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: t(`${F}.mineTitle`) })).not.toBeInTheDocument()
  })
})
