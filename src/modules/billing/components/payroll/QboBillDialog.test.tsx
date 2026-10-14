import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { testAccess, renderWithContexts } from '@/test/contexts'
import { FunctionCallError } from '@/core/supabase/functions'
import type { PayoutPeriod } from '../../api/payroll'
import { PayoutPeriodDetail } from './PayoutPeriodDetail'

const mocks = vi.hoisted(() => ({
  api: { checkQboBillVoided: vi.fn(), forceClearQboBill: vi.fn(), reopenPayoutPeriod: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/payroll', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/payroll')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@/core/storage/hooks', () => ({ useSignedFileUrl: () => ({ data: { url: 'https://files.test/f.pdf' }, isError: false }) }))

const P = 'modules.billing.payroll.period'
const PERIOD = 'p0000000-0000-0000-0000-000000000001'

const period = (qboBill: string | null, over: Partial<PayoutPeriod> = {}): PayoutPeriod => ({
  id: PERIOD,
  month: '2026-09-01',
  state: 'validated',
  professional: { professional_id: 'pro1', display_name: 'Pro Un', title_label: 'Psychologue' },
  title_name: 'Psychologue',
  lines_count: 0,
  unpriced_count: 0,
  total_cents: 34600,
  built_at: '2026-10-01T11:15:00Z',
  sent_at: '2026-10-01T14:00:00Z',
  correction_note: null,
  correction_requested_at: null,
  validated_at: '2026-10-02T14:00:00Z',
  reopen_reason: null,
  paid_on: null,
  payment_note: null,
  lines: [],
  invoice: {
    id: 'i1',
    source: 'uploaded',
    file_id: 'f1',
    number: 'PU-2026-09',
    issued_on: '2026-10-01',
    amount_cents: 34600,
    created_at: '2026-10-02T14:00:00Z',
    qbo_bill_id: qboBill,
  },
  ...over,
})

function renderDetail(value: PayoutPeriod, { audience = 'staff', permissions = ['billing.payroll'] }: { audience?: 'staff' | 'professional'; permissions?: string[] } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(<PayoutPeriodDetail period={value} audience={audience} />, {
        access: { access: { ...testAccess, permissions, modules: ['billing'] } },
      })}
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('« Bill annulé dans QuickBooks » (BI-27)', () => {
  it('shows only to the administration, on a validated period whose invoice has a Bill', () => {
    renderDetail(period('901'))
    expect(screen.getByRole('button', { name: t(`${P}.actions.billVoided`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${P}.notices.inQuickbooks`, { bill: '901' }))).toBeInTheDocument()
  })

  it('is absent without a Bill', () => {
    renderDetail(period(null))
    expect(screen.queryByRole('button', { name: t(`${P}.actions.billVoided`) })).not.toBeInTheDocument()
  })

  it('is absent in « Ma paie »', () => {
    renderDetail(period('901'), { audience: 'professional', permissions: ['billing.self'] })
    expect(screen.queryByRole('button', { name: t(`${P}.actions.billVoided`) })).not.toBeInTheDocument()
  })

  it('asks QuickBooks, then says the Bill is forgotten', async () => {
    mocks.api.checkQboBillVoided.mockResolvedValue({ status: 'cleared', qbo: 'deleted' })
    const user = userEvent.setup()
    renderDetail(period('901'))
    await user.click(screen.getByRole('button', { name: t(`${P}.actions.billVoided`) }))
    expect(screen.getByText(t(`${P}.billDialog.description`, { bill: '901' }))).toBeInTheDocument()
    // Without billing.settings, no way to force.
    expect(screen.queryByRole('button', { name: t(`${P}.billDialog.force`) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${P}.billDialog.verify`) }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${P}.toasts.billCleared`)))
    expect(mocks.api.checkQboBillVoided).toHaveBeenCalledWith(PERIOD)
  })

  it('shows QuickBooks’ refusal as written when the Bill still exists, and a not-connected QuickBooks plainly', async () => {
    const still = "Le Bill existe toujours dans QuickBooks : supprimez-le d'abord."
    mocks.api.checkQboBillVoided.mockRejectedValueOnce(new FunctionCallError('invalid_request', 400, still, { refusal: true }))
    mocks.api.checkQboBillVoided.mockRejectedValueOnce(new FunctionCallError('not_found', 404, 'Not connected'))
    const user = userEvent.setup()
    renderDetail(period('901'))
    await user.click(screen.getByRole('button', { name: t(`${P}.actions.billVoided`) }))
    await user.click(screen.getByRole('button', { name: t(`${P}.billDialog.verify`) }))
    expect(await screen.findByText(still)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${P}.billDialog.verify`) }))
    expect(await screen.findByText(t('modules.billing.payroll.errors.qboBill.notConnected'))).toBeInTheDocument()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('lets whoever manages QuickBooks force it, with a warning and a reason of 10 characters', async () => {
    mocks.api.forceClearQboBill.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDetail(period('901'), { permissions: ['billing.payroll', 'billing.settings'] })
    await user.click(screen.getByRole('button', { name: t(`${P}.actions.billVoided`) }))
    await user.click(screen.getByRole('button', { name: t(`${P}.billDialog.force`) }))
    expect(screen.getByText(t(`${P}.forceDialog.warning`))).toBeInTheDocument()
    const reason = screen.getByRole('textbox', { name: new RegExp(t(`${P}.forceDialog.label`)) })
    await user.type(reason, 'Supprimé')
    await user.click(screen.getByRole('button', { name: t(`${P}.forceDialog.submit`) }))
    expect(screen.getByText(t('modules.billing.payroll.dialogs.noteLength', { min: '10', max: '500' }))).toBeInTheDocument()
    expect(mocks.api.forceClearQboBill).not.toHaveBeenCalled()
    await user.type(reason, ' dans QuickBooks hier')
    await user.click(screen.getByRole('button', { name: t(`${P}.forceDialog.submit`) }))
    await waitFor(() => expect(mocks.api.forceClearQboBill).toHaveBeenCalledWith(PERIOD, 'Supprimé dans QuickBooks hier'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${P}.toasts.billCleared`))
  })
})
