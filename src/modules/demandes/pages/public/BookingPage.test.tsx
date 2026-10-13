import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { BookingPage } from './BookingPage'

const mocks = vi.hoisted(() => ({ api: { fetchBookingPage: vi.fn(), bookCall: vi.fn() }, solveCheck: vi.fn() }))
vi.mock('../../api/booking', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('../../lib/booking', async (importOriginal) => ({ ...(await importOriginal<object>()), solveCheck: mocks.solveCheck }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.demandes.booking.page'
const ORG = '00000000-0000-4000-8000-000000000001'
const SLOT_1 = '2026-10-14T13:00:00.000Z' // 9 h 00 in Montréal
const SLOT_2 = '2026-10-14T13:30:00.000Z'
const PAGE = {
  open: true,
  clinic_name: 'Clinique MANA',
  timezone: 'America/Toronto',
  slot_minutes: 15,
  slots: [SLOT_1, SLOT_2, '2026-10-15T14:00:00.000Z'],
  referral_sources: [{ id: 'r1', name: 'Instagram' }],
  check: { ticket: 'ticket.sig', bits: 16 },
}

function open(search = `?clinique=${ORG}&utm_source=instagram&utm_campaign=automne`) {
  window.history.replaceState(null, '', `/appel-decouverte${search}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/appel-decouverte" element={<BookingPage />} />
        </Routes>,
        { path: `/appel-decouverte${search}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

async function fill() {
  await userEvent.click(await screen.findByRole('radio', { name: /mercredi 14 octobre à 9 h 00/ }))
  await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`^${t(`${P}.firstName`)}`) }), 'Camille')
  await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`^${t(`${P}.lastName`)}`) }), 'Essai')
  await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`^${t(`${P}.email`)}`) }), 'camille@exemple.test')
  await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`^${t(`${P}.phone`)}`) }), '514 555-0101')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: t(`${P}.heard`) }), 'r1')
}

beforeEach(() => {
  mocks.api.fetchBookingPage.mockResolvedValue(PAGE)
  mocks.solveCheck.mockResolvedValue('42')
  mocks.api.bookCall.mockResolvedValue({ starts_at: SLOT_1, timezone: 'America/Toronto', emailed: true })
})
afterEach(() => vi.clearAllMocks())

describe('BookingPage', () => {
  it('no clinic in the address, or a closed one: says to call, offers nothing', async () => {
    open('')
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${P}.closed`))
    expect(mocks.api.fetchBookingPage).not.toHaveBeenCalled()
    mocks.api.fetchBookingPage.mockResolvedValue({ open: false })
  })

  it('the slots by day in the clinic’s time, then the booking with its source; « réservé »', async () => {
    open()
    // The first day is chosen: its two times; another day shows its own.
    expect(await screen.findAllByRole('radio')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: /jeu\.? 15 oct/i }))
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /mer\.? 14 oct/i }))
    await fill()
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.submit`) }))
    await waitFor(() => expect(mocks.api.bookCall).toHaveBeenCalledOnce())
    expect(mocks.solveCheck).toHaveBeenCalledWith('ticket.sig', 16)
    expect(mocks.api.bookCall.mock.calls[0]![0]).toMatchObject({
      org: ORG,
      ticket: 'ticket.sig',
      nonce: '42',
      startsAt: SLOT_1,
      firstName: 'Camille',
      phoneE164: '+15145550101',
      referralSourceId: 'r1',
      source: { utm: { utm_source: 'instagram', utm_campaign: 'automne' } },
    })
    expect(await screen.findByText(t(`${P}.doneTitle`))).toBeInTheDocument()
    expect(screen.getByText(/mercredi 14 octobre à 9 h 00/)).toBeInTheDocument()
  })

  it('checks before any call: a slot, the names, an email, a phone', async () => {
    open()
    await screen.findByText(/mercredi 14 octobre/i)
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.submit`) }))
    expect(screen.getByText(t(`${P}.chooseSlotFirst`))).toBeInTheDocument()
    expect(screen.getByText(t(`${P}.invalidEmail`))).toBeInTheDocument()
    expect(screen.getByText(t(`${P}.invalidPhone`))).toBeInTheDocument()
    expect(mocks.solveCheck).not.toHaveBeenCalled()
  })

  it('a refusal (the slot was just taken) is shown as written, and the page reloads its slots', async () => {
    mocks.api.bookCall.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Cette plage n’est plus libre : choisissez-en une autre.', { refusal: true }))
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.submit`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cette plage n’est plus libre')
    await waitFor(() => expect(mocks.api.fetchBookingPage).toHaveBeenCalledTimes(2))
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

describe('BookingPage in English', () => {
  it('&lang=en: the page, the times and the call language in English; « Français » switches back', async () => {
    open(`?clinique=${ORG}&lang=en`)
    expect(await screen.findByRole('radio', { name: /Wednesday, October 14 at 9:00 a\.m\./ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: new RegExp(`^${t('modules.demandes.booking.pageEn.firstName')}`) })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: t('modules.demandes.booking.pageEn.language') })).toHaveValue('en')
    expect(screen.getByRole('link', { name: 'Français' })).toHaveAttribute('href', `/appel-decouverte?clinique=${ORG}`)
  })

  it('in French, « English » opens the English page', async () => {
    open(`?clinique=${ORG}`)
    expect(await screen.findByRole('link', { name: 'English' })).toHaveAttribute('href', `/appel-decouverte?clinique=${ORG}&lang=en`)
  })
})
