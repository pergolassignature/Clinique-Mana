import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { PropositionPage } from './PropositionPage'

const mocks = vi.hoisted(() => ({ resolvePropositionLink: vi.fn(), answerProposition: vi.fn() }))
vi.mock('../../api/propositions', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.demandes.propositions.page'
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

const display = {
  clinic_name: 'Clinique MANA',
  timezone: 'America/Toronto',
  language: 'fr',
  professional_name: 'Pro Un',
  professional_title: 'Psychologue',
  service_name: 'Consultation 50 min',
  mode: 'video',
  expires_at: '2026-10-15T15:00:00Z',
  slots: [
    { id: 's1', starts_at: '2026-10-20T13:00:00Z', ends_at: '2026-10-20T13:50:00Z' },
    { id: 's2', starts_at: '2026-10-21T13:00:00Z', ends_at: '2026-10-21T13:50:00Z' },
  ],
}

function open(hash = `#t=${TOKEN}`) {
  window.history.replaceState(null, '', `/proposition${hash}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/proposition" element={<PropositionPage />} />
        </Routes>,
        { path: `/proposition${hash}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.resolvePropositionLink.mockResolvedValue(display)
  mocks.answerProposition.mockResolvedValue({ state: 'accepted', starts_at: '2026-10-20T13:00:00Z' })
})
afterEach(() => vi.clearAllMocks())

describe('PropositionPage', () => {
  it('the token leaves the address; one slot chosen and booked', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(/Clinique MANA vous propose un premier rendez-vous avec Pro Un, Psychologue/)).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    await user.click(screen.getByRole('radio', { name: /mardi 20 octobre à 9 h 00/i }))
    await user.click(screen.getByRole('button', { name: t(`${A}.accept`) }))
    await waitFor(() => expect(mocks.answerProposition).toHaveBeenCalledWith(TOKEN, { appointmentId: 's1' }))
    expect(await screen.findByText(t(`${A}.acceptedTitle`))).toBeInTheDocument()
  })

  it('a slot taken meanwhile: said plainly, the others offered again', async () => {
    const user = userEvent.setup()
    mocks.answerProposition.mockResolvedValue({ state: 'unavailable', reason: 'overlap' })
    open()
    await user.click(await screen.findByRole('radio', { name: /mardi 20 octobre/i }))
    await user.click(screen.getByRole('button', { name: t(`${A}.accept`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${A}.unavailable.overlap`))
    await waitFor(() => expect(mocks.resolvePropositionLink).toHaveBeenCalledTimes(2))
  })

  it('« Aucune ne me convient » with a reason', async () => {
    const user = userEvent.setup()
    mocks.answerProposition.mockResolvedValue({ state: 'declined' })
    open()
    await user.click(await screen.findByRole('button', { name: t(`${A}.none`) }))
    await user.selectOptions(screen.getByRole('combobox', { name: t(`${A}.reasonLabel`) }), 'schedule')
    await user.click(screen.getByRole('button', { name: t(`${A}.declineConfirm`) }))
    await waitFor(() => expect(mocks.answerProposition).toHaveBeenCalledWith(TOKEN, { decline: 'schedule' }))
    expect(await screen.findByText(t(`${A}.declinedBody`))).toBeInTheDocument()
  })

  it('a used or expired link: « ne peut plus être utilisé »', async () => {
    mocks.resolvePropositionLink.mockRejectedValue(new FunctionCallError('link_used', 410, 'Used'))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${A}.invalid`))
  })
})

describe('PropositionPage in English', () => {
  it('an English person: the page, the times and the reasons in English; <html lang> follows', async () => {
    const user = userEvent.setup()
    mocks.resolvePropositionLink.mockResolvedValue({ ...display, language: 'en' })
    const view = open()
    expect(await screen.findByText(/Clinique MANA offers you a first appointment with Pro Un, Psychologue/)).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en-CA')
    expect(screen.getByRole('radio', { name: /Tuesday, October 20 at 9:00 a\.m\./i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('modules.demandes.propositions.pageEn.none') }))
    expect(screen.getByRole('option', { name: t('modules.demandes.propositions.reasonsEn.changed_mind') })).toBeInTheDocument()
    view.unmount()
    expect(document.documentElement.lang).not.toBe('en-CA')
  })
})
