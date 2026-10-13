import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import type { PayerOrganisation } from '../../api/payers'
import { PayersSettingsPage } from './PayersSettingsPage'

const mocks = vi.hoisted(() => ({
  payers: { fetchPayerSettings: vi.fn(), fetchPayerOrganisations: vi.fn(), setIvacRate: vi.fn(), savePayerOrganisation: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/payers', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.payers }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.billing.payers.settings'

const IVAC: PayerOrganisation = {
  id: 'o-ivac',
  kind: 'ivac',
  name: 'IVAC',
  billingEmail: null,
  contactName: null,
  language: 'fr',
  providerNumber: null,
  cadence: 'monthly',
  dueDays: 30,
  remindersEnabled: false,
  isActive: true,
  note: null,
}

function open(role: FixtureRole = 'admin') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderInSettingsSection(<PayersSettingsPage />, { access: { access: accessForRole(role) } })}</QueryClientProvider>)
}

beforeEach(() => {
  mocks.payers.fetchPayerSettings.mockResolvedValue({ ivacRateCents: 9450, ivacRates: [{ effectiveFrom: '2000-01-01', sessionCents: 9450 }] })
  mocks.payers.fetchPayerOrganisations.mockResolvedValue([IVAC])
  mocks.payers.setIvacRate.mockResolvedValue(undefined)
  mocks.payers.savePayerOrganisation.mockResolvedValue('o-new')
})
afterEach(() => vi.clearAllMocks())

describe('PayersSettingsPage', () => {
  it('IVAC’s rate: the current one, a new one from a day (FP-10)', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(t(`${S}.rate.current`, { amount: '94,50 $' }))).toBeInTheDocument()
    const card = screen.getByRole('form', { name: t(`${S}.rate.title`) })
    await user.type(within(card).getByLabelText(new RegExp(`^${t(`${S}.rate.newAmount`)}`)), '96,25')
    await user.click(within(card).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.payers.setIvacRate).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 9625))
  })

  it('a PAE provider added with its billing address, by thirds by default, no reminders', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: t(`${S}.organisations.add`) }))
    const dialog = screen.getByRole('dialog', { name: t(`${S}.dialog.addTitle`) })
    await user.type(within(dialog).getByLabelText(/^Nom/), 'Fournisseur X')
    await user.type(within(dialog).getByLabelText(/^Courriel de facturation/), 'factures@x.test')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.payers.savePayerOrganisation).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, name: 'Fournisseur X', billingEmail: 'factures@x.test', cadence: 'threshold', dueDays: 30, remindersEnabled: false, isActive: true }),
      ),
    )
  })

  it('the adjointe manages the organisations, not IVAC’s rate', async () => {
    open('admin_assistant')
    expect(await screen.findByRole('button', { name: t(`${S}.organisations.add`) })).toBeInTheDocument()
    expect(screen.queryByLabelText(new RegExp(`^${t(`${S}.rate.newAmount`)}`))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${S}.organisations.editLabel`, { name: 'IVAC' }) })).toBeInTheDocument()
  })
})
