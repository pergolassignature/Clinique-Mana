import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { BookingCancelPage } from './BookingCancelPage'

const mocks = vi.hoisted(() => ({ resolveCancelLink: vi.fn(), cancelCall: vi.fn() }))
vi.mock('../../api/booking', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.demandes.booking.cancel'
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

function open(hash = `#t=${TOKEN}`) {
  window.history.replaceState(null, '', `/appel-decouverte/annuler${hash}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/appel-decouverte/annuler" element={<BookingCancelPage />} />
        </Routes>,
        { path: `/appel-decouverte/annuler${hash}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.resolveCancelLink.mockResolvedValue({ clinic_name: 'Clinique MANA', timezone: 'America/Toronto', starts_at: '2026-10-14T13:00:00.000Z', language: 'fr' })
  mocks.cancelCall.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('BookingCancelPage', () => {
  it('the token leaves the address; the call is shown, then cancelled once', async () => {
    open()
    expect(await screen.findByText(/Clinique MANA est prévu le mercredi 14 octobre à 9 h 00/)).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mocks.resolveCancelLink).toHaveBeenCalledExactlyOnceWith(TOKEN)
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.confirm`) }))
    await waitFor(() => expect(mocks.cancelCall).toHaveBeenCalledExactlyOnceWith(TOKEN))
    expect(await screen.findByText(t(`${C}.doneTitle`))).toBeInTheDocument()
  })

  it('a malformed or spent link: « plus valide », no call', async () => {
    open('#t=court')
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.invalid`))
    expect(mocks.resolveCancelLink).not.toHaveBeenCalled()
  })

  it('a link already used reads the same', async () => {
    mocks.resolveCancelLink.mockRejectedValue(new FunctionCallError('link_used', 410, 'Used'))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.invalid`))
  })
})
