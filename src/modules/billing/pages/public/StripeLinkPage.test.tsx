import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { CardSetupPage, PayPage } from './StripeLinkPage'

const mocks = vi.hoisted(() => ({
  api: { resolveCardLink: vi.fn(), resolvePayLink: vi.fn(), openCheckout: vi.fn() },
  leaveFor: vi.fn(),
}))
vi.mock('../../api/stripe', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/stripe')>()), ...mocks.api }))
vi.mock('../../lib/leave-for', () => ({ leaveFor: mocks.leaveFor }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.billing.stripe.public'
const TOKEN = 'a'.repeat(42) + 'A'

afterEach(() => vi.clearAllMocks())

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/carte" element={<CardSetupPage />} />
          <Route path="/payer" element={<PayPage />} />
        </Routes>,
        { path },
      )}
    </QueryClientProvider>,
  )
}

describe('the public Stripe pages (FS)', () => {
  it('/payer: the invoice and its balance, then Stripe Checkout', async () => {
    mocks.api.resolvePayLink.mockResolvedValue({
      clinic_name: 'Clinique MANA', language: 'fr', invoice_number: '2026-3', issued_on: '2026-11-02',
      total_cents: 20000, balance_cents: 20000, available: true,
    })
    mocks.api.openCheckout.mockResolvedValue({ state: 'valid', url: 'https://checkout.stripe.com/c/pay/cs_1' })
    renderAt(`/payer#t=${TOKEN}`)
    expect(await screen.findByText(/200,00/)).toBeInTheDocument()
    expect(mocks.api.resolvePayLink).toHaveBeenCalledWith(TOKEN)
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.pay.button`) }))
    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1'))
  })

  it('/payer: paid meanwhile says so', async () => {
    mocks.api.resolvePayLink.mockResolvedValue({
      clinic_name: 'Clinique MANA', language: 'fr', invoice_number: '2026-3', issued_on: '2026-11-02',
      total_cents: 20000, balance_cents: 20000, available: true,
    })
    mocks.api.openCheckout.mockResolvedValue({ state: 'paid' })
    renderAt(`/payer#t=${TOKEN}`)
    await userEvent.click(await screen.findByRole('button', { name: t(`${P}.pay.button`) }))
    expect(await screen.findByText(t(`${P}.pay.alreadyPaid`))).toBeInTheDocument()
    expect(mocks.leaveFor).not.toHaveBeenCalled()
  })

  it('/carte: the authorization before Stripe; back with ?etat=merci, thanks', async () => {
    mocks.api.resolveCardLink.mockResolvedValue({ clinic_name: 'Clinique MANA', language: 'fr', first_name: 'Alice', has_card: false })
    renderAt(`/carte#t=${TOKEN}`)
    expect(await screen.findByText(t(`${P}.card.authorization`, { clinic: 'Clinique MANA' }))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${P}.card.button`) })).toBeInTheDocument()
  })

  it('back from Stripe: thanks, or cancelled, without a token', () => {
    renderAt('/carte?etat=merci')
    expect(screen.getByText(t(`${P}.card.thanks`))).toBeInTheDocument()
    expect(mocks.api.resolveCardLink).not.toHaveBeenCalled()
  })

  it('a used or unknown link says so', async () => {
    mocks.api.resolveCardLink.mockRejectedValue(new FunctionCallError('link_invalid', 410, 'gone'))
    renderAt(`/carte#t=${TOKEN}`)
    expect(await screen.findByText(t(`${P}.invalid`))).toBeInTheDocument()
  })
})

describe('the public Stripe pages in English', () => {
  it('/payer for an English payer: the invoice, the date and the amount in English', async () => {
    mocks.api.resolvePayLink.mockResolvedValue({
      clinic_name: 'Clinique MANA', language: 'en', invoice_number: '2026-3', issued_on: '2026-11-02',
      total_cents: 20000, balance_cents: 20000, available: true,
    })
    renderAt(`/payer#t=${TOKEN}`)
    expect(await screen.findByText('Invoice 2026-3 of November 2, 2026, Clinique MANA.')).toBeInTheDocument()
    expect(screen.getByText('Balance due: $200.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('modules.billing.stripe.publicEn.pay.button') })).toBeInTheDocument()
  })

  it('back from Stripe with &lang=en: thanks in English', () => {
    renderAt('/carte?etat=merci&lang=en')
    expect(screen.getByText(t('modules.billing.stripe.publicEn.card.thanks'))).toBeInTheDocument()
  })
})
