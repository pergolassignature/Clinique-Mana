import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { ClientVisit } from '../api/visits'
import { ClientVisitsPanel } from './ClientVisitsPanel'

const mocks = vi.hoisted(() => ({ fetchClientVisits: vi.fn() }))
vi.mock('../api/visits', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))

const V = 'modules.appointments.visits'

const visit = (overrides: Partial<ClientVisit>): ClientVisit => ({
  id: 'v1',
  startsAt: '2099-03-15T14:00:00Z',
  endsAt: '2099-03-15T14:50:00Z',
  state: 'booked',
  mode: 'video',
  professionalId: 'p1',
  professionalName: 'Félix Martin',
  serviceName: 'Consultation individuelle 50 min',
  serviceCode: 10150,
  presence: 'expected',
  role: 'client',
  cancelReason: null,
  cancelLate: null,
  keptOnSchedule: false,
  confirmedAt: null,
  ...overrides,
})

function open(role?: FixtureRole) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/clients/:id/:onglet" element={<ClientVisitsPanel />} />
        </Routes>,
        { path: '/clients/c1/visites', ...(role && { access: { access: accessForRole(role) } }) },
      )}
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('ClientVisitsPanel', () => {
  it('the coming appointments, then the past with their state and presence', async () => {
    mocks.fetchClientVisits.mockResolvedValue([
      visit({ id: 'v1' }),
      visit({ id: 'v2', startsAt: '2020-03-15T14:00:00Z', state: 'completed', presence: 'present' }),
      visit({ id: 'v3', startsAt: '2020-03-08T14:00:00Z', state: 'cancelled', cancelReason: 'Plus requis', cancelLate: true }),
    ])
    open()
    const coming = await screen.findByRole('list', { name: t(`${V}.coming`, { count: '1' }) })
    expect(within(coming).getByText('Réservé')).toBeInTheDocument()
    const past = screen.getByRole('list', { name: t(`${V}.past`) })
    expect(within(past).getByText('Terminé')).toBeInTheDocument()
    expect(within(past).getByText('Présent')).toBeInTheDocument()
    expect(within(past).getByText(t(`${V}.cancelledLate`, { reason: 'Plus requis' }))).toBeInTheDocument()
    expect(mocks.fetchClientVisits).toHaveBeenCalledWith('c1', null)
  })

  it('each date opens the appointment in the agenda (AP-33): « Agenda » for the staff, « Mon agenda » for a professional', async () => {
    mocks.fetchClientVisits.mockResolvedValue([visit({ id: '00000000-0000-4000-8000-0000000000a1' })])
    open('counselor')
    const link = await screen.findByRole('link', { name: /^Ouvrir le rendez-vous du/ })
    expect(link).toHaveAttribute('href', '/agenda?date=2099-03-15&vue=jour&professionnel=p1&rendez-vous=00000000-0000-4000-8000-0000000000a1')
  })

  it('… a professional to « Mon agenda »', async () => {
    mocks.fetchClientVisits.mockResolvedValue([visit({ id: '00000000-0000-4000-8000-0000000000a1' })])
    open('provider')
    const link = await screen.findByRole('link', { name: /^Ouvrir le rendez-vous du/ })
    expect(link).toHaveAttribute('href', '/mon-agenda?date=2099-03-15&vue=jour&rendez-vous=00000000-0000-4000-8000-0000000000a1')
  })

  it('no appointment yet', async () => {
    mocks.fetchClientVisits.mockResolvedValue([])
    open()
    expect(await screen.findByText(t(`${V}.empty`))).toBeInTheDocument()
  })
})
