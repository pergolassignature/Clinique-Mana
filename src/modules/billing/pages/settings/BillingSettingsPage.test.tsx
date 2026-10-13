import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { BillingSettingsPage } from './BillingSettingsPage'

const mocks = vi.hoisted(() => ({
  queue: { fetchBillingSettings: vi.fn(), setInvoiceNote: vi.fn() },
  invoices: { fetchSequence: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/queue', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.queue }))
vi.mock('../../api/invoices', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.invoices }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const N = 'modules.billing.settings.invoiceNote'
const DEFAULT_FR = 'Votre reçu vous est envoyé dans les 24 h ouvrables suivant votre paiement.'

function open(readOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderInSettingsSection(<BillingSettingsPage />, { readOnly, access: { access: accessForRole('admin') } })}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.invoices.fetchSequence.mockResolvedValue(0)
  mocks.queue.fetchBillingSettings.mockResolvedValue({
    queueFrom: null,
    dunningFrom: null,
    dunningDays: [3, 5, 7, 10],
    blockAfterDays: 10,
    invoiceNote: { fr: DEFAULT_FR, en: 'Your receipt is sent to you within 24 business hours of your payment.', frDefault: true, enDefault: true },
    etransferEmail: 'paiements@exemple.test',
  })
  mocks.queue.setInvoiceNote.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('BillingSettingsPage — « Note des factures » (BI-21)', () => {
  it('shows the Interac line and the default notes; a changed note is saved', async () => {
    const user = userEvent.setup()
    open()
    const card = await screen.findByRole('form', { name: t(`${N}.title`) })
    expect(within(card).getByText(t(`${N}.interac`, { email: 'paiements@exemple.test' }))).toBeInTheDocument()
    expect(within(card).getAllByText(t(`${N}.isDefault`))).toHaveLength(2)
    const fr = within(card).getByLabelText(new RegExp(`^${t(`${N}.fr`)}`))
    await user.clear(fr)
    await user.type(fr, 'Merci de payer le jour même.')
    await user.click(within(card).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.queue.setInvoiceNote).toHaveBeenCalledWith('Merci de payer le jour même.', 'Your receipt is sent to you within 24 business hours of your payment.'),
    )
  })

  it('read-only without billing.settings', async () => {
    open(true)
    const card = await screen.findByRole('form', { name: t(`${N}.title`) })
    expect(within(card).getByLabelText(new RegExp(`^${t(`${N}.fr`)}`))).toHaveAttribute('readonly')
    expect(within(card).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })
})
