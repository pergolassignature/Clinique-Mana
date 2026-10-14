import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import { AppointmentsHomeCard } from './AppointmentsHomeCard'

const mocks = vi.hoisted(() => ({ agenda: vi.fn(), withoutReminder: vi.fn() }))
vi.mock('../api/agenda', async (o) => ({ ...(await o<typeof import('../api/agenda')>()), fetchAgenda: mocks.agenda }))
vi.mock('../api/messages', async (o) => ({ ...(await o<typeof import('../api/messages')>()), fetchWithoutReminder: mocks.withoutReminder }))

const H = 'modules.appointments.home'
const later = new Date(Date.now() + 3_600_000).toISOString()
const earlier = new Date(Date.now() - 3_600_000).toISOString()

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

describe('Accueil « Rendez-vous à surveiller » (L29)', () => {
  it('today\'s still to come and not confirmed, never a personal one; the coming ones without a reminder', async () => {
    mocks.agenda.mockResolvedValue([
      { isPersonal: false, state: 'booked', startsAt: later },
      { isPersonal: false, state: 'booked', startsAt: earlier },
      { isPersonal: true, state: 'booked', startsAt: later },
      { isPersonal: false, state: 'confirmed', startsAt: later },
    ])
    mocks.withoutReminder.mockResolvedValue([{}, {}])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}>{renderWithContexts(<AppointmentsHomeCard />, { path: '/accueil' })}</QueryClientProvider>)
    await screen.findByText(t(`${H}.items.withoutReminder`))
    await screen.findByText(t(`${H}.items.unconfirmed`))
    const links = screen.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])
    expect(links[0]![0]).toBe(`1${t(`${H}.items.unconfirmed`)}`)
    expect(links[0]![1]).toMatch(/^\/agenda\?vue=jour&date=\d{4}-\d{2}-\d{2}$/)
    expect(links[1]).toEqual([`2${t(`${H}.items.withoutReminder`)}`, '/agenda?sans-rappel=1'])
  })
})
