import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts, testAccess } from '@/test/contexts'
import type { ClientStripe, StripePayer } from '../api/stripe'
import { ClientCardPanel } from './ClientCardPanel'

const mocks = vi.hoisted(() => ({
  api: { fetchClientStripe: vi.fn(), sendCardLink: vi.fn(), chargeNow: vi.fn(), removeCard: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/stripe', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/stripe')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.billing.stripe.panel'
const payer = (over: Partial<StripePayer> = {}): StripePayer => ({
  payer_client_id: 'c1', name: 'Alice Tremblay', is_self: true, card: null, link_sent_at: null, charges: [], ...over,
})
const stripe = (payers: StripePayer[], configured = true): ClientStripe => ({ configured, payers })

afterEach(() => vi.clearAllMocks())

function renderPanel(permissions = ['billing.view', 'billing.manage']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/clients/:id/visites" element={<ClientCardPanel />} />
        </Routes>,
        { path: '/clients/c1/visites', access: { access: { ...testAccess, permissions, modules: ['billing'] } } },
      )}
    </QueryClientProvider>,
  )
}

describe('ClientCardPanel (« Carte au dossier », FS)', () => {
  it('no card: « Envoyer le lien pour enregistrer une carte » sends it', async () => {
    mocks.api.fetchClientStripe.mockResolvedValue(stripe([payer()]))
    mocks.api.sendCardLink.mockResolvedValue(undefined)
    renderPanel()
    expect(await screen.findByText(t(`${S}.noCard`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${S}.send`) }))
    await waitFor(() => expect(mocks.api.sendCardLink).toHaveBeenCalledWith('c1'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.linkSent`, { name: 'Alice Tremblay' }))
  })

  it('a card on file: brand, last four digits and expiry, never more; « Retirer la carte » asks first', async () => {
    mocks.api.fetchClientStripe.mockResolvedValue(stripe([payer({
      card: { brand: 'visa', last4: '4242', exp_month: 3, exp_year: 2030, consent_at: '2026-11-02T14:00:00Z' },
    })]))
    mocks.api.removeCard.mockResolvedValue(undefined)
    renderPanel()
    expect(await screen.findByText(/Visa •••• 4242/)).toBeInTheDocument()
    expect(screen.getByText(/03\/2030/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${S}.remove`) }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t(`${S}.remove`) }))
    await waitFor(() => expect(mocks.api.removeCard).toHaveBeenCalledWith('c1'))
  })

  it('a refused charge: its reason and « Prélever maintenant »', async () => {
    mocks.api.fetchClientStripe.mockResolvedValue(stripe([payer({
      card: { brand: 'visa', last4: '4242', exp_month: 3, exp_year: 2030, consent_at: null },
      charges: [{ id: 'ch1', invoice_id: 'f1', invoice_number: '2026-1', kind: 'auto', amount_cents: 13000, status: 'failed', failure_code: 'insufficient_funds', created_at: '2026-11-03T15:00:00Z' }],
    })]))
    mocks.api.chargeNow.mockResolvedValue({ status: 'failed', failure_code: 'card_declined' })
    renderPanel()
    expect(await screen.findByText(t('modules.billing.stripe.failures.insufficient_funds'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${S}.chargeNow`) }))
    await waitFor(() => expect(mocks.api.chargeNow).toHaveBeenCalledWith('f1'))
    expect(await screen.findByText(t(`${S}.chargeRefused`, { reason: t('modules.billing.stripe.failures.card_declined') }))).toBeInTheDocument()
  })

  it('Facturation reserved for testers: the refusal is said', async () => {
    mocks.api.fetchClientStripe.mockResolvedValue(stripe([payer()]))
    mocks.api.sendCardLink.mockRejectedValue(new FunctionCallError('conflict', 409, 'reserved'))
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.send`) }))
    expect(await screen.findByText(t('modules.billing.stripe.errors.reserved'))).toBeInTheDocument()
  })

  it('Stripe not set: said, no action; the conseillère sees no button', async () => {
    mocks.api.fetchClientStripe.mockResolvedValue(stripe([payer()], false))
    renderPanel(['billing.view'])
    expect(await screen.findByText(t(`${S}.notConfigured`))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
